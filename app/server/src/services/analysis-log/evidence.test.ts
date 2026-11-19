import { expect, test } from "bun:test";
import { classifyCall, rowsQuote } from "./evidence.js";

/**
 * What account deletion may keep of a stored call (ADR 0001 as amended):
 * results that returned text quote, results of numbers and ids count, and a
 * counting call loses arguments that may carry transcript text. The store
 * contract (store-contract.ts) covers what deletion then does with it.
 */

const run = (sessionId: string, turn: number) => ({
	sessionId,
	agentId: "",
	turn,
});
const find = (output: unknown, args: Record<string, unknown> = {}) =>
	classifyCall({ tool: "find", args: { source: "runs", ...args }, output });

test("a find counts only when everything it returned beside the server's header is metadata", () => {
	const header = { notes: ["Server text."], cursor: "abc", from: "2026-10-01" };
	for (const counting of [
		{
			source: "weekly",
			header,
			snapshot: { id: "snap", refreshedAt: "2026-10-02" },
			totals: [{ week: "2026-09-28", member: "m1", agent: "codex", runs: 4 }],
		},
		// A run group's key is a week, model, repository, agent or session.
		{
			source: "runs",
			header,
			groups: [{ key: "acme/app", runs: 3, costUsd: null }],
		},
		{
			source: "user",
			header,
			events: [],
			groups: [{ type: "swear", count: 2, sessions: 1 }],
		},
		{
			source: "runs",
			header,
			rows: [
				{
					ref: run("s1", 1),
					startedAt: "2026-10-01T09:00:00Z",
					model: "a-model",
					models: ["a-model"],
					repository: "acme/app",
					agent: "codex",
					nextReaction: null,
					promptHead: "",
					parentSessionId: null,
				},
			],
		},
	])
		expect(find(counting)).toEqual({ counts: true, keptArgs: null });

	for (const quoting of [
		{
			source: "runs",
			header,
			rows: [{ ref: run("s1", 1), promptHead: "fix it" }],
		},
		{ source: "user", header, events: [{ quote: "no, stop" }], groups: [] },
		// A call group's key is command text.
		{ source: "calls", header, groups: [{ key: "deploy --prod", calls: 2 }] },
		{ source: "tool", header, groups: [{ topCommands: ["make test"] }] },
		{ source: "git", header, events: [{ branch: "fix/private" }] },
		null,
		["a list"],
	])
		expect(find(quoting).counts).toBe(false);
});

test("a counting call keeps only arguments that cannot carry transcript text", () => {
	const sql = (query: unknown) =>
		classifyCall({
			tool: "sql",
			args: { query, title: "Runs" },
			output: {},
			quotes: false,
		}).keptArgs;
	for (const carrying of [
		"SELECT count() FROM runs WHERE prompt_head = 'ship it'",
		'SELECT count() AS "ship it" FROM runs',
		"SELECT count() FROM runs -- the prompt said ship it",
		"SELECT count() FROM runs /* ship it */",
		"SELECT count() FROM runs WHERE prompt_head = 'unclosed",
		42,
	])
		expect(sql(carrying)).toEqual({ title: "Runs" });
	expect(sql("SELECT count() FROM runs WHERE turn_idx > 3")).toBeNull();

	expect(
		find(
			{ source: "weekly", totals: [] },
			{ groupBy: "member", commandPrefix: "deploy private-host", cause: "x" },
		).keptArgs,
	).toEqual({ source: "runs", groupBy: "member" });
	expect(
		find({ source: "weekly", totals: [] }, { from: "2026-10-01" }).keptArgs,
	).toBeNull();
});

test("sql rows quote unless every value is empty, a number, a time or an id", () => {
	const ids = new Set(["member-1", "session-a"]);
	for (const plain of [
		"",
		"member-1",
		"session-a",
		"12",
		"-3.5e2",
		"2026-10-01",
		"2026-10-01 09:30:00.123",
		"2026-10-01T09:30:00Z",
		"0b9d5f0e-5f35-4c43-9a8e-9cf2e3d6d0a1",
		"a1b2c3d",
		"nan",
		"-inf",
	])
		expect(
			rowsQuote([{ value: plain, n: 1, flag: true, none: null }], ids),
		).toBe(false);
	for (const text of [
		"ship it",
		"deadbeef",
		"abc12",
		"acme/app",
		"2026-10-01 later",
	])
		expect(rowsQuote([{ value: text }], ids)).toBe(true);
	// Arrays, tuples and maps: their items and keys count too.
	expect(rowsQuote([{ value: [1, ["ship it"]] }], ids)).toBe(true);
	expect(rowsQuote([{ value: { "ship it": 1 } }], ids)).toBe(true);
	expect(rowsQuote([{ value: { "member-1": ["12"] } }], ids)).toBe(false);
	expect(rowsQuote([], ids)).toBe(false);
});
