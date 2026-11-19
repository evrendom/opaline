import { expect, test } from "bun:test";
import type { SessionAnalytics } from "@rudel/api-routes";
import { DemoSeedSchema } from "@/features/demo/demo-runtime";
import fixture from "@/features/demo/seed.json";
import {
	compareSessions,
	getInitialSortDirection,
	type SessionOverviewSortKey,
} from "./sessions-overview-table-utils";

const seedSession = DemoSeedSchema.parse(fixture).sessions[0];
if (!seedSession) throw new Error("Missing demo session fixture");
const smaller: SessionAnalytics = {
	...seedSession,
	session_date: "2026-08-01T10:00:00Z",
	estimated_cost: 0.1,
	input_tokens: 900,
	output_tokens: 50,
	skills: ["review"],
	error_count: 1,
	duration_min: 2.5,
	total_interactions: 4,
	member_swears: 0,
	member_apologies: 0,
	member_positive: 0,
	model_swears: 0,
	model_apologies: 0,
	model_positive: 1,
};
const larger: SessionAnalytics = {
	...smaller,
	session_date: "2026-08-02T10:00:00Z",
	estimated_cost: 1.2,
	input_tokens: 100,
	output_tokens: 900,
	skills: ["review", "testing"],
	error_count: 3,
	duration_min: 2.75,
	total_interactions: 12,
	member_swears: 2,
};
const sortKeys: SessionOverviewSortKey[] = [
	"time",
	"cost",
	"tokens",
	"skills",
	"errors",
	"duration",
	"messages",
	"signals",
];

test.each(sortKeys)("sorts %s numerically in both directions", (key) => {
	expect(compareSessions(smaller, larger, key, {})).toBeLessThan(0);
	expect(compareSessions(larger, smaller, key, {})).toBeGreaterThan(0);
	expect(compareSessions(smaller, smaller, key, {})).toBe(0);
	expect(getInitialSortDirection(key)).toBe("desc");
});

test("keeps unavailable cost and errors distinct from confirmed zero", () => {
	const unknown = { ...smaller, estimated_cost: null, error_count: undefined };
	const zero = { ...smaller, estimated_cost: 0, error_count: 0 };
	expect(compareSessions(unknown, zero, "cost", {})).toBeLessThan(0);
	expect(compareSessions(unknown, zero, "errors", {})).toBeLessThan(0);
});

test("sorts usage by each session's share of the plan limit, unknown below none", () => {
	const left = { ...smaller, session_id: "left" };
	const right = { ...larger, session_id: "right" };
	const unread = { ...smaller, session_id: "unread" };
	const shares = new Map([
		["left", 0.4],
		["right", 6.2],
	]);
	expect(compareSessions(left, right, "usage", {}, shares)).toBeLessThan(0);
	expect(compareSessions(right, left, "usage", {}, shares)).toBeGreaterThan(0);
	expect(compareSessions(unread, left, "usage", {}, shares)).toBeLessThan(0);
	expect(compareSessions(left, right, "usage", {})).toBe(0);
	expect(getInitialSortDirection("usage")).toBe("desc");
});
