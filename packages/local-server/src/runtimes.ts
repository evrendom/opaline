import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	chmodSync,
	constants,
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	createProgressLine,
	type DownloadProgress,
	ensureVerifiedDownload,
} from "./download.js";
import { findExecutable } from "./paths.js";
import {
	BUN_VERSION,
	CLICKHOUSE_VERSION,
	cpuInfoHasAvx2,
	getBunAsset,
	getClickHouseAsset,
	getPostgresAsset,
	type HostPlatform,
	MINIMUM_BUN_VERSION,
	MINIMUM_POSTGRES_MAJOR,
	minimumClickHouseVersion,
	type PinnedAsset,
	POSTGRES_PACKAGE_VERSION,
	POSTGRES_VERSION,
} from "./pinned-runtimes.js";

export const RUNTIME_SOURCE_ORDER = [
	"explicit",
	"data-dir",
	"system",
	"download",
] as const;

export type RuntimeSource = (typeof RUNTIME_SOURCE_ORDER)[number];
export type RuntimeName = "clickhouse" | "postgres" | "bun";

export interface ResolvedRuntime {
	readonly name: RuntimeName;
	readonly source: RuntimeSource;
	readonly version: string;
	readonly path: string;
}

export type VersionProbe = (
	command: string,
	args: readonly string[],
	env: NodeJS.ProcessEnv,
) => Promise<string | undefined>;

export interface RuntimeContext {
	readonly dataDir: string;
	readonly env: NodeJS.ProcessEnv;
	readonly home: string;
	readonly platform: HostPlatform;
	readonly downloadCacheDir: string;
	readonly sharedDownloadCache: boolean;
	readonly useSystemRuntimes: boolean;
	readonly cpuHasAvx2: () => boolean;
	readonly probe: VersionProbe;
	readonly progress: (label: string) => {
		update: (progress: DownloadProgress) => void;
		finish: () => void;
	};
	readonly log: (line: string) => void;
	readonly fetchImpl?: typeof fetch;
	readonly postgresDirectories?: readonly string[];
}

interface Candidate {
	readonly source: RuntimeSource;
	readonly path: string;
	readonly origin: string;
}

const CLICKHOUSE_EXPLICIT_ENV = "OPALINE_CLICKHOUSE_BIN";
const POSTGRES_EXPLICIT_ENV = "OPALINE_POSTGRES_BIN_DIR";
const BUN_EXPLICIT_ENV = "OPALINE_BUN_BIN";
export const DOWNLOAD_ONLY_ENV = "OPALINE_SERVER_RUNTIMES";

export function getRuntimeInstallDir(
	dataDir: string,
	name: RuntimeName,
): string {
	const version =
		name === "clickhouse"
			? CLICKHOUSE_VERSION
			: name === "postgres"
				? POSTGRES_PACKAGE_VERSION
				: BUN_VERSION;
	return join(dataDir, "bin", `${name}-${version}`);
}

export function createRuntimeContext(options: {
	dataDir: string;
	env: NodeJS.ProcessEnv;
	home: string;
	platform: HostPlatform;
	log: (line: string) => void;
}): RuntimeContext {
	const sharedCache = options.env.OPALINE_DOWNLOAD_CACHE?.trim();
	return {
		...options,
		downloadCacheDir: sharedCache || join(options.dataDir, "bin", ".downloads"),
		sharedDownloadCache: Boolean(sharedCache),
		useSystemRuntimes:
			options.env[DOWNLOAD_ONLY_ENV]?.trim().toLowerCase() !== "download",
		cpuHasAvx2: () => readLinuxCpuHasAvx2(),
		probe: probeVersionOutput,
		progress: (label) => createProgressLine(label),
	};
}

