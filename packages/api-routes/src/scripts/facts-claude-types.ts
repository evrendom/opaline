import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { claudeTypesCoverage } from "../session-transcript/transcript-records/claude-types-coverage.js";
import { generateClaudeTypesSnapshot } from "./claude-types/oracle.js";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
let source: string | undefined;
let out: string | undefined;
for (let index = 0; index < args.length; index += 2) {
	const flag = args[index];
	const value = args[index + 1];
	if (value === undefined || value.startsWith("--"))
		throw new Error(`${flag} requires a path`);
	if (flag === "--source") source = resolve(value);
	else if (flag === "--out") out = resolve(value);
	else throw new Error(`Unknown flag ${flag}`);
}
if (source === undefined)
	throw new Error(
		"Usage: facts:claude-types -- --source <published sdk-tools.d.ts> [--out <snapshot.json>]",
	);
const metadata: unknown = JSON.parse(
	readFileSync(join(dirname(source), "package.json"), "utf8"),
);
if (
	typeof metadata !== "object" ||
	metadata === null ||
	!("name" in metadata) ||
	metadata.name !== "@anthropic-ai/claude-agent-sdk" ||
	!("version" in metadata) ||
	metadata.version !== "0.3.287"
)
	throw new Error(
		"Expected published SDK 0.3.287; review the version correspondence before updating the pin.",
	);
const snapshot = generateClaudeTypesSnapshot(
	readFileSync(source, "utf8"),
	metadata.version,
	"2.1.287",
);
if (snapshot.diagnostics.length)
	throw new Error(snapshot.diagnostics.join("\n"));
const target =
	out ??
	new URL(
		"../session-transcript/transcript-records/claude-types-0.3.287.json",
		import.meta.url,
	).pathname;
await Bun.write(target, `${JSON.stringify(snapshot)}\n`);
const coverage = claudeTypesCoverage(undefined, undefined, snapshot);
await Bun.write(
	new URL(
		"../session-transcript/transcript-records/claude-types-coverage-0.3.287.json",
		import.meta.url,
	),
	`${JSON.stringify({ ...coverage, blindSpots: coverage.blindSpots.map(({ tool, direction, path, source }) => ({ tool, direction, path, source })) })}\n`,
);
console.log(
	JSON.stringify({
		catalogSources: coverage.catalogSources,
		matches: coverage.matches,
		noted: coverage.noted.length,
		unaccounted: coverage.unaccounted,
		expectedPaths: coverage.expectedPaths,
		observedPaths: coverage.observedPaths,
		blindSpots: coverage.blindSpots.length,
		localNotInSdk: coverage.localNotInSdk.length,
	}),
);
console.log(
	JSON.stringify({
		out: target,
		tools: snapshot.tools.length,
		paths: snapshot.paths.length,
		sha256: snapshot.sha256,
		diagnostics: snapshot.diagnostics.length,
	}),
);
