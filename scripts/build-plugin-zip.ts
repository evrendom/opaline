/**
 * Packs the Opaline plugin for upload to the OpenAI plugin dashboard:
 * `dist/opaline-plugin-<version>.zip`, with the manifest, MCP config, skills
 * and assets at the archive root. Nothing else in `plugins/opaline/` ships
 * (no .DS_Store, editor files or env files).
 *
 *   bun scripts/build-plugin-zip.ts [--copy-to <dir>]
 */
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PLUGIN = join(ROOT, "plugins/opaline");
const ENTRIES = [".codex-plugin", ".mcp.json", "skills", "assets"];

const { version } = await Bun.file(
	join(PLUGIN, ".codex-plugin/plugin.json"),
).json();
const zip = join(ROOT, "dist", `opaline-plugin-${version}.zip`);
await mkdir(join(ROOT, "dist"), { recursive: true });
await rm(zip, { force: true });

const result = Bun.spawnSync(
	[
		"zip",
		"-r",
		"-X",
		zip,
		...ENTRIES,
		"-x",
		"*.DS_Store",
		"*/.*",
		"*.env*",
	],
	{ cwd: PLUGIN, stderr: "inherit" },
);
if (result.exitCode !== 0) throw new Error("zip failed");

const listing = Bun.spawnSync(["unzip", "-Z1", zip]).stdout.toString();
const files = listing.split("\n").filter((line) => line && !line.endsWith("/"));
console.log(files.join("\n"));
console.log(`wrote ${zip}`);

const copyIndex = process.argv.indexOf("--copy-to");
const copyTo = copyIndex === -1 ? undefined : process.argv[copyIndex + 1];
if (copyTo) {
	const target = join(copyTo, `opaline-plugin-${version}.zip`);
	await copyFile(zip, target);
	console.log(`copied to ${target}`);
}
