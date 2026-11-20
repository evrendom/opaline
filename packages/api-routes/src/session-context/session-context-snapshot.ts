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
	costMap,
	runsByPart,
	storedCost,
} from "./session-reader-context-part-figures.js";
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

/** The snapshot's shape. Version 2 added each view's `figures`; the backfill
 * rebuilds snapshots that do not start with this version. */
export const CONTEXT_SNAPSHOT_VERSION = 2;

/** What each part of a view cost and which runs touched it, read from the
 * map's trail before it is dropped: `cost` in millionths of a dollar by part
 * key and by `pairKey(part, item)`, or null when no call was priced; `runs`
 * the indexes of the view's runs by part key and by `thingKey(part, item)`. */
export type SessionContextFigures = {
	cost: Record<string, number> | null;
	runs: Record<string, number[]>;
};

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
	/** Missing on snapshots built before version 2. */
	figures?: SessionContextFigures;
};

export type SessionContextSnapshot = {
	/** Missing before version 2. Kept first, so the stored JSON starts with it. */
	version?: number;
	sessionCost: number | null;
	views: SessionContextView[];
};

function figuresOf(
	map: ContextMap,
	runs: readonly Turn[],
	segment: readonly Turn[],
	total: number | null,
	subagentCosts: ReadonlyMap<string, number | null> | undefined,
): SessionContextFigures {
	const calls = segment.flatMap((run) => run.usageCalls);
	const costed =
		calls.length > 0 ? costMap(map, calls, total, subagentCosts) : null;
	return {
		cost: costed ? storedCost(costed) : null,
		runs: Object.fromEntries(
			[...runsByPart(map, runs)].map(([key, at]) => [key, [...at]]),
		),
	};
}

export function sessionContextSnapshot({
	bodyOf,
	model,
	sessionCost,
	setup,
	setupRuns,
	subagentCosts,
	turns,
}: {
	bodyOf: (turnId: string) => ReadyBody<Turn>["body"] | null;
	model: string | null;
	sessionCost: number | null;
	setup: readonly SessionSetupFile[];
	setupRuns: readonly SessionSetupRun[];
	subagentCosts?: ReadonlyMap<string, number | null>;
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
		const segmentCost = segment.reduce(
			(sum, turn) => sum + (turn.estimatedCost ?? 0),
			0,
		);
		views.push({
			compactedRuns: compactedTurns.map((turn) => `run:${turn.turnId}`),
			compacting: [...compactedLater(turns, runs)],
			later: segment.length - 1 - segment.indexOf(target),
			map: drawnContextMap(map),
			segmentCost,
			withCompaction,
			figures: figuresOf(
				map,
				runs,
				segment,
				sides ? segmentCost : sessionCost,
				subagentCosts,
			),
		});
	}
	return views.length > 0
		? { version: CONTEXT_SNAPSHOT_VERSION, sessionCost, views }
		: null;
}
