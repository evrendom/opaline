import { describe, expect, test } from "bun:test";
import {
	parseOrganizationScope,
	parsePositiveIntegerFlag,
	parseRetireTranscriptRecordsArgs,
} from "./l1-script-args.js";

describe("L1 script arguments", () => {
	test("a scope must be named, exactly once", () => {
		expect(() => parseOrganizationScope({})).toThrow("Name the scope");
		expect(() =>
			parseOrganizationScope({
				"organization-id": "org",
				"all-organizations": true,
			}),
		).toThrow("not both");
		expect(() => parseOrganizationScope({ "organization-id": " " })).toThrow(
			"must not be empty",
		);
		expect(parseOrganizationScope({ "organization-id": "org" })).toEqual({
			organizationId: "org",
		});
		expect(parseOrganizationScope({ "all-organizations": true })).toEqual({
			organizationId: undefined,
		});
	});

	test("integers are positive, whole and bounded", () => {
		expect(parsePositiveIntegerFlag(undefined, 7, "--x")).toBe(7);
		expect(parsePositiveIntegerFlag("12", 7, "--x")).toBe(12);
		for (const value of ["0", "-1", "1.5", "1e3", "abc", ""])
			expect(() => parsePositiveIntegerFlag(value, 7, "--x")).toThrow("--x");
		expect(() => parsePositiveIntegerFlag("11", 7, "--x", 10)).toThrow(
			"at most 10",
		);
	});

	test("retire:transcript-records previews by default with bounded pages", () => {
		expect(
			parseRetireTranscriptRecordsArgs(["--organization-id", "org"]),
		).toEqual({
			organizationId: "org",
			execute: false,
			maxSessions: 10_000,
			pageSize: 25,
			pauseMs: 500,
		});
		expect(
			parseRetireTranscriptRecordsArgs([
				"--all-organizations",
				"--execute",
				"--page-size",
				"100",
				"--pause-ms",
				"0",
			]),
		).toMatchObject({
			organizationId: undefined,
			execute: true,
			pageSize: 100,
		});
		expect(() =>
			parseRetireTranscriptRecordsArgs([
				"--organization-id",
				"org",
				"--page-size",
				"101",
			]),
		).toThrow("--page-size");
		expect(() => parseRetireTranscriptRecordsArgs(["--execute"])).toThrow(
			"Name the scope",
		);
		expect(() =>
			parseRetireTranscriptRecordsArgs([
				"--organization-id",
				"org",
				"--retire",
			]),
		).toThrow();
	});
});
