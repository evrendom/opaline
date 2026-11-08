import { describe, expect, test } from "bun:test";
import {
	adaptExecutor,
	adaptSql,
	adaptStatement,
	CLOUD_CAPABILITIES,
	type ClickHouseCapabilities,
	expectedEngine,
	probeClickHouseCapabilities,
	readClickHouseFlavorSetting,
} from "../clickhouse-flavor.js";

const OSS_S3: ClickHouseCapabilities = {
	flavor: "oss",
	sharedEngines: false,
	storagePolicy: "s3",
};
const NAS: ClickHouseCapabilities = {
	flavor: "oss",
	sharedEngines: false,
	storagePolicy: "default",
};

function server(answers: { shared: boolean; s3: boolean }) {
	const asked: string[] = [];
	return {
		asked,
		query: async (sql: string) => {
			asked.push(sql);
			if (sql.includes("system.table_engines"))
				return [{ n: answers.shared ? "1" : "0" }];
			if (sql.includes("system.storage_policies"))
				return [{ n: answers.s3 ? 1 : 0 }];
			throw new Error(`unexpected ${sql}`);
		},
	};
}

describe("CLICKHOUSE_FLAVOR", () => {
	test("defaults to auto and accepts only auto, oss and cloud", () => {
		expect(readClickHouseFlavorSetting({})).toBe("auto");
		expect(readClickHouseFlavorSetting({ CLICKHOUSE_FLAVOR: " " })).toBe(
			"auto",
		);
		expect(readClickHouseFlavorSetting({ CLICKHOUSE_FLAVOR: "OSS" })).toBe(
			"oss",
		);
		expect(readClickHouseFlavorSetting({ CLICKHOUSE_FLAVOR: "cloud" })).toBe(
			"cloud",
		);
		expect(() =>
			readClickHouseFlavorSetting({ CLICKHOUSE_FLAVOR: "local" }),
		).toThrow("CLICKHOUSE_FLAVOR must be auto, oss or cloud");
	});

	test("cloud assumes shared engines and the s3 policy without asking the server", async () => {
		const probe = server({ shared: false, s3: false });
		expect(
			await probeClickHouseCapabilities(probe.query, {
				CLICKHOUSE_FLAVOR: "cloud",
			}),
		).toEqual(CLOUD_CAPABILITIES);
		expect(probe.asked).toEqual([]);
	});

	test("auto asks the server for shared engines and the s3 policy", async () => {
		expect(
			await probeClickHouseCapabilities(
				server({ shared: true, s3: true }).query,
				{},
			),
		).toEqual(CLOUD_CAPABILITIES);
		expect(
			await probeClickHouseCapabilities(
				server({ shared: false, s3: true }).query,
				{},
			),
		).toEqual(OSS_S3);
		expect(
			await probeClickHouseCapabilities(
				server({ shared: false, s3: false }).query,
				{ CLICKHOUSE_FLAVOR: "auto" },
			),
		).toEqual(NAS);
	});

	test("oss never uses shared engines but still checks the storage policy", async () => {
		const probe = server({ shared: true, s3: false });
		expect(
			await probeClickHouseCapabilities(probe.query, {
				CLICKHOUSE_FLAVOR: "oss",
			}),
		).toEqual(NAS);
		expect(probe.asked).toHaveLength(1);
		expect(probe.asked[0]).toContain("system.storage_policies");
	});

	test("the expected engine follows the capabilities", () => {
		expect(expectedEngine(CLOUD_CAPABILITIES, "ReplacingMergeTree")).toBe(
			"SharedReplacingMergeTree",
		);
		expect(expectedEngine(NAS, "ReplacingMergeTree")).toBe(
			"ReplacingMergeTree",
		);
	});
});

