import { TURN_GAP_PX } from "../detail/reader-turns-pending";
import type { ModelTurn } from "../reader-dom";
import type { PageSpans } from "./session-reader-minimap-hold";
import { type Part, withLanes } from "./session-reader-minimap-line";

const ERROR_PX = 3;
const OPEN_SUBAGENT_PX = 8;
const MIN_SUBAGENT_PX = 4;

type Placed = {
	endMs: number | undefined;
	height: number;
	member: number;
	startMs: number | undefined;
	top: number;
};

const share = (value: number) => Math.min(Math.max(value, 0), 1);

function pointAt(placed: readonly Placed[], ms: number): number {
	let after: Placed | undefined;
	for (const turn of placed) {
		if (turn.startMs === undefined) continue;
		const endMs = turn.endMs ?? turn.startMs;
		if (ms >= turn.startMs && ms <= endMs) {
			const span = Math.max(endMs - turn.startMs, 1);
			return (
				turn.top +
				turn.member +
				share((ms - turn.startMs) / span) * (turn.height - turn.member)
			);
		}
		if (turn.startMs > ms) {
			after = turn;
			break;
		}
	}
	if (after) return after.top;
	const last = placed.at(-1);
	return last ? last.top + last.height : 0;
}

export function modelMap(turns: readonly ModelTurn[]): {
	parts: Part[];
	spans: PageSpans;
} {
	const parts: Part[] = [];
	const ids: string[] = [];
	const edges: number[] = [];
	const placed: Placed[] = [];
	let y = 0;
	for (const turn of turns) {
		if (turn.hidden) continue;
		const top = y;
		const member = Math.min(turn.member, turn.height);
		const agent = turn.height - member;
		parts.push({
			height: member,
			kind: "member",
			top,
			...(turn.marks.frustrated ? { frustrated: true } : {}),
		});
		if (agent > 0) {
			const span =
				turn.startMs !== undefined && turn.endMs !== undefined
					? Math.max(turn.endMs - turn.startMs, 1)
					: undefined;
			const errors = turn.errors.map((ms) => ({
				height: ERROR_PX,
				offset:
					span !== undefined && turn.startMs !== undefined
						? share((ms - turn.startMs) / span) * Math.max(agent - ERROR_PX, 0)
						: agent / 2,
			}));
			parts.push({
				height: agent,
				kind: "agent",
				top: top + member,
				...(errors.length > 0 ? { errors } : {}),
				...(turn.marks.apology ? { apologized: true } : {}),
			});
		}
		ids.push(turn.turnId);
		edges.push(top, top + turn.height);
		placed.push({
			endMs: turn.endMs,
			height: turn.height,
			member,
			startMs: turn.startMs,
			top,
		});
		y = top + turn.height + TURN_GAP_PX;
	}
	for (const turn of turns) {
		if (turn.hidden) continue;
		for (const subagent of turn.subagents) {
			const top = pointAt(placed, subagent.startMs);
			const bottom =
				subagent.endMs === undefined
					? top + OPEN_SUBAGENT_PX
					: pointAt(placed, subagent.endMs);
			parts.push({
				height: Math.max(bottom - top, MIN_SUBAGENT_PX),
				id: subagent.id,
				kind: "subagent",
				top,
			});
		}
	}
	return {
		parts: withLanes(parts),
		spans: { edges, end: Math.max(y - TURN_GAP_PX, 0), ids: ids.join(" ") },
	};
}
