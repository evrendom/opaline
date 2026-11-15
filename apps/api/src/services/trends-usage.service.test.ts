import { expect, test } from "bun:test";
import {
	assembleTrendsUsage,
	buildFrictionWindowStatement,
	frictionRows,
	readExcludedUserIds,
	type TrendsUsageRows,
	trendsQueryParams,
	trendsWindow,
} from "./trends-usage.service.js";

const window = trendsWindow(new Date("2026-10-03T12:00:00Z"));

const runRow = (
	model: string,
	runs: number,
	developers: number,
	workspaces: number,
	isTotal = 0,
	sessions = Math.ceil(runs / 4),
) => ({
	period: "current" as const,
	model,
	is_total: isTotal,
	runs: String(runs),
	replied: "0",
	negative: "0",
	mixed: "0",
	neutral: "0",
	positive: "0",
	timed: "0",
	seconds_q: [0, 0, 0],
	developers: String(developers),
	workspaces: String(workspaces),
	sessions: String(sessions),
});

const empty: TrendsUsageRows = {
	runs: [],
	counts: [],
	runUsage: [],
	usageTotals: [],
	sessions: [],
	tools: [],
	runTimeMonths: [],
	toolCallMonths: [],
	friction: [],
};

test("the window is all time through yesterday, its last 30 days and 13 whole weeks", () => {
	expect(window).toEqual({
		periodStart: "2000-01-01",
		periodEndExclusive: "2026-10-03",
		previousPeriodStart: "2000-01-01",
		harnessStart: "2026-09-03",
		shareStart: "2026-06-29",
		shareEndExclusive: "2026-09-28",
	});
});

test("all time is published from the first day any run started", () => {
	const usage = assembleTrendsUsage(
		{
			...empty,
			runs: [runRow("", 200, 4, 3, 1), runRow("claude-opus-5", 200, 4, 3)],
			counts: [
				{
					kind: "first",
					key: "2025-11-20",
					model: "claude-opus-5",
					runs: "200",
				},
				{ kind: "first", key: "2025-07-02", model: "gpt-5", runs: "3" },
			],
		},
		window,
		{ minRuns: 50, minDevelopers: 2, minWorkspaces: 2, minRunShare: 0.01 },
		new Date("2026-10-03T12:00:00Z"),
	);
	expect(usage.scope).toBe("all_time");
	expect(usage.periodStart).toBe("2025-07-02");
	expect(usage.periodEndExclusive).toBe("2026-10-03");
	expect(usage.models[0]?.firstUsedAt).toBe("2025-11-20");
	expect(usage.models[0]?.previous).toBeNull();
});

test("only models that clear every threshold are published; totals keep everything", () => {
	const usage = assembleTrendsUsage(
		{
			...empty,
			runs: [
				runRow("", 1000, 9, 5, 1),
				runRow("claude-opus-5-5", 900, 5, 3),
				runRow("gpt-6-astra", 95, 4, 2),
				runRow("claude-haiku-4-5-20251001", 5, 1, 1),
			],
		},
		window,
		{ minRuns: 50, minDevelopers: 2, minWorkspaces: 2, minRunShare: 0.01 },
		new Date("2026-10-03T12:00:00Z"),
	);
	expect(usage.models.map((model) => model.familyId)).toEqual([
		"claude-opus-5-5",
		"gpt-6-astra",
	]);
	expect(usage.totals).toEqual({
		runs: 1000,
		sessions: 250,
		prompts: 0,
		developers: 9,
		workspaces: 5,
	});
	expect(usage.models.map((model) => model.sessions)).toEqual([230, 20]);
	expect(usage.harnessDays).toHaveLength(30);
	expect(usage.weeks).toHaveLength(13);
});