export async function resolveClickHouse(
	context: RuntimeContext,
): Promise<ResolvedRuntime> {
	const installed = join(
		getRuntimeInstallDir(context.dataDir, "clickhouse"),
		"clickhouse",
	);
	return resolveRuntime(context, {
		name: "clickhouse",
		label: "ClickHouse",
		explicitEnv: CLICKHOUSE_EXPLICIT_ENV,
		explicit: context.env[CLICKHOUSE_EXPLICIT_ENV]?.trim(),
		dataDirPath: installed,
		systemCandidates: async () => {
			const candidates: Candidate[] = [];
			const onPath = findExecutable("clickhouse", context.env);
			if (onPath)
				candidates.push({ source: "system", path: onPath, origin: "PATH" });
			const fromClickhousectl = await findClickhousectlBinary(context);
			if (fromClickhousectl)
				candidates.push({
					source: "system",
					path: fromClickhousectl,
					origin: "clickhousectl",
				});
			return candidates;
		},
		version: async (path) =>
			parseVersion(await context.probe(path, ["--version"], context.env)),
		accepts: (version) =>
			compareVersions(version, minimumClickHouseVersion(context.platform)) >= 0,
		requirement: context.platform.startsWith("darwin-")
			? `ClickHouse ${minimumClickHouseVersion(context.platform)} or newer (older macOS builds give query threads a 512 KiB stack, too small for Opaline's deeper queries)`
			: `ClickHouse ${minimumClickHouseVersion(context.platform)} or newer`,
		download: async () => {
			const asset = getClickHouseAsset(context.platform);
			await installAsset(context, asset, "clickhouse", (archive, staging) =>
				asset.format === "binary"
					? placeFile(context, archive, join(staging, "clickhouse"))
					: extractEntry(archive, asset, staging, "clickhouse"),
			);
			return { path: installed, version: CLICKHOUSE_VERSION };
		},
	});
}

export async function resolvePostgres(
	context: RuntimeContext,
	requiredMajor?: number,
): Promise<ResolvedRuntime> {
	const installedBin = join(
		getRuntimeInstallDir(context.dataDir, "postgres"),
		"bin",
	);
	const downloadMajor = Number.parseInt(POSTGRES_VERSION, 10);
	return resolveRuntime(context, {
		name: "postgres",
		label: "Postgres",
		explicitEnv: POSTGRES_EXPLICIT_ENV,
		explicit: context.env[POSTGRES_EXPLICIT_ENV]?.trim(),
		dataDirPath: installedBin,
		systemCandidates: async () => listSystemPostgres(context),
		version: async (binDir) => {
			if (!existsSync(join(binDir, "initdb"))) return undefined;
			return parseVersion(
				await context.probe(
					join(binDir, "postgres"),
					["--version"],
					context.env,
				),
			);
		},
		accepts: (version) => {
			const major = Number.parseInt(version, 10);
			return requiredMajor === undefined
				? major >= MINIMUM_POSTGRES_MAJOR
				: major === requiredMajor;
		},
		requirement:
			requiredMajor === undefined
				? `Postgres ${MINIMUM_POSTGRES_MAJOR} or newer with initdb`
				: `Postgres ${requiredMajor} (the data directory was created by it)`,
		download: async () => {
			if (requiredMajor !== undefined && requiredMajor !== downloadMajor)
				throw new Error(
					`The Postgres data directory was created by Postgres ${requiredMajor}, and the bundled download is Postgres ${downloadMajor}. Install Postgres ${requiredMajor} or set ${POSTGRES_EXPLICIT_ENV} to its bin directory.`,
				);
			const asset = getPostgresAsset(context.platform);
			await installAsset(context, asset, "postgres", (archive, staging) =>
				extractPostgres(archive, asset, staging),
			);
			return { path: installedBin, version: POSTGRES_VERSION };
		},
	});
}

