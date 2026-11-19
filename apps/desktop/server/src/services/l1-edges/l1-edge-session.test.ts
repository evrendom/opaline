import { describe, expect, test } from "bun:test";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import { writeSessionEdges } from "./l1-edge-session.service.js";

const session = { userId: "u1", source: "claude_code", sessionId: "s1" };

describe("session edge writes", () => {
	test("a retraction keeps the generation of the edge and resolution it retracts", async () => {
		const inserts: { table: string; values: Record<string, unknown>[] }[] = [];
		const executor = {
			query: async (statement: { query: string }) =>
				statement.query.includes("l1_edge_resolutions")
					? [
							{
								evidence_id: "obs::10:0:push_range",
								target: "branch_pull_request",
								revision_text: "5",
							},
						]
					: [
							{
								from_kind: "run",
								from_id: "u1/claude_code/s1//4",
								relation: "pr_branch_head",
								to_kind: "pull_request",
								to_id: "101/133",
								evidence_id: "obs::10:0:push_range",
								revision_text: "5",
								evidence_parser_version: 773,
								transcript_parser_version: 8,
							},
						],
			insert: async (params: {
				table: string;
				values: Record<string, unknown>[];
			}) => {
				inserts.push(params);
			},
		} as unknown as ClickHouseExecutor;
		await writeSessionEdges(executor, {
			organizationId: "org",
			session,
			revision: 9,
			edges: [],
			resolutions: [],
			now: new Date("2026-10-08T00:00:00Z"),
		});
		expect(inserts.map((insert) => insert.values[0])).toMatchObject([
			{
				relation: "pr_branch_head",
				is_active: 0,
				revision: "9",
				evidence_revision: "5",
				evidence_parser_version: 773,
				transcript_parser_version: 8,
			},
			{
				target: "branch_pull_request",
				is_active: 0,
				revision: "9",
				evidence_revision: "5",
			},
		]);
	});
});
