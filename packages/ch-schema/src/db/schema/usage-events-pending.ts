import { schema, table } from "@chkit/core";
import {
	USAGE_EVENTS_PENDING_COLUMNS,
	USAGE_EVENTS_PENDING_COMMENT,
	USAGE_EVENTS_PENDING_KEY,
	USAGE_EVENTS_PENDING_TTL,
	USAGE_EVENTS_PENDING_VERSION,
} from "../../usage-events-pending.js";

export const usageEventsPendingTable = table({
	database: "rudel",
	name: "usage_events_pending",
	engine: `SharedReplacingMergeTree(${USAGE_EVENTS_PENDING_VERSION})`,
	columns: [...USAGE_EVENTS_PENDING_COLUMNS],
	primaryKey: USAGE_EVENTS_PENDING_KEY,
	orderBy: USAGE_EVENTS_PENDING_KEY,
	ttl: USAGE_EVENTS_PENDING_TTL,
	settings: {
		index_granularity: "1024",
		storage_policy: "'s3'",
	},
	comment: USAGE_EVENTS_PENDING_COMMENT,
});

export default schema(usageEventsPendingTable);
