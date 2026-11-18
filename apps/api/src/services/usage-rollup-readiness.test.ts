import { beforeEach, describe, expect, test } from "bun:test";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import {
	buildUsageRollupCoverageStatement,
	clearUsageRollupReadiness,
	hasCompleteUsageRollups,
	isUsageRollupCoverageComplete,
	USAGE_ROLLUP_BUILD_VERSION,
} from "./usage-session-rollup.service.js";

function coverageExecutor(
	answer: () => Promise<Array<{ rolled_up: number; uncovered: number }>>,
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
	test("a workspace is ready only when every session has a current rollup", () => {
		expect(isUsageRollupCoverageComplete(undefined)).toBe(false);
		expect(isUsageRollupCoverageComplete({ rolled_up: 0, uncovered: 0 })).toBe(
			false,
		);
		expect(isUsageRollupCoverageComplete({ rolled_up: 0, uncovered: 12 })).toBe(
			false,
		);
		expect(isUsageRollupCoverageComplete({ rolled_up: 40, uncovered: 1 })).toBe(
			false,
		);
		expect(
			isUsageRollupCoverageComplete({ rolled_up: "40", uncovered: "0" }),
		).toBe(true);
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
		expect(
			statement.query.match(/organization_id = \{organizationId:String\}/g),
		).toHaveLength(3);
		expect(statement.query_params).toEqual({
			buildVersion: USAGE_ROLLUP_BUILD_VERSION,
			organizationId: "org-a",
		});
		expect(statement.clickhouse_settings?.join_use_nulls).toBe(0);
	});

	test("zero rollup rows, an older build and a complete workspace", async () => {
		const answers = [
			{ rolled_up: 0, uncovered: 30 },
			{ rolled_up: 30, uncovered: 3 },
			{ rolled_up: 30, uncovered: 0 },
		];
		for (const [index, answer] of answers.entries()) {
			clearUsageRollupReadiness();
			const { executor } = coverageExecutor(async () => [answer]);
			expect(await hasCompleteUsageRollups(executor, "org-a")).toBe(
				index === 2,
			);
		}
	});

	test("caches a ready workspace for two minutes and a not-ready one for one", async () => {
		let clock = 0;
		let answer = { rolled_up: 5, uncovered: 0 };
		const { executor, statements } = coverageExecutor(async () => [answer]);
		const ready = () => hasCompleteUsageRollups(executor, "org-a", () => clock);
		expect(await Promise.all([ready(), ready()])).toEqual([true, true]);
		expect(statements).toHaveLength(1);
		clock = 119_000;
		answer = { rolled_up: 5, uncovered: 1 };
		expect(await ready()).toBe(true);
		clock = 120_000;
		expect(await ready()).toBe(false);
		expect(statements).toHaveLength(2);
		clock += 59_000;
		answer = { rolled_up: 6, uncovered: 0 };
		expect(await ready()).toBe(false);
		clock += 1_000;
		expect(await ready()).toBe(true);
		expect(statements).toHaveLength(3);
	});

	test("a failed check prices from the events", async () => {
		const { executor } = coverageExecutor(async () => {
			throw new Error("timeout");
		});
		expect(await hasCompleteUsageRollups(executor, "org-a")).toBe(false);
	});
});
