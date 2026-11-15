import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import {
	clickHouseMemoryBytes,
	formatGiB,
	LOCAL_CLICKHOUSE_USER,
	parseClickHouseMemoryGiB,
	readConfiguredClickHouseMemoryBytes,
	writeClickHouseConfig,
} from "./clickhouse-config.js";
import {
	type ClickHouseConnection,
	probeClickHouse,
} from "./clickhouse-probe.js";
import { createProgressLine } from "./download.js";
import {
	type CredentialPromptContext,
	type FirstRunResult,
	type Reporter,
	runFirstRun,
} from "./first-run.js";
import { readGitHubStatusLines } from "./github-status.js";
import { getSelfHostedMcpUrl } from "./paths.js";
import { detectHostPlatform, type HostPlatform } from "./pinned-runtimes.js";
import { findFreePort, isPortFree } from "./ports.js";
import {
	getPostgresConnectionString,
	getPostgresLayout,
	getPostgresStartArgs,
	initializePostgres,
	POSTGRES_DATABASE,
	POSTGRES_USER,
	probePostgres,
	readPostgresDataMajor,
} from "./postgres.js";
import {
	getServicePaths,
	isAlive,
	type PidRecord,
	readRunningService,
	SERVICE_NAMES,
	type ServiceName,
	sleep,
	startDetachedService,
	stopService,
	tailFile,
} from "./processes.js";
import {
	createRuntimeContext,
	type ResolvedRuntime,
	type RuntimeContext,
	resolveBun,
	resolveClickHouse,
	resolvePostgres,
} from "./runtimes.js";
import {
	isLoopbackHostname,
	parseSafeBrowserUrl,
	sanitizeForTerminalDisplay,
} from "./safe-url.js";
import { createSelfHostLoginLink, fetchSelfHostInfo } from "./selfhost-api.js";
import {
	compareServerVersions,
	getServerInstallRoot,
	pruneServerInstalls,
	SERVER_ARTIFACT_ENV,
} from "./server-artifact.js";
import {
	type PreparedServerDistribution,
	prepareServerDistribution,
	type ServerDistribution,
} from "./server-distribution.js";
import { createEventProgress, type ServerEventSink } from "./server-events.js";
import { readServerSettings } from "./server-settings.js";
import {
	type ClickHouseState,
	createSecrets,
	DEFAULT_SERVER_HOST,
	DEFAULT_SERVER_PORT,
	generateSecret,
	loadServerState,
	type RuntimeRecord,
	resolveServerDataDir,
	type ServerState,
	saveServerState,
} from "./server-state.js";
import { getLauncherVersion } from "./version.js";

export interface ServerStartFlags {
	readonly clickhouseUrl?: string;
	readonly clickhouseUser?: string;
	readonly clickhousePassword?: string;
	readonly clickhouseMemory?: string;
	readonly port?: number;
	readonly host?: string;
	readonly publicUrl?: string;
	readonly dataDir?: string;
	readonly email?: string;
	readonly noAgentSetup: boolean;
	readonly noBrowser: boolean;
	readonly yes: boolean;
}

export interface ServerRunnerContext {
	readonly env: NodeJS.ProcessEnv;
	readonly home: string;
	readonly reporter: Reporter;
	readonly interactive: boolean;
	readonly confirm: (message: string) => Promise<boolean>;
	readonly openBrowser: (url: string) => void;
	readonly cliVersion?: string;
	readonly fetchImpl?: typeof fetch;
	readonly events?: ServerEventSink;
}

const PASSTHROUGH_ENV = [
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TMPDIR",
	"TZ",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"NODE_EXTRA_CA_CERTS",
	"GH_HOST",
	"GH_CONFIG_DIR",
	"XDG_CONFIG_HOME",
	"CLAUDE_CONFIG_DIR",
	"CODEX_HOME",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
] as const;

export const LOCAL_INGEST_ENVIRONMENT = {
	OPALINE_LOCAL_INGEST: "1",
} as const;

const CLICKHOUSE_READY_TIMEOUT_MS = 90_000;
const POSTGRES_READY_TIMEOUT_MS = 60_000;
const DEFAULT_SERVER_READY_TIMEOUT_MS = 300_000;

export async function startServer(
	flags: ServerStartFlags,
	context: ServerRunnerContext,
): Promise<undefined | Error> {
	const { reporter } = context;
	const dataDir = resolveServerDataDir(
		flags.dataDir,
		context.env,
		context.home,
	);
	const platform = detectHostPlatform();
	if (platform instanceof Error) return platform;
	let existing: ServerState | undefined;
	try {
		existing = loadServerState(dataDir);
	} catch (error) {
		return asError(error);
	}
	const planned = await planServerState(existing, flags, context);
	if (planned instanceof Error) return planned;
	const early =
		context.events && !(await readRunningServices(dataDir)).server
			? resolveRuntimesEarly(dataDir, platform, planned.state, context)
			: undefined;
	const distribution = await prepareServerDistribution({
		dataDir,
		env: context.env,
		cliVersion: context.cliVersion ?? getLauncherVersion(),
		log: reporter.info,
		progress: (label) =>
			context.events
				? createEventProgress(context.events)(label)
				: createProgressLine(label),
		fetchImpl: context.fetchImpl,
		currentInstall:
			existing?.server?.kind === "packaged" ? existing.server.root : undefined,
	});
	if (distribution instanceof Error) return distribution;
	try {
		return await startWithDistribution({
			dataDir,
			platform,
			existing,
			planned,
			distribution,
			flags,
			context,
			early,
		});
	} finally {
		distribution.discard();
	}
}

