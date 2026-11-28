// The product demo's recorded answers are too large for the repository, so they
// live in a release asset named by demo-fixtures.lock.json. This puts them into
// demo-public/fixtures (git-ignored): skipped when the folder already holds the
// locked archive, otherwise downloaded, checked against the lock's sha256 and
// unpacked. A local archive can stand in for the download:
//   DEMO_FIXTURES_ARCHIVE=/path/to/demo-fixtures.tar bun tools/fetch-demo-fixtures.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const lock = JSON.parse(
	readFileSync(join(root, "demo-fixtures.lock.json"), "utf8"),
);
const target = join(root, "demo-public", "fixtures");
const marker = join(target, ".lock-sha256");

export async function fetchDemoFixtures() {
	if (existsSync(marker) && readFileSync(marker, "utf8").trim() === lock.sha256)
		return;
	const local = process.env.DEMO_FIXTURES_ARCHIVE;
	let bytes;
	if (local) bytes = readFileSync(local);
	else {
		const response = await fetch(lock.url, { redirect: "follow" });
		if (!response.ok)
			throw new Error(`demo fixtures: ${response.status} for ${lock.url}`);
		bytes = Buffer.from(await response.arrayBuffer());
	}
	const sha = createHash("sha256").update(bytes).digest("hex");
	if (sha !== lock.sha256)
		throw new Error(
			`demo fixtures: sha256 ${sha} does not match the lock (${lock.sha256})`,
		);
	const archive = join(tmpdir(), `demo-fixtures-${sha.slice(0, 12)}.tar.gz`);
	writeFileSync(archive, bytes);
	rmSync(target, { recursive: true, force: true });
	mkdirSync(target, { recursive: true });
	execFileSync("tar", ["-xzf", archive, "-C", target]);
	rmSync(archive, { force: true });
	writeFileSync(marker, `${lock.sha256}\n`);
	console.log(
		`Demo fixtures ${lock.dataset}: ${lock.answers} answers unpacked into demo-public/fixtures.`,
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
	await fetchDemoFixtures();
