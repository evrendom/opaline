import { expect, test } from "bun:test";
import {
	type EstimatedTurn,
	estimateTurnPx,
	pendingTurnsPx,
} from "./reader-turns-pending";

const estimate = (turn: EstimatedTurn) =>
	1_000 + turn.toolCallCount * 100 + (turn.subagentEvents?.length ?? 0) * 500;

const turns = [
	{ subagentEvents: [{}], toolCallCount: 2, turnId: "a" },
	{ toolCallCount: 4, turnId: "b" },
];

test("the turns still to load hold their kept heights, and their gaps", () => {
	expect(
		pendingTurnsPx({
			estimate,
			keptHeights: { a: 10, b: 20, c: 300, d: 400 },
			subagentTotal: 3,
			total: 4,
			turns,
		}),
	).toBe(300 + 400 + 32);
});

test("without them all kept, each is estimated as the loaded turns are", () => {
	expect(
		pendingTurnsPx({
			estimate,
			keptHeights: { c: 300 },
			subagentTotal: 3,
			total: 4,
			turns,
		}),
	).toBe(2 * 1_300 + 2 * 500 + 32);
});

test("every turn in: no room held", () => {
	expect(
		pendingTurnsPx({
			estimate,
			keptHeights: undefined,
			subagentTotal: 0,
			total: 2,
			turns,
		}),
	).toBe(0);
});

const LAID_OUT_SESSION: readonly (readonly [
	toolCalls: number,
	subagents: number,
	px: number,
])[] = [
	[276, 7, 48761],
	[2, 0, 2858],
	[7, 2, 1797],
	[4, 0, 1129],
	[0, 0, 1352],
	[0, 0, 1401],
	[30, 4, 7609],
	[0, 0, 1728],
	[0, 0, 1292],
	[0, 0, 1137],
	[30, 2, 6275],
	[1, 0, 1125],
	[0, 0, 1101],
	[0, 0, 1022],
	[13, 0, 2423],
	[0, 0, 1234],
	[0, 0, 1174],
	[0, 0, 1157],
	[3, 0, 1303],
	[2, 0, 584],
	[1, 0, 1110],
	[7, 0, 1262],
	[9, 0, 3489],
	[118, 0, 21056],
	[5, 0, 932],
	[1, 0, 969],
	[11, 0, 2586],
	[1, 0, 746],
	[1, 0, 961],
	[9, 0, 2151],
	[13, 0, 2249],
	[5, 0, 1148],
	[8, 0, 1559],
	[20, 0, 4522],
	[4, 0, 1585],
];

const WHOLE_PAGE_ERROR_BOUND = 0.2;

test("a whole page of estimated turns stands within 20% of the page laid out", () => {
	let measured = 0;
	let estimated = 0;
	for (const [
		index,
		[toolCalls, subagents, px],
	] of LAID_OUT_SESSION.entries()) {
		measured += px;
		estimated += estimateTurnPx({
			subagentEvents: Array.from({ length: subagents }),
			toolCallCount: toolCalls,
			turnId: `turn-${index}`,
		});
	}
	expect(Math.abs(estimated - measured) / measured).toBeLessThan(
		WHOLE_PAGE_ERROR_BOUND,
	);
	expect(estimated).toBe(141_840);
});

test("a Codex turn is estimated shorter than a Claude Code one with the same calls", () => {
	const calls = { subagentEvents: [], toolCallCount: 10 };
	expect(estimateTurnPx({ ...calls, turnId: "codex-1" })).toBe(1_600);
	expect(estimateTurnPx({ ...calls, turnId: "claude-1" })).toBe(2_400);
});