async function startWithDistribution(options: {
	readonly dataDir: string;
	readonly platform: HostPlatform;
	readonly existing: ServerState | undefined;
	readonly planned: PlannedState;
	readonly distribution: PreparedServerDistribution;
	readonly flags: ServerStartFlags;
	readonly context: ServerRunnerContext;
	readonly early?: EarlyRuntimes;
}): Promise<undefined | Error> {
	const { dataDir, platform, existing, planned, distribution, flags, context } =
		options;
	const { reporter } = context;
	let state = planned.state;
	const localUrl = getLocalServerUrl(state);
	clearStoppedMarker(dataDir);

	const downgrade = describeDowngrade(existing, distribution);
	if (downgrade && !flags.yes) {
		if (!context.interactive)
			return new Error(`${downgrade} Add --yes to start it anyway.`);
		if (!(await context.confirm(`${downgrade} Start it anyway?`)))
			return new Error("Nothing changed.");
	}

	const running = await readRunningServices(dataDir);
	const switching =
		running.server !== undefined &&
		needsServerSwitch(running.server, existing?.server, distribution);
	const desiredMemory =
		state.clickhouse.mode === "local"
			? clickHouseMemoryBytes(state.clickhouse.memoryGiB)
			: undefined;
	const configuredMemory = readConfiguredClickHouseMemoryBytes(dataDir);
	const memoryChanged =
		running.clickhouse !== undefined &&
		desiredMemory !== undefined &&
		configuredMemory !== desiredMemory;
	const ready = running.server ? await isServerReady(localUrl) : false;
	if (ready && planned.changed)
		return new Error(
			`The server in ${dataDir} is already running with other settings. Run \`opaline server stop\` first, then start it with the new settings.`,
		);
	if (ready && !switching && !memoryChanged) {
		context.events?.({
			type: "ready",
			url: state.publicUrl,
			localUrl,
			...(state.server?.version ? { version: state.server.version } : {}),
			alreadyRunning: true,
		});
		if (!state.setup) {
			const firstRun = await completeFirstRun(
				state,
				localUrl,
				flags,
				context,
				planned.urlChanged,
			);
			if (firstRun instanceof Error) return firstRun;
			state = firstRun.state;
			saveServerState(dataDir, state);
			emitFirstRun(firstRun, context);
			printLinks(state, firstRun.loginUrl, flags, context);
			context.events?.({ type: "done", url: state.publicUrl });
			return;
		}
		if (context.events) {
			const firstRun = await completeFirstRun(
				state,
				localUrl,
				flags,
				context,
				planned.urlChanged,
			);
			if (firstRun instanceof Error) return firstRun;
			state = firstRun.state;
			saveServerState(dataDir, state);
			emitFirstRun(firstRun, context);
			context.events({ type: "done", url: state.publicUrl });
			return;
		}
		reporter.info(`Opaline is already running at ${state.publicUrl}.`);
		for (const line of await describeStatus(dataDir, state))
			reporter.info(line);
		for (const line of await readGitHubStatusLines(
			localUrl,
			state.secrets.setupToken,
			dataDir,
			context.fetchImpl,
		))
			reporter.info(line);
		reporter.info(
			"Run `opaline server open` to sign in to the dashboard, or `opaline server stop` to stop it.",
		);
		return;
	}

	if (state.clickhouse.mode === "external") {
		reporter.info(`Checking ClickHouse at ${state.clickhouse.url} ...`);
		const probe = await probeClickHouse(state.clickhouse);
		if (!probe.ok) return new Error(probe.message);
		for (const warning of probe.warnings) reporter.warn(warning);
		state = {
			...state,
			clickhouse: { ...state.clickhouse, version: probe.version },
		};
	}

	let runtimes: Runtimes;
	try {
		runtimes = await resolveRuntimes(
			runtimeContextFor(dataDir, platform, context),
			state,
			dataDir,
			distribution.minimumBun,
			context.events !== undefined,
			runtimeReporter(context),
			options.early,
		);
	} catch (error) {
		return asError(error);
	}
	if (switching) {
		const sameVersion =
			distribution.version !== undefined &&
			existing?.server?.version === distribution.version;
		reporter.info(
			sameVersion
				? `Restarting the Opaline server ${distribution.version} with another build (${distribution.source}); ClickHouse and Postgres keep running.`
				: `Switching the Opaline server from ${describeServerRecord(existing?.server)} to ${describeDistribution(distribution)}; ClickHouse and Postgres keep running.`,
		);
		await stopNamedService(dataDir, "server");
		delete running.server;
	}
	if (memoryChanged && desiredMemory !== undefined) {
		reporter.info(
			`The ClickHouse memory limit changes from ${configuredMemory === undefined ? "the default" : `${formatGiB(configuredMemory)} GiB`} to ${formatGiB(desiredMemory)} GiB; restarting ClickHouse.`,
		);
		await stopNamedService(dataDir, "clickhouse");
		delete running.clickhouse;
	}
	try {
		distribution.install();
	} catch (error) {
		return new Error(
			`Could not install the Opaline server into ${distribution.root}: ${asError(error).message}`,
		);
	}
	state = withRuntimes(state, runtimes, distribution, existing?.server);
	state = await reassignBusyInternalPorts(state, running);
	if (
		!running.server &&
		!(await isPortFree(state.port, bindCheckHost(state.host)))
	)
		return new Error(
			`Port ${state.port} on ${state.host} is in use by another program. Stop it, or pick another port with --port (agents then get the new MCP URL).`,
		);
	mkdirSync(dataDir, { recursive: true, mode: 0o700 });
	saveServerState(dataDir, state);

	const startedHere: ServiceName[] = [];
	const failure = await startServices({
		dataDir,
		state,
		runtimes,
		distribution,
		running,
		startedHere,
		context,
	});
	if (failure) {
		for (const name of [...startedHere].reverse())
			await stopNamedService(dataDir, name);
		return withRollbackHint(failure, dataDir, state, startedHere);
	}
	context.events?.({
		type: "ready",
		url: state.publicUrl,
		localUrl,
		...(distribution.version ? { version: distribution.version } : {}),
		alreadyRunning: false,
	});
	if (distribution.kind === "packaged" && distribution.version) {
		const keep = [distribution.version, state.server?.previousVersion].filter(
			(version): version is string => Boolean(version),
		);
		for (const removed of pruneServerInstalls(dataDir, keep))
			reporter.info(`Removed the old Opaline server ${removed}.`);
	}

	const firstRun = await completeFirstRun(
		state,
		localUrl,
		flags,
		context,
		planned.urlChanged,
	);
	if (firstRun instanceof Error) {
		reporter.warn(
			`The server is running, but first-run setup failed: ${firstRun.message}`,
		);
		printSummary(state, runtimes, dataDir, context);
		return firstRun;
	}
	state = firstRun.state;
	saveServerState(dataDir, state);
	emitFirstRun(firstRun, context);
	printSummary(state, runtimes, dataDir, context);
	if (!context.events)
		for (const line of await readGitHubStatusLines(
			localUrl,
			state.secrets.setupToken,
			dataDir,
			context.fetchImpl,
		))
			reporter.info(line);
	printLinks(state, firstRun.loginUrl, flags, context);
	context.events?.({ type: "done", url: state.publicUrl });
}

function emitFirstRun(
	firstRun: FirstRunResult,
	context: ServerRunnerContext,
): void {
	if (!context.events) return;
	emitSetup(
		firstRun.state,
		firstRun.created,
		firstRun.credentials,
		context.events,
	);
	if (firstRun.agents)
		context.events({
			type: "agents",
			hooks: firstRun.agents.hooks,
			mcp: firstRun.agents.mcp,
		});
}

