const { describe, expect, test } = require("bun:test");
const {
	deepLinkFromArgv,
	deepLinkTarget,
	isDeepLink,
} = require("../deep-link");

const ORIGIN = "http://localhost:4100";

describe("deepLinkTarget", () => {
	test("maps the path and query onto the local server", () => {
		expect(deepLinkTarget("opaline://acme/reports/123", ORIGIN)).toBe(
			"http://localhost:4100/acme/reports/123",
		);
		expect(
			deepLinkTarget(
				"opaline://acme/dashboard?from=2026-11-01&repo=a&repo=b",
				ORIGIN,
			),
		).toBe(
			"http://localhost:4100/acme/dashboard?from=2026-11-01&repo=a&repo=b",
		);
		expect(deepLinkTarget("opaline:///acme/sessions/s1?turn=t#x", ORIGIN)).toBe(
			"http://localhost:4100/acme/sessions/s1?turn=t#x",
		);
		expect(deepLinkTarget("OPALINE://acme", `${ORIGIN}/`)).toBe(
			"http://localhost:4100/acme",
		);
	});

	test("the bare scheme opens the server's root", () => {
		expect(deepLinkTarget("opaline://", ORIGIN)).toBe("http://localhost:4100/");
		expect(deepLinkTarget("opaline:", ORIGIN)).toBe("http://localhost:4100/");
		expect(deepLinkTarget("opaline://?x=1", ORIGIN)).toBe(
			"http://localhost:4100/?x=1",
		);
	});

	test("an MCP session resource opens that session's page", () => {
		expect(deepLinkTarget("opaline://sessions/acme/abc-1", ORIGIN)).toBe(
			"http://localhost:4100/acme/sessions/abc-1",
		);
	});

	test("never leaves the server's origin", () => {
		for (const raw of [
			"opaline:////evil.example/x",
			"opaline://\\\\evil.example/x",
			"opaline:///\\evil.example/x",
			"opaline://\t//evil.example/x",
			"opaline://\n/\\evil.example/x",
		])
			expect(deepLinkTarget(raw, ORIGIN)).toBe(
				"http://localhost:4100/evil.example/x",
			);
		expect(deepLinkTarget("opaline://a/../../x", ORIGIN)).toBe(
			"http://localhost:4100/x",
		);
		expect(deepLinkTarget("opaline://@evil.example/x", ORIGIN)).toBe(
			"http://localhost:4100/@evil.example/x",
		);
		expect(deepLinkTarget("opaline://evil.example:443/x", ORIGIN)).toBe(
			"http://localhost:4100/evil.example:443/x",
		);
	});

	test("rejects API paths, other schemes and unknown origins", () => {
		expect(
			deepLinkTarget("opaline://api/selfhost/login?token=x", ORIGIN),
		).toBeUndefined();
		expect(deepLinkTarget("opaline:///API", ORIGIN)).toBeUndefined();
		expect(deepLinkTarget("opaline://apis/x", ORIGIN)).toBe(
			"http://localhost:4100/apis/x",
		);
		expect(
			deepLinkTarget("https://localhost:4100/acme", ORIGIN),
		).toBeUndefined();
		expect(deepLinkTarget("javascript:alert(1)", ORIGIN)).toBeUndefined();
		expect(deepLinkTarget("opaline://acme", undefined)).toBeUndefined();
		expect(deepLinkTarget("opaline://acme", "file:///tmp")).toBeUndefined();
		expect(deepLinkTarget(undefined, ORIGIN)).toBeUndefined();
	});
});

describe("deepLinkFromArgv", () => {
	test("finds the link a second launch passes", () => {
		expect(
			deepLinkFromArgv([
				"/Applications/Opaline.app/Contents/MacOS/Opaline",
				"--flag",
				"opaline://acme/x",
			]),
		).toBe("opaline://acme/x");
		expect(
			deepLinkFromArgv(["Opaline", "--remote-debugging-port=9351"]),
		).toBeUndefined();
		expect(deepLinkFromArgv(undefined)).toBeUndefined();
		expect(isDeepLink(" opaline://x")).toBe(true);
		expect(isDeepLink("https://x")).toBe(false);
	});
});
