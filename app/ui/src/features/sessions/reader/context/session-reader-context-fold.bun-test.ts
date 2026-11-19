import { expect, test } from "bun:test";
import { foldAll, foldByKind, tileCount } from "./session-reader-context-fold";
import type { ContextPart } from "./session-reader-context-map";

const part = (
	key: string,
	kind: ContextPart["kind"],
	tokens: number,
	count = 1,
): ContextPart => ({ count, key, kind, label: key, tokens });

const parts = [
	part("files:read", "read", 50_000),
	part("agent:a1", "agent", 4_000),
	part("agent:a2", "agent", 3_000),
	part("tool:SendMessage", "tools", 2_000, 5),
	part("agent:a3", "agent", 1_000),
];

test("small parts fold with their own kind first", () => {
	const folded = foldByKind(parts, 4);
	expect(folded.map((each) => [each.key, each.label, each.tokens])).toEqual([
		["files:read", "files:read", 50_000],
		["group:agent", "Subagents", 8_000],
		["tool:SendMessage", "tool:SendMessage", 2_000],
	]);
	expect(folded[1]?.items?.map((item) => item.label)).toEqual([
		"agent:a1",
		"agent:a2",
		"agent:a3",
	]);
});

test("the last resort: one Other, each part a line, counted once", () => {
	const folded = foldAll(foldByKind(parts, 4), 2);
	const other = folded.find((each) => each.key === "other:results");
	expect(other?.tokens).toBe(10_000);
	expect(other?.parts).toBe(4);
	expect(other?.items?.map((item) => [item.label, item.count])).toEqual([
		["agent:a1", 1],
		["agent:a2", 1],
		["agent:a3", 1],
		["tool:SendMessage", 5],
	]);
});

test("the MCP servers' calls never fold with the tools", () => {
	const folded = foldByKind(
		[
			part("files:read", "read", 50_000),
			part("mcp", "tools", 6_000, 50),
			part("tool:sleep", "tools", 900, 2),
			part("tool:TaskStop", "tools", 250, 2),
		],
		3,
	);
	expect(folded.map((each) => [each.key, each.tokens])).toEqual([
		["files:read", 50_000],
		["mcp", 6_000],
		["group:tools", 1_150],
	]);
});

test("the chat never folds into the tools' Other", () => {
	const folded = foldAll(
		[
			part("files:read", "read", 50_000),
			part("you", "you", 800),
			part("tool:sleep", "tools", 900, 2),
			part("tool:TaskStop", "tools", 250, 2),
		],
		3,
	);
	expect(folded.map((each) => [each.key, each.tokens])).toEqual([
		["files:read", 50_000],
		["other:results", 1_150],
		["you", 800],
	]);
});

test("commands fold with commands, not into the lane they read in", () => {
	const command = (
		name: string,
		kind: ContextPart["kind"],
		tokens: number,
	) => ({
		count: 1,
		key: `program:${name}`,
		kind,
		label: name,
		tokens,
	});
	const folded = foldByKind(
		[
			{
				count: 1,
				key: "files:read",
				kind: "read",
				label: "Read files",
				tokens: 9_000,
			},
			command("tail", "read", 2_100),
			command("sed", "read", 1_500),
			command("wc", "shell", 1_200),
		],
		3,
	);
	const commands = folded.find((part) => part.key === "group:commands");
	expect(commands).toMatchObject({
		kind: "shell",
		label: "Commands",
		parts: 3,
	});
	expect(tileCount(commands as ContextPart)).toBe("3 commands");
	expect(folded.find((part) => part.key === "files:read")).toBeDefined();
});