test("daily runs per model run from the first day with any, published models only", () => {
	const usage = assembleTrendsUsage(
		{
			...empty,
			runs: [
				runRow("", 1000, 9, 5, 1),
				runRow("claude-opus-5-5", 900, 5, 3),
				runRow("claude-haiku-4-5-20251001", 5, 1, 1),
			],
			counts: [
				{
					kind: "model_day",
					key: "2026-09-20",
					model: "claude-opus-5-5",
					runs: "42",
				},
				{
					kind: "model_day",
					key: "2026-09-20",
					model: "claude-haiku-4-5-20251001",
					runs: "3",
				},
				{
					kind: "model_day",
					key: "2026-03-01",
					model: "claude-opus-5-5",
					runs: "1",
				},
			],
		},
		window,
		{ minRuns: 50, minDevelopers: 2, minWorkspaces: 2, minRunShare: 0.01 },
		new Date("2026-10-03T12:00:00Z"),
	);
	expect(usage.modelDays).toHaveLength(216);
	expect(usage.modelDays?.[0]).toEqual({
		day: "2026-03-01",
		runsByModel: { "claude-opus-5-5": 1 },
	});
	expect(usage.modelDays?.at(-1)?.day).toBe("2026-10-02");
	expect(
		usage.modelDays?.find((day) => day.day === "2026-09-20")?.runsByModel,
	).toEqual({ "claude-opus-5-5": 42 });
	expect(
		usage.modelDays?.find((day) => day.day === "2026-09-21")?.runsByModel,
	).toEqual({ "claude-opus-5-5": 0 });
});

test("harness days carry each harness's input tokens, cache included, beside output and cost", () => {
	const usage = assembleTrendsUsage(
		{
			...empty,
			usageTotals: [
				{
					day: "2026-09-20",
					model: "claude-opus-5-5",
					source: "claude_code",
					input_tokens: "900",
					output_tokens: "100",
					cost: 2,
				},
				{
					day: "2026-09-20",
					model: "gpt-6-astra",
					source: "codex",
					input_tokens: "300",
					output_tokens: "40",
					cost: 0.5,
				},
			],
		},
		window,
		{ minRuns: 50, minDevelopers: 2, minWorkspaces: 2, minRunShare: 0.01 },
		new Date("2026-10-03T12:00:00Z"),
	);
	const day = usage.harnessDays.find((entry) => entry.day === "2026-09-20");
	expect(usage.harnessDays).toHaveLength(30);
	expect(day?.inputTokens).toEqual({ "claude-code": 900, codex: 300 });
	expect(day?.outputTokens).toEqual({ "claude-code": 100, codex: 40 });
	expect(day?.costUsd).toEqual({ "claude-code": 2, codex: 0.5 });
});

test("harness days reach back to the first day with any runs or usage", () => {
	const usage = assembleTrendsUsage(
		{
			...empty,
			counts: [{ kind: "day", key: "2026-08-01", model: "codex", runs: "4" }],
			usageTotals: [
				{
					day: "2026-07-31",
					model: "claude-opus-5-5",
					source: "claude_code",
					input_tokens: "10",
					output_tokens: "5",
					cost: 1,
				},
			],
		},
		window,
		{ minRuns: 50, minDevelopers: 2, minWorkspaces: 2, minRunShare: 0.01 },
		new Date("2026-10-03T12:00:00Z"),
	);
	expect(usage.harnessDays[0]).toEqual({
		day: "2026-07-31",
		runs: { "claude-code": 0, codex: 0 },
		outputTokens: { "claude-code": 5, codex: 0 },
		inputTokens: { "claude-code": 10, codex: 0 },
		costUsd: { "claude-code": 1, codex: 0 },
	});
	expect(usage.harnessDays[1]?.runs).toEqual({ "claude-code": 0, codex: 4 });
	expect(usage.harnessDays.at(-1)?.day).toBe("2026-10-02");
});

test("figures without a measurement are null, never zero", () => {
	const usage = assembleTrendsUsage(
		{
			...empty,
			runs: [runRow("", 10, 1, 1, 1), runRow("gpt-6-sol", 10, 1, 1)],
		},
		window,
		{ minRuns: 1, minDevelopers: 1, minWorkspaces: 1, minRunShare: 0 },
		new Date("2026-10-03T12:00:00Z"),
	);
	expect(usage.models[0]?.current).toEqual({
		runs: 10,
		apologiesPer100Runs: null,
		reactions: null,
		replyRate: 0,
		swearsPer1kPrompts: null,
		toolFailureRate: null,
		runSeconds: null,
		outputTokensPerRun: null,
		costPerRunUsd: null,
	});
	expect(usage.models[0]?.previous).toBeNull();
});

