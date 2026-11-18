import { describe, expect, test } from "bun:test";
import {
	CLI_DATA_LIMITS,
	CliDataPullPlanInputSchema,
	CliDataPullTableInputSchema,
	CliDataSqlInputSchema,
	DataChunkSchema,
} from "../cli-data.js";
import { CliUserSchema } from "../index.js";

describe("cli.data inputs", () => {
	test("sql takes one query of at most 20,000 characters as jsonl or csv", () => {
		expect(
			CliDataSqlInputSchema.safeParse({ query: "SELECT 1", format: "jsonl" })
				.success,
		).toBe(true);
		expect(
			CliDataSqlInputSchema.safeParse({
				query: "x".repeat(CLI_DATA_LIMITS.queryChars + 1),
				format: "jsonl",
			}).success,
		).toBe(false);
		expect(
			CliDataSqlInputSchema.safeParse({ query: "SELECT 1", format: "parquet" })
				.success,
		).toBe(false);
		expect(
			CliDataSqlInputSchema.safeParse({ query: "   ", format: "csv" }).success,
		).toBe(false);
	});

	test("pullPlan needs a selector, real days in order, unique session ids and a pattern id", () => {
		const parse = (input: object) =>
			CliDataPullPlanInputSchema.safeParse(input);
		expect(parse({ workspace: "acme" }).success).toBe(false);
		expect(parse({ repository: "acme/app" }).success).toBe(true);
		expect(parse({ from: "2026-11-01", to: "2026-11-07" }).success).toBe(true);
		expect(parse({ from: "2026-11-07", to: "2026-11-01" }).success).toBe(false);
		expect(parse({ from: "2026-13-40" }).success).toBe(false);
		expect(parse({ from: "11/01/2026" }).success).toBe(false);
		expect(parse({ pattern: "fc_1a2b3c4d5e" }).success).toBe(true);
		expect(parse({ pattern: "fc_1A2B" }).success).toBe(false);
		expect(parse({ sessions: ["a", "a"] }).success).toBe(false);
		expect(parse({ sessions: ["a; DROP"] }).success).toBe(false);
		expect(
			parse({
				sessions: Array.from(
					{ length: CLI_DATA_LIMITS.planInputSessions + 1 },
					(_, index) => `s-${index}`,
				),
			}).success,
		).toBe(false);
	});

	test("pullTable takes a known table and 1 to 200 sessions", () => {
		const parse = (input: object) =>
			CliDataPullTableInputSchema.safeParse(input);
		expect(parse({ table: "records", sessions: ["s-1"] }).success).toBe(true);
		expect(parse({ table: "sessions", sessions: ["s-1"] }).success).toBe(false);
		expect(parse({ table: "runs", sessions: [] }).success).toBe(false);
		expect(
			parse({
				table: "runs",
				sessions: Array.from({ length: 201 }, (_, index) => `s-${index}`),
			}).success,
		).toBe(false);
	});

	test("a chunk is lines or the closing done", () => {
		expect(
			DataChunkSchema.safeParse({ type: "lines", text: "{}\n" }).success,
		).toBe(true);
		expect(
			DataChunkSchema.safeParse({
				type: "done",
				rows: 1,
				bytes: 3,
				columns: [],
				notices: [],
			}).success,
		).toBe(true);
	});

	test("the CLI user advertises dataExport", () => {
		expect(
			CliUserSchema.parse({
				id: "u",
				email: "u@example.com",
				name: "U",
				capabilities: { analysisLinkedUploads: true, dataExport: true },
			}).capabilities?.dataExport,
		).toBe(true);
	});
});