describe("statement adaptation", () => {
	const ddl = `CREATE TABLE IF NOT EXISTS rudel.github_ci_runs
(
  \`id\` UInt64
) ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', version)
ORDER BY (id)
SETTINGS index_granularity = 8192, storage_policy = 's3', non_replicated_deduplication_window = 1000;`;
	const check = `SELECT throwIf(countIf(startsWith(engine_full, 'SharedReplacingMergeTree(extraction_seq)') AND position(create_table_query, 's3') > 0) != 1)`;

	test("a cloud target runs every statement unchanged", () => {
		expect(adaptSql(ddl, CLOUD_CAPABILITIES)).toBe(ddl);
		expect(
			adaptStatement(
				"SYSTEM SYNC REPLICA _chkit_migrations",
				CLOUD_CAPABILITIES,
			),
		).toBe("SYSTEM SYNC REPLICA _chkit_migrations");
	});

	test("without shared engines only ENGINE clauses lose Shared and their replication arguments", () => {
		const adapted = adaptSql(ddl, OSS_S3);
		expect(adapted).toContain("ENGINE = ReplacingMergeTree(version)");
		expect(adapted).toContain("storage_policy = 's3'");
		expect(adaptSql("ENGINE = SharedMergeTree()", OSS_S3)).toBe(
			"ENGINE = MergeTree()",
		);
		expect(adaptSql("ENGINE=SharedReplacingMergeTree(revision)", OSS_S3)).toBe(
			"ENGINE=ReplacingMergeTree(revision)",
		);
		expect(adaptSql(check, OSS_S3)).toBe(check);
	});

	test("without the s3 policy tables use the default policy and checks look for it", () => {
		const adapted = adaptSql(ddl, NAS);
		expect(adapted).toContain(
			"SETTINGS index_granularity = 8192, storage_policy = 'default', non_replicated_deduplication_window = 1000;",
		);
		expect(adaptSql(check, NAS)).toContain(
			"position(create_table_query, 'default') > 0",
		);
		expect(adaptSql(check, NAS)).toContain(
			"'SharedReplacingMergeTree(extraction_seq)'",
		);
	});

	test("replication syncs and s3 policy changes are skipped where they cannot apply", () => {
		expect(
			adaptStatement("SYSTEM SYNC REPLICA _chkit_migrations", OSS_S3),
		).toBeNull();
		const modify =
			"-- operation: alter_table_modify_setting risk=caution\nALTER TABLE rudel.claude_sessions MODIFY SETTING storage_policy = 's3';";
		expect(adaptStatement(modify, NAS)).toBeNull();
		expect(adaptStatement(modify, OSS_S3)).toBe(modify);
	});
});

describe("adapted executor", () => {
	function recorder(tables: string[] = []) {
		const executed: string[] = [];
		const queried: string[] = [];
		return {
			executed,
			queried,
			executor: {
				execute: async (sql: string) => {
					executed.push(sql);
				},
				query: async <T>(sql: string): Promise<T[]> => {
					queried.push(sql);
					if (sql.includes("FROM system.tables"))
						return [
							{ n: tables.some((table) => sql.includes(`'${table}'`)) ? 1 : 0 },
						] as T[];
					return [] as T[];
				},
				close: async () => {},
			},
		};
	}

	test("a cloud target gets the executor itself", () => {
		const { executor } = recorder();
		expect(adaptExecutor(executor, CLOUD_CAPABILITIES)).toBe(executor);
	});

	test("statements are adapted or skipped, and the journal probe never fails on the server", async () => {
		const missing = recorder();
		const adapted = adaptExecutor(missing.executor, NAS);
		await adapted.execute("SYSTEM SYNC REPLICA _chkit_migrations");
		await adapted.execute(
			"CREATE TABLE t (a UInt8) ENGINE = MergeTree ORDER BY a SETTINGS storage_policy = 's3'",
		);
		expect(missing.executed).toEqual([
			"CREATE TABLE t (a UInt8) ENGINE = MergeTree ORDER BY a SETTINGS storage_policy = 'default'",
		]);
		await expect(
			adapted.query("SELECT name FROM _chkit_migrations LIMIT 0"),
		).rejects.toThrow("does not exist yet");
		expect(missing.queried).toHaveLength(1);

		const present = recorder(["_chkit_migrations"]);
		await adaptExecutor(present.executor, NAS).query(
			"SELECT name FROM _chkit_migrations LIMIT 0",
		);
		expect(present.queried).toEqual([
			expect.stringContaining("FROM system.tables"),
			"SELECT name FROM _chkit_migrations LIMIT 0",
		]);
	});
});
