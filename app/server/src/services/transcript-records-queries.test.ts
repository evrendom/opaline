import { describe, expect, test } from "bun:test";
import type { ClickHouseStatement } from "../clickhouse.js";
import type {
	SessionGeneration,
	TranscriptReadScope,
} from "./transcript-generations/generations.js";
import {
	buildMapCommandsStatement,
	buildMapFilesStatement,
	buildMapPromptsStatement,
	buildMapTurnsStatement,
	buildRecordBlocksStatement,
	buildRecordSliceStatement,
	buildSessionCommandsStatement,
	buildSessionFilesStatement,
	buildSessionTotalsStatement,
	buildTurnActionsStatement,
	buildTurnDiffStatement,
	buildTurnFailuresStatement,
	buildTurnFileChangesStatement,
	buildTurnParentCommandsStatement,
	buildTurnPromptStatement,
	buildTurnRawStatement,
} from "./transcript-records-queries.js";

const scope: TranscriptReadScope = {
	organizationId: "org-under-test",
	userId: "user-under-test",
};
const hostile = "x'; DROP TABLE rudel.transcript_records; --";
const generation: SessionGeneration = {
	parserVersion: 2,
	revision: "1700000000000",
	sessionId: hostile,
};

const factsAndMapStatements: readonly [string, ClickHouseStatement][] = [
	["session totals", buildSessionTotalsStatement(scope, [generation])],
	["session commands", buildSessionCommandsStatement(scope, [generation])],
	["session files", buildSessionFilesStatement(scope, [generation], 10)],
	["map turns", buildMapTurnsStatement(scope, generation, hostile)],
	["map prompts", buildMapPromptsStatement(scope, generation, hostile)],
	["map files", buildMapFilesStatement(scope, generation, hostile, 5)],
	["map commands", buildMapCommandsStatement(scope, generation, hostile)],
];

const textReadingStatements: readonly [string, ClickHouseStatement][] = [
	["turn prompt", buildTurnPromptStatement(scope, generation, hostile, 1, 100)],
	["turn diff", buildTurnDiffStatement(scope, generation, hostile, 1, 10, 100)],
	[
		"turn parent commands",
		buildTurnParentCommandsStatement(
			scope,
			generation,
			hostile,
			1,
			[hostile],
			100,
		),
	],
	["turn raw", buildTurnRawStatement(scope, generation, hostile, 1, 10, 100)],
	[
		"record slice",
		buildRecordSliceStatement(scope, generation, hostile, 3, 0, 0, 100),
	],
];

const lightStatements: readonly [string, ClickHouseStatement][] = [
	[
		"turn actions",
		buildTurnActionsStatement(scope, generation, hostile, 1, 10, 100),
	],
	[
		"turn file changes",
		buildTurnFileChangesStatement(scope, generation, hostile, 1, 10),
	],
	[
		"turn failures",
		buildTurnFailuresStatement(scope, generation, hostile, 1, 10),
	],
	["record blocks", buildRecordBlocksStatement(scope, generation, hostile, 3)],
];

const allStatements = [
	...factsAndMapStatements,
	...textReadingStatements,
	...lightStatements,
];

/** Identifier `text` as a column, not `text_chars` or an alias like `prompt_text`. */
const TEXT_COLUMN = /(?<![\w.])text(?![\w])/u;

describe("transcript record statements", () => {
	for (const [name, statement] of allStatements) {
		test(`${name} is tenant scoped by bound parameters`, () => {
			expect(statement.query).toContain(
				"organization_id = {organizationId:String}",
			);
			expect(statement.query).toContain("user_id = {userId:String}");
			expect(statement.query_params?.organizationId).toBe(scope.organizationId);
			expect(statement.query_params?.userId).toBe(scope.userId);
		});

		test(`${name} never interpolates caller values into SQL`, () => {
			expect(statement.query).not.toContain("DROP TABLE");
			expect(statement.query).not.toContain(scope.organizationId);
			expect(statement.query).not.toContain(scope.userId);
			expect(JSON.stringify(statement.query_params)).toContain("DROP TABLE");
		});
	}

	for (const [name, statement] of [
		...factsAndMapStatements,
		...lightStatements,
	]) {
		test(`${name} does not read the text column`, () => {
			expect(statement.query).not.toMatch(TEXT_COLUMN);
		});
	}

	for (const [name, statement] of textReadingStatements) {
		test(`${name} caps the text it reads in SQL`, () => {
			if (name === "turn raw") {
				expect(statement.query).toContain(
					"substringUTF8(if(empty(text), head, text), 1, {recordChars:UInt32}) AS text_slice",
				);
				expect(statement.query_params?.recordChars).toBe(100);
			} else if (name === "turn prompt") {
				expect(statement.query).toContain(
					"substringUTF8(if(empty(text), concat(head, '\\n', tail), text), 1, {promptChars:UInt32}) AS text_slice",
				);
				expect(statement.query_params?.promptChars).toBe(100);
			} else {
				expect(statement.query).toMatch(/substringUTF8\(text,/u);
			}
			expect(statement.query).toMatch(TEXT_COLUMN);
		});
	}

	test("map and facts statements read head only for prompt rows or the receipt", () => {
		const withHead = factsAndMapStatements.filter(([, statement]) =>
			/\bhead\b/u.test(statement.query),
		);

		expect(withHead.map(([name]) => name)).toEqual(["map prompts"]);
		const prompts = buildMapPromptsStatement(scope, generation, "");
		expect(prompts.query).toContain("kind = 'user_prompt'");
	});

	test("failed calls are excluded from file changes by call id", () => {
		const statement = buildSessionFilesStatement(scope, [generation], 10);

		expect(statement.query).toContain("kind = 'file_change'");
		expect(statement.query).toContain("file_op IN ('write', 'edit', 'delete')");
		expect(statement.query).toContain(
			"(session_id, agent_id, call_id) NOT IN (",
		);
		expect(statement.query).toContain(
			"AND (is_error OR (exit_code IS NOT NULL AND exit_code != 0))",
		);
	});

	test("nonzero exits are failures even when is_error is false", () => {
		const failures = buildTurnFailuresStatement(scope, generation, "", 1, 10);
		const actions = buildTurnActionsStatement(
			scope,
			generation,
			"",
			1,
			10,
			100,
		);
		expect(failures.query).toContain(
			"is_error OR (exit_code IS NOT NULL AND exit_code != 0)",
		);
		expect(actions.query).toContain(
			"results.is_error OR (results.exit_code IS NOT NULL AND results.exit_code != 0)",
		);
	});
});