test("run time per month lists complete months that clear the thresholds", () => {
	const month = (start: string, runs: number, developers: number) => ({
		month: start,
		runs: String(runs),
		developers: String(developers),
		mean_seconds: 120,
		seconds_q: [600, 1800],
	});
	const usage = assembleTrendsUsage(
		{
			...empty,
			runTimeMonths: [
				month("2026-08-01", 304, 5),
				month("2026-09-01", 40, 5),
				month("2026-10-01", 500, 9),
			],
		},
		window,
		{ minRuns: 50, minDevelopers: 2, minWorkspaces: 2, minRunShare: 0.01 },
		new Date("2026-10-03T12:00:00Z"),
	);
	// September has too few runs; October is still in progress.
	expect(usage.runTimeMonths).toEqual([
		{
			monthStart: "2026-08-01",
			runs: 300,
			meanSeconds: 120,
			p95Seconds: 600,
			p99Seconds: 1800,
		},
	]);
});

test("friction lists each population's models that enough of its developers used", () => {
	const figures = (developers: number, swears: number, tokens: number) => ({
		developers: String(developers),
		swearers: String(Math.min(developers, swears)),
		swears: String(swears),
		apologies: String(swears * 2),
		tool_errors: String(swears * 10),
		tokens: String(tokens),
		prompts: String(tokens / 10_000),
	});
	const row = (
		model: string,
		all: ReturnType<typeof figures>,
		swearers: ReturnType<typeof figures>,
		cohort: ReturnType<typeof figures>,
	) =>
		({
			model,
			...Object.fromEntries(
				Object.entries({ all, swearers, cohort }).flatMap(([key, value]) =>
					Object.entries(value).map(([field, figure]) => [
						`${key}_${field}`,
						figure,
					]),
				),
			),
		}) as unknown as TrendsUsageRows["friction"][number];
	const usage = assembleTrendsUsage(
		{
			...empty,
			friction: [
				row(
					"claude-opus-5-5",
					figures(48, 34, 35_000_000),
					figures(20, 34, 20_000_000),
					figures(48, 34, 35_000_000),
				),
				row(
					"gpt-5.5",
					figures(80, 300, 120_000_000),
					figures(20, 300, 100_000_000),
					figures(2, 200, 60_000_000),
				),
			],
		},
		window,
		{ minRuns: 50, minDevelopers: 3, minWorkspaces: 2, minRunShare: 0.01 },
		new Date("2026-10-03T12:00:00Z"),
	);
	expect(usage.friction?.cohortFamilyId).toBe("claude-opus-5-5");
	expect(usage.friction?.all.models.map((model) => model.familyId)).toEqual([
		"claude-opus-5-5",
		"gpt-5.5",
	]);
	// Two cohort developers used GPT-5.5: too few to list.
	expect(usage.friction?.cohort.models.map((model) => model.familyId)).toEqual([
		"claude-opus-5-5",
	]);
	expect(usage.friction?.all.models[1]).toEqual({
		familyId: "gpt-5.5",
		developers: 80,
		swearers: 80,
		swears: 300,
		apologies: 600,
		toolErrors: 3000,
		outputTokens: 120_000_000,
		prompts: 12_000,
	});
});

test("excluded developers come from a comma-separated list", () => {
	const previous = process.env.TRENDS_EXCLUDED_USER_IDS;
	process.env.TRENDS_EXCLUDED_USER_IDS = " user-a, ,user-b ";
	expect(readExcludedUserIds()).toEqual(["user-a", "user-b"]);
	delete process.env.TRENDS_EXCLUDED_USER_IDS;
	expect(readExcludedUserIds()).toEqual([]);
	if (previous !== undefined) process.env.TRENDS_EXCLUDED_USER_IDS = previous;
});

