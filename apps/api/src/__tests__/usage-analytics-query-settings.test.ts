import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ClickHouseStatement } from "../clickhouse.js";
import * as clickhouse from "../clickhouse.js";

const queryCalls: ClickHouseStatement[] = [];

mock.module("../clickhouse.js", () => ({
	...clickhouse,
	getClickhouse: () => ({
		query: () => Promise.resolve([]),
	}),
	queryClickhouse: (statement: ClickHouseStatement) => {
		queryCalls.push(statement);
		return Promise.resolve(
			statement.query.includes("AS fingerprint")
				? [
						{
							fingerprint: "fingerprint-1",
							git_remote: "https://github.com/acme/app.git",
							package_name: "",
							project_path: "/work/app",
						},
					]
				: [],
		);
	},
}));

const { getSessionAnalytics, getSessionAnalyticsSummaryComparison } =
	await import("../services/session-analytics.service.js");
const { getSessionDimensionAnalysis } = await import(
	"../services/session-analytics.service.js"
);
const { getSessionFilterCatalog } = await import(
	"../services/session-list-filters.js"
);
const { getLastSessionUpload, LAST_UPLOAD_QUERY_CACHE_SETTINGS } = await import(
	"../services/session-last-upload.service.js"
);
const { listRepositories } = await import(
	"../services/repositories.service.js"
);
const { getRepositoryOverview } = await import(
	"../services/repository-overview.service.js"
);
const { getUsersDailyTrend } = await import("../services/overview.service.js");
const { getSessionFamilyCost } = await import(
	"../services/session-family-cost.service.js"
);
const { USAGE_ANALYTICS_CLICKHOUSE_SETTINGS } = await import(
	"../services/usage-event-analytics.service.js"
);

const pricedQueries = () =>
	queryCalls.filter((statement) =>
		statement.query.includes("usage_analytics_metadata AS ("),
	);

describe("priced analytics reads", () => {
	beforeEach(() => {
		queryCalls.length = 0;
	});

	test("skip the AND-chain rewrite that dominated their analysis, keeping their own settings", async () => {
		expect(USAGE_ANALYTICS_CLICKHOUSE_SETTINGS).toEqual({
			optimize_and_compare_chain: 0,
		});
		await getSessionAnalytics("org-1", { days: 7 });
		await getSessionAnalyticsSummaryComparison("org-1", { days: 7 });
		await getSessionDimensionAnalysis("org-1", {
			dimension: "model_used",
			metric: "session_count",
		});
		await getSessionFilterCatalog("org-1", { days: 30 }).catch(() => null);
		await getLastSessionUpload("org-settings");
		await listRepositories("org-1");
		await getRepositoryOverview("org-1", {
			endDate: "2026-08-31",
			repoKey: "remote:github.com/acme/app",
			startDate: "2026-08-01",
		});
		await getUsersDailyTrend("org-1", "2026-08-01", "2026-08-31");
		await getSessionFamilyCost({
			estimatedCost: 1,
			organizationId: "org-1",
			ownerId: "user-1",
			sessionId: "session-1",
			source: "codex",
		});
		const priced = pricedQueries();
		expect(priced.length).toBeGreaterThanOrEqual(10);
		for (const statement of priced)
			expect(statement.clickhouse_settings).toMatchObject(
				USAGE_ANALYTICS_CLICKHOUSE_SETTINGS,
			);
		expect(
			priced.map((statement) => statement.clickhouse_settings?.log_comment),
		).toEqual(
			expect.arrayContaining([
				"analytics.sessions.list",
				"analytics.sessions.summaryComparison",
				"analytics.sessions.filterCatalog",
				"analytics.sessions.lastUpload",
				"analytics.repositories.overview",
			]),
		);
	});

	test("the last upload bar reads through the ClickHouse query cache for its 30 second reuse window", async () => {
		await getLastSessionUpload("org-cache");
		const reads = pricedQueries();
		expect(reads.length).toBeGreaterThan(0);
		for (const statement of reads)
			expect(statement.clickhouse_settings).toMatchObject({
				...LAST_UPLOAD_QUERY_CACHE_SETTINGS,
				join_use_nulls: 0,
				log_comment: "analytics.sessions.lastUpload",
			});
		expect(LAST_UPLOAD_QUERY_CACHE_SETTINGS).toEqual({
			query_cache_nondeterministic_function_handling: "save",
			query_cache_ttl: 30,
			use_query_cache: 1,
		});
		await getSessionAnalytics("org-1", { days: 7 });
		expect(queryCalls.at(-1)?.clickhouse_settings).not.toHaveProperty(
			"use_query_cache",
		);
	});
});
