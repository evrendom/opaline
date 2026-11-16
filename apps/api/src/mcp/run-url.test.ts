import { afterEach, expect, test } from "bun:test";
import { runFromUrl } from "./run-url.js";

const saved = {
	OPALINE_SELF_HOSTED: process.env.OPALINE_SELF_HOSTED,
	ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
};

afterEach(() => {
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

test("a link from elsewhere is refused with an example from this server", () => {
	delete process.env.OPALINE_SELF_HOSTED;
	process.env.ALLOWED_ORIGIN = "https://opaline.so";
	expect(() => runFromUrl("https://example.com/x", {})).toThrow(
		"url is not an Opaline link (https://opaline.so/…): https://example.com/x",
	);
	process.env.OPALINE_SELF_HOSTED = "1";
	process.env.ALLOWED_ORIGIN = "http://localhost:4100";
	expect(() => runFromUrl("https://example.com/x", {})).toThrow(
		"url is not an Opaline link (http://localhost:4100/…): https://example.com/x",
	);
	expect(
		runFromUrl("http://localhost:4100/acme/dashboard?from=2026-11-01", {}).hint,
	).toContain("call get_dashboard");
});
