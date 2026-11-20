import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import {
	createProgressLine,
	ensureVerifiedDownload,
} from "../../../../packages/local-server/src/download.ts";
import {
	BUN_VERSION,
	CLICKHOUSE_VERSION,
	detectHostPlatform,
	getBunAsset,
	getClickHouseAsset,
	getPostgresAsset,
	type HostPlatform,
	POSTGRES_VERSION,
} from "../../../../packages/local-server/src/pinned-runtimes.ts";
import {
	createRuntimeContext,
	getRuntimeInstallDir,
	resolveBun,
	resolveClickHouse,
	resolvePostgres,
} from "../../../../packages/local-server/src/runtimes.ts";

const [mode, cacheDir, outDir, platformArgument] = process.argv.slice(2);
if ((mode !== "download" && mode !== "unpack") || !cacheDir || !outDir) {
	process.stderr.write(
		"usage: bun runtimes.ts download|unpack <verified download cache> <out dir> [darwin-arm64|darwin-x64|linux-x64|linux-arm64]\n",
	);
	process.exit(2);
}
const detected = detectHostPlatform();
if (detected instanceof Error && !platformArgument) throw detected;
const platform = (platformArgument ?? detected) as HostPlatform;
mkdirSync(outDir, { recursive: true });

if (mode === "download") {
	const files: Record<string, string> = {};
	for (const [name, asset] of [
		["clickhouse", getClickHouseAsset(platform)],
		["postgres", getPostgresAsset(platform)],
		["bun", getBunAsset(platform, true)],
	] as const) {
		const progress = createProgressLine(`${name} ${asset.id}`);
		await ensureVerifiedDownload(asset, {
			cacheDir,
			label: name,
			onProgress: progress.update,
		});
		progress.finish();
		files[name] = asset.id;
	}
	writeFileSync(
		join(outDir, "runtimes.json"),
		`${JSON.stringify({ layout: "downloads", platform, files }, null, 2)}\n`,
	);
	process.stdout.write(`${JSON.stringify(files)}\n`);
} else {
	const native = createRuntimeContext({
		dataDir: outDir,
		env: {
			...process.env,
			OPALINE_SERVER_RUNTIMES: "download",
			OPALINE_DOWNLOAD_CACHE: cacheDir,
			OPALINE_CLICKHOUSE_BIN: "",
			OPALINE_POSTGRES_BIN_DIR: "",
			OPALINE_BUN_BIN: "",
		},
		home: homedir(),
		platform,
		log: (line) => process.stderr.write(`${line}\n`),
	});
	// Packaging for another platform (an Intel build on Apple silicon) cannot run
	// its binaries, or only slowly (Rosetta translates ClickHouse for minutes).
	// The downloads are checked against their pinned digests, so report the
	// pinned versions instead of running them.
	const pinnedVersion = (command: string) =>
		({
			clickhouse: `ClickHouse ${CLICKHOUSE_VERSION}`,
			postgres: `postgres (PostgreSQL) ${POSTGRES_VERSION}`,
			bun: BUN_VERSION,
		})[basename(command)];
	const context =
		platform === detected
			? native
			: { ...native, probe: async (command: string) => pinnedVersion(command) };
	const runtimes = [
		await resolveClickHouse(context),
		await resolvePostgres(context),
		await resolveBun(context),
	];
	const binDir = join(outDir, "bin");
	const manifest: Record<
		string,
		{ version: string; path: string; dir: string }
	> = {};
	for (const runtime of runtimes) {
		if (runtime.source !== "download")
			throw new Error(
				`${runtime.name} came from ${runtime.source}, not the pinned download.`,
			);
		manifest[runtime.name] = {
			version: runtime.version,
			path: relative(binDir, runtime.path),
			dir: relative(binDir, getRuntimeInstallDir(outDir, runtime.name)),
		};
	}
	writeFileSync(
		join(binDir, "runtimes.json"),
		`${JSON.stringify({ layout: "unpacked", platform, ...manifest }, null, 2)}\n`,
	);
	process.stdout.write(`${JSON.stringify(manifest)}\n`);
}
