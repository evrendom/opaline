import type { SessionDetailTurnSummary } from "../schemas/session-detail-payload.js";
import type {
	SessionSetupFile,
	SessionSetupRun,
} from "../session-summary-links.js";
import { getReaderMemberText, type ReadyBody } from "./session-reader-body.js";
import type { ContextRuns } from "./session-reader-context-before.js";
import {
	compactedLater,
	compactionSides,
	fullestOf,
	segmentOf,
} from "./session-reader-context-compaction.js";
import {
	type ContextMap,
	type ContextPart,
	getContextMap,
} from "./session-reader-context-map.js";
import {
	compactedRuns,
	contextRuns,
	fullestCall,
	NO_RUNS,
	readRuns,
	runSetupTexts,
	sessionBaseline,
} from "./session-reader-context-runs.js";
import { getReaderWaterfall } from "./session-reader-run-steps.js";

type Turn = SessionDetailTurnSummary;

export function contextTarget(
	turns: readonly Turn[],
	withCompaction: boolean | null,
) {
	const fullest = fullestOf(turns);
	const sides = fullest ? compactionSides(turns, fullest) : null;
	const showingWith = withCompaction ?? sides?.with === fullest;
	const target = sides ? (showingWith ? sides.with : sides.without) : fullest;
	return { showingWith, sides, target };
}

export function buildContextMap({
	compacted,
	model,
	runBodies,
	setup,
	setupRuns,
	target,
	turns,
}: {
	compacted: ContextRuns | null;
	model: string | null;
	runBodies: readonly ReadyBody<Turn>[];
	setup: readonly SessionSetupFile[];
	setupRuns: readonly SessionSetupRun[];
	target: Turn;
	turns: readonly Turn[];
}): ContextMap | null {
	const fullest = fullestCall(target);
	if (!fullest) return null;
	return getContextMap({
		baseline: sessionBaseline(turns),
		compacted,
		earlier: null,
		prompt: runBodies.map(({ body }) => getReaderMemberText(body)),
		setup: runSetupTexts(setup, setupRuns, {
			agent: null,
			startedAt: target.startedAt,
		}),
		steps: runBodies.flatMap(
			({ body, turn }) => getReaderWaterfall(body, turn, model)?.steps ?? [],
		),
		until: fullest.at,
		use: fullest,
	});
}

const DRAWN_AREA = 600_000;
const DRAWN_CELL = 18 * 18;

function drawnItems(part: ContextPart): ContextPart {
	const items = part.items?.filter((item) => item.tokens > 0) ?? [];
	const whole = items.reduce((sum, item) => sum + item.tokens, 0);
	const least = (whole * DRAWN_CELL) / DRAWN_AREA;
	return {
		...part,
		...(part.items
			? { items: items.filter((item) => item.tokens >= least) }
			: {}),
		...(part.compacted ? { compacted: part.compacted.map(drawnItems) } : {}),
	};
}

export function drawnContextMap(map: ContextMap): ContextMap {
	return { ...map, parts: map.parts.map(drawnItems), trail: [] };
}

export type SessionContextView = {
	compactedRuns: string[];
	compacting: string[];
	later: number;
	map: ContextMap;
	segmentCost: number;
	withCompaction: boolean | null;
};

export type SessionContextSnapshot = {
	sessionCost: number | null;
	views: SessionContextView[];
};

export function sessionContextSnapshot({
	bodyOf,
	model,
	sessionCost,
	setup,
	setupRuns,
	turns,
}: {
	bodyOf: (turnId: string) => ReadyBody<Turn>["body"] | null;
	model: string | null;
	sessionCost: number | null;
	setup: readonly SessionSetupFile[];
	setupRuns: readonly SessionSetupRun[];
	turns: readonly Turn[];
}): SessionContextSnapshot | null {
	const ready = (runs: readonly Turn[]) => {
		const bodies: ReadyBody<Turn>[] = [];
		for (const turn of runs) {
			const body = bodyOf(turn.turnId);
			if (!body) return null;
			bodies.push({ body, turn });
		}
		return bodies;
	};
	const first = contextTarget(turns, null);
	const sides = first.sides;
	const choices = sides
		? [first.showingWith, !first.showingWith]
		: [null as boolean | null];
	const views: SessionContextView[] = [];
	for (const withCompaction of choices) {
		const target =
			withCompaction === null
				? first.target
				: withCompaction
					? sides?.with
					: sides?.without;
		if (!target) continue;
		const runs = contextRuns(turns, target);
		const runBodies = ready(runs);
		const compactedTurns = compactedRuns(turns, target);
		const compactedBodies = ready(compactedTurns);
		if (!runBodies || !compactedBodies) return null;
		const map = buildContextMap({
			compacted:
				compactedBodies.length === 0
					? NO_RUNS
					: readRuns(compactedBodies, model),
			model,
			runBodies,
			setup,
			setupRuns,
			target,
			turns,
		});
		if (!map) continue;
		const segment = segmentOf(turns, target);
		views.push({
			compactedRuns: compactedTurns.map((turn) => `run:${turn.turnId}`),
			compacting: [...compactedLater(turns, runs)],
			later: segment.length - 1 - segment.indexOf(target),
			map: drawnContextMap(map),
			segmentCost: segment.reduce(
				(sum, turn) => sum + (turn.estimatedCost ?? 0),
				0,
			),
			withCompaction,
		});
	}
	return views.length > 0 ? { sessionCost, views } : null;
}
