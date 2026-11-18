import { schema, table } from "@chkit/core";
import {
	SESSION_INVENTORY_COLUMNS,
	SESSION_INVENTORY_COMMENT,
	SESSION_INVENTORY_KEY,
	SESSION_INVENTORY_TTL,
	SESSION_INVENTORY_VERSION,
} from "../../session-inventory.js";

export const sessionInventoryTable = table({
	database: "rudel",
	name: "session_inventory",
	engine: `SharedReplacingMergeTree(${SESSION_INVENTORY_VERSION})`,
	columns: [...SESSION_INVENTORY_COLUMNS],
	primaryKey: SESSION_INVENTORY_KEY,
	orderBy: SESSION_INVENTORY_KEY,
	ttl: SESSION_INVENTORY_TTL,
	settings: {
		index_granularity: "1024",
		storage_policy: "'s3'",
	},
	comment: SESSION_INVENTORY_COMMENT,
});

export default schema(sessionInventoryTable);
