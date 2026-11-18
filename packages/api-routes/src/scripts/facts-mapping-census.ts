import { homedir } from "node:os";
import {
	FACT_AGENTS,
	FACT_CATALOG,
} from "../session-transcript/transcript-records/fact-catalog.js";
import {
	compareVersions,
	createCensus,
	pathMatches,
} from "../session-transcript/transcript-records/fact-census.js";
import { addCensusPaths } from "../session-transcript/transcript-records/fact-census-files.js";
import { CENSUS_IGNORED_PATHS } from "../session-transcript/transcript-records/fact-census-ignored.js";
import { sourcePathMatch } from "../session-transcript/transcript-records/fact-source-coverage.js";

const census = createCensus(CENSUS_IGNORED_PATHS);
await addCensusPaths(census, [
	`${homedir()}/.claude/projects`,
	`${homedir()}/.codex/sessions`,
]);
const paths = Object.fromEntries(
	FACT_AGENTS.map((agent) => [
		agent,
		Object.fromEntries(
			[...(census.paths.get(agent) ?? [])]
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([path, stats]) => [path, stats.count]),
		),
	]),
);
const legacyPatterns = FACT_CATALOG.flatMap(
	(entry) => entry.agents.codex.legacySources ?? [],
);
const legacyPaths = [...(census.paths.get("codex") ?? [])]
	.filter(
		([path]) =>
			sourcePathMatch(path) === undefined &&
			(!/^response_item\/function_call:[^.]+\.arguments[.[]/u.test(path) ||
				legacyPatterns.some((pattern) => pathMatches(pattern, path))),
	)
	.sort(([left], [right]) => left.localeCompare(right))
	.map(([path, stats]) => ({
		path,
		count: stats.count,
		versions: [...stats.versions.keys()].sort(compareVersions),
	}));
await Bun.write(
	new URL(
		"../session-transcript/transcript-records/codex-legacy-paths.json",
		import.meta.url,
	),
	`${JSON.stringify({ corpus: `Read-only local Codex census, ${new Date().toISOString().slice(0, 10)}: ${census.files.get("codex")} files, ${census.records.get("codex")} records`, paths: legacyPaths })}\n`,
);
await Bun.write(
	new URL(
		"../session-transcript/transcript-records/fact-mapping-census.json",
		import.meta.url,
	),
	`${JSON.stringify({ corpus: `Read-only local transcript census, ${new Date().toISOString().slice(0, 10)}: ${FACT_AGENTS.map((agent) => `${agent}: ${census.files.get(agent)} files, ${census.records.get(agent)} records`).join("; ")}`, paths })}\n`,
);
console.log(
	JSON.stringify({
		files: Object.fromEntries(census.files),
		records: Object.fromEntries(census.records),
	}),
);
