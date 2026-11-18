import type { RunRef } from "@rudel/api-routes";
import type { VisibilitySyncs } from "./finding-visibility.js";

/**
 * Finding impact (docs/retro-architecture.md, "Finding impact"): when an
 * analysis is saved, each finding's cited runs go to
 * `rudel.analysis_finding_runs` with the cost, tokens and active time their
 * committed run index build recorded, so the `sql` tool's `finding_runs`
 * view can sum what retros found. Nothing is estimated: a cited run the run
 * index does not hold is left out, and an unknown measure stays NULL. The
 * ClickHouse side is `finding-impact-clickhouse.ts`.
 */

/** One saved finding and the runs its step's call cites. */
export interface FindingCitation {
	stepId: string;
	finding: string;
	runs: RunRef[];
}

/**
 * An analysis's visibility as the analysis log (authoritative) holds it:
 * `revision` grows with every share and unshare, and a copy keeps the
 * visibility of the highest revision it was handed.
 */
export interface Visibility {
	shared: boolean;
	revision: number;
}

/** What saving an analysis hands over. */
export interface SavedFindings {
	workspaceId: string;
	analysisId: string;
	authorId: string;
	visibility: Visibility;
	savedAt: string;
	/**
	 * Members whose deletion deletes the analysis (ADR 0001 as amended), and
	 * so these rows: every member a quoting query read, and every member a
	 * finding's result names a session of.
	 */
	quotedOwners: string[];
	/**
	 * The saver reads only this member's sessions now: only their runs are
	 * recorded. Null when the saver reads every member's.
	 */
	onlyMember: string | null;
	citations: FindingCitation[];
}

export interface FindingImpact {
	record(saved: SavedFindings): Promise<void>;
	/**
	 * The analysis was shared or unshared: its rows take this visibility,
	 * unless they already hold a higher revision's.
	 */
	share(
		analysis: { workspaceId: string; analysisId: string },
		visibility: Visibility,
	): Promise<void>;
}

/** Finding impact with the durable requests that make its rows follow visibility changes. */
export interface FindingMirror {
	impact: FindingImpact;
	syncs: VisibilitySyncs;
}

/**
 * The runs a stored call result cites, once each in order: every run
 * reference in it (`sessionId`, `agentId`, `turn`), as find rows and events,
 * read runs and sql results' named runs carry them.
 */
export function citedRuns(output: unknown): RunRef[] {
	const runs = new Map<string, RunRef>();
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		if (!value || typeof value !== "object") return;
		const run = runRefOf(value);
		if (run) {
			runs.set(runKey(run), run);
			return;
		}
		for (const item of Object.values(value)) visit(item);
	};
	visit(output);
	return [...runs.values()];
}

/** In-process stand-in that keeps what it was handed, for tests. */
export function createMemoryFindingImpact(): FindingImpact & {
	readonly saved: SavedFindings[];
	readonly shares: ({
		workspaceId: string;
		analysisId: string;
	} & Visibility)[];
} {
	const saved: SavedFindings[] = [];
	const shares: ({ workspaceId: string; analysisId: string } & Visibility)[] =
		[];
	return {
		saved,
		shares,
		async record(findings) {
			saved.push(structuredClone(findings));
		},
		async share(analysis, visibility) {
			shares.push({ ...analysis, ...visibility });
		},
	};
}

/** A run reference as results carry them (`RunRefSchema`); anything else is not one. */
function runRefOf(value: object): RunRef | null {
	const candidate: Record<string, unknown> = { ...value };
	const { sessionId, agentId, turn } = candidate;
	return typeof sessionId === "string" &&
		typeof agentId === "string" &&
		typeof turn === "number"
		? { sessionId, agentId, turn }
		: null;
}

export function runKey(run: RunRef): string {
	return JSON.stringify([run.sessionId, run.agentId, run.turn]);
}
