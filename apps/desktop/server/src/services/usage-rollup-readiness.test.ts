import { beforeEach, describe, expect, test } from "bun:test";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import {
	buildUsageRollupCoverageStatement,
	clearUsageRollupReadiness,
	readUsageRollupCoverage,
	USAGE_ROLLUP_BUILD_VERSION,
	USAGE_ROLLUP_MAX_STALE_SESSIONS,
	usageRollupCoverageFromRow,
} from "./usage-session-rollup.service.js";

type Stale = Array<[string, string, string]>;
const stale = (count: number): Stale =>
	Array.from({ length: count }, (_, index) => [
		"user-a",
		"claude_code",
		`session-${index}`,
	]);

function coverageExecutor(
	answer: () => Promise<
		Array<{ rolled_up: number; uncovered: number; stale?: Stale }>
	>,
) {
	const statements: ClickHouseStatement[] = [];
	const executor = {
		query: async (statement: ClickHouseStatement) => {
			statements.push(statement);
			return answer();
		},
	} as unknown as ClickHouseExecutor;
	return { executor, statements };
}

beforeEach(() => clearUsageRollupReadiness());

describe("usage rollup readiness", () => {
	test("a workspace with rollups prices its few stale sessions from their events", () => {
		const notReady = { ready: false, staleSessions: [] };
		expect(usageRollupCoverageFromRow(undefined)).toEqual(notReady);
		expect(
			usageRollupCoverageFromRow({ rolled_up: 0, uncovered: 0, stale: [] }),
		).toEqual(notReady);
		expect(
			usageRollupCoverageFromRow({
				rolled_up: 0,
				uncovered: 12,
				stale: stale(12),
			}),
		).toEqual(notReady);
		expect(
			usageRollupCoverageFromRow({
				rolled_up: "40",
				uncovered: "0",
				stale: [],
			}),
		).toEqual({ ready: true, staleSessions: [] });
		expect(
			usageRollupCoverageFromRow({
				rolled_up: 40,
				uncovered: 1,
				stale: [["user-a", "codex", "thread-1"]],
			}),
		).toEqual({
			ready: true,
			staleSessions: [
				{ sessionId: "thread-1", source: "codex", userId: "user-a" },
			],
		});
		const most = USAGE_ROLLUP_MAX_STALE_SESSIONS;
		expect(
			usageRollupCoverageFromRow({
				rolled_up: 40,
				uncovered: most,
				stale: stale(most),
			}).ready,
		).toBe(true);
		expect(
			usageRollupCoverageFromRow({
				rolled_up: 40,
				uncovered: most + 1,
				stale: stale(most + 1),
			}),
		).toEqual(notReady);
		expect(
			usageRollupCoverageFromRow({
				rolled_up: 40,
				uncovered: 2,
				stale: stale(1),
			}),
		).toEqual(notReady);
	});

	test("counts sessions without a rollup, of another build, built before their latest upload, or behind their latest receipt", () => {
		const statement = buildUsageRollupCoverageStatement("org-a");
		expect(statement.query).toContain("FROM rudel.session_analytics");
		expect(statement.query).toContain("FROM rudel.usage_session_rollups FINAL");
		expect(statement.query).toContain("LEFT ANY JOIN");
		expect(statement.query).toContain("r.session_id = ''");
		expect(statement.query).toContain(
			"r.build_version != {buildVersion:UInt32}",
		);
		expect(statement.query).toContain("r.built_at < sa.ingested_at");
		expect(statement.query).toContain(
			"r.receipt_generation != e.receipt_generation",
		);
		expect(statement.query).toContain("FROM rudel.usage_events");
		expect(statement.query).toContain(
			`groupArrayIf(${USAGE_ROLLUP_MAX_STALE_SESSIONS + 1})`,
		);
		expect(
			statement.query.match(/organization_id = \{organizationId:String\}/g),
		).toHaveLength(3);
		expect(statement.query_params).toEqual({
			buildVersion: USAGE_ROLLUP_BUILD_VERSION,
			organizationId: "org-a",
		});
		expect(statement.clickhouse_settings?.join_use_nulls).toBe(0);
	});

	test("caches the coverage for thirty seconds", async () => {
		let clock = 0;
		let answer = { rolled_up: 5, uncovered: 0, stale: [] as Stale };
		const { executor, statements } = coverageExecutor(async () => [answer]);
		const read = async () =>
			(await readUsageRollupCoverage(executor, "org-a", () => clock))
				.staleSessions.length;
		expect(await Promise.all([read(), read()])).toEqual([0, 0]);
		expect(statements).toHaveLength(1);
		answer = { rolled_up: 5, uncovered: 1, stale: stale(1) };
		clock = 29_999;
		expect(await read()).toBe(0);
		clock = 30_000;
		expect(await read()).toBe(1);
		expect(statements).toHaveLength(2);
	});

	test("a failed check prices from the events", async () => {
		const { executor } = coverageExecutor(async () => {
			throw new Error("timeout");
		});
		expect(await readUsageRollupCoverage(executor, "org-a")).toEqual({
			ready: false,
			staleSessions: [],
		});
	});
});