export async function resolveBun(
	context: RuntimeContext,
	serverMinimum?: string,
): Promise<ResolvedRuntime> {
	const installed = join(getRuntimeInstallDir(context.dataDir, "bun"), "bun");
	const minimum =
		serverMinimum && compareVersions(serverMinimum, MINIMUM_BUN_VERSION) > 0
			? serverMinimum
			: MINIMUM_BUN_VERSION;
	return resolveRuntime(context, {
		name: "bun",
		label: "Bun",
		explicitEnv: BUN_EXPLICIT_ENV,
		explicit: context.env[BUN_EXPLICIT_ENV]?.trim(),
		dataDirPath: installed,
		systemCandidates: async () =>
			[
				findExecutable("bun", context.env),
				join(context.home, ".bun", "bin", "bun"),
			]
				.filter((path): path is string => Boolean(path && existsSync(path)))
				.map((path) => ({ source: "system", path, origin: "PATH" })),
		version: async (path) =>
			parseVersion(await context.probe(path, ["--version"], context.env)),
		accepts: (version) => compareVersions(version, minimum) >= 0,
		requirement: `Bun ${minimum} or newer`,
		download: async () => {
			if (compareVersions(BUN_VERSION, minimum) < 0)
				throw new Error(
					`This Opaline server needs Bun ${minimum} or newer; this CLI downloads Bun ${BUN_VERSION}. Install a newer Bun or set ${BUN_EXPLICIT_ENV} to one.`,
				);
			const asset = getBunAsset(context.platform, context.cpuHasAvx2());
			await installAsset(context, asset, "bun", (archive, staging) =>
				extractEntry(archive, asset, staging, "bun"),
			);
			return { path: installed, version: BUN_VERSION };
		},
	});
}

interface RuntimeSpec {
	readonly name: RuntimeName;
	readonly label: string;
	readonly explicitEnv: string;
	readonly explicit: string | undefined;
	readonly dataDirPath: string;
	readonly systemCandidates: () => Promise<Candidate[]>;
	readonly version: (path: string) => Promise<string | undefined>;
	readonly accepts: (version: string) => boolean;
	readonly requirement: string;
	readonly download: () => Promise<{ path: string; version: string }>;
}

async function resolveRuntime(
	context: RuntimeContext,
	spec: RuntimeSpec,
): Promise<ResolvedRuntime> {
	for (const source of RUNTIME_SOURCE_ORDER) {
		if (source === "explicit" && spec.explicit) {
			const version = await spec.version(spec.explicit);
			if (!version || !spec.accepts(version))
				throw new Error(
					`${spec.explicitEnv}=${spec.explicit} is not usable: need ${spec.requirement}${version ? `, found ${version}` : ""}.`,
				);
			return { name: spec.name, source, version, path: spec.explicit };
		}
		if (source === "data-dir" && existsSync(spec.dataDirPath)) {
			const version = await spec.version(spec.dataDirPath);
			if (version && spec.accepts(version))
				return { name: spec.name, source, version, path: spec.dataDirPath };
		}
		if (source === "system" && context.useSystemRuntimes) {
			for (const candidate of await spec.systemCandidates()) {
				const version = await spec.version(candidate.path);
				if (version && spec.accepts(version))
					return { name: spec.name, source, version, path: candidate.path };
				if (version)
					context.log(
						`Skipping ${spec.label} ${version} at ${candidate.path}: need ${spec.requirement}.`,
					);
			}
		}
		if (source === "download") {
			const downloaded = await spec.download();
			const version = await spec.version(downloaded.path);
			if (!version)
				throw new Error(
					`The downloaded ${spec.label} at ${downloaded.path} does not run on this machine.`,
				);
			return { name: spec.name, source, version, path: downloaded.path };
		}
	}
	throw new Error(`No ${spec.label} found.`);
}

