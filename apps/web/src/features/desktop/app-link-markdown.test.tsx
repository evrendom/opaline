import { render } from "@testing-library/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { appLinkPath, remarkAppLinks } from "./app-link-markdown";

function links(markdown: string) {
	const { container } = render(
		<Markdown remarkPlugins={[remarkGfm, remarkAppLinks]}>{markdown}</Markdown>,
	);
	return [...container.querySelectorAll("a")].map((a) => [
		a.textContent,
		a.getAttribute("href"),
	]);
}

describe("appLinkPath", () => {
	it("maps an app link to the page it opens on this server", () => {
		expect(appLinkPath("opaline://acme/reports/a1")).toBe("/acme/reports/a1");
		expect(
			appLinkPath("opaline://acme/dashboard?from=2026-11-01&repo=a%2Fb"),
		).toBe("/acme/dashboard?from=2026-11-01&repo=a%2Fb");
		expect(appLinkPath("opaline://sessions/acme/s1")).toBe("/acme/sessions/s1");
		expect(appLinkPath("opaline:////evil.example/x")).toBe("/evil.example/x");
		expect(appLinkPath("opaline://api/selfhost/login?token=x")).toBeNull();
		expect(appLinkPath("https://opaline.so/acme")).toBeNull();
	});
});

describe("remarkAppLinks", () => {
	it("makes app links in answers clickable inside the app", () => {
		expect(
			links(
				"See opaline://acme/sessions/s1?turn=t1. And [the report](opaline://acme/reports/a1), https://github.com/a/b.",
			),
		).toEqual([
			["opaline://acme/sessions/s1?turn=t1", "/acme/sessions/s1?turn=t1"],
			["the report", "/acme/reports/a1"],
			["https://github.com/a/b", "https://github.com/a/b"],
		]);
	});

	it("leaves code and other text alone", () => {
		expect(links("`opaline://acme/x` and no links")).toEqual([]);
		expect(links("```\nopaline://acme/x\n```")).toEqual([]);
		expect(links("plain text")).toEqual([]);
	});
});
