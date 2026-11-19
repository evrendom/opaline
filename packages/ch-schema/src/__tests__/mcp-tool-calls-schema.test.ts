import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractExecutableStatements } from "chkit/dist/bin/lib.js";
import { z } from "zod";
import { engineMatches } from "../../scripts/migrate-mcp-tool-calls.js";
import { RudelMcpToolCallsRowSchema } from "../generated/chkit-types.js";
import {
	MCP_TOOL_CALL_COLUMNS,
	MCP_TOOL_CALLS_MIGRATION,
	MCP_TOOL_CALLS_ORDER_BY,
	MCP_TOOL_CALLS_TTL,
} from "../mcp-tool-calls.js";

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const sql = read(`../../chx/migrations/${MCP_TOOL_CALLS_MIGRATION}`);

describe("MCP tool calls migration", () => {
	test("only creates the new table, with the columns the API writes", () => {
		const statements = extractExecutableStatements(sql);
		expect(statements).toHaveLength(1);
		expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bALTER\b/u);
		const statement = statements[0] ?? "";
		expect(statement).toStartWith(
			"CREATE TABLE IF NOT EXISTS rudel.mcp_tool_calls",
		);
		const declared = [
			...statement.matchAll(/^ {2}`([a-z0-9_]+)` (.+) COMMENT/gmu),
		];
		expect(declared.map((match) => [match[1], match[2]])).toEqual(
			MCP_TOOL_CALL_COLUMNS.map((column) => [column.name, column.type]),
		);
		const key = MCP_TOOL_CALLS_ORDER_BY.map((name) => `\`${name}\``).join(", ");
		expect(statement).toContain("ENGINE = MergeTree");
		expect(statement).toContain(`ORDER BY (${key})`);
		expect(statement).toContain(`TTL ${MCP_TOOL_CALLS_TTL}`);
		expect(statement).toContain("ttl_only_drop_parts = 1");
	});

	test("the runner accepts the local and the Cloud engine and nothing else", () => {
		const local =
			"MergeTree PARTITION BY toYYYYMM(called_at) PRIMARY KEY (tool, called_at, call_id)";
		const cloud =
			"SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}') PARTITION BY toYYYYMM(called_at) ORDER BY tool";
		expect(engineMatches(local, "MergeTree")).toBe(true);
		expect(engineMatches(cloud, "SharedMergeTree")).toBe(true);
		expect(engineMatches(cloud, "MergeTree")).toBe(false);
		expect(
			engineMatches("ReplacingMergeTree(version) ORDER BY tool", "MergeTree"),
		).toBe(false);
	});

	test("the snapshot and the generated row schema hold the table as defined", () => {
		const snapshot = z
			.object({
				definitions: z.array(
					z.object({
						name: z.string(),
						ttl: z.string().optional(),
						columns: z
							.array(
								z.object({
									name: z.string(),
									type: z.string(),
									comment: z.string().optional(),
								}),
							)
							.optional(),
					}),
				),
			})
			.parse(JSON.parse(read("../../chx/meta/snapshot.json")));
		const definition = snapshot.definitions.find(
			(candidate) => candidate.name === "mcp_tool_calls",
		);
		expect(definition?.columns).toEqual(
			MCP_TOOL_CALL_COLUMNS.map(({ name, type, comment }) => ({
				name,
				type,
				comment,
			})),
		);
		expect(definition?.ttl).toBe(MCP_TOOL_CALLS_TTL);
		expect(Object.keys(RudelMcpToolCallsRowSchema.shape)).toEqual(
			MCP_TOOL_CALL_COLUMNS.map((column) => column.name),
		);
	});

	test("bootstrap and the production gate run its runner", () => {
		expect(read("../../scripts/bootstrap.ts")).toContain(
			`["${MCP_TOOL_CALLS_MIGRATION}", "migrate-mcp-tool-calls.ts"],`,
		);
		expect(read("../../package.json")).toMatch(
			/"ch:migrate:production": "[^"]* ch:migrate:mcp-tool-calls[ "]/u,
		);
	});
});