function emitSetup(
	state: ServerState,
	created: boolean,
	credentials: FirstRunResult["credentials"],
	sink: ServerEventSink,
): void {
	const setup = state.setup;
	if (!setup) return;
	sink({
		type: "setup",
		created,
		credentials,
		user: { id: setup.userId, email: setup.email, name: setup.name },
		organization: {
			id: setup.organizationId,
			slug: setup.organizationSlug,
			name: setup.organizationName,
		},
	});
}

type Runtimes = {
	clickhouse: ResolvedRuntime | undefined;
	postgres: ResolvedRuntime;
	bun: ResolvedRuntime;
};

export function describeDowngrade(
	existing: ServerState | undefined,
	distribution: ServerDistribution,
): string | undefined {
	const previous = existing?.server?.version;
	const next = distribution.version;
	if (!previous || !next || compareServerVersions(next, previous) >= 0)
		return undefined;
	return `This server's data was last run by Opaline server ${previous}, and ${next} is older. Migrations only go forward, so ${next} may refuse the newer schema.`;
}

export function needsServerSwitch(
	record: PidRecord,
	prior: ServerState["server"],
	distribution: ServerDistribution,
): boolean {
	if (record.marker !== distribution.entry) return true;
	return (
		distribution.kind === "packaged" &&
		prior?.sha256 !== undefined &&
		prior.sha256 !== distribution.sha256
	);
}

function withRollbackHint(
	failure: Error,
	dataDir: string,
	state: ServerState,
	startedHere: readonly ServiceName[],
): Error {
	const previous = state.server?.previousVersion;
	if (!startedHere.includes("server") || !previous) return failure;
	const directory = join(getServerInstallRoot(dataDir), previous);
	if (!existsSync(directory)) return failure;
	return new Error(
		`${failure.message}\nThe previous Opaline server ${previous} is kept in ${directory}. To go back to it: ${SERVER_ARTIFACT_ENV}=${directory} opaline server start --yes (that works only while the data has not been migrated by ${state.server?.version ?? "the new version"}; an older server refuses a newer schema).`,
	);
}

function describeServerRecord(server: ServerState["server"]): string {
	if (!server) return "the running server";
	return server.version ?? server.source ?? server.root;
}

function describeDistribution(distribution: ServerDistribution): string {
	return distribution.version
		? `${distribution.version} (${distribution.source})`
		: distribution.source;
}

export async function stopServer(
	dataDirFlag: string | undefined,
	context: ServerRunnerContext,
): Promise<void> {
	const dataDir = resolveServerDataDir(dataDirFlag, context.env, context.home);
	if (existsSync(dataDir)) writeStoppedMarker(dataDir);
	let anyRunning = false;
	for (const name of ["server", "postgres", "clickhouse"] as const) {
		const result = await stopNamedService(dataDir, name);
		if (result === "not-running") continue;
		anyRunning = true;
		context.reporter.info(
			`${SERVICE_LABELS[name]}: ${result === "killed" ? "did not stop in time; killed" : "stopped"}`,
		);
	}
	if (!anyRunning) context.reporter.info(`Nothing is running for ${dataDir}.`);
}

export async function printServerStatus(
	dataDirFlag: string | undefined,
	context: ServerRunnerContext,
): Promise<undefined | Error> {
	const dataDir = resolveServerDataDir(dataDirFlag, context.env, context.home);
	let state: ServerState | undefined;
	try {
		state = loadServerState(dataDir);
	} catch (error) {
		return asError(error);
	}
	if (!state) {
		context.reporter.info(
			`No Opaline server in ${dataDir}. Run \`opaline server\` to set one up.`,
		);
		return;
	}
	const running = await readRunningServices(dataDir);
	const localUrl = getLocalServerUrl(state);
	const ready = running.server ? await isServerReady(localUrl) : false;
	const liveVersion = ready
		? (await fetchSelfHostInfo(localUrl, 3_000).catch(() => null))?.version
		: undefined;
	context.reporter.info(
		`Opaline server: ${ready ? "running" : running.server ? "starting or unhealthy" : "stopped"} at ${state.publicUrl}`,
	);
	for (const line of await describeStatus(dataDir, state, liveVersion))
		context.reporter.info(line);
	if (ready)
		for (const line of await readGitHubStatusLines(
			localUrl,
			state.secrets.setupToken,
			dataDir,
			context.fetchImpl,
		))
			context.reporter.info(line);
}

export type ServerRunState =
	| "not-configured"
	| "stopped"
	| "starting"
	| "running";

export interface ServerStatusReport {
	readonly dataDir: string;
	readonly state: ServerRunState;
	readonly stoppedByUser: boolean;
	readonly url?: string;
	readonly localUrl?: string;
	readonly mcpUrl?: string;
	readonly version?: string;
	readonly liveVersion?: string;
	readonly services?: Record<
		ServiceName,
		{ readonly running: boolean; readonly pid?: number }
	>;
	readonly clickhouse?: {
		readonly mode: "local" | "external";
		readonly url: string;
		readonly version?: string;
		readonly memoryBytes?: number;
	};
	readonly setup?: {
		readonly email: string;
		readonly name: string;
		readonly userId: string;
		readonly organizationId: string;
		readonly organizationSlug: string;
		readonly organizationName: string;
	} | null;
}

export async function getServerStatusReport(
	dataDirFlag: string | undefined,
	context: Pick<ServerRunnerContext, "env" | "home">,
): Promise<ServerStatusReport | Error> {
	const dataDir = resolveServerDataDir(dataDirFlag, context.env, context.home);
	let state: ServerState | undefined;
	try {
		state = loadServerState(dataDir);
	} catch (error) {
		return asError(error);
	}
	const stoppedByUser = isStoppedByUser(dataDir);
	if (!state) return { dataDir, state: "not-configured", stoppedByUser };
	const running = await readRunningServices(dataDir);
	const localUrl = getLocalServerUrl(state);
	const ready = running.server ? await isServerReady(localUrl) : false;
	const liveVersion = ready
		? (await fetchSelfHostInfo(localUrl, 3_000).catch(() => null))?.version
		: undefined;
	const service = (name: ServiceName) => {
		const record = running[name];
		return record ? { running: true, pid: record.pid } : { running: false };
	};
	const clickhouse = getClickHouseConnection(state);
	const version = state.server?.version;
	return {
		dataDir,
		state: ready ? "running" : running.server ? "starting" : "stopped",
		stoppedByUser,
		url: state.publicUrl,
		localUrl,
		mcpUrl: getSelfHostedMcpUrl(state.publicUrl),
		...(version ? { version } : {}),
		...(liveVersion ? { liveVersion } : {}),
		services: {
			clickhouse: service("clickhouse"),
			postgres: service("postgres"),
			server: service("server"),
		},
		clickhouse:
			state.clickhouse.mode === "local"
				? {
						mode: "local",
						url: clickhouse.url,
						...(state.clickhouse.runtime?.version
							? { version: state.clickhouse.runtime.version }
							: {}),
						memoryBytes:
							readConfiguredClickHouseMemoryBytes(dataDir) ??
							clickHouseMemoryBytes(state.clickhouse.memoryGiB),
					}
				: {
						mode: "external",
						url: state.clickhouse.url,
						...(state.clickhouse.version
							? { version: state.clickhouse.version }
							: {}),
					},
		setup: state.setup
			? {
					email: state.setup.email,
					name: state.setup.name,
					userId: state.setup.userId,
					organizationId: state.setup.organizationId,
					organizationSlug: state.setup.organizationSlug,
					organizationName: state.setup.organizationName,
				}
			: null,
	};
}

