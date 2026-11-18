import { expect, test } from "bun:test";
import { appRoutes, getWorkspaceAppPath } from "@/app/routes";
import { collectNewSessionArrivals } from "./session-arrival-tracker";

const first = { sessionId: "first", userName: "Evren" };
const second = { sessionId: "second", userName: "Teammate" };

test("announces each arrival once across overlapping pages and polls", () => {
	const initial = collectNewSessionArrivals(new Set(), []);
	expect(initial.arrivals).toEqual([]);
	const upload = collectNewSessionArrivals(initial.seen, [first, first]);
	expect(upload.arrivals).toEqual([first]);
	const next = collectNewSessionArrivals(upload.seen, [first, second]);
	expect(next.arrivals).toEqual([second]);
	expect(
		collectNewSessionArrivals(next.seen, [second, first]).arrivals,
	).toEqual([]);
});

test("remembers sessions that disappear and later return", () => {
	const uploaded = collectNewSessionArrivals(new Set(), [first]);
	const empty = collectNewSessionArrivals(uploaded.seen, []);
	expect(collectNewSessionArrivals(empty.seen, [first]).arrivals).toEqual([]);
});

test("workspace subscriptions keep their own session identities", () => {
	const workspaceA = collectNewSessionArrivals(new Set(), [first]);
	const workspaceB = collectNewSessionArrivals(new Set(), [first]);
	expect(workspaceA.arrivals).toEqual([first]);
	expect(workspaceB.arrivals).toEqual([first]);
	expect(
		getWorkspaceAppPath("my-team", appRoutes.sessionDetail("session/a")),
	).toBe("/my-team/sessions/session%2Fa");
});
