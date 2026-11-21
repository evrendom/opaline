import { beforeEach, describe, expect, mock, test } from "bun:test";
import { resolveRepoIdentity } from "@rudel/api-routes";
import type { ClickHouseStatement } from "../clickhouse.js";
import * as clickhouse from "../clickhouse.js";
import { toRepoIdentityInput } from "../services/repo-identity-rows.js";

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
});