export interface DashboardLink {
	readonly url: string;
	readonly signIn: boolean;
	readonly dashboardUrl: string;
}

export async function createDashboardLink(
	dataDirFlag: string | undefined,
	context: Pick<ServerRunnerContext, "env" | "home" | "reporter">,
): Promise<{ link: DashboardLink; state: ServerState } | Error> {
	const dataDir = resolveServerDataDir(dataDirFlag, context.env, context.home);
	let state: ServerState | undefined;
	try {
		state = loadServerState(dataDir);
	} catch (error) {
		return asError(error);
	}
	if (!state)
		return new Error(
			`No Opaline server in ${dataDir}. Run \`opaline server\` to set one up.`,
		);
	if (!(await isServerReady(getLocalServerUrl(state))))
		return new Error(
			"The Opaline server is not running. Start it with `opaline server`.",
		);
	if (state.setup) {
		try {
			const url = await createSelfHostLoginLink(
				getLocalServerUrl(state),
				state.setup.apiKey,
			);
			return {
				link: { url, signIn: true, dashboardUrl: state.publicUrl },
				state,
			};
		} catch (error) {
			context.reporter.warn(
				`Could not create a sign-in link (${asError(error).message}); opening the dashboard instead.`,
			);
		}
	}
	return {
		link: {
			url: state.publicUrl,
			signIn: false,
			dashboardUrl: state.publicUrl,
		},
		state,
	};
}

export async function openDashboard(
	dataDirFlag: string | undefined,
	noBrowser: boolean,
	context: ServerRunnerContext,
): Promise<undefined | Error> {
	const created = await createDashboardLink(dataDirFlag, context);
	if (created instanceof Error) return created;
	return openOrPrint(created.link.url, created.state, noBrowser, context);
}

export async function printServerLogs(
	options: {
		readonly dataDir?: string;
		readonly service: ServiceName | "all";
		readonly lines: number;
		readonly follow: boolean;
	},
	context: ServerRunnerContext,
): Promise<undefined | Error> {
	const dataDir = resolveServerDataDir(
		options.dataDir,
		context.env,
		context.home,
	);
	const services =
		options.service === "all" ? [...SERVICE_NAMES] : [options.service];
	const files = services
		.map((name) => ({ name, path: getServicePaths(dataDir, name).logFile }))
		.filter(({ path }) => existsSync(path));
	if (files.length === 0)
		return new Error(`No logs in ${join(dataDir, "logs")} yet.`);
	const prefix = files.length > 1;
	for (const { name, path } of files) {
		const tail = tailFile(path, options.lines);
		if (!tail) continue;
		for (const line of tail.split("\n"))
			process.stdout.write(prefix ? `[${name}] ${line}\n` : `${line}\n`);
	}
	if (!options.follow) return;
	const offsets = new Map(files.map(({ path }) => [path, statSync(path).size]));
	for (;;) {
		await sleep(500);
		for (const { name, path } of files) {
			const size = existsSync(path) ? statSync(path).size : 0;
			const offset = offsets.get(path) ?? 0;
			if (size < offset) offsets.set(path, 0);
			if (size <= offset) continue;
			const chunk = readRange(path, offset, size);
			offsets.set(path, size);
			for (const line of chunk.split("\n").filter(Boolean))
				process.stdout.write(prefix ? `[${name}] ${line}\n` : `${line}\n`);
		}
	}
}

interface PlannedState {
	readonly state: ServerState;
	readonly urlChanged: boolean;
	readonly changed: boolean;
}

export async function planServerState(
	existing: ServerState | undefined,
	flags: ServerStartFlags,
	context: Pick<ServerRunnerContext, "env" | "interactive" | "confirm">,
): Promise<PlannedState | Error> {
	const port = flags.port ?? existing?.port ?? DEFAULT_SERVER_PORT;
	if (!Number.isInteger(port) || port < 1 || port > 65_535)
		return new Error(`--port ${port} is not a TCP port.`);
	const host = flags.host?.trim() || existing?.host || DEFAULT_SERVER_HOST;
	const keepPublicUrl =
		existing !== undefined && existing.port === port && existing.host === host;
	const publicUrl = flags.publicUrl?.trim()
		? normalizePublicUrl(flags.publicUrl)
		: keepPublicUrl
			? existing.publicUrl
			: defaultPublicUrl(host, port);
	if (publicUrl instanceof Error) return publicUrl;
	const urlChanged = existing !== undefined && existing.publicUrl !== publicUrl;
	if (urlChanged && !flags.yes) {
		const detail = `This server runs at ${existing.publicUrl}, and coding agents have ${getSelfHostedMcpUrl(existing.publicUrl)} registered.`;
		if (!context.interactive)
			return new Error(
				`${detail} Start it with --port ${existing.port} --host ${existing.host} to keep that, or add --yes to move it to ${publicUrl} and register the new MCP URL.`,
			);
		if (!(await context.confirm(`${detail} Move it to ${publicUrl}?`)))
			return new Error(`Kept ${existing.publicUrl}; nothing changed.`);
	}
	const clickhouse = await planClickHouse(existing, flags, context.env);
	if (clickhouse instanceof Error) return clickhouse;
	const state: ServerState = {
		version: 1,
		createdAt: existing?.createdAt ?? new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		port,
		host,
		publicUrl,
		secrets: existing?.secrets ?? createSecrets(),
		clickhouse,
		postgres: existing?.postgres ?? {
			port: await findFreePort(),
			user: POSTGRES_USER,
			password: generateSecret(24),
			database: POSTGRES_DATABASE,
		},
		...(existing?.bun ? { bun: existing.bun } : {}),
		...(existing?.server ? { server: existing.server } : {}),
		...(existing?.setup ? { setup: existing.setup } : {}),
		...(existing?.agentsConfiguredAt
			? { agentsConfiguredAt: existing.agentsConfiguredAt }
			: {}),
	};
	const changed =
		urlChanged ||
		(existing !== undefined &&
			JSON.stringify(connectionOf(existing.clickhouse)) !==
				JSON.stringify(connectionOf(clickhouse)));
	return { state, urlChanged, changed };
}

