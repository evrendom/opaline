import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { disableExternalProviders } from "../lib/self-hosted.js";
import { readSelfHostConfig, SelfHostConfigError } from "./config.js";

const SHUTDOWN_GRACE_MS = 10_000;

function status(line: string): void {
	process.stderr.write(`opaline: ${line}\n`);
}

async function main(): Promise<void> {
	const disabled = disableExternalProviders(process.env);
	const { config, env } = readSelfHostConfig(process.env);
	Object.assign(process.env, env);
	if (disabled.length > 0)
		status(`ignoring ${disabled.join(", ")} (never called when self-hosted)`);
	if (config.dataDir) await mkdir(config.dataDir, { recursive: true });

	const { preparePostgres } = await import("./postgres.js");
	const postgresReady = await preparePostgres(
		process.env.PG_CONNECTION_STRING ?? "",
	);
	status(
		`postgres ${postgresReady.database}: ${postgresReady.migrated || "migrations applied"}`,
	);

	const { bootstrapClickHouseSchema } = await import(
		"@rudel/ch-schema/bootstrap"
	);
	const schema = await bootstrapClickHouseSchema({ env: process.env });
	status(schema.summary);

	const [
		{ fetchHandler, MAX_REQUEST_BODY_BYTES },
		{ createStaticFallback },
		scheduler,
		{ sqlClient },
	] = await Promise.all([
		import("../handler.js"),
		import("../static-site.js"),
		import("./scheduler.js"),
		import("../db.js"),
	]);
	const fallback = config.webDir
		? createStaticFallback({
				directory: config.webDir,
				pluginBuildDirectory: join(config.webDir, "..", "dist-plugin"),
				spaExcludedPrefixes: ["/api/", "/rpc", "/.well-known/", "/health"],
			})
		: undefined;

	const server = Bun.serve({
		hostname: config.host,
		port: config.port,
		maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
		fetch(request, bunServer) {
			return fetchHandler(request, {
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
	status(
		`listening on ${config.host}:${server.port}; jobs: ${jobs.jobs.join(", ")}${config.webDir ? `; web: ${config.webDir}` : "; no OPALINE_WEB_DIR, API only"}`,
	);
	process.stdout.write(`ready ${config.appUrl}\n`);

	let stopping = false;
	const shutdown = async (signal: string) => {
		if (stopping) return;
		stopping = true;
		status(`stopping (${signal})`);
		const timedOut = Symbol("timeout");
		const [settled] = await Promise.all([
			Promise.race([
				Promise.all([jobs.stop(), purgeWorker.stop(), server.stop()]),
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
