import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { disableExternalProviders } from "../lib/self-hosted.js";
import { readSelfHostConfig, SelfHostConfigError } from "./config.js";
import { layoutEnvironment, resolveServerLayout } from "./layout.js";
import { atPublicOrigin } from "./public-request.js";

const SHUTDOWN_GRACE_MS = 10_000;
const LOCAL_INGEST_DEFAULTS = {
	OPALINE_BACKGROUND_WORKERS: "1",
	INGEST_FILTER_WORKERS: "3",
	TRANSCRIPT_RECORDS_QUEUE_MAX_JOBS: "4",
	GIT_OBSERVATION_MAX_JOBS: "4",
} as const;

function status(line: string): void {
	process.stderr.write(`opaline: ${line}\n`);
}

async function main(): Promise<void> {
	const layout = resolveServerLayout(import.meta.dir);
	Object.assign(process.env, layoutEnvironment(process.env, layout));
	const disabled = disableExternalProviders(process.env);
	const { config, env } = readSelfHostConfig(process.env);
	Object.assign(process.env, env);
	if (process.env.OPALINE_LOCAL_INGEST === "1")
		for (const [name, value] of Object.entries(LOCAL_INGEST_DEFAULTS))
			process.env[name] ??= value;
	status(
		`version ${process.env.OPALINE_VERSION?.trim() || "dev"} (${layout.kind} ${layout.root})`,
	);
	if (disabled.length > 0)
		status(`ignoring ${disabled.join(", ")} (never called when self-hosted)`);
	if (config.dataDir) await mkdir(config.dataDir, { recursive: true });

	const { preparePostgres } = await import("./postgres.js");
	const postgresReady = await preparePostgres(
		process.env.PG_CONNECTION_STRING ?? "",
		layout.postgresMigrateScript,
	);
	status(
		`postgres ${postgresReady.database}: ${postgresReady.migrated || "migrations applied"}`,
	);

	const { bootstrapClickHouseSchema } = await import(
		"@rudel/ch-schema/bootstrap"
	);
	const schema = await bootstrapClickHouseSchema({
		env: process.env,
		schemaDir: layout.clickHouseSchemaDir,
	});
	status(schema.summary);

	const [
		{ fetchHandler, MAX_REQUEST_BODY_BYTES },
		{ createStaticFallback },
		scheduler,
		{ sqlClient },
		storage,
		{ registerR2IngestCleanupWorker },
	] = await Promise.all([
		import("../handler.js"),
		import("../static-site.js"),
		import("./scheduler.js"),
		import("../db.js"),
		import("../services/r2-ingest-storage.service.js"),
		import("../services/r2-ingest-cleanup.service.js"),
	]);
	status(
		`object storage: ${storage.describeObjectStore(storage.readR2IngestAvailability())}`,
	);
	const fallback = config.webDir
		? createStaticFallback({
				directory: config.webDir,
				pluginBuildDirectory: join(config.webDir, "..", "dist-plugin"),
				spaExcludedPrefixes: ["/api/", "/rpc", "/.well-known/", "/health"],
			})
		: undefined;

	const publicOrigin = new URL(config.appUrl).origin;
	const server = Bun.serve({
		hostname: config.host,
		port: config.port,
		maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
		fetch(request, bunServer) {
			return fetchHandler(atPublicOrigin(request, publicOrigin), {
				fallback,
				socketIp: bunServer.requestIP(request)?.address ?? null,
			});
		},
	});

	const purgeWorker = await scheduler.startPurgeWorker();
	const jobs = scheduler.startScheduler({
		jobs: scheduler.selfHostedJobs(),
		lock: scheduler.leaseJobLock(sqlClient),
		cronSecret: config.cronSecret,
	});
	if (jobs.jobs.includes("r2-ingest"))
		registerR2IngestCleanupWorker({
			wake: async () => jobs.runNow("r2-ingest"),
		});
	const localIngest = await import("./local-ingest/index.js");
	const ingest = localIngest.isLocalIngestEnabled()
		? await localIngest.startLocalIngest({
				wakeJobs: () => jobs.runNow("l1-edges"),
				log: status,
			})
		: null;
	status(
		`listening on ${config.host}:${server.port}; jobs: ${jobs.jobs.join(", ")}${config.webDir ? `; web: ${config.webDir}` : "; no OPALINE_WEB_DIR, API only"}`,
	);
	status(
		`sign-up: ${config.openSignup ? "open to anyone who reaches the server" : "invite only"}; sql quota: ${config.sqlQuotaPerHour === null ? "off" : `${config.sqlQuotaPerHour} calls per workspace per hour`}`,
	);
	process.stdout.write(`ready ${config.appUrl}\n`);
	void import("../services/github-token.service.js")
		.then(async (github) =>
			status(
				`github: ${github.describeGitHubTokenStatus(await github.readGitHubTokenStatus())}; history ${config.githubHistoryDays} days, polled every 5 minutes`,
			),
		)
		.catch((error: unknown) =>
			status(
				`github: status unknown (${error instanceof Error ? error.message : String(error)})`,
			),
		);

	let stopping = false;
	const shutdown = async (signal: string) => {
		if (stopping) return;
		stopping = true;
		status(`stopping (${signal})`);
		const timedOut = Symbol("timeout");
		const [settled] = await Promise.all([
			Promise.race([
				Promise.all([
					ingest?.stop(),
					jobs.stop(),
					purgeWorker.stop(),
					server.stop(),
				]),
				Bun.sleep(SHUTDOWN_GRACE_MS).then(() => timedOut),
			]),
			import("../services/ingest-filter.service.js").then((module) =>
				module.shutdownIngestFilterQueue(),
			),
			import("../services/usage-extraction.service.js").then((module) =>
				module.shutdownUsageExtractionQueue(),
			),
			import("../services/session-language-signal-scanner.service.js").then(
				(module) => module.shutdownSessionLanguageSignalScanner(),
			),
			import("../services/session-detail-derivation-thread.js").then((module) =>
				module.shutdownSessionDetailDerivationThread(),
			),
		]);
		if (settled === timedOut)
			status("jobs still running after 10s; stopping anyway");
		const db = await import("../db.js");
		await Promise.allSettled([
			db.sqlClient.end({ timeout: 5 }),
			db.ingestProcessingSqlClient.end({ timeout: 5 }),
			db.liveSessionSqlClient.end({ timeout: 5 }),
		]);
		status("stopped");
		process.exit(0);
	};
	for (const signal of ["SIGINT", "SIGTERM"] as const)
		process.on(signal, () => {
			void shutdown(signal);
		});
}

main().catch((error: unknown) => {
	if (error instanceof SelfHostConfigError) {
		process.stderr.write(`${error.message}\n`);
	} else if (
		error instanceof Error &&
		/EADDRINUSE|address already in use/iu.test(
			`${error.message} ${(error as { code?: string }).code ?? ""}`,
		)
	) {
		process.stderr.write(
			`opaline: port ${process.env.PORT} is already in use; stop the other process or choose another --port\n`,
		);
	} else {
		process.stderr.write(
			`opaline: ${error instanceof Error ? error.message : String(error)}\n`,
		);
	}
	process.exit(1);
});