async function planClickHouse(
	existing: ServerState | undefined,
	flags: ServerStartFlags,
	env: NodeJS.ProcessEnv,
): Promise<ClickHouseState | Error> {
	const password =
		flags.clickhousePassword ?? env.OPALINE_CLICKHOUSE_PASSWORD ?? undefined;
	const previous = existing?.clickhouse;
	const url = flags.clickhouseUrl?.trim();
	const memory =
		flags.clickhouseMemory === undefined
			? undefined
			: parseClickHouseMemoryGiB(flags.clickhouseMemory);
	if (memory instanceof Error) return memory;
	if (memory !== undefined && (url || previous?.mode === "external"))
		return new Error(
			"--clickhouse-memory sets the memory limit of the ClickHouse that opaline server runs itself; configure a ClickHouse at --clickhouse-url on that server.",
		);
	if (url) {
		const normalized = url.replace(/\/+$/u, "");
		const sameServer =
			previous?.mode === "external" && previous.url === normalized;
		return {
			mode: "external",
			url: normalized,
			user:
				flags.clickhouseUser?.trim() ||
				(sameServer ? previous.user : "default"),
			password: password ?? (sameServer ? previous.password : ""),
		};
	}
	if (previous?.mode === "external")
		return {
			...previous,
			user: flags.clickhouseUser?.trim() || previous.user,
			password: password ?? previous.password,
		};
	if (flags.clickhouseUser || flags.clickhousePassword)
		return new Error(
			"--clickhouse-user and --clickhouse-password need --clickhouse-url. Without it opaline server runs its own ClickHouse.",
		);
	const local: ClickHouseState =
		previous?.mode === "local"
			? previous
			: {
					mode: "local",
					httpPort: await findFreePort(),
					tcpPort: await findFreePort(),
					user: LOCAL_CLICKHOUSE_USER,
					password: generateSecret(24),
				};
	if (memory === undefined || local.mode !== "local") return local;
	const { memoryGiB: _replaced, ...rest } = local;
	return memory === "auto" ? rest : { ...rest, memoryGiB: memory };
}

function connectionOf(clickhouse: ClickHouseState) {
	return clickhouse.mode === "external"
		? [clickhouse.url, clickhouse.user, clickhouse.password]
		: ["local"];
}

export function defaultPublicUrl(host: string, port: number): string {
	if (host === "0.0.0.0" || host === "::")
		return `http://${firstLanAddress() ?? "localhost"}:${port}`;
	const hostname = host.includes(":") ? `[${host}]` : host;
	return isLoopbackHostname(hostname)
		? `http://localhost:${port}`
		: `http://${hostname}:${port}`;
}

function normalizePublicUrl(value: string): string | Error {
	try {
		const url = new URL(value.trim());
		if (url.protocol !== "http:" && url.protocol !== "https:")
			throw new Error("scheme");
		if (url.pathname !== "/" || url.search || url.hash)
			return new Error(
				`--public-url must be an origin like https://opaline.acme.lan, without a path.`,
			);
		return url.origin;
	} catch {
		return new Error(
			`--public-url ${sanitizeForTerminalDisplay(value)} is not an http(s) URL.`,
		);
	}
}

function firstLanAddress(): string | undefined {
	for (const addresses of Object.values(networkInterfaces()))
		for (const address of addresses ?? [])
			if (address.family === "IPv4" && !address.internal)
				return address.address;
	return undefined;
}

export function getLocalServerUrl(state: ServerState): string {
	const host =
		state.host === "0.0.0.0" || state.host === "::" ? "127.0.0.1" : state.host;
	return `http://${host.includes(":") ? `[${host}]` : host}:${state.port}`;
}

function bindCheckHost(host: string): string {
	return host === "::" ? "::" : host;
}

interface EarlyRuntimes {
	readonly clickhouse?: Promise<ResolvedRuntime>;
	readonly postgres: Promise<ResolvedRuntime>;
}

function runtimeContextFor(
	dataDir: string,
	platform: HostPlatform,
	context: ServerRunnerContext,
): RuntimeContext {
	const created = createRuntimeContext({
		dataDir,
		env: context.env,
		home: context.home,
		platform,
		log: context.reporter.info,
	});
	return context.events
		? { ...created, progress: createEventProgress(context.events) }
		: created;
}

function runtimeReporter(
	context: ServerRunnerContext,
): (runtime: ResolvedRuntime) => void {
	return (runtime) =>
		context.events?.({
			type: "runtime",
			name: runtime.name,
			phase: "ready",
			version: runtime.version,
			source: runtime.source,
			path: runtime.path,
		});
}

function resolveRuntimesEarly(
	dataDir: string,
	platform: HostPlatform,
	state: ServerState,
	context: ServerRunnerContext,
): EarlyRuntimes {
	const runtimeContext = runtimeContextFor(dataDir, platform, context);
	const report = runtimeReporter(context);
	const reported = <T extends ResolvedRuntime>(runtime: T): T => {
		report(runtime);
		return runtime;
	};
	const early: EarlyRuntimes = {
		clickhouse:
			state.clickhouse.mode === "local"
				? resolveClickHouse(runtimeContext).then(reported)
				: undefined,
		postgres: resolvePostgres(
			runtimeContext,
			readPostgresDataMajor(getPostgresLayout(dataDir)),
		).then(reported),
	};
	early.clickhouse?.catch(() => {});
	early.postgres.catch(() => {});
	return early;
}

async function resolveRuntimes(
	runtimeContext: RuntimeContext,
	state: ServerState,
	dataDir: string,
	minimumBun: string | undefined,
	concurrently = false,
	onResolved: (runtime: ResolvedRuntime) => void = () => {},
	early?: EarlyRuntimes,
): Promise<Runtimes> {
	const resolve = {
		clickhouse: () =>
			state.clickhouse.mode === "local"
				? (early?.clickhouse ??
					resolveClickHouse(runtimeContext).then(reported))
				: Promise.resolve(undefined),
		postgres: () =>
			early?.postgres ??
			resolvePostgres(
				runtimeContext,
				readPostgresDataMajor(getPostgresLayout(dataDir)),
			).then(reported),
		bun: () => resolveBun(runtimeContext, minimumBun).then(reported),
	};
	function reported<T extends ResolvedRuntime>(runtime: T): T {
		onResolved(runtime);
		return runtime;
	}
	if (concurrently) {
		const [clickhouse, postgres, bun] = await Promise.all([
			resolve.clickhouse(),
			resolve.postgres(),
			resolve.bun(),
		]);
		return { clickhouse, postgres, bun };
	}
	const clickhouse = await resolve.clickhouse();
	const postgres = await resolve.postgres();
	const bun = await resolve.bun();
	return { clickhouse, postgres, bun };
}

