import { expect, test } from "bun:test";
import type { CostDashboardInput, SessionAnalytics } from "@rudel/api-routes";
import { buildSessionsDashboard } from "./skill-dashboard";

function session(overrides: Partial<SessionAnalytics>): SessionAnalytics {
	return {
		session_id: "s",
		user_id: "u1",
		session_date: "2026-10-01T09:00:00Z",
		project_path: "/repo",
		repository: null,
		duration_min: 10,
		total_tokens: 100,
		input_tokens: 60,
		output_tokens: 40,
		estimated_cost: 1,
		total_interactions: 3,
		subagent_types: [],
		skills: [],
		slash_commands: [],
		error_count: 0,
		model_used: "opus",
		member_swears: 0,
		member_apologies: 0,
		member_positive: 0,
		model_swears: 0,
		model_apologies: 0,
		model_positive: 0,
		...overrides,
	} as SessionAnalytics;
}

const input = (overrides: Partial<CostDashboardInput> = {}) =>
	({
		startDate: "2026-10-01",
		endDate: "2026-10-03",
		requestedMetric: "cost",
		splitBy: "none",
		members: [],
		repositories: [],
		models: [],
		signalTypes: [],
		phrases: [],
		...overrides,
	}) as CostDashboardInput;

const labels = { names: { u1: "Ada", u2: "Lin" }, avatars: {} };
const sessions = [
	session({ session_id: "a", estimated_cost: 2 }),
	session({
		session_id: "b",
		user_id: "u2",
		model_used: "sonnet",
		session_date: "2026-10-03T10:00:00Z",
		member_swears: 1,
		member_swear_matches: ["ugh"],
	}),
	session({ session_id: "c", estimated_cost: null }),
];

test("totals, daily trend and breakdowns, unpriced sessions flagged", () => {
	const { metrics } = buildSessionsDashboard(sessions, input(), labels);
	expect(metrics.cost.total).toBe(3);
	expect(metrics.cost.incomplete).toBe(true);
	expect(metrics.sessions.total).toBe(3);
	expect(metrics.cost.trend.map((point) => point.total)).toEqual([2, 0, 1]);
	expect(
		metrics.sessions.breakdowns.members.map((e) => [e.label, e.value]),
	).toEqual([
		["Ada", 2],
		["Lin", 1],
	]);
});

test("a breakdown ignores its own filter but applies the others", () => {
	const { metrics } = buildSessionsDashboard(
		sessions,
		input({ members: ["u2"] }),
		labels,
	);
	expect(metrics.sessions.total).toBe(1);
	// Members still lists everyone; Models only what u2 ran.
	expect(metrics.sessions.breakdowns.members.map((e) => e.id)).toEqual([
		"u1",
		"u2",
	]);
	expect(metrics.sessions.breakdowns.models.map((e) => e.id)).toEqual([
		"sonnet",
	]);
});

test("splits name each series and counts language signals", () => {
	const { metrics } = buildSessionsDashboard(
		sessions,
		input({ splitBy: "members", requestedMetric: "sessions" }),
		labels,
	);
	expect(metrics.sessions.series).toEqual([
		{ id: "series-0", label: "Ada" },
		{ id: "series-1", label: "Lin" },
	]);
	expect(metrics.signals?.total).toBe(1);
	expect(
		metrics.signals?.breakdowns.phrases.map((e) => [e.id, e.value]),
	).toEqual([["ugh", 1]]);
});
