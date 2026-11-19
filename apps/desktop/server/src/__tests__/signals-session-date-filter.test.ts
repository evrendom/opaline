import { beforeEach, describe, expect, mock, test } from "bun:test";
import { resolveRepoIdentity } from "@rudel/api-routes";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import * as clickhouse from "../clickhouse.js";
import { toRepoIdentityInput } from "../services/repo-identity-rows.js";
import { periodOf } from "../services/usage-digest/schedule.js";
import { readDigestReport } from "../services/usage-digest/usage.js";

const TRANSFORMED_SESSION_DATE_PREDICATE =
	/\b\w+\(\s*(?:\w+\.)?session_date\s*\)\s*(?:>=|<=|<|>|=|IN\b|BETWEEN\b)\s*(?:\w+\()?\{\w+:/i;

const REPOSITORY_ROW = {
	git_remote: "https://github.com/acme/web.git",
	package_name: "",
	project_path: "/work/web",
	fingerprint: "F1",
};

const queryCalls: ClickHouseStatement[] = [];

mock.module("../clickhouse.js", () => ({
	...clickhouse,
	queryClickhouse: (statement: ClickHouseStatement) => {
		queryCalls.push(statement);
		return Promise.resolve(
			statement.query.includes("AS fingerprint") ? [REPOSITORY_ROW] : [],
		);
	},
}));

const { getRepositoryOverview } = await import(
	"../services/repository-overview.service.js"
);

describe("session_date filters that can reach session_language_signals", () => {
	beforeEach(() => {
		queryCalls.length = 0;
	});

	test("compare bare DateTime64 bounds", () => {
		const filter = clickhouse.buildInclusiveDateTimeRangeFilter(
			"startDate",
			"endDate",
			"sa.session_date",
		);
		expect(filter).toBe(
			"sa.session_date >= toDateTime64({startDate:String}, 3, 'UTC') AND sa.session_date < toDateTime64({endDate:String}, 3, 'UTC') + INTERVAL 1 DAY",
		);
		expect(filter).not.toMatch(TRANSFORMED_SESSION_DATE_PREDICATE);
	});

	test("the repository overview joins signals without a transformed session_date predicate", async () => {
		await getRepositoryOverview("org-1", {
			repoKey: resolveRepoIdentity(toRepoIdentityInput(REPOSITORY_ROW)).repoKey,
			startDate: "2026-08-01",
			endDate: "2026-10-30",
		});

		const overview = queryCalls.find((statement) =>
			statement.query.includes("rudel.session_language_signals"),
		);
		expect(overview).toBeDefined();
		expect(overview?.query).not.toMatch(TRANSFORMED_SESSION_DATE_PREDICATE);
		expect(overview?.query_params).toMatchObject({
			startDate: "2026-08-01",
			endDate: "2026-10-30",
		});
	});

	test("the digest reads signals by bare session_date bounds and keeps only its days", async () => {
		const statements: ClickHouseStatement[] = [];
		const executor = {
			async query<T>(statement: ClickHouseStatement): Promise<T[]> {
				statements.push(statement);
				if (statement.query.includes("session_language_signals"))
					return [
						signalRow("2026-10-08", 2),
						signalRow("2026-10-04", 5),
					] as T[];
				if (statement.query.includes("ARRAY JOIN")) return [];
				if (statement.query.includes("AS title")) return [];
				return [digestRow("2026-10-08")] as T[];
			},
		} as unknown as ClickHouseExecutor;

		const report = await readDigestReport(
			executor,
			"org-1",
			periodOf("daily", "2026-10-08"),
			"UTC",
		);

		const signals = statements.find((statement) =>
			statement.query.includes("session_language_signals"),
		);
		expect(signals?.query).not.toMatch(TRANSFORMED_SESSION_DATE_PREDICATE);
		expect(signals?.query_params).toMatchObject({
			firstDay: "2026-10-01",
			lastDay: "2026-10-08",
		});
		expect(report.members.get("ada")?.frustration?.moments).toBe(2);
	});
});

function signalRow(day: string, negatives: number) {
	return {
		user_id: "ada",
		session_id: "s1",
		day,
		negatives,
		swears: 0,
		apologies: 0,
		phrases: {},
	};
}

function digestRow(day: string) {
	return {
		user_id: "ada",
		session_id: "s1",
		day,
		agent: "claude_code",
		repository: "github.com/acme/web",
		model: "claude-opus-5-5",
		runs: 1,
		prompts: 1,
		active_minutes: 10,
		cost_usd: 1,
		tool_calls: 0,
		failed_calls: 0,
		interrupts: 0,
		compactions: 0,
		api_errors_known_runs: 1,
		api_errors: 0,
		cache_read_tokens: 0,
		longest_run_minutes: 10,
		input_tokens: 0,
		subagent_launches: 0,
		subagent_minutes: 0,
		subagent_runs: 0,
		subagent_cost_usd: 0,
		subagent_tool_calls: 0,
		subagent_failed_calls: 0,
		turn_errors: 0,
		timeouts: 0,
		refusals: 0,
	};
}
