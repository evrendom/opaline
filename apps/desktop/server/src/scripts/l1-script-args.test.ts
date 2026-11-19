import { describe, expect, test } from "bun:test";
import {
	parseOrganizationScope,
	parsePositiveIntegerFlag,
	parseRetireTranscriptRecordsArgs,
	parseRunQuestionsAddArgs,
	parseRunQuestionsBackfillArgs,
	parseTranscriptSearchBackfillArgs,
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

	test("backfill:transcript-search previews by default, paced at 30 sessions a minute below load 12", () => {
		expect(
			parseTranscriptSearchBackfillArgs(["--organization-id", "org"]),
		).toEqual({
			organizationId: "org",
			execute: false,
			maxSessions: 10_000,
			after: undefined,
			sessionsPerMinute: 30,
			maxLoad: 12,
		});
		expect(
			parseTranscriptSearchBackfillArgs([
				"--all-organizations",
				"--execute",
				"--max-sessions",
				"50",
				"--after",
				"cursor",
				"--sessions-per-minute",
				"6",
				"--max-load",
				"4",
			]),
		).toEqual({
			organizationId: undefined,
			execute: true,
			maxSessions: 50,
			after: "cursor",
			sessionsPerMinute: 6,
			maxLoad: 4,
		});
		expect(() => parseTranscriptSearchBackfillArgs(["--execute"])).toThrow(
			"Name the scope",
		);
		expect(() =>
			parseTranscriptSearchBackfillArgs([
				"--organization-id",
				"org",
				"--sessions-per-minute",
				"601",
			]),
		).toThrow("--sessions-per-minute");
		expect(() =>
			parseTranscriptSearchBackfillArgs([
				"--organization-id",
				"org",
				"--max-load",
				"0",
			]),
		).toThrow("--max-load");
		expect(() =>
			parseTranscriptSearchBackfillArgs([
				"--organization-id",
				"org",
				"--after",
				" ",
			]),
		).toThrow("--after");
	});

	test("backfill:run-questions previews the last 28 days by default, paced at 60 runs a minute below load 12", () => {
		expect(parseRunQuestionsBackfillArgs(["--organization-id", "org"])).toEqual(
			{
				organizationId: "org",
				execute: false,
				queueOnly: false,
				days: 28,
				maxRuns: 10_000,
				after: undefined,
				runsPerMinute: 60,
				maxLoad: 12,
			},
		);
		expect(
			parseRunQuestionsBackfillArgs([
				"--all-organizations",
				"--execute",
				"--days",
				"7",
				"--max-runs",
				"500",
				"--after",
				"cursor",
				"--runs-per-minute",
				"30",
				"--max-load",
				"8",
				"--queue-only",
			]),
		).toEqual({
			organizationId: undefined,
			execute: true,
			queueOnly: true,
			days: 7,
			maxRuns: 500,
			after: "cursor",
			runsPerMinute: 30,
			maxLoad: 8,
		});
		expect(() =>
			parseRunQuestionsBackfillArgs([
				"--organization-id",
				"org",
				"--queue-only",
			]),
		).toThrow("--queue-only");
		expect(() => parseRunQuestionsBackfillArgs(["--execute"])).toThrow(
			"Name the scope",
		);
		for (const bad of [
			["--days", "0"],
			["--max-runs", "100001"],
			["--runs-per-minute", "601"],
			["--after", " "],
		])
			expect(() =>
				parseRunQuestionsBackfillArgs(["--organization-id", "org", ...bad]),
			).toThrow();
	});

	test("run-questions:add needs a file and adds drafts unless --on", () => {
		expect(parseRunQuestionsAddArgs(["--file", "q.json"])).toEqual({
			file: "q.json",
			on: false,
		});
		expect(parseRunQuestionsAddArgs(["--file", "q.json", "--on"])).toEqual({
			file: "q.json",
			on: true,
		});
		expect(() => parseRunQuestionsAddArgs([])).toThrow("--file");
		expect(() =>
			parseRunQuestionsAddArgs(["--file", "q.json", "--execute"]),
		).toThrow();
	});
});
