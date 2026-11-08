import { afterEach, expect, mock, test } from "bun:test";

const statements: { text: string; values: unknown[] }[] = [];
const fakeSql = (strings: TemplateStringsArray, ...values: unknown[]) => {
	statements.push({ text: strings.join("$"), values });
	return Promise.resolve(Object.assign([], { count: 0 }));
};
mock.module("../db.js", () => ({
	sqlClient: fakeSql,
	db: {},
	ingestProcessingSqlClient: {},
	liveSessionSqlClient: {},
}));

const { handleAnalysisLogRetentionMaintenanceRequest } = await import(
	"./analysis-log-retention-maintenance.js"
);
const { setAnalysisLogForTests } = await import(
	"../services/analysis-log/config.js"
);

const SECRET = "0123456789abcdef0123";
const saved = {
	CRON_SECRET: process.env.CRON_SECRET,
	OPALINE_SELF_HOSTED: process.env.OPALINE_SELF_HOSTED,
	ANALYSIS_LOG_STORE: process.env.ANALYSIS_LOG_STORE,
};
afterEach(() => {
	for (const [name, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	statements.length = 0;
	setAnalysisLogForTests(undefined);
});

const request = (secret: string) =>
	new Request("http://selfhost.internal/api/cron/analysis-log-retention", {
		headers: { Authorization: `Bearer ${secret}` },
	});

test("refuses a request without the cron secret", async () => {
	process.env.CRON_SECRET = SECRET;
	const response = await handleAnalysisLogRetentionMaintenanceRequest(
		request("wrong-secret-0000000"),
	);
	expect(response.status).toBe(401);
	expect(statements).toEqual([]);
});

test("leaves Postgres alone while analyses live elsewhere", async () => {
	process.env.CRON_SECRET = SECRET;
	delete process.env.OPALINE_SELF_HOSTED;
	for (const store of [undefined, "memory", "convex"]) {
		if (store === undefined) delete process.env.ANALYSIS_LOG_STORE;
		else process.env.ANALYSIS_LOG_STORE = store;
		const response = await handleAnalysisLogRetentionMaintenanceRequest(
			request(SECRET),
		);
		expect(await response.json()).toEqual({ ok: true, skipped: "store" });
	}
	expect(statements).toEqual([]);
});

test("on a self-hosted server deletes drafts past 7 days and results past their retention", async () => {
	process.env.CRON_SECRET = SECRET;
	process.env.OPALINE_SELF_HOSTED = "1";
	delete process.env.ANALYSIS_LOG_STORE;
	const startedAt = Date.now();
	const response = await handleAnalysisLogRetentionMaintenanceRequest(
		request(SECRET),
	);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ ok: true, drafts: 0, results: 0 });
	const deletion = statements.find((statement) =>
		statement.text.includes("DELETE FROM analysis_log_analysis"),
	);
	const draftCutoff = statements.find((statement) =>
		statement.text.includes("draft AND created_at"),
	);
	const results = statements.find((statement) =>
		statement.text.includes("UPDATE analysis_log_query q SET has_output"),
	);
	expect(deletion).toBeDefined();
	const [before] = (draftCutoff?.values ?? []) as string[];
	expect(Date.parse(before ?? "")).toBeLessThanOrEqual(
		startedAt - 7 * 86_400_000 + 5_000,
	);
	expect(Date.parse(before ?? "")).toBeGreaterThan(
		startedAt - 7 * 86_400_000 - 5_000,
	);
	const [resultCutoff, sharedCutoff] = (results?.values ?? []) as string[];
	expect(Date.parse(resultCutoff ?? "")).toBeCloseTo(
		startedAt - 90 * 86_400_000,
		-4,
	);
	expect(Date.parse(sharedCutoff ?? "")).toBeCloseTo(
		startedAt - 365 * 86_400_000,
		-4,
	);
});
