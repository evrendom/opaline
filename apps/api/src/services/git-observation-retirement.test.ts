import { describe, expect, test } from "bun:test";
import type { ClickHouseExecutor, ClickHouseStatement } from "../clickhouse.js";
import {
	buildOlderGitObservationsDelete,
	OLDER_GIT_OBSERVATIONS_PER_DELETE,
	retireOlderGitObservations,
} from "./git-observation-extraction.service.js";

function generation(index: number) {
	return {
		organization_id: "o1",
		user_id: "u1",
		source: "claude_code",
		session_id: `s${index}`,
		revision: String(100 + index),
		parser_version: 773,
	};
}

describe("retireOlderGitObservations", () => {
	test("deletes exactly the older generations it read, in bounded statements", async () => {
		const older = Array.from(
			{ length: OLDER_GIT_OBSERVATIONS_PER_DELETE + 1 },
			(_, index) => generation(index),
		);
		const reads: ClickHouseStatement[] = [];
		const deletes: ClickHouseStatement[] = [];
		const executor = {
			query: async (statement: ClickHouseStatement) => {
				reads.push(statement);
				return older;
			},
			execute: async (statement: ClickHouseStatement) => {
				deletes.push(statement);
			},
		} as unknown as ClickHouseExecutor;

		expect(
			await retireOlderGitObservations(executor, { organizationId: "o1" }),
		).toBe(older.length);
		expect(reads[0]?.query).toContain(
			"max(tuple(revision, parser_version)) AS head",
		);
		expect(reads[0]?.query).toContain(
			"tuple(o.revision, o.parser_version) < h.head",
		);
		expect(reads[0]?.query_params).toEqual({ organizationId: "o1" });
		expect(deletes).toHaveLength(2);
		expect(deletes[0]?.query_params?.sessions).toHaveLength(
			OLDER_GIT_OBSERVATIONS_PER_DELETE,
		);
		expect(deletes[1]?.query_params?.sessions).toEqual([
			`s${OLDER_GIT_OBSERVATIONS_PER_DELETE}`,
		]);
	});

	test("matches each generation by its full key", () => {
		const statement = buildOlderGitObservationsDelete([generation(1)]);
		expect(statement.query).toContain(
			"(organization_id, user_id, source, session_id, toString(revision), parser_version))",
		);
		expect(statement.query_params).toEqual({
			organizationIds: ["o1"],
			organizations: ["o1"],
			users: ["u1"],
			sources: ["claude_code"],
			sessions: ["s1"],
			revisions: ["101"],
			parsers: [773],
		});
		expect(statement.clickhouse_settings.lightweight_deletes_sync).toBe("1");
	});

	test("reads every organization when none is named", async () => {
		const reads: ClickHouseStatement[] = [];
		const executor = {
			query: async (statement: ClickHouseStatement) => {
				reads.push(statement);
				return [];
			},
			execute: async () => {},
		} as unknown as ClickHouseExecutor;
		expect(await retireOlderGitObservations(executor)).toBe(0);
		expect(reads[0]?.query).not.toContain("{organizationId:String}");
	});
});
