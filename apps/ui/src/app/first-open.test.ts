import { afterEach, describe, expect, it } from "vitest";
import { takeFirstOpenIntro } from "./first-open";

afterEach(() => {
	delete document.documentElement.dataset.intro;
	window.history.replaceState(null, "", "/");
});

describe("takeFirstOpenIntro", () => {
	it("leaves a normal load alone", () => {
		window.history.replaceState(null, "", "/dashboard?from=2026-11-01");
		takeFirstOpenIntro();
		expect(document.documentElement.dataset.intro).toBeUndefined();
		expect(window.location.search).toBe("?from=2026-11-01");
	});

	it("marks the intro and drops only its param from the URL", () => {
		window.history.replaceState(
			null,
			"",
			"/dashboard?from=2026-11-01&opaline-intro=1#top",
		);
		takeFirstOpenIntro();
		expect(document.documentElement.dataset.intro).toBe("");
		expect(
			`${window.location.pathname}${window.location.search}${window.location.hash}`,
		).toBe("/dashboard?from=2026-11-01#top");
	});
});
