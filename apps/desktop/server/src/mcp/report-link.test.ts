import { afterEach, expect, test } from "bun:test";
import { analysisReportUrl, withReportLink } from "./report-link.js";

const original = process.env.ALLOWED_ORIGIN;
afterEach(() => {
	if (original === undefined) delete process.env.ALLOWED_ORIGIN;
	else process.env.ALLOWED_ORIGIN = original;
});

test("a saved analysis links to its report page on the web app's origin, under its workspace", () => {
	process.env.ALLOWED_ORIGIN = "https://opaline.so/";
	expect(analysisReportUrl("acme", "a_123")).toBe(
		"https://opaline.so/acme/reports/a_123",
	);
	expect(analysisReportUrl("a b", "a/1")).toBe(
		"https://opaline.so/a%20b/reports/a%2F1",
	);
	process.env.ALLOWED_ORIGIN = "https://preview.example.com";
	expect(
		withReportLink("saved analysis=a_1 status=finished", "acme", "a_1"),
	).toBe(
		"saved analysis=a_1 status=finished\nOpen in Opaline: https://preview.example.com/acme/reports/a_1",
	);
});