function withRuntimes(
	state: ServerState,
	runtimes: Runtimes,
	distribution: ServerDistribution,
	prior: ServerState["server"],
): ServerState {
	const record = (runtime: ResolvedRuntime): RuntimeRecord => ({
		source: runtime.source,
		version: runtime.version,
		path: runtime.path,
	});
	return {
		...state,
		clickhouse:
			state.clickhouse.mode === "local" && runtimes.clickhouse
				? { ...state.clickhouse, runtime: record(runtimes.clickhouse) }
				: state.clickhouse,
		postgres: { ...state.postgres, runtime: record(runtimes.postgres) },
		bun: record(runtimes.bun),
		server: serverRecord(distribution, prior),
	};
}

export function serverRecord(
	distribution: ServerDistribution,
	prior: ServerState["server"],
): NonNullable<ServerState["server"]> {
	const carried =
		prior?.version && prior.version !== distribution.version
			? prior.version
			: prior?.previousVersion;
	const previousVersion =
		carried && carried !== distribution.version ? carried : undefined;
	return {
		kind: distribution.kind,
		root: distribution.root,
		source: distribution.source,
		...(distribution.version ? { version: distribution.version } : {}),
		...(distribution.sha256 ? { sha256: distribution.sha256 } : {}),
		...(previousVersion ? { previousVersion } : {}),
	};
}

async function reassignBusyInternalPorts(
	state: ServerState,
	running: Partial<Record<ServiceName, PidRecord>>,
): Promise<ServerState> {
	let next = state;
	if (!running.postgres && !(await isPortFree(next.postgres.port)))
		next = {
			...next,
			postgres: { ...next.postgres, port: await findFreePort() },
		};
	if (next.clickhouse.mode === "local" && !running.clickhouse) {
		const clickhouse = next.clickhouse;
		const httpPort = (await isPortFree(clickhouse.httpPort))
			? clickhouse.httpPort
			: await findFreePort();
		const tcpPort = (await isPortFree(clickhouse.tcpPort))
			? clickhouse.tcpPort
			: await findFreePort();
		next = { ...next, clickhouse: { ...clickhouse, httpPort, tcpPort } };
	}
	return next;
}

async function startServices(options: {
	readonly dataDir: string;
	readonly state: ServerState;
	readonly runtimes: Runtimes;
	readonly distribution: ServerDistribution;
	readonly running: Partial<Record<ServiceName, PidRecord>>;
	readonly startedHere: ServiceName[];
	readonly context: ServerRunnerContext;
}): Promise<Error | undefined> {
	const { dataDir, state, runtimes, running, startedHere, context } = options;
	const baseEnv = pickEnvironment(context.env);
	const clickhouse = getClickHouseConnection(state);

	const startClickHouse = async (): Promise<Error | undefined> => {
		if (state.clickhouse.mode === "local" && runtimes.clickhouse) {
			const maxServerMemoryBytes = clickHouseMemoryBytes(
				state.clickhouse.memoryGiB,
			);
			const layout = writeClickHouseConfig(dataDir, {
				httpPort: state.clickhouse.httpPort,
				tcpPort: state.clickhouse.tcpPort,
				password: state.clickhouse.password,
				maxServerMemoryBytes,
			});
			if (!running.clickhouse) {
				context.reporter.info(
					`Starting ClickHouse ${runtimes.clickhouse.version} on 127.0.0.1:${state.clickhouse.httpPort} (memory limit ${formatGiB(maxServerMemoryBytes)} GiB) ...`,
				);
				context.events?.({
					type: "starting",
					service: "clickhouse",
					version: runtimes.clickhouse.version,
				});
				const record = startDetachedService({
					dataDir,
					name: "clickhouse",
					command: runtimes.clickhouse.path,
					args: ["server", `--config-file=${layout.configPath}`],
					env: { ...baseEnv, CLICKHOUSE_WATCHDOG_ENABLE: "0" },
					cwd: layout.root,
					marker: layout.configPath,
				});
				startedHere.push("clickhouse");
				const ready = await waitUntilReady({
					dataDir,
					name: "clickhouse",
					pid: record.pid,
					timeoutMs: CLICKHOUSE_READY_TIMEOUT_MS,
					check: async () =>
						(await probeClickHouse(clickhouse, { timeoutMs: 2_000 })).ok,
				});
				if (ready) return ready;
			}
		}
		return undefined;
	};
	const startPostgres = async (): Promise<Error | undefined> => {
		const postgresLayout = getPostgresLayout(dataDir);
		if (!running.postgres) {
			if (readPostgresDataMajor(postgresLayout) === undefined) {
				context.reporter.info(
					`Initializing Postgres ${runtimes.postgres.version} in ${postgresLayout.dataPath} ...`,
				);
				mkdirSync(join(dataDir, "run"), { recursive: true, mode: 0o700 });
				try {
					await initializePostgres({
						binDir: runtimes.postgres.path,
						layout: postgresLayout,
						password: state.postgres.password,
						scratchDir: join(dataDir, "run"),
						env: baseEnv,
					});
				} catch (error) {
					return asError(error);
				}
			}
			context.reporter.info(
				`Starting Postgres ${runtimes.postgres.version} on 127.0.0.1:${state.postgres.port} ...`,
			);
			context.events?.({
				type: "starting",
				service: "postgres",
				version: runtimes.postgres.version,
			});
			const record = startDetachedService({
				dataDir,
				name: "postgres",
				command: join(runtimes.postgres.path, "postgres"),
				args: getPostgresStartArgs(postgresLayout, state.postgres.port),
				env: baseEnv,
				cwd: dataDir,
				marker: postgresLayout.dataPath,
			});
			startedHere.push("postgres");
			const ready = await waitUntilReady({
				dataDir,
				name: "postgres",
				pid: record.pid,
				timeoutMs: POSTGRES_READY_TIMEOUT_MS,
				check: async () =>
					(await probePostgres(state.postgres.port)) === "ready",
			});
			if (ready) return ready;
		}
		return undefined;
	};
	const [clickhouseFailed, postgresFailed] = await Promise.all([
		startClickHouse(),
		startPostgres(),
	]);
	if (clickhouseFailed) return clickhouseFailed;
	if (postgresFailed) return postgresFailed;

	if (!running.server) {
		if (!options.distribution.hasWebBuild)
			context.reporter.warn(
				options.distribution.kind === "checkout"
					? `No web build in ${options.distribution.webDir}; the API and MCP work, the dashboard does not. Build it with \`bun run --cwd apps/web build\` in the server checkout.`
					: `The Opaline server ${options.distribution.version} has no web build in ${options.distribution.webDir}; the API and MCP work, the dashboard does not.`,
			);
		context.reporter.info(
			`Starting the Opaline server${options.distribution.version ? ` ${options.distribution.version}` : ""} on ${state.host}:${state.port} ...`,
		);
		context.events?.({
			type: "starting",
			service: "server",
			...(options.distribution.version
				? { version: options.distribution.version }
				: {}),
		});
		mkdirSync(join(dataDir, "data"), { recursive: true, mode: 0o700 });
		const serverSettings = readServerSettings(dataDir);
		for (const problem of serverSettings.problems)
			context.reporter.warn(problem);
		const settingNames = Object.keys(serverSettings.settings);
		if (settingNames.length > 0)
			context.reporter.info(
				`Server settings from ${serverSettings.path}: ${settingNames.sort().join(", ")}`,
			);
		const record = startDetachedService({
			dataDir,
			name: "server",
			command: runtimes.bun.path,
			args: ["--no-install", options.distribution.entry],
			env: {
				...baseEnv,
				...LOCAL_INGEST_ENVIRONMENT,
				...serverSettings.settings,
				...getServerEnvironment(dataDir, state, options.distribution),
			},
			cwd: dataDir,
			marker: options.distribution.entry,
		});
		startedHere.push("server");
		const localUrl = getLocalServerUrl(state);
		const ready = await waitUntilReady({
			dataDir,
			name: "server",
			pid: record.pid,
			timeoutMs: readServerTimeout(context.env),
			check: () => isServerReady(localUrl),
		});
		if (ready) return ready;
	}
	return undefined;
}

