import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import {
	appUrl,
	classifyOpalineUrl,
	linkExample,
	sessionsUrl,
	sessionUrl,
	workspacePageUrl,
} from "./app-links.js";
import { analysisReportUrl, withReportLink } from "./report-link.js";
import { runFromUrl } from "./run-url.js";

const { deepLinkTarget } = createRequire(import.meta.url)(
	"../../../desktop/deep-link.js",
) as {
	deepLinkTarget: (raw: string, origin: string) => string | undefined;
};

const ORIGIN = "http://localhost:4100";
const KEYS = [
	"OPALINE_SELF_HOSTED",
	"OPALINE_DESKTOP_APP",
	"ALLOWED_ORIGIN",
] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

function mode(desktop: boolean) {
	process.env.OPALINE_SELF_HOSTED = "1";
	process.env.ALLOWED_ORIGIN = ORIGIN;
	if (desktop) process.env.OPALINE_DESKTOP_APP = "1";
	else delete process.env.OPALINE_DESKTOP_APP;
}

beforeEach(() => mode(true));
afterEach(() => {
	for (const key of KEYS) {
		const value = saved[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

const LINKS: Array<() => string> = [
	() => sessionUrl("acme", "a/b c"),
	() => sessionUrl("acme", "019a-ffff"),
	() => sessionsUrl("acme"),
	() => sessionsUrl("acme", { from: "2026-10-01", to: "2026-10-07T23:59Z" }),
	() => analysisReportUrl("acme", "an_1"),
	() => analysisReportUrl("a b", "a/1"),
	() => appUrl("dashboard", { workspaceSlug: "acme" }, { from: "2026-11-01" }),
	() =>
		workspacePageUrl(
			"acme",
			"/dashboard?from=2026-11-01&to=2026-11-07&repo=a%2Fb&repo=c&model=x%20y",
		),
	() => workspacePageUrl("acme", "/dashboard"),
];

describe("links in the desktop app", () => {
	test("every page link the MCP returns opens in the app", () => {
		expect(sessionUrl("acme", "a/b c")).toBe(
			"opaline://acme/sessions/a%2Fb%20c",
		);
		expect(
			sessionsUrl("acme", { from: "2026-10-01", to: "2026-10-07T23:59Z" }),
		).toBe("opaline://acme/sessions?from=2026-10-01&to=2026-10-07");
		expect(analysisReportUrl("acme", "an_1")).toBe(
			"opaline://acme/reports/an_1",
		);
		expect(withReportLink("saved", "acme", "an_1")).toBe(
			"saved\nOpen in Opaline: opaline://acme/reports/an_1",
		);
		expect(workspacePageUrl("acme", "/dashboard?from=2026-11-01")).toBe(
			"opaline://acme/dashboard?from=2026-11-01",
		);
		for (const link of LINKS) expect(link()).not.toContain("localhost");
	});

	test("the app maps each link to exactly the page the server would have linked", () => {
		for (const link of LINKS) {
			mode(true);
			const deep = link();
			mode(false);
			const page = link();
			expect(page.startsWith(`${ORIGIN}/`)).toBe(true);
			expect(deepLinkTarget(deep, ORIGIN)).toBe(page);
		}
	});

	test("a pasted opaline:// link is read like the page it opens", () => {
		const uuid = "0b6f0c1e-8d4f-4a39-9a51-3c1f0f6f2a10";
		expect(
			classifyOpalineUrl(
				`opaline://acme/sessions/s1?turn=${uuid}&from=2026-10-01`,
			),
		).toEqual({
			kind: "session",
			workspace: "acme",
			sessionId: "s1",
			record: uuid,
			from: "2026-10-01",
			to: null,
		});
		expect(classifyOpalineUrl("opaline://sessions/acme/s1")).toMatchObject({
			kind: "session",
			workspace: "acme",
			sessionId: "s1",
		});
		expect(
			classifyOpalineUrl("opaline://acme/dashboard?repo=a&repo=b"),
		).toEqual({
			kind: "dashboard",
			workspace: "acme",
			args: { repositories: ["a", "b"] },
		});
		expect(classifyOpalineUrl(`${ORIGIN}/acme/sessions`)).toMatchObject({
			kind: "sessions",
		});
		expect(runFromUrl(`opaline://acme/sessions/s1?turn=${uuid}`, {})).toEqual({
			hint: null,
			args: { id: uuid },
		});
	});

	test("errors name the app's links, not the server's origin", () => {
		expect(linkExample()).toBe("opaline://…");
		expect(() => runFromUrl("https://example.com/x", {})).toThrow(
			"url is not an Opaline link (opaline://…): https://example.com/x",
		);
	});
});

describe("links without the desktop app", () => {
	test("a self-hosted server links to its own origin and ignores opaline:// links", () => {
		mode(false);
		expect(analysisReportUrl("acme", "an_1")).toBe(
			`${ORIGIN}/acme/reports/an_1`,
		);
		expect(workspacePageUrl("acme", "/dashboard")).toBe(
			`${ORIGIN}/acme/dashboard`,
		);
		expect(linkExample()).toBe(`${ORIGIN}/…`);
		expect(classifyOpalineUrl("opaline://acme/sessions/s1")).toBeNull();
	});

	test("the cloud links to opaline.so", () => {
		delete process.env.OPALINE_SELF_HOSTED;
		process.env.OPALINE_DESKTOP_APP = "1";
		process.env.ALLOWED_ORIGIN = "https://opaline.so";
		expect(sessionUrl("acme", "s1")).toBe(
			"https://opaline.so/acme/sessions/s1",
		);
		expect(linkExample()).toBe("https://opaline.so/…");
		expect(classifyOpalineUrl("opaline://acme/sessions/s1")).toBeNull();
	});
});