test("tool calls per month list complete months that clear the thresholds", () => {
	const usage = assembleTrendsUsage(
		{
			...empty,
			toolCallMonths: [
				{
					month: "2026-09-01",
					runs: "404",
					developers: "6",
					mean_calls: 7.5,
					calls_q: [32, 110],
				},
				{
					month: "2026-10-01",
					runs: "900",
					developers: "9",
					mean_calls: 8,
					calls_q: [30, 100],
				},
			],
		},
		window,
		{ minRuns: 50, minDevelopers: 2, minWorkspaces: 2, minRunShare: 0.01 },
		new Date("2026-10-03T12:00:00Z"),
	);
	expect(usage.toolCallMonths).toEqual([
		{
			monthStart: "2026-09-01",
			runs: 400,
			meanCalls: 7.5,
			p95Calls: 32,
			p99Calls: 110,
		},
	]);
});

test("a friction window bounds every input on the primary key and carries its budget", () => {
	const statement = buildFrictionWindowStatement(
		{
			from: { organizationId: "org-a", userId: "user-a", sessionId: "s-1" },
			to: { organizationId: "org-b", userId: "user-b", sessionId: "s-2" },
		},
		trendsQueryParams(window),
	);
	const reads = [
		...statement.query.matchAll(
			/FROM rudel\.(usage_events|session_language_signals|transcript_records)\b[\s\S]*?(?=\bFROM\b|$)/g,
		),
	];
	expect(reads.map((read) => read[1]).sort()).toEqual([
		"session_language_signals",
		"transcript_records",
		"transcript_records",
		"usage_events",
	]);
	for (const [read] of reads) {
		expect(read).toContain("session_id >= {fromSessionId:String}");
		expect(read).toContain("session_id < {toSessionId:String}");
		expect(read).not.toContain("<= {toSessionId:String}");
	}
	expect(statement.query).toContain(
		"r.organization_id > {fromOrganizationId:String}",
	);
	expect(statement.query).not.toContain("dev_totals");
	expect(statement.query_params).toMatchObject({
		fromOrganizationId: "org-a",
		toSessionId: "s-2",
	});
	expect(statement.clickhouse_settings).toMatchObject({
		max_memory_usage: String(1024 ** 3),
		max_rows_to_read: "24000000",
		max_bytes_to_read: String(4 * 1024 ** 3),
	});
	expect(
		buildFrictionWindowStatement({}, trendsQueryParams(window)).query,
	).not.toContain("OrganizationId:String}");
});

test("friction rows merge each developer's windows before choosing populations", () => {
	const developer = (
		organization: string,
		user: string,
		model: string,
		figures: Partial<
			Record<"tokens" | "swears" | "apologies" | "errors" | "prompts", number>
		>,
	) => ({
		model,
		organization_id: organization,
		user_id: user,
		output_tokens: String(figures.tokens ?? 0),
		swears: String(figures.swears ?? 0),
		apologies: String(figures.apologies ?? 0),
		tool_errors: String(figures.errors ?? 0),
		prompts: String(figures.prompts ?? 0),
	});
	const rows = frictionRows([
		developer("org-a", "ann", "gpt-5.5", { tokens: 100, prompts: 4 }),
		developer("org-a", "ann", "gpt-5.5", { swears: 2, errors: 1, prompts: 1 }),
		developer("org-a", "ann", "claude-opus-5-5", { tokens: 50, apologies: 3 }),
		developer("org-b", "ann", "gpt-5.5", { tokens: 10, errors: 2 }),
		developer("org-b", "bob", "claude-opus-5-5", { prompts: 2 }),
	]);
	expect(rows.map((row) => row.model)).toEqual(["claude-opus-5-5", "gpt-5.5"]);
	expect(rows[1]).toMatchObject({
		all_developers: "2",
		all_swearers: "1",
		all_swears: "2",
		all_tool_errors: "3",
		all_tokens: "110",
		all_prompts: "5",
		swearers_developers: "1",
		swearers_tokens: "100",
		cohort_developers: "1",
		cohort_tool_errors: "1",
	});
	expect(rows[0]).toMatchObject({
		all_developers: "2",
		all_apologies: "3",
		swearers_developers: "1",
		swearers_apologies: "3",
		cohort_developers: "1",
		cohort_prompts: "0",
	});
});
