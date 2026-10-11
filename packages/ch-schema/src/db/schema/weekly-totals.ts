import { schema, table } from "@chkit/core";
import {
	WEEKLY_TOTALS_KEY_COLUMNS,
	WEEKLY_TOTALS_MEASURES,
	WEEKLY_TOTALS_ORDER_BY,
	WEEKLY_TOTALS_SNAPSHOT_DAYS,
} from "../../weekly-totals.js";

/**
 * `weekly_totals` (docs/l1-literal-schema.md, "Weekly totals"): nightly
 * snapshots of the run index summed per workspace, member, agent and ISO
 * week. Only the target table is declared here: the refreshable view that
 * fills it (`weekly_totals_mv`) has a REFRESH clause chkit cannot express, so
 * it lives in the hand-written migration `20261011150000_weekly_totals.sql`
 * and its runner validates it.
 *
 * Each refresh appends a whole snapshot (one part per day partition), and a
 * snapshot is read only when it holds all `snapshot_rows` of its rows, so a
 * refresh in flight is never seen. Day partitions let the TTL drop old
 * snapshots whole.
 */
export const weeklyTotalsTable = table({
	database: "rudel",
	name: "weekly_totals",
	engine: "SharedMergeTree",
	columns: [...WEEKLY_TOTALS_KEY_COLUMNS, ...WEEKLY_TOTALS_MEASURES].map(
		({ name, type, comment }) => ({ name, type, comment }),
	),
	primaryKey: [...WEEKLY_TOTALS_ORDER_BY],
	orderBy: [...WEEKLY_TOTALS_ORDER_BY],
	partitionBy: "toDate(refreshed_at)",
	ttl: `toDateTime(refreshed_at) + toIntervalDay(${WEEKLY_TOTALS_SNAPSHOT_DAYS})`,
	settings: {
		index_granularity: "8192",
		ttl_only_drop_parts: "1",
		storage_policy: "'s3'",
	},
	comment:
		"Nightly snapshots of the run index summed per workspace, member, agent and ISO week; appended only by weekly_totals_mv.",
});

export default schema(weeklyTotalsTable);
