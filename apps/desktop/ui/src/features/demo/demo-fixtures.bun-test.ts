import { expect, test } from "bun:test";
import {
	createFixtureFetch,
	createFixtureMatcher,
	type DemoFixture,
	type DemoFixtureIndex,
} from "./demo-fixtures";

const ORIGIN = "https://demo.test";

function recorded(path: string, json: unknown, file: string): DemoFixture {
	return {
		method: "POST",
		path,
		search: "",
		body: JSON.stringify({ json }),
		status: 200,
		type: "application/json",
		file,
	};
}

function demoFetch(index: DemoFixtureIndex, answers: Record<string, unknown>) {
	return createFixtureFetch(
		index,
		async (file) => JSON.stringify({ json: answers[file], meta: [] }),
		() => Promise.reject(new Error("The demo asked the network")),
		() => ORIGIN,
	);
}

function ask(path: string, json: unknown): RequestInit & { url: string } {
	return {
		url: `${ORIGIN}/api/demo/rpc/${path}`,
		method: "POST",
		body: JSON.stringify({ json }),
	};
}

test("an unrecorded session is not in the demo, though another session is", async () => {
	const fetchDemo = demoFetch(
		[
			recorded(
				"/rpc/analytics/sessions/detailInitial",
				{ bodyChunks: true, sessionId: "recorded" },
				"recorded.json",
			),
		],
		{ "recorded.json": { overview: "the recorded session" } },
	);
	const { url, ...other } = ask("analytics/sessions/detailInitial", {
		bodyChunks: true,
		sessionId: "unrecorded",
	});
	const response = await fetchDemo(url, other);
	expect(response.status).toBe(404);
	expect(await response.json()).toEqual({
		json: {
			defined: false,
			code: "NOT_FOUND",
			status: 404,
			message: "This part of the app isn’t in the demo.",
		},
		meta: [],
	});
	const { url: recordedUrl, ...asked } = ask(
		"analytics/sessions/detailInitial",
		{ sessionId: "recorded" },
	);
	const answer = await fetchDemo(recordedUrl, asked);
	expect(await answer.json()).toEqual({
		json: { overview: "the recorded session" },
		meta: [],
	});
});

test("a recording of the same item stands in when only its range differs", () => {
	const match = createFixtureMatcher([
		recorded(
			"/rpc/analytics/repositories/runs",
			{
				repoKey: "remote:github.com/acme/loomrail",
				of: { kind: "setup", setupFile: "AGENTS.md" },
				range: { startDate: "2026-10-28", endDate: "2026-11-27" },
			},
			"agents.json",
		),
	]);
	const runs = (setupFile: string) =>
		match(
			"POST",
			"/api/demo/rpc/analytics/repositories/runs",
			"",
			JSON.stringify({
				json: {
					repoKey: "remote:github.com/acme/loomrail",
					// Another component may build the same item in another key order.
					of: { setupFile, kind: "setup" },
					range: { startDate: "2026-11-20", endDate: "2026-11-27" },
				},
			}),
		)?.file;
	expect(runs("AGENTS.md")).toBe("agents.json");
	expect(runs("CLAUDE.md")).toBeUndefined();
});

test("the stand-in shares the most presentation inputs", () => {
	const dashboard = {
		startDate: "2026-10-28",
		endDate: "2026-11-27",
		requestedMetric: "ciRuns",
	};
	const match = createFixtureMatcher([
		recorded(
			"/rpc/analytics/overview/costs",
			{ ...dashboard, durationInterval: "daily", sessionMetrics: false },
			"preview.json",
		),
		recorded(
			"/rpc/analytics/overview/costs",
			{ ...dashboard, durationInterval: "weekly" },
			"weekly.json",
		),
		recorded(
			"/rpc/analytics/overview/costs",
			{ ...dashboard, durationInterval: "monthly" },
			"monthly.json",
		),
	]);
	expect(
		match(
			"POST",
			"/api/demo/rpc/analytics/overview/costs",
			"",
			JSON.stringify({
				json: { ...dashboard, durationInterval: "weekly", models: [] },
			}),
		)?.file,
	).toBe("weekly.json");
});

test("an input left out is the contract's default", () => {
	// The session reader's flags ask without filters; Compass sends them.
	const match = createFixtureMatcher([
		recorded(
			"/rpc/analytics/moments/list",
			{ startDate: "2026-11-27", endDate: "2026-11-27", limit: 200, offset: 0 },
			"day.json",
		),
	]);
	const compass = (mine: boolean) =>
		match(
			"POST",
			"/api/demo/rpc/analytics/moments/list",
			"",
			JSON.stringify({
				json: {
					startDate: "2026-11-27",
					endDate: "2026-11-27",
					kinds: [],
					mine,
					limit: 100,
					offset: 0,
				},
			}),
		)?.file;
	expect(compass(false)).toBe("day.json");
	expect(compass(true)).toBeUndefined();
});

