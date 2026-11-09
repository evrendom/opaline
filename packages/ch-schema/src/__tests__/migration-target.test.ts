import { expect, spyOn, test } from "bun:test";
import * as chkit from "@chkit/clickhouse";
import { openMigrationTarget } from "../../scripts/migration-target.js";
import { CLOUD_CAPABILITIES } from "../clickhouse-flavor.js";

const ENGINES = "system.table_engines";
const POLICIES = "system.storage_policies";
const SHARED_DDL =
	"CREATE TABLE rudel.github_ci_runs (`id` UInt64) ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', version) ORDER BY id SETTINGS storage_policy = 's3'";

type Answer = (sql: string) => Response | Record<string, unknown>[];

function fakeClickHouse(answer: Answer) {
	const requests: {
		sql: string;
		database: string | null;
		authorization: string | null;
	}[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const sql = (await request.text())
				.replace(/\s*FORMAT JSONEachRow$/u, "")
				.trim();
			requests.push({
				sql,
				database: new URL(request.url).searchParams.get("database"),
				authorization: request.headers.get("authorization"),
			});
			const result = answer(sql);
			if (result instanceof Response) return result;
			return new Response(
				result.map((row) => `${JSON.stringify(row)}\n`).join(""),
				{
					headers: {
						"Content-Type": "application/x-ndjson; charset=UTF-8",
						"X-ClickHouse-Format": "JSONEachRow",
					},
				},
			);
		},
	});
	return {
		url: `http://127.0.0.1:${server.port}`,
		requests,
		stop: () => server.stop(true),
	};
}

const capable =
	(shared: boolean, s3: boolean): Answer =>
	(sql) => {
		if (sql.includes(ENGINES)) return [{ n: shared ? "1" : "0" }];
		if (sql.includes(POLICIES)) return [{ n: s3 ? "1" : "0" }];
		return [];
	};

function countCloses() {
	const create = chkit.createClickHouseExecutor;
	let closes = 0;
	const spy = spyOn(chkit, "createClickHouseExecutor").mockImplementation(
		(config) => {
			const executor = create(config);
			return {
				...executor,
				close: async () => {
					closes += 1;
					await executor.close();
				},
			};
		},
	);
	return { closes: () => closes, restore: () => spy.mockRestore() };
}

const basic = (user: string, password: string) =>
	`Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

test("CLICKHOUSE_URL is required", async () => {
	await expect(openMigrationTarget({})).rejects.toThrow(
		"CLICKHOUSE_URL is required",
	);
});

test("a server with shared engines is cloud: Shared engines, statements unchanged, its own credentials and database", async () => {
	const clickhouse = fakeClickHouse(capable(true, true));
	const executors = countCloses();
	try {
		const target = await openMigrationTarget(
			{
				CLICKHOUSE_URL: clickhouse.url,
				CLICKHOUSE_USERNAME: "opaline",
				CLICKHOUSE_PASSWORD: "ch-password",
			},
			"rudel",
		);
		await target.executor.execute(SHARED_DDL);
		await target.close();

		expect(target.url).toBe(clickhouse.url);
		expect(target.capabilities).toEqual(CLOUD_CAPABILITIES);
		expect(target.engine("ReplacingMergeTree")).toBe(
			"SharedReplacingMergeTree",
		);
		expect(clickhouse.requests.map((request) => request.sql)).toEqual([
			expect.stringContaining(ENGINES),
			expect.stringContaining(POLICIES),
			SHARED_DDL,
		]);
		for (const request of clickhouse.requests) {
			expect(request.database).toBe("rudel");
			expect(request.authorization).toBe(basic("opaline", "ch-password"));
		}
		expect(executors.closes()).toBe(1);
	} finally {
		executors.restore();
		clickhouse.stop();
	}
});

test("a NAS without shared engines or the s3 policy gets plain engines and adapted statements", async () => {
	const clickhouse = fakeClickHouse(capable(false, false));
	try {
		const target = await openMigrationTarget({
			CLICKHOUSE_URL: clickhouse.url,
		});
		await target.executor.execute(SHARED_DDL);
		await target.close();

		expect(target.capabilities).toEqual({
			flavor: "oss",
			sharedEngines: false,
			storagePolicy: "default",
		});
		expect(target.engine("ReplacingMergeTree")).toBe("ReplacingMergeTree");
		expect(clickhouse.requests.at(-1)?.sql).toBe(
			"CREATE TABLE rudel.github_ci_runs (`id` UInt64) ENGINE = ReplacingMergeTree(version) ORDER BY id SETTINGS storage_policy = 'default'",
		);
		expect(clickhouse.requests.at(-1)?.authorization).toBe(
			basic("default", ""),
		);
	} finally {
		clickhouse.stop();
	}
});

test("a failed probe closes the connection and reports what ClickHouse said", async () => {
	const clickhouse = fakeClickHouse(
		() =>
			new Response(
				"Code: 497. DB::Exception: opaline: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(name) ON system.table_engines. (ACCESS_DENIED) (version 26.9.16.10 (official build))\n",
				{
					status: 403,
					headers: { "X-ClickHouse-Exception-Code": "497" },
				},
			),
	);
	const executors = countCloses();
	const quiet = spyOn(console, "error").mockImplementation(() => {});
	try {
		await expect(
			openMigrationTarget({
				CLICKHOUSE_URL: clickhouse.url,
				CLICKHOUSE_USERNAME: "opaline",
			}),
		).rejects.toThrow("Not enough privileges");
		expect(executors.closes()).toBe(1);
	} finally {
		quiet.mockRestore();
		executors.restore();
		clickhouse.stop();
	}
});
