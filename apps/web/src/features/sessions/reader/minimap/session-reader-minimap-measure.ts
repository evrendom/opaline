import {
	readTurnMarks,
	TURN_ANSWER,
	TURN_REPLY,
	TURNS_PENDING,
	turnElementsIn,
} from "../reader-dom";
import { subagentDoneAt } from "../subagents/session-reader-subagent-done";
import { type Part, withLanes } from "./session-reader-minimap-line";

const FALLBACK_MEMBER_PX = 96;

export type TurnShape = {
	member: number;
	reply?: number;
	subagents: [number, number, string | undefined][];
	talks: [number, string][];
	errors?: [number, number][];
	marks?: [number, number, string][];
};

export function measure(
	scroller: HTMLElement,
	seen: Map<string, TurnShape>,
	tags: readonly string[] = [],
	kept: (turnId: string) => boolean = () => false,
): Part[] {
	const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
	const parts: Part[] = [];
	const turns = turnElementsIn(scroller);
	for (const [index, turn] of turns.entries()) {
		const box = turn.getBoundingClientRect();
		const block = turn.firstElementChild as HTMLElement | null;
		const flags = readTurnMarks(turn);
		const turnId = flags.turnId ?? "";
		const top = box.top - origin;
		const bottom = box.bottom - origin;
		const shown =
			block?.checkVisibility?.({ contentVisibilityAuto: true }) ?? true;
		let shape = seen.get(turnId) ?? {
			member: FALLBACK_MEMBER_PX,
			subagents: [],
			talks: [],
		};
		if (
			block &&
			(!(seen.has(turnId) && kept(turnId)) || tags.length > 0) &&
			(shown ||
				tags.length > 0 ||
				flags.errors ||
				turn.querySelector("[data-subagent]"))
		) {
			shape = readTurnShape(turn, turns.slice(index + 1), tags);
			seen.set(turnId, shape);
		}
		const split = Math.min(top + shape.member, bottom);
		const { frustrated, apology: apologized } = flags;
		if (split > top)
			parts.push({
				height: split - top,
				kind: "member",
				top,
				...(frustrated ? { frustrated } : {}),
			});
		const inStretch = ([offset]: readonly [number, ...unknown[]]) =>
			top + offset >= split && top + offset < bottom;
		const errors = (shape.errors ?? [])
			.filter(inStretch)
			.map(([offset, height]) => ({ height, offset: top + offset - split }));
		const marks = (tags.length > 0 ? (shape.marks ?? []) : [])
			.filter(inStretch)
			.map(([offset, height, tag]) => ({
				height,
				offset: top + offset - split,
				tag,
			}));
		if (bottom > split)
			parts.push({
				...(errors.length > 0 ? { errors } : {}),
				...(marks.length > 0 ? { marks } : {}),
				...(apologized ? { apologized } : {}),
				height: bottom - split,
				kind: "agent",
				reply:
					shape.reply !== undefined && top + shape.reply > split
						? Math.min(top + shape.reply, bottom)
						: undefined,
				top: split,
			});
		for (const [offset, height, id] of shape.subagents)
			if (top + offset < bottom)
				parts.push({ height, id, kind: "subagent", top: top + offset });
		for (const [offset, id] of shape.talks)
			if (top + offset < bottom)
				parts.push({ height: 0, id, kind: "talk", top: top + offset });
	}
	const pending = scroller.querySelector<HTMLElement>(TURNS_PENDING);
	const room = pending?.getBoundingClientRect();
	if (room && room.height > 0)
		parts.push({
			height: room.height,
			kind: "agent",
			pending: true,
			top: room.top - origin,
		});
	return withLanes(parts);
}

export function readTurnShape(
	turn: HTMLElement,
	later: readonly HTMLElement[],
	tags: readonly string[] = [],
): TurnShape {
	const box = turn.getBoundingClientRect();
	const answer = turn.querySelector<HTMLElement>(TURN_ANSWER);
	const subagents = [...turn.querySelectorAll<HTMLElement>("[data-subagent]")]
		.filter((each) => !each.parentElement?.closest("[data-subagent]"))
		.map((each): [number, number, string | undefined] => {
			const whole = each.getBoundingClientRect();
			const row = (each.firstElementChild ?? each).getBoundingClientRect();
			const from = row.top + row.height / 2;
			const endMs = each.dataset.subagentEndMs;
			const done =
				endMs === undefined
					? whole.bottom
					: subagentDoneAt(
							each.closest("[data-trace]") ?? turn,
							row.top,
							each.dataset.subagentUntil ?? null,
							Number(endMs),
							later,
							each,
						);
			return [
				from - box.top,
				Math.max(done - from, 0),
				each.dataset.subagentId,
			];
		});
	const talks = [...turn.querySelectorAll<HTMLElement>("[data-talks-to]")]
		.filter((each) => !each.closest("[data-subagent]"))
		.map((each): [number, string] => {
			const row = each.getBoundingClientRect();
			return [row.top + row.height / 2 - box.top, each.dataset.talksTo ?? ""];
		});
	const errors = [...turn.querySelectorAll<HTMLElement>("[data-step-failed]")]
		.filter((each) => !each.parentElement?.closest("[data-subagent]"))
		.map((each): [number, number] => {
			const row = each.getBoundingClientRect();
			return [row.top - box.top, row.height];
		});
	const marks =
		tags.length === 0
			? []
			: [...turn.querySelectorAll<HTMLElement>("[data-step-tags]")]
					.filter((each) => !each.parentElement?.closest("[data-subagent]"))
					.flatMap((each) => {
						const own = (each.dataset.stepTags ?? "")
							.split(" ")
							.filter((tag) => tags.includes(tag));
						if (own.length === 0) return [];
						const row = each.getBoundingClientRect();
						return own.map((tag): [number, number, string] => [
							row.top - box.top,
							row.height,
							tag,
						]);
					});
	const reply = turn.querySelector<HTMLElement>(TURN_REPLY);
	return {
		errors,
		marks,
		member:
			(answer ? answer.getBoundingClientRect().top : box.bottom) - box.top,
		reply: reply ? reply.getBoundingClientRect().top - box.top : undefined,
		subagents,
		talks,
	};
}

export function turnHeights(scroller: HTMLElement): Record<string, number> {
	const heights: Record<string, number> = {};
	let padding: number | null = null;
	for (const turn of turnElementsIn(scroller)) {
		const { turnId } = readTurnMarks(turn);
		if (!turnId || turn.hidden || !turn.firstElementChild) continue;
		if (padding === null) {
			const style = getComputedStyle(turn);
			padding =
				Number.parseFloat(style.paddingTop) +
				Number.parseFloat(style.paddingBottom);
		}
		heights[turnId] = turn.getBoundingClientRect().height - padding;
	}
	return heights;
}
