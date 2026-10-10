/**
 * The L1 drift census: every field path in the given transcripts that the
 * fact catalog does not map. Read-only; prints no values except short
 * enum-like ones.
 *
 *   bun run --cwd packages/api-routes facts:census -- <dir-or-file>... \
 *     [--agent claude_code|codex] [--json] [--limit N]
 *
 * Directories are walked for `.jsonl` files. The agent is detected per file
 * unless `--agent` is given. Exits 1 when a path is unmapped and
 * `--fail-on-unmapped` is set.
 */
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	type CensusAgent,
	censusReportJson,
	censusStream,
	compareCensus,
	createCensus,
	formatCensusReport,
} from "../session-transcript/transcript-records/fact-census.js";
import { FACT_CENSUS_CATALOG } from "../session-transcript/transcript-records/fact-census-ignored.js";

interface Options {
	readonly paths: string[];
	agent?: CensusAgent;
	json: boolean;
	limit: number;
	failOnUnmapped: boolean;
}

function parseArgs(argv: readonly string[]): Options {
	const options: Options = {
		paths: [],
		json: false,
		limit: 50,
		failOnUnmapped: false,
	};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? "";
		if (arg === "--json") options.json = true;
		else if (arg === "--fail-on-unmapped") options.failOnUnmapped = true;
		else if (arg === "--agent") {
			const agent = argv[++index];
			if (agent !== "claude_code" && agent !== "codex")
				throw new Error("--agent must be claude_code or codex");
			options.agent = agent;
		} else if (arg === "--limit") {
			options.limit = Number(argv[++index]);
			if (!Number.isSafeInteger(options.limit) || options.limit < 1)
				throw new Error("--limit must be a positive integer");
		} else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
		else options.paths.push(arg);
	}
	if (options.paths.length === 0)
		throw new Error(
			"Usage: facts:census -- <dir-or-file>... [--agent claude_code|codex] [--json] [--limit N] [--fail-on-unmapped]",
		);
	return options;
}

async function* jsonlFiles(path: string): AsyncGenerator<string> {
	const info = await stat(path);
	if (info.isFile()) {
		yield path;
		return;
	}
	const entries = await readdir(path, { withFileTypes: true });
	entries.sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		const child = join(path, entry.name);
		if (entry.isDirectory()) yield* jsonlFiles(child);
		else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield child;
	}
}

/** Feed a file to the census line by line, without holding it in memory. */
async function censusFile(
	addLine: (line: string) => void,
	path: string,
): Promise<void> {
	const decoder = new TextDecoder();
	let pending = "";
	const reader = Bun.file(path).stream().getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		pending += decoder.decode(value, { stream: true });
		const lines = pending.split("\n");
		pending = lines.pop() ?? "";
		for (const line of lines) addLine(line);
	}
	addLine(pending + decoder.decode());
}

const options = parseArgs(process.argv.slice(2));
const census = createCensus();
for (const root of options.paths)
	for await (const file of jsonlFiles(resolve(root)))
		await censusFile(censusStream(census, options.agent), file);
const report = compareCensus(census, FACT_CENSUS_CATALOG);
process.stdout.write(
	options.json
		? censusReportJson(report)
		: formatCensusReport(report, { limit: options.limit }),
);
if (
	options.failOnUnmapped &&
	report.agents.some((agent) => agent.unmapped.length > 0)
)
	process.exitCode = 1;
