import { schema, table } from "@chkit/core";
import {
	FINDING_RUNS_COLUMNS,
	FINDING_RUNS_COMMENT,
	FINDING_RUNS_ORDER_BY,
} from "../../finding-runs.js";

/**
 * `analysis_finding_runs` (`src/finding-runs.ts`): each saved finding's
 * cited runs with their recorded measures. A share rewrites an analysis's
 * rows with its new `visibility_revision`, so the highest wins under FINAL.
 */
export const analysisFindingRunsTable = table({
	database: "rudel",
	name: "analysis_finding_runs",
	engine: "SharedReplacingMergeTree(visibility_revision)",
	columns: [...FINDING_RUNS_COLUMNS],
	primaryKey: [...FINDING_RUNS_ORDER_BY],
	orderBy: [...FINDING_RUNS_ORDER_BY],
	settings: {
		index_granularity: "8192",
		storage_policy: "'s3'",
	},
	comment: FINDING_RUNS_COMMENT,
});

export default schema(analysisFindingRunsTable);
