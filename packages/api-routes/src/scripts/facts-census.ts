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
import {
	type CensusAgent,
	censusReportJson,
	compareCensus,
	createCensus,
	formatCensusReport,
} from "../session-transcript/transcript-records/fact-census.js";
import { addCensusPaths } from "../session-transcript/transcript-records/fact-census-files.js";
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

const options = parseArgs(process.argv.slice(2));
const census = createCensus();
await addCensusPaths(census, options.paths, options.agent);
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
