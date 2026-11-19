import { describe, expect, test } from "bun:test";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import {
	buildReactionsRewriteStatement,
	buildStoredReactionsStatement,
	refreshPromptReactions,
} from "./prompt-reactions-refresh.js";

const SESSION = {
	organizationId: "org-1",
	userId: "user-1",
	sessionId: "session-1",
};

function stored(turn: number, reactions: string[], agent = "") {
	return {
		agent_id: agent,
		turn_idx: turn,
		prompt_reactions: reactions,
		revision: "11",
		parser_version: 14,
		index_version: 11,
		build_revision: "3",
	};
}

function opening(turn: number, prompt: string | null, agent = "") {
	return {
		agent_id: agent,
		turn_idx: turn,
		opening_prompt: prompt,
		final_message: null,
		final_message_cut: 0,
		system_prompt: 0,
	};
}

function fakeExecutor(rows: { stored: object[]; messages: object[] }) {
	const executed: ClickHouseStatement[] = [];
	const executor = {
		query: async (statement: ClickHouseStatement) =>
			statement.query.includes("prompt_reactions")
				? rows.stored
				: rows.messages,
		execute: async (statement: ClickHouseStatement) => {
			executed.push(statement);
		},
	} as unknown as ClickHouseExecutor;
	return { executor, executed };
}

describe("prompt reactions refresh", () => {
	test("rewrites only the runs whose reactions the current rules read differently", async () => {
		const { executor, executed } = fakeExecutor({
			stored: [
				stored(1, []),
				stored(2, ["swear"]),
				stored(3, ["negative"]),
				stored(1, ["positive"], "agent-1"),
			],
			messages: [
				opening(1, "the settings page is horrible"),
				opening(2, "that is so fucking fast"),
				opening(3, "it still doesnt load"),
				opening(1, "great, thanks", "agent-1"),
			],
		});
		const writes: string[] = [];

		expect(
			await refreshPromptReactions(executor, SESSION, async () => {
				writes.push("checked");
			}),
		).toBe(2);
		expect(writes).toEqual(["checked"]);
		expect(executed).toHaveLength(1);
		expect(executed[0]?.query_params).toMatchObject({
			agents: ["", ""],
			turns: [1, 2],
			reactions: [["negative"], ["positive"]],
			revision: "11",
			parserVersion: 14,
			indexVersion: 11,
			buildRevision: "3",
			sessionId: "session-1",
		});
	});

	test("writes nothing when the stored reactions already match, or no build is committed", async () => {
		const unchanged = fakeExecutor({
			stored: [stored(1, ["negative"])],
			messages: [opening(1, "this is horrible")],
		});
		expect(await refreshPromptReactions(unchanged.executor, SESSION)).toBe(0);
		expect(unchanged.executed).toEqual([]);

		const empty = fakeExecutor({ stored: [], messages: [] });
		expect(await refreshPromptReactions(empty.executor, SESSION)).toBe(0);
		expect(empty.executed).toEqual([]);
	});

	test("a fenced write stops before anything is inserted", async () => {
		const { executor, executed } = fakeExecutor({
			stored: [stored(1, [])],
			messages: [opening(1, "this is horrible")],
		});
		await expect(
			refreshPromptReactions(executor, SESSION, async () => {
				throw new Error("fenced");
			}),
		).rejects.toThrow("fenced");
		expect(executed).toEqual([]);
	});

	test("reads the committed build and rewrites it in place without deduplication", () => {
		const read = buildStoredReactionsStatement(SESSION).query;
		expect(read).toContain("FINAL");
		expect(read).toContain("row_kind = 'receipt'");
		expect(read).toContain("index_version >= 4");
		const rewrite = buildReactionsRewriteStatement(SESSION, stored(1, []), [
			{ agentId: "", turn: 1, reactions: ["negative"] },
		]);
		expect(rewrite.query).toContain("INSERT INTO rudel.run_index");
		expect(rewrite.query).toContain("SELECT * REPLACE");
		expect(rewrite.query).toContain("build_revision = {buildRevision:UInt64}");
		expect(rewrite.clickhouse_settings).toEqual({ insert_deduplicate: 0 });
	});
});