export function getServerEnvironment(
	dataDir: string,
	state: ServerState,
	distribution: ServerDistribution,
): Record<string, string> {
	const clickhouse = getClickHouseConnection(state);
	return {
		NODE_ENV: "production",
		OPALINE_SELF_HOSTED: "1",
		PORT: String(state.port),
		HOST: state.host,
		APP_URL: state.publicUrl,
		ALLOWED_ORIGIN: state.publicUrl,
		PG_CONNECTION_STRING: getPostgresConnectionString(
			state.postgres.port,
			state.postgres.password,
		),
		CLICKHOUSE_URL: clickhouse.url,
		CLICKHOUSE_USERNAME: clickhouse.user,
		CLICKHOUSE_PASSWORD: clickhouse.password,
		CLICKHOUSE_FLAVOR: "auto",
		BETTER_AUTH_SECRET: state.secrets.betterAuthSecret,
		CRON_SECRET: state.secrets.cronSecret,
		OPALINE_DATA_DIR: join(dataDir, "data"),
		OPALINE_SETUP_TOKEN: state.secrets.setupToken,
		...(distribution.hasWebBuild
			? { OPALINE_WEB_DIR: distribution.webDir }
			: {}),
		...(distribution.version ? { OPALINE_VERSION: distribution.version } : {}),
	};
}

function getClickHouseConnection(state: ServerState): ClickHouseConnection {
	if (state.clickhouse.mode === "external") return state.clickhouse;
	return {
		url: `http://127.0.0.1:${state.clickhouse.httpPort}`,
		user: state.clickhouse.user,
		password: state.clickhouse.password,
	};
}

async function completeFirstRun(
	state: ServerState,
	localUrl: string,
	flags: ServerStartFlags,
	context: ServerRunnerContext,
	urlConfirmed: boolean,
) {
	const prompt: CredentialPromptContext = {
		yes: flags.yes || urlConfirmed,
		interactive: context.interactive,
		confirm: context.confirm,
	};
	try {
		return await runFirstRun({
			state,
			localUrl,
			email: flags.email,
			agentSetup: !flags.noAgentSetup,
			prompt,
			reporter: context.reporter,
		});
	} catch (error) {
		return asError(error);
	}
}

async function waitUntilReady(options: {
	readonly dataDir: string;
	readonly name: ServiceName;
	readonly pid: number;
	readonly timeoutMs: number;
	readonly check: () => Promise<boolean>;
}): Promise<Error | undefined> {
	const deadline = Date.now() + options.timeoutMs;
	while (Date.now() < deadline) {
		if (await options.check().catch(() => false)) return undefined;
		if (!isAlive(options.pid))
			return startupFailure(options, "exited during startup");
		await sleep(500);
	}
	return startupFailure(
		options,
		`was not ready after ${Math.round(options.timeoutMs / 1000)} s`,
	);
}

function startupFailure(
	options: { readonly dataDir: string; readonly name: ServiceName },
	what: string,
): Error {
	const { logFile } = getServicePaths(options.dataDir, options.name);
	const tail = tailFile(logFile, 30);
	return new Error(
		`${SERVICE_LABELS[options.name]} ${what}.${tail ? `\nLast lines of ${logFile}:\n${tail}` : ` See ${logFile}.`}`,
	);
}

export async function isServerReady(localUrl: string): Promise<boolean> {
	try {
		const response = await fetch(`${localUrl}/health/ready`, {
			signal: AbortSignal.timeout(3_000),
		});
		await response.body?.cancel();
		return response.ok;
	} catch {
		return false;
	}
}

async function readRunningServices(
	dataDir: string,
): Promise<Partial<Record<ServiceName, PidRecord>>> {
	const running: Partial<Record<ServiceName, PidRecord>> = {};
	for (const name of SERVICE_NAMES) {
		const record = await readRunningService(dataDir, name);
		if (record) running[name] = record;
	}
	return running;
}

async function stopNamedService(dataDir: string, name: ServiceName) {
	if (name === "server")
		return stopService(dataDir, name, { signal: "SIGTERM", timeoutMs: 30_000 });
	if (name === "postgres")
		return stopService(dataDir, name, { signal: "SIGINT", timeoutMs: 30_000 });
	return stopService(dataDir, name, { signal: "SIGTERM", timeoutMs: 60_000 });
}

const SERVICE_LABELS: Record<ServiceName, string> = {
	clickhouse: "ClickHouse",
	postgres: "Postgres",
	server: "Opaline server",
};

