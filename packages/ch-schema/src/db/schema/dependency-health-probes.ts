import { schema, table } from "@chkit/core";

export default schema(
	table({
		database: "rudel",
		name: "dependency_health_probes",
		engine: "SharedReplacingMergeTree(probed_at)",
		columns: [
			{ name: "probe_id", type: "UUID" },
			{ name: "probed_at", type: "DateTime", default: "fn:now()" },
		],
		primaryKey: ["probe_id"],
		orderBy: ["probe_id"],
		ttl: "probed_at + toIntervalDay(1)",
		settings: { storage_policy: "'s3'" },
	}),
);