async function installAsset(
	context: RuntimeContext,
	asset: PinnedAsset,
	name: RuntimeName,
	populate: (archive: string, staging: string) => Promise<void>,
): Promise<void> {
	const label = `Downloading ${describeAsset(name)}`;
	const progress = context.progress(label);
	let archive: string;
	try {
		archive = await ensureVerifiedDownload(asset, {
			cacheDir: context.downloadCacheDir,
			label: describeAsset(name),
			onProgress: progress.update,
			fetchImpl: context.fetchImpl,
		});
	} finally {
		progress.finish();
	}
	const installDir = getRuntimeInstallDir(context.dataDir, name);
	const staging = `${installDir}.staging-${randomUUID()}`;
	mkdirSync(staging, { recursive: true, mode: 0o700 });
	try {
		await populate(archive, staging);
		rmSync(installDir, { recursive: true, force: true });
		renameSync(staging, installDir);
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
	if (!context.sharedDownloadCache) rmSync(archive, { force: true });
}

async function placeFile(
	context: RuntimeContext,
	source: string,
	destination: string,
): Promise<void> {
	if (context.sharedDownloadCache)
		copyFileSync(source, destination, constants.COPYFILE_FICLONE);
	else renameSync(source, destination);
	chmodSync(destination, 0o755);
}

async function extractEntry(
	archive: string,
	asset: PinnedAsset,
	staging: string,
	fileName: string,
): Promise<void> {
	const extracted = join(staging, ".extract");
	await extractArchive(archive, asset, extracted);
	const entry = resolveInside(extracted, asset.entry);
	if (!existsSync(entry))
		throw new Error(`${asset.id} does not contain ${asset.entry}`);
	renameSync(entry, join(staging, fileName));
	chmodSync(join(staging, fileName), 0o755);
	rmSync(extracted, { recursive: true, force: true });
}

async function extractPostgres(
	archive: string,
	asset: PinnedAsset,
	staging: string,
): Promise<void> {
	const extracted = join(staging, ".extract");
	await extractArchive(archive, asset, extracted);
	const packageRoot = join(extracted, "package");
	hydratePostgresSymlinks(packageRoot);
	const native = resolveInside(extracted, asset.entry);
	for (const entry of readdirSync(native))
		renameSync(join(native, entry), join(staging, entry));
	rmSync(extracted, { recursive: true, force: true });
	for (const binary of ["initdb", "postgres", "pg_ctl"]) {
		const path = join(staging, "bin", binary);
		if (existsSync(path)) chmodSync(path, 0o755);
	}
}

export function hydratePostgresSymlinks(packageRoot: string): number {
	const manifest = join(packageRoot, "native", "pg-symlinks.json");
	if (!existsSync(manifest)) return 0;
	const entries: unknown = JSON.parse(readFileSync(manifest, "utf8"));
	if (!Array.isArray(entries))
		throw new Error("pg-symlinks.json is not a list");
	let created = 0;
	for (const entry of entries) {
		const { source, target } = (entry ?? {}) as {
			source?: unknown;
			target?: unknown;
		};
		if (typeof source !== "string" || typeof target !== "string")
			throw new Error("pg-symlinks.json has an invalid entry");
		const sourcePath = resolveInside(packageRoot, source);
		const targetPath = resolveInside(
			join(packageRoot, "native"),
			target,
			packageRoot,
		);
		if (existsSync(targetPath)) continue;
		symlinkSync(relative(dirname(targetPath), sourcePath), targetPath);
		created++;
	}
	return created;
}

function resolveInside(root: string, path: string, base = root): string {
	if (isAbsolute(path))
		throw new Error(`Refusing absolute archive path ${path}`);
	const resolved = resolve(base, path);
	if (resolved !== root && !resolved.startsWith(`${root}${sep}`))
		throw new Error(`Refusing archive path outside ${root}: ${path}`);
	return resolved;
}

function extractArchive(
	archive: string,
	asset: PinnedAsset,
	destination: string,
): Promise<void> {
	mkdirSync(destination, { recursive: true, mode: 0o700 });
	const [command, args] =
		asset.format === "zip"
			? ["unzip", ["-q", "-o", archive, "-d", destination]]
			: ["tar", ["-xzf", archive, "-C", destination, "--no-same-owner"]];
	return new Promise((resolvePromise, reject) => {
		execFile(
			command,
			args,
			{ maxBuffer: 16 * 1024 * 1024 },
			(error, _stdout, stderr) => {
				if (error)
					reject(
						new Error(
							`${command} could not extract ${asset.id}: ${stderr.trim() || error.message}`,
						),
					);
				else resolvePromise();
			},
		);
	});
}

async function findClickhousectlBinary(
	context: RuntimeContext,
): Promise<string | undefined> {
	const clickhousectl =
		findExecutable("clickhousectl", context.env) ??
		[join(context.home, ".local", "bin", "clickhousectl")].find((path) =>
			existsSync(path),
		);
	if (!clickhousectl) return undefined;
	const output = await context.probe(
		clickhousectl,
		["local", "which", "--json"],
		{ ...context.env, DO_NOT_TRACK: "1" },
	);
	if (!output) return undefined;
	try {
		const parsed: unknown = JSON.parse(output);
		const path = (parsed as { binary_path?: unknown }).binary_path;
		return typeof path === "string" && existsSync(path) ? path : undefined;
	} catch {
		return undefined;
	}
}

function listSystemPostgres(context: RuntimeContext): Candidate[] {
	const fromPath = ["postgres", "initdb"]
		.map((name) => findExecutable(name, context.env))
		.filter((path): path is string => path !== undefined)
		.map(dirname);
	const seen = new Set<string>();
	return [
		...fromPath,
		...(context.postgresDirectories ?? DEFAULT_POSTGRES_DIRECTORIES),
	]
		.filter((directory) => {
			if (seen.has(directory)) return false;
			seen.add(directory);
			return (
				existsSync(join(directory, "postgres")) &&
				existsSync(join(directory, "initdb"))
			);
		})
		.map((path) => ({ source: "system", path, origin: "system" }));
}

const SUPPORTED_POSTGRES_MAJORS = [18, 17, 16] as const;

const DEFAULT_POSTGRES_DIRECTORIES = [
	...["/opt/homebrew/opt", "/usr/local/opt"].flatMap((prefix) => [
		...SUPPORTED_POSTGRES_MAJORS.map((major) =>
			join(prefix, `postgresql@${major}`, "bin"),
		),
		join(prefix, "postgresql", "bin"),
	]),
	...SUPPORTED_POSTGRES_MAJORS.flatMap((major) => [
		join("/usr/lib/postgresql", String(major), "bin"),
		join("/usr", `pgsql-${major}`, "bin"),
	]),
];

function describeAsset(name: RuntimeName): string {
	if (name === "clickhouse") return `ClickHouse ${CLICKHOUSE_VERSION}`;
	if (name === "postgres") return `Postgres ${POSTGRES_VERSION}`;
	return `Bun ${BUN_VERSION}`;
}

export function parseVersion(output: string | undefined): string | undefined {
	return output?.match(/\b(\d+\.\d+(?:\.\d+)*)/u)?.[1];
}

export function compareVersions(left: string, right: string): number {
	const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
	const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		const difference = (a[index] ?? 0) - (b[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

export function readLinuxCpuHasAvx2(path = "/proc/cpuinfo"): boolean {
	try {
		return cpuInfoHasAvx2(readFileSync(path, "utf8"));
	} catch {
		return false;
	}
}

const FIRST_RUN_SCAN_TIMEOUT_MS = 300_000;

export function probeVersionOutput(
	command: string,
	args: readonly string[],
	env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
	return new Promise((resolvePromise) => {
		execFile(
			command,
			[...args],
			{ encoding: "utf8", env, timeout: FIRST_RUN_SCAN_TIMEOUT_MS },
			(error, stdout) => resolvePromise(error ? undefined : stdout.trim()),
		);
	});
}
