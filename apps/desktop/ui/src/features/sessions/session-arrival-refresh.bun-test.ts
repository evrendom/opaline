import { expect, test } from "bun:test";
import {
	isOrganizationQueryChangedByArrival,
	isSessionDetailChangedByArrival,
	mergeSessionArrivalChange,
} from "./session-arrival-refresh";

const org = "org-1";
const procedure = (path: string, input?: Record<string, unknown>) => [
	"org",
	org,
	path.split("."),
	{ type: "query", input },
];

test("a new session refreshes workspace lists, totals and costs", () => {
	const change = mergeSessionArrivalChange(null, ["new"]);
	for (const key of [
		procedure("analytics.sessions.list", { limit: 50, offset: 0 }),
		procedure("analytics.sessions.liveList"),
		procedure("analytics.sessions.lastUpload"),
		procedure("analytics.overview.kpis", { startDate: "a", endDate: "b" }),
		procedure("analytics.overview.costs"),
		procedure("analytics.repositories.list"),
		procedure("analytics.skills.list"),
		["org", org, "usage-session-id-search", "", {}],
	])
		expect(isOrganizationQueryChangedByArrival(key, org, change)).toBe(true);
});

test("a new session leaves other sessions, settings and other workspaces alone", () => {
	const change = mergeSessionArrivalChange(null, ["new"]);
	for (const key of [
		procedure("analytics.sessions.fileChanges", { sessionId: "open" }),
		procedure("analytics.sessions.setupText", { sessionId: "open" }),
		["org", org, "session-native-relationships", "open"],
		["org", org, "liveSession", "open"],
		["org", org, "skill-runs", "open", "skill"],
		procedure("repositorySettings.list"),
		procedure("analytics.moments.settings"),
		["org", "org-2", ["analytics", "sessions", "list"], { type: "query" }],
		["session-detail-v2", "initial", "open"],
	])
		expect(isOrganizationQueryChangedByArrival(key, org, change)).toBe(false);
	expect(isSessionDetailChangedByArrival("open", change)).toBe(false);
});

test("the arriving session's own reader data refreshes", () => {
	const change = mergeSessionArrivalChange(null, ["new"]);
	expect(
		isOrganizationQueryChangedByArrival(
			procedure("analytics.sessions.fileChanges", { sessionId: "new" }),
			org,
			change,
		),
	).toBe(true);
	expect(
		isOrganizationQueryChangedByArrival(
			["org", org, "liveSession", "new"],
			org,
			change,
		),
	).toBe(true);
	expect(isSessionDetailChangedByArrival("new", change)).toBe(true);
});

test("a child upload refreshes the open family overview and its children", () => {
	const change = mergeSessionArrivalChange(null, []);
	expect(change.lineage).toBe(true);
	expect(isSessionDetailChangedByArrival("open", change)).toBe(true);
	expect(
		isOrganizationQueryChangedByArrival(
			["org", org, "session-native-relationships", "open"],
			org,
			change,
		),
	).toBe(true);
	expect(
		isOrganizationQueryChangedByArrival(
			procedure("analytics.sessions.list"),
			org,
			change,
		),
	).toBe(true);
	expect(
		isOrganizationQueryChangedByArrival(
			procedure("analytics.sessions.setupText", { sessionId: "open" }),
			org,
			change,
		),
	).toBe(false);
});

test("a burst of pages coalesces into one change", () => {
	const burst = mergeSessionArrivalChange(
		mergeSessionArrivalChange(mergeSessionArrivalChange(null, ["a"]), []),
		["b", "a"],
	);
	expect([...burst.sessionIds].sort()).toEqual(["a", "b"]);
	expect(burst.lineage).toBe(true);
});
