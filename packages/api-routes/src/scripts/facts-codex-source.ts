import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	CODEX_SOURCE_SNAPSHOT,
	sourceOracleCoverage,
	sourceSnapshotDiff,
} from "../session-transcript/transcript-records/fact-source-coverage.js";
import { generateSourceSnapshot } from "./codex-source/oracle.js";

const argv = process.argv.slice(2).filter((arg) => arg !== "--");
let source: string | undefined;
let out: string | undefined;
for (let position = 0; position < argv.length; position += 2) {
	const flag = argv[position];
	const value = argv[position + 1];
	if (value === undefined || value.startsWith("--"))
		throw new Error(`${flag} requires a path`);
	if (flag === "--source") source = resolve(value);
	else if (flag === "--out") out = resolve(value);
	else throw new Error(`Unknown option ${flag}`);
}
if (source === undefined)
	throw new Error(
		"Usage: facts:codex-source -- --source <openai/codex checkout> [--out <file>]",
	);
const rustRoot = existsSync(join(source, "codex-rs"))
	? join(source, "codex-rs")
	: source;
const checkout = rustRoot.endsWith("codex-rs") ? dirname(rustRoot) : source;
const git = (args: readonly string[]) => {
	const result = Bun.spawnSync(["git", "-C", checkout, ...args], {
		env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_OPTIONAL_LOCKS: "0" },
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim());
	return result.stdout.toString().trim();
};
const tag = git(["describe", "--tags", "--exact-match", "--match", "rust-v*"]);
const version = /^rust-v(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/u.exec(tag)?.[1];
if (version === undefined)
	throw new Error(`Unsupported Codex source tag ${tag}`);
if (
	git([
		"status",
		"--porcelain",
		"--untracked-files=no",
		"--",
		":(glob)codex-rs/**/*.rs",
		":(glob)codex-rs/**/Cargo.toml",
		"codex-rs/Cargo.toml",
	]) !== ""
)
	throw new Error(
		"Rust source or crate manifests have tracked modifications; cannot attribute evidence to their tag",
	);
const snapshot = generateSourceSnapshot(
	rustRoot,
	version,
	git(["rev-parse", "HEAD"]),
);
const diff = sourceSnapshotDiff(CODEX_SOURCE_SNAPSHOT, snapshot);
const coverage = sourceOracleCoverage(undefined, snapshot);
console.log(
	JSON.stringify({
		added: diff.added,
		removed: diff.removed,
		removedStoredDependencies: diff.removedStoredDependencies,
		mapped: coverage.mapped,
		ignored: coverage.ignored,
		context: coverage.context.length,
		pendingReview: coverage.pendingReview.length,
		pendingPaths: coverage.pending.length,
		residue: coverage.residue.length,
		missingCatalogSources: coverage.missingSources,
	}),
);
if (diff.removedStoredDependencies.length > 0)
	throw new Error(
		"Removed writer paths are dependencies of stored facts; review catalog/legacy evidence before updating the pin",
	);
const path =
	out ??
	new URL(
		`../session-transcript/transcript-records/codex-source-${version}.json`,
		import.meta.url,
	).pathname;
await Bun.write(path, `${JSON.stringify(snapshot)}\n`);
console.log(
	JSON.stringify({
		tag,
		paths: snapshot.paths.length,
		policies: snapshot.policies.length,
		diagnostics: snapshot.diagnostics.length,
		out: path,
	}),
);
