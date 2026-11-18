import { expect, test } from "bun:test";
import type { ContextMap, ContextPart } from "./session-reader-context-map";
import { GAP, MIN_TILE, placeTiles } from "./session-reader-context-place";

const part = (
	key: string,
	kind: ContextPart["kind"],
	tokens: number,
	fields: Partial<ContextPart> = {},
): ContextPart => ({ count: 1, key, kind, label: key, tokens, ...fields });

const mapOf = (parts: ContextPart[], window: number): ContextMap => ({
	compacted: false,
	estimate: { scale: 1, text: 0 },
	model: null,
	parts,
	trail: [],
	until: null,
	used: parts.reduce((sum, each) => sum + each.tokens, 0),
	window,
});

const subagent = [
	part("files:read", "read", 140_000),
	part("program:bun", "shell", 60_000),
	part("program:git", "shell", 30_000),
	part("files:edit", "edit", 25_000),
	part("tool:Grep", "search", 18_000),
	part("program:rg", "search", 9_000),
	part("program:ls", "shell", 4_000),
	part("tool:Glob", "search", 3_000),
	part("program:cat", "shell", 2_000),
	part("program:wc", "shell", 1_200),
	part("model:messages", "model", 40_000),
	part("model:thinking", "model", 20_000),
	part("you", "you", 1_500),
	part("system", "context", 2_600),
];

test("a tiny part alone in its kind never folds the rest into Other", () => {
	const tiles = placeTiles(mapOf(subagent, 1_000_000), 930, true);
	const keys = tiles.map((tile) => tile.key);
	for (const key of ["files:read", "program:bun", "model:messages"])
		expect(keys).toContain(key);
	const drawn = tiles
		.filter((tile) => tile.key !== "free")
		.reduce((sum, tile) => sum + tile.tokens, 0);
	expect(drawn).toBe(subagent.reduce((sum, each) => sum + each.tokens, 0));
	for (const tile of tiles) {
		expect(tile.w - GAP).toBeGreaterThanOrEqual(MIN_TILE);
		expect(tile.h - GAP).toBeGreaterThanOrEqual(MIN_TILE);
	}
});

test("a small part beside a big one grows to be read", () => {
	const tiles = placeTiles(
		mapOf(
			[
				part("earlier", "earlier", 802_000),
				part("group:agent", "agent", 43_000),
				part("system", "context", 7_000),
			],
			1_000_000,
		),
		930,
		true,
	);
	const agents = tiles.find((tile) => tile.key === "group:agent");
	expect(agents?.w).toBeGreaterThanOrEqual(96);
	expect(agents?.tokens).toBe(43_000);
});

test("earlier turns broken down: one group, its parts inside it", () => {
	const before = { before: "Earlier turns" };
	const tiles = placeTiles(
		mapOf(
			[
				part("earlier:files:read", "read", 400_000, before),
				part("earlier:program:bun", "shell", 250_000, before),
				part("earlier:model:messages", "model", 150_000, before),
				part("model:messages", "model", 30_000),
				part("system", "context", 20_000),
			],
			1_000_000,
		),
		930,
		true,
	);
	const group = tiles.find((tile) => tile.key === "earlier");
	expect(group?.part?.label).toBe("Earlier turns");
	expect(group?.tokens).toBe(800_000);
	expect(group?.inside?.map((tile) => tile.key)).toEqual([
		"before:earlier:files:read",
		"before:earlier:program:bun",
		"before:earlier:model:messages",
	]);
	expect(tiles.map((tile) => tile.key)).toContain("model:messages");
});
