import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import {
	createProgressLine,
	ensureVerifiedDownload,
} from "../../cli/src/lib/self-host/download.ts";
import {
	detectHostPlatform,
	getBunAsset,
	getClickHouseAsset,
	getPostgresAsset,
	type HostPlatform,
} from "../../cli/src/lib/self-host/pinned-runtimes.ts";
import {
	createRuntimeContext,
	getRuntimeInstallDir,
	resolveBun,
	resolveClickHouse,
	resolvePostgres,
} from "../../cli/src/lib/self-host/runtimes.ts";

const [mode, cacheDir, outDir, platformArgument] = process.argv.slice(2);
if ((mode !== "download" && mode !== "unpack") || !cacheDir || !outDir) {
	process.stderr.write(
		"usage: bun runtimes.ts download|unpack <verified download cache> <out dir> [darwin-arm64|darwin-x64]\n",
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
	const context = createRuntimeContext({
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
