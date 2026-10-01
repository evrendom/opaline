import { schema, table } from "@chkit/core";
import { GITHUB_OUTCOME_TABLES } from "../../github-outcomes.js";

export const githubOutcomesSchema = schema(
	...GITHUB_OUTCOME_TABLES.map((definition) =>
		table({
			database: "rudel",
			name: definition.name,
			engine: "SharedReplacingMergeTree(version)",
			columns: definition.columns,
			primaryKey: definition.orderBy,
			orderBy: definition.orderBy,
			settings: {
				storage_policy: "'s3'",
				non_replicated_deduplication_window: 1000,
			},
		}),
	),
);
