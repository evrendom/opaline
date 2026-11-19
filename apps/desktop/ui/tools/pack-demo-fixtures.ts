import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { DemoFixture } from "../src/features/demo/demo-fixtures";

const [recordedDir, outDir = "demo-public/fixtures", ...replacements] =
	process.argv.slice(2);
if (!recordedDir) {
	console.error(
		"usage: bun tools/pack-demo-fixtures.ts <recorded-dir> [out-dir] [from=to ...]",
	);
	process.exit(1);
}

const rewrites = replacements.map((pair) => {
	const [from, to = ""] = pair.split("=");
	if (!from) throw new Error(`Bad replacement: ${pair}`);
	return [from, to] as const;
});
const scrub = (text: string) =>
	rewrites.reduce((value, [from, to]) => value.replaceAll(from, to), text);

interface Recording {
	method: string;
	path: string;
	search: string;
	body: string;
	status: number;
	type: string;
	response: string;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
const index: DemoFixture[] = [];
const written = new Set<string>();
let bytes = 0;
for (const name of (await readdir(recordedDir)).sort()) {
	if (!name.endsWith(".json")) continue;
	const recording = JSON.parse(
		await readFile(join(recordedDir, name), "utf8"),
	) as Recording;
	if (recording.status >= 400 || /event-stream/u.test(recording.type)) continue;
	const response = scrub(recording.response);
	const file = `${createHash("sha1").update(response).digest("hex").slice(0, 16)}.json.gz`;
	if (!written.has(file)) {
		written.add(file);
		const packed = gzipSync(response, { level: 9 });
		bytes += packed.byteLength;
		await writeFile(join(outDir, file), packed);
	}
	index.push({
		method: recording.method,
		path: recording.path,
		search: scrub(recording.search),
		body: scrub(recording.body),
		status: recording.status,
		type: recording.type.split(";")[0] ?? "application/json",
		file,
	});
}
index.sort((a, b) =>
	`${a.path} ${a.search} ${a.body}`.localeCompare(
		`${b.path} ${b.search} ${b.body}`,
	),
);
await writeFile(join(outDir, "index.json"), JSON.stringify(index));
console.log(
	`${index.length} answers in ${written.size} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB gzipped`,
);
