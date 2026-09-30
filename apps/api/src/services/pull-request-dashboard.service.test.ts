import { expect, test } from "bun:test";
import type { CostDashboardInput } from "@rudel/api-routes";
import { resolvePriorSessionAttribution } from "./github-evidence-persistence.service.js";
import {
	type AttributedPullRequest,
	buildPullRequestMetric,
} from "./pull-request-dashboard.service.js";

const input: CostDashboardInput = {
	startDate: "2026-09-01",
	endDate: "2026-09-30",
	members: [],
	repositories: [],
	models: [],
	signalTypes: [],
	phrases: [],
	runSignals: [],
	durations: [],
	skillsUsed: [],
	splitBy: "none",
};

function observation(
	overrides: Partial<AttributedPullRequest> = {},
): AttributedPullRequest {
	return {
		pullKey: "repo:github:101",
		date: "2026-09-20",
		member: "member-1",
		memberLabel: "Member One",
		memberImage: null,
		repository: "repo",
		repositoryLabel: "opaline/repo",
		model: "gpt-6-astra",
		failedJobs: [],
		ciComplete: true,
		...overrides,
	};
}

test("counts one merged PR across many attributed sessions", () => {
	const metric = buildPullRequestMetric(
		[
			observation(),
			observation({ member: "member-2", memberLabel: "Member Two" }),
			observation({ model: "gpt-5.6-sol" }),
		],
		input,
		false,
	);

	expect(metric.total).toBe(1);
	expect(metric.trend.find(({ date }) => date === "2026-09-20")).toMatchObject({
		total: 1,
		values: { total: 1 },
	});
	expect(metric.breakdowns.members.map(({ value }) => value)).toEqual([1, 1]);
	expect(metric.breakdowns.models.map(({ value }) => value)).toEqual([1, 1]);
});

test("deduplicates repeated CI jobs while retaining distinct retry attempts", () => {
	const metric = buildPullRequestMetric(
		[
			observation({ failedJobs: ["run:1:job", "run:2:job"] }),
			observation({ failedJobs: ["run:1:job"] }),
		],
		input,
		true,
	);

	expect(metric).toMatchObject({ total: 2, numerator: 2, denominator: 1 });
	expect(metric.trend.find(({ date }) => date === "2026-09-20")).toMatchObject({
		total: 2,
		values: { total: 2 },
		numerator: 2,
		denominator: 1,
		numeratorValues: { total: 2 },
		denominatorValues: { total: 1 },
	});
});

test("zero-fills every UTC day of the range for merged PRs", () => {
	const metric = buildPullRequestMetric(
		[
			observation({ pullKey: "repo:github:1", date: "2026-09-02" }),
			observation({ pullKey: "repo:github:2", date: "2026-09-05" }),
			observation({ pullKey: "repo:github:3", date: "2026-09-05" }),
		],
		{ ...input, endDate: "2026-09-07" },
		false,
	);

	expect(
		metric.trend.map(({ date, total, values }) => [date, total, values]),
	).toEqual([
		["2026-09-01", 0, { total: 0 }],
		["2026-09-02", 1, { total: 1 }],
		["2026-09-03", 0, { total: 0 }],
		["2026-09-04", 0, { total: 0 }],
		["2026-09-05", 2, { total: 2 }],
		["2026-09-06", 0, { total: 0 }],
		["2026-09-07", 0, { total: 0 }],
	]);
	expect(metric.total).toBe(3);
});

test("zero-fills split series and leaves empty CI ratio days without a denominator", () => {
	const split = {
		...input,
		endDate: "2026-09-03",
		splitBy: "members" as const,
	};
	const merged = buildPullRequestMetric(
		[observation({ date: "2026-09-02" })],
		split,
		false,
	);
	const ratio = buildPullRequestMetric(
		[observation({ date: "2026-09-02", failedJobs: ["run:1:job"] })],
		split,
		true,
	);

	expect(merged.trend.map(({ values }) => values)).toEqual([
		{ "series-0": 0 },
		{ "series-0": 1 },
		{ "series-0": 0 },
	]);
	expect(ratio.trend.map(({ date }) => date)).toEqual([
		"2026-09-01",
		"2026-09-02",
		"2026-09-03",
	]);
	expect(ratio.trend[0]).toMatchObject({
		total: 0,
		numerator: 0,
		denominator: 0,
		denominatorValues: { "series-0": 0 },
	});
	expect(ratio.trend[1]).toMatchObject({
		total: 1,
		numerator: 1,
		denominator: 1,
	});
});

test("an empty pull request cohort still plots a zero line across the range", () => {
	const metric = buildPullRequestMetric(
		[],
		{ ...input, endDate: "2026-09-03" },
		false,
	);

	expect(metric.trend.map(({ total }) => total)).toEqual([0, 0, 0]);
	expect(metric.hasUsage).toBe(false);
});

test("leaves refresh attribution unknown when prior evidence is ambiguous", () => {
	expect(
		resolvePriorSessionAttribution([
			{ session_source: "codex", session_user_id: "member-1" },
			{ session_source: "claude_code", session_user_id: "member-2" },
		]),
	).toBeUndefined();
});

test("refresh attribution lookup remains tenant and context scoped", async () => {
	const source = await Bun.file(
		new URL("./github-evidence-persistence.service.ts", import.meta.url),
	).text();
	expect(source).toContain("snapshot.organization_id = $1");
	expect(source).toContain("snapshot.repository_id = $2");
	expect(source).toContain("snapshot.session_id = $3");
	expect(source).toContain("collection.context_id = $4");
});
