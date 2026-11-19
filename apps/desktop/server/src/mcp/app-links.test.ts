import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import {
	APP_ROUTES,
	appUrl,
	classifyOpalineUrl,
	pastedUrlHint,
	routeParams,
	sessionsUrl,
	sessionUrl,
} from "./app-links.js";

const WEB = join(import.meta.dir, "../../../ui/src");
const saved = process.env.ALLOWED_ORIGIN;
beforeEach(() => {
	process.env.ALLOWED_ORIGIN = "https://opaline.so/";
});
afterEach(() => {
	if (saved === undefined) delete process.env.ALLOWED_ORIGIN;
	else process.env.ALLOWED_ORIGIN = saved;
});

test("every route is one the web router serves, and the date range is read from the params links set", async () => {
	const router = await Bun.file(join(WEB, "app/AppRouter.tsx")).text();
	const block =
		/const workspaceShellRoutePaths: ShellRoutePaths = \{([\s\S]*?)\};/u.exec(
			router,
		)?.[1];
	const served = Object.fromEntries(
		[...(block ?? "").matchAll(/(\w+): "([^"]+)"/gu)].map((match) => [
			match[1],
			match[2],
		]),
	);
	expect(APP_ROUTES.sessions).toBe(served.session);
	expect(APP_ROUTES.dashboard).toBe(served.dashboard);
	expect(router).toMatch(/path=\{`\$\{routePaths\.session\}\/:sessionId\?`\}/u);
	expect(`${APP_ROUTES.session}`).toBe(`${served.session}/:sessionId`);
	expect(router).toContain(`path="${APP_ROUTES.report}"`);
	const dates = await Bun.file(
		join(WEB, "features/analytics/date-range/DateRangeProvider.tsx"),
	).text();
	expect(dates).toContain('searchParams.get("from")');
	expect(dates).toContain('searchParams.get("to")');
});

test("app urls take exactly the route's params, encoded, on the frontend origin", () => {
	expect(routeParams("session")).toEqual(["workspaceSlug", "sessionId"]);
	expect(sessionUrl("acme", "a/b c")).toBe(
		"https://opaline.so/acme/sessions/a%2Fb%20c",
	);
	expect(() => appUrl("session", { workspaceSlug: "acme" })).toThrow(
		"missing: sessionId",
	);
	expect(() =>
		appUrl("sessions", { workspaceSlug: "acme", sessionId: "s" }),
	).toThrow("unexpected: sessionId");
	expect(
		sessionsUrl("acme", { from: "2026-10-01", to: "2026-10-07T23:59Z" }),
	).toBe("https://opaline.so/acme/sessions?from=2026-10-01&to=2026-10-07");
	expect(sessionsUrl("acme", { from: "2026-10-01" })).toBe(
		"https://opaline.so/acme/sessions",
	);
});

test("a pasted link is classified by its path, keeping its dates and the run it names", () => {
	const uuid = "0b6f0c1e-8d4f-4a39-9a51-3c1f0f6f2a10";
	expect(
		classifyOpalineUrl(
			`https://opaline.so/acme/sessions/s1?turn=${uuid}&from=2026-10-01&to=2026-10-07`,
		),
	).toEqual({
		kind: "session",
		workspace: "acme",
		sessionId: "s1",
		record: uuid,
		from: "2026-10-01",
		to: "2026-10-07",
	});
	for (const legacy of [
		"https://app.opaline.so/session/s1",
		"https://opaline.so/dashboard/sessions/s1",
		"https://opaline.so/session/full/s1",
		"https://opaline.so/acme/newsesh/s1?run=not-a-uuid",
	])
		expect(classifyOpalineUrl(legacy)).toMatchObject({
			kind: "session",
			sessionId: "s1",
			record: null,
		});
	expect(
		classifyOpalineUrl(
			"https://opaline.so/acme/dashboard?from=2026-10-01&split=models&repo=a&repo=b",
		),
	).toEqual({
		kind: "dashboard",
		workspace: "acme",
		args: {
			startDate: "2026-10-01",
			splitBy: "models",
			repositories: ["a", "b"],
		},
	});
	expect(classifyOpalineUrl("https://opaline.so/acme/sessions")).toMatchObject({
		kind: "sessions",
	});
	expect(classifyOpalineUrl("https://opaline.so/acme/skills")).toEqual({
		kind: "other",
		path: "/acme/skills",
	});
	expect(classifyOpalineUrl("https://example.com/acme/sessions/s1")).toBeNull();
	expect(classifyOpalineUrl("not a url")).toBeNull();
});

test("a session link without a run says how to list its runs, quoting the id safely", () => {
	const hint = pastedUrlHint({
		kind: "session",
		workspace: "acme",
		sessionId: "it's",
		record: null,
		from: null,
		to: "2026-10-07",
	});
	expect(hint).toContain("WHERE session_id = 'it\\\\'s'");
	expect(hint).toContain(
		'{"source":"runs","sessionId":"it\'s","to":"2026-10-07"}',
	);
});
