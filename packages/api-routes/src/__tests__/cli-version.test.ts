import { describe, expect, test } from "bun:test";
import {
	getCliReleaseUrl,
	isCliVersionOlder,
	parseCliVersion,
} from "../cli-version.js";

describe("CLI versions", () => {
	test("accepts only released x.y.z versions", () => {
		expect(parseCliVersion("0.11.0")).toBe("0.11.0");
		for (const value of [
			"0.11",
			"v0.11.0",
			"0.11.0-dev",
			" 0.11.0",
			"",
			11,
			null,
		])
			expect(parseCliVersion(value)).toBeNull();
	});

	test("compares numerically, not as text", () => {
		expect(isCliVersionOlder("0.9.0", "0.11.0")).toBe(true);
		expect(isCliVersionOlder("0.11.0", "0.9.0")).toBe(false);
		expect(isCliVersionOlder("0.11.0", "0.11.0")).toBe(false);
		expect(isCliVersionOlder("1.0.0", "0.99.99")).toBe(false);
	});

	test("links to the tagged release", () => {
		expect(getCliReleaseUrl("0.11.0")).toBe(
			"https://github.com/opalinehq/cli/releases/tag/opaline-cli%400.11.0",
		);
	});
});
