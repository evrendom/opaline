import type {
	RunRef,
	SessionBehind,
	SessionsBehindOutput,
} from "@rudel/api-routes";
import { type CursorKey, type CursorOrder, takePage } from "./find-cursor.js";
import { runKey } from "./reactions.js";
import type { RunRow } from "./run-queries.js";
import type { AnalysisSession } from "./scope.js";

export const SESSIONS_BEHIND_ORDER: CursorOrder = ["desc", "asc", "asc"];

export type FailedCallsOf = "rows" | "hits" | "runs";

export interface SessionHit {
	readonly ref: RunRef;
	readonly record: number;
	readonly atMs: number;
	readonly lastMs?: number;
	readonly rows?: number;
	readonly failedCalls?: number;
	readonly callMinutes?: number | null;
	readonly runs?: readonly string[];
}

interface Tally {
	sessionId: string;
	rows: number;
	firstMs: number;
	lastMs: number;
	failedCalls: number;
	callMinutes: number | null;
	runs: Set<string>;
	example: { ref: RunRef; record: number; atMs: number };
}

interface PageInput {
	readonly after: CursorKey | undefined;
	readonly limit: number;
	readonly runs: ReadonlyMap<string, RunRow>;
	readonly sessions: ReadonlyMap<string, AnalysisSession>;
	readonly failedCallsOf: FailedCallsOf;
	readonly timed: boolean;
}

export class SessionsBehind {
	private readonly tallies = new Map<string, Tally>();

	add(hit: SessionHit): void {
		const sessionId = hit.ref.sessionId;
		const lastMs = hit.lastMs ?? hit.atMs;
		const tally = this.tallies.get(sessionId) ?? {
			sessionId,
			rows: 0,
			firstMs: hit.atMs,
			lastMs,
			failedCalls: 0,
			callMinutes: null,
			runs: new Set<string>(),
			example: { ref: hit.ref, record: hit.record, atMs: hit.atMs },
		};
		this.tallies.set(sessionId, tally);
		tally.rows += hit.rows ?? 1;
		tally.failedCalls += hit.failedCalls ?? 0;
		if (hit.callMinutes != null)
			tally.callMinutes = (tally.callMinutes ?? 0) + hit.callMinutes;
		if (hit.atMs < tally.firstMs) tally.firstMs = hit.atMs;
		if (lastMs > tally.lastMs) tally.lastMs = lastMs;
		if (hit.atMs < tally.example.atMs)
			tally.example = { ref: hit.ref, record: hit.record, atMs: hit.atMs };
		for (const key of hit.runs ?? [runKey(hit.ref)]) tally.runs.add(key);
	}

	page(input: PageInput): {
		output: Omit<SessionsBehindOutput, "source" | "of" | "header">;
		keys: CursorKey[];
		more: boolean;
	} {
		const all = [...this.tallies.values()];
		const keyOf = (tally: Tally): CursorKey => [
			tally.rows,
			new Date(tally.firstMs).toISOString(),
			tally.sessionId,
		];
		const { page, more } = takePage(
			all,
			keyOf,
			SESSIONS_BEHIND_ORDER,
			input.after,
			input.limit,
		);
		const starts = new Map<string, number>();
		const shown = new Set(page.map((tally) => tally.sessionId));
		for (const run of input.runs.values())
			if (shown.has(run.session_id))
				starts.set(
					run.session_id,
					Math.min(
						starts.get(run.session_id) ?? run.started_ms,
						run.started_ms,
					),
				);
		const firstMs = Math.min(...all.map((tally) => tally.firstMs));
		const lastMs = Math.max(...all.map((tally) => tally.lastMs));
		return {
			output: {
				sessionTotals: {
					sessions: all.length,
					rows: all.reduce((sum, tally) => sum + tally.rows, 0),
					firstSeen: all.length ? new Date(firstMs).toISOString() : null,
					lastSeen: all.length ? new Date(lastMs).toISOString() : null,
				},
				sessions: page.map((tally) =>
					toSession(tally, input, starts.get(tally.sessionId) ?? null),
				),
			},
			keys: page.map(keyOf),
			more,
		};
	}
}

function toSession(
	tally: Tally,
	input: PageInput,
	started: number | null,
): SessionBehind {
	const session = input.sessions.get(tally.sessionId);
	const behind = [...tally.runs].flatMap((key) => input.runs.get(key) ?? []);
	return {
		sessionId: tally.sessionId,
		repository: session?.repository ?? "",
		agent: session?.source ?? "claude_code",
		startedAt: started === null ? null : new Date(started).toISOString(),
		rows: tally.rows,
		firstSeen: new Date(tally.firstMs).toISOString(),
		lastSeen: new Date(tally.lastMs).toISOString(),
		groupRunTime: round(
			behind.reduce((sum, run) => sum + run.active_minutes, 0),
		),
		groupCallTime:
			input.timed && tally.callMinutes !== null
				? round(tally.callMinutes)
				: input.timed
					? 0
					: null,
		failedCalls:
			input.failedCallsOf === "rows"
				? tally.rows
				: input.failedCallsOf === "hits"
					? tally.failedCalls
					: behind.reduce((sum, run) => sum + run.failed_calls, 0),
		example: { ref: tally.example.ref, record: tally.example.record },
		parentSessionId: session?.parentSessionId ?? null,
	};
}

function round(minutes: number): number {
	return Math.round(minutes * 10_000) / 10_000;
}