test("filters picked in another order are the same request", () => {
	const dashboard = {
		startDate: "2026-10-28",
		endDate: "2026-11-27",
		requestedMetric: "cost",
	};
	const match = createFixtureMatcher([
		recorded(
			"/rpc/analytics/overview/costs",
			{ ...dashboard, models: ["fable-5", "opus-5"] },
			"models.json",
		),
	]);
	const models = (picked: string[]) =>
		match(
			"POST",
			"/api/demo/rpc/analytics/overview/costs",
			"",
			JSON.stringify({ json: { ...dashboard, models: picked } }),
		)?.file;
	expect(models(["opus-5", "fable-5"])).toBe("models.json");
	expect(models(["opus-5"])).toBeUndefined();
});

test("plan usage answers only its own range, refreshed or not", async () => {
	const range =
		"from=2026-10-28T00%3A00%3A00.000Z&to=2026-11-28T00%3A00%3A00.000Z";
	const fetchDemo = createFixtureFetch(
		[
			{
				method: "GET",
				path: "/api/selfhost/plan-usage",
				search: `?${range}&buckets=day`,
				body: "",
				status: 200,
				type: "application/json",
				file: "usage.json",
			},
		],
		async () => JSON.stringify({ providers: [] }),
		() => Promise.reject(new Error("The demo asked the network")),
		() => ORIGIN,
	);
	const usage = async (search: string) =>
		(await fetchDemo(`${ORIGIN}/api/selfhost/plan-usage?${search}`)).status;
	expect(await usage(`${range}&buckets=day&refresh=1`)).toBe(200);
	expect(
		await usage(
			"from=2026-11-20T00%3A00%3A00.000Z&to=2026-11-28T00%3A00%3A00.000Z&buckets=day",
		),
	).toBe(404);
});

test("a Better Auth body names what it asks about", () => {
	const match = createFixtureMatcher([
		{
			method: "POST",
			path: "/api/auth/organization/check-slug",
			search: "",
			body: JSON.stringify({ slug: "loomrail" }),
			status: 200,
			type: "application/json",
			file: "slug.json",
		},
	]);
	const slug = (asked: string) =>
		match(
			"POST",
			"/api/demo/auth/organization/check-slug",
			"",
			JSON.stringify({ slug: asked }),
		)?.file;
	expect(slug("loomrail")).toBe("slug.json");
	expect(slug("acme")).toBeUndefined();
});

test("run question tags merge the asked sessions from every recording", async () => {
	const tag = (sessionId: string) => ({
		sessionId,
		questions: [
			{
				id: "q1",
				question: "Did it stop?",
				label: null,
				runs: 1,
				probability: 0.9,
			},
		],
	});
	const fetchDemo = demoFetch(
		[
			recorded(
				"/rpc/analytics/sessions/runQuestionTags",
				{ sessionIds: ["a", "b"] },
				"first.json",
			),
			recorded(
				"/rpc/analytics/sessions/runQuestionTags",
				{ sessionIds: ["c"] },
				"second.json",
			),
		],
		{
			"first.json": { enabled: true, sessions: [tag("a"), tag("b")] },
			"second.json": { enabled: true, sessions: [tag("c")] },
		},
	);
	const { url, ...asked } = ask("analytics/sessions/runQuestionTags", {
		sessionIds: ["c", "a", "d"],
	});
	expect(await (await fetchDemo(url, asked)).json()).toEqual({
		json: { enabled: true, sessions: [tag("a"), tag("c")] },
		meta: [],
	});
});

test("MCP servers merge the asked sessions from every recording", async () => {
	const fetchDemo = demoFetch(
		[
			recorded(
				"/rpc/analytics/sessions/mcpServers",
				{ sessionIds: ["a"] },
				"first.json",
			),
			recorded(
				"/rpc/analytics/sessions/mcpServers",
				{ sessionIds: ["b", "c"] },
				"second.json",
			),
		],
		{
			"first.json": { a: [{ server: "linear", at: 1 }] },
			"second.json": {
				b: [{ server: "posthog", at: 2 }],
				c: [{ server: "figma", at: 3 }],
			},
		},
	);
	const { url, ...asked } = ask("analytics/sessions/mcpServers", {
		sessionIds: ["a", "b"],
	});
	expect(await (await fetchDemo(url, asked)).json()).toEqual({
		json: {
			a: [{ server: "linear", at: 1 }],
			b: [{ server: "posthog", at: 2 }],
		},
		meta: [],
	});
});
