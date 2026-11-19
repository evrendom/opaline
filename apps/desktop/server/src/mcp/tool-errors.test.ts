import { expect, test } from "bun:test";
import {
	closestTools,
	recoveryHint,
	unknownToolMessage,
	validationMessage,
} from "./tool-errors.js";

const tool = (name: string, title: string, description: string) => ({
	name,
	title,
	description,
	inputSchema: {},
});
const tools = [
	tool("find", "Find patterns in agent runs", "Finds where agents got stuck."),
	tool("read", "Read agent runs", "Shows what happened in runs."),
	tool("run", "Open one agent run", "Shows one run compactly."),
	tool("sql", "Rank and count agent runs with SQL", "Runs one SELECT."),
	tool("list_workspaces", "List your workspaces", "Lists workspaces."),
];

test("an unknown tool name is ranked by its words: name 3, title 2, description 1", () => {
	expect(closestTools(tools, "get_run")).toEqual([
		"run",
		"find",
		"read",
		"sql",
	]);
	expect(closestTools(tools, "workspaces-list")).toEqual(["list_workspaces"]);
	expect(closestTools(tools, "zzz")).toEqual([]);
	expect(unknownToolMessage("open_run", tools)).toBe(
		'No tool is named "open_run". These are the closest matches by its words: run, find, read, sql.',
	);
	expect(unknownToolMessage("zzz", tools)).toBe(
		'No tool is named "zzz". The tools are: find, read, run, sql, list_workspaces.',
	);
});

test("at most five closest tools are named", () => {
	const many = Array.from({ length: 9 }, (_, index) =>
		tool(`run_${index}`, "Run", "run"),
	);
	expect(closestTools(many, "run")).toHaveLength(5);
});

test("a validation error names the parameter, its description cut to 200 characters and the shape to resend", () => {
	const find = {
		...tool("find", "Find", "Finds."),
		inputSchema: {
			properties: {
				source: {
					type: "string",
					enum: ["runs", "tool"],
					description: `Required. ${"d".repeat(300)}`,
				},
				limit: {
					type: "integer",
					minimum: 1,
					maximum: 200,
					description: "Rows per call.",
				},
				refs: {
					type: "array",
					items: { type: "object", properties: { sessionId: {}, turn: {} } },
					description: "Runs.",
				},
				from: { type: "string", format: "date", description: "First day." },
			},
		},
	};
	expect(
		validationMessage(find, [
			{ path: ["source"], message: "Invalid option", code: "invalid_value" },
		]),
	).toBe(
		`Invalid input for "find": parameter "source": Invalid option (Required. ${"d".repeat(190)}...); resend it as one of: runs, tool`,
	);
	expect(
		validationMessage(find, [
			{ path: ["limit"], message: "Too big", code: "too_big" },
			{ path: ["refs"], message: "Expected array", code: "invalid_type" },
			{ path: ["from"], message: "Invalid date", code: "invalid_format" },
		]),
	).toBe(
		'Invalid input for "find": parameter "limit": Too big (Rows per call.); resend it as an integer from 1 to 200; parameter "refs": Expected array (Runs.); resend it as an array of objects with sessionId, turn; parameter "from": Invalid date (First day.); resend it as a date, YYYY-MM-DD',
	);
	expect(
		validationMessage(find, [
			{
				path: [],
				message: 'Unrecognized key: "dtail"',
				code: "unrecognized_keys",
			},
		]),
	).toBe(
		'Invalid input for "find": Unrecognized key: "dtail"; this tool takes: source, limit, refs, from',
	);
	expect(
		validationMessage(find, [
			{ path: ["refs", 0, "turn"], message: "Too small", code: "too_small" },
		]),
	).toBe('Invalid input for "find": parameter "refs.0.turn": Too small');
});

test("server failures of the analysis tools carry a numbered narrow-and-retry hint", () => {
	expect(recoveryHint("find")).toContain(
		"Narrow the call and retry:\n1. Shorten from..to",
	);
	expect(recoveryHint("sql")).toContain("Narrow the query and retry:\n1.");
	expect(recoveryHint("read")).toContain("1. Pass fewer refs per call.");
	expect(recoveryHint("run")).toContain("1. Expand fewer ids at once.");
	expect(recoveryHint("list_workspaces")).toBeUndefined();
	expect(recoveryHint(undefined)).toBeUndefined();
});