export async function describeStatus(
	dataDir: string,
	state: ServerState,
	liveVersion?: string,
): Promise<string[]> {
	const running = await readRunningServices(dataDir);
	const pid = (name: ServiceName) =>
		running[name] ? `running (pid ${running[name]?.pid})` : "stopped";
	const lines: string[] = [];
	if (state.clickhouse.mode === "local")
		lines.push(
			`  ClickHouse  ${pid("clickhouse")}, local ${state.clickhouse.runtime?.version ?? "?"} (${state.clickhouse.runtime?.source ?? "?"}), http://127.0.0.1:${state.clickhouse.httpPort}, memory limit ${formatGiB(readConfiguredClickHouseMemoryBytes(dataDir) ?? clickHouseMemoryBytes(state.clickhouse.memoryGiB))} GiB${state.clickhouse.memoryGiB === undefined ? "" : " (--clickhouse-memory)"}`,
		);
	else
		lines.push(
			`  ClickHouse  external ${state.clickhouse.url} as ${state.clickhouse.user}${state.clickhouse.version ? `, version ${state.clickhouse.version}` : ""}`,
		);
	lines.push(
		`  Postgres    ${pid("postgres")}, ${state.postgres.runtime?.version ?? "?"} (${state.postgres.runtime?.source ?? "?"}), 127.0.0.1:${state.postgres.port}`,
		`  Server      ${pid("server")}, Bun ${state.bun?.version ?? "?"} (${state.bun?.source ?? "?"})`,
		`  Version     ${describeServerVersion(state.server, liveVersion)}`,
	);
	const previous = state.server?.previousVersion;
	if (previous && existsSync(join(getServerInstallRoot(dataDir), previous)))
		lines.push(
			`  Previous    ${previous}, kept in ${join(getServerInstallRoot(dataDir), previous)}`,
		);
	lines.push(
		`  Data        ${dataDir}`,
		`  Logs        ${join(dataDir, "logs")}`,
		`  Dashboard   ${state.publicUrl}`,
		`  MCP         ${getSelfHostedMcpUrl(state.publicUrl)}`,
	);
	if (state.setup)
		lines.push(
			`  Admin       ${state.setup.email}, workspace ${state.setup.organizationName}`,
		);
	return lines;
}

export function describeServerVersion(
	server: ServerState["server"],
	liveVersion?: string,
): string {
	if (!server) return liveVersion ?? "unknown";
	const version = server.version ?? liveVersion ?? "dev";
	const running =
		liveVersion && liveVersion !== version ? ` (running ${liveVersion})` : "";
	const source = server.source ?? `${server.kind} ${server.root}`;
	const location =
		server.kind === "packaged" && !source.endsWith(server.root)
			? `, installed in ${server.root}`
			: "";
	return `${version}${running} from ${source}${location}`;
}

function printSummary(
	state: ServerState,
	runtimes: Runtimes,
	dataDir: string,
	context: ServerRunnerContext,
): void {
	const { reporter } = context;
	reporter.info(`Opaline is running at ${state.publicUrl}`);
	reporter.info(
		state.clickhouse.mode === "local"
			? `  ClickHouse  local ${runtimes.clickhouse?.version} (${runtimes.clickhouse?.source}), http://127.0.0.1:${state.clickhouse.httpPort}`
			: `  ClickHouse  ${state.clickhouse.url} as ${state.clickhouse.user}`,
	);
	reporter.info(
		`  Postgres    ${runtimes.postgres.version} (${runtimes.postgres.source}), 127.0.0.1:${state.postgres.port}`,
	);
	reporter.info(
		`  Bun         ${runtimes.bun.version} (${runtimes.bun.source})`,
	);
	reporter.info(`  Server      ${describeServerVersion(state.server)}`);
	reporter.info(`  Data        ${dataDir}`);
	reporter.info(`  MCP         ${getSelfHostedMcpUrl(state.publicUrl)}`);
}

function printLinks(
	state: ServerState,
	loginUrl: string | undefined,
	flags: ServerStartFlags,
	context: ServerRunnerContext,
): void {
	if (!loginUrl) {
		context.reporter.info(
			"Run `opaline server open` to sign in to the dashboard.",
		);
		return;
	}
	openOrPrint(loginUrl, state, flags.noBrowser, context);
}

function openOrPrint(
	url: string,
	state: ServerState,
	noBrowser: boolean,
	context: ServerRunnerContext,
): undefined | Error {
	const safe = parseSafeBrowserUrl(url, { allowPlaintext: true });
	if (!safe.ok)
		return new Error(
			`The server returned an unusable sign-in link (${safe.detail}).`,
		);
	if (context.events) {
		context.events({ type: "login", url: safe.url });
		return undefined;
	}
	if (new URL(safe.url).origin !== new URL(state.publicUrl).origin)
		context.reporter.warn(
			`The sign-in link points at ${new URL(safe.url).origin}, not ${state.publicUrl}.`,
		);
	context.reporter.info(
		`Sign in to the dashboard with this one-time link (valid for 10 minutes):\n  ${safe.url}`,
	);
	if (!noBrowser) context.openBrowser(safe.url);
	return undefined;
}

export function getStoppedMarkerPath(dataDir: string): string {
	return join(dataDir, "run", "stopped");
}

export function isStoppedByUser(dataDir: string): boolean {
	return existsSync(getStoppedMarkerPath(dataDir));
}

function writeStoppedMarker(dataDir: string): void {
	mkdirSync(join(dataDir, "run"), { recursive: true, mode: 0o700 });
	writeFileSync(
		getStoppedMarkerPath(dataDir),
		`${JSON.stringify({ stoppedAt: new Date().toISOString() })}\n`,
		{ mode: 0o600 },
	);
}

function clearStoppedMarker(dataDir: string): void {
	rmSync(getStoppedMarkerPath(dataDir), { force: true });
}

function pickEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
	const picked: Record<string, string> = {};
	for (const key of PASSTHROUGH_ENV) {
		const value = env[key];
		if (value !== undefined) picked[key] = value;
	}
	return picked;
}

function readServerTimeout(env: NodeJS.ProcessEnv): number {
	const seconds = Number.parseInt(
		env.OPALINE_SERVER_START_TIMEOUT_SECONDS ?? "",
		10,
	);
	return Number.isFinite(seconds) && seconds > 0
		? seconds * 1000
		: DEFAULT_SERVER_READY_TIMEOUT_MS;
}

function readRange(path: string, start: number, end: number): string {
	const fd = openSync(path, "r");
	try {
		const buffer = Buffer.alloc(end - start);
		const read = readSync(fd, buffer, 0, buffer.length, start);
		return buffer.subarray(0, read).toString("utf8");
	} finally {
		closeSync(fd);
	}
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
