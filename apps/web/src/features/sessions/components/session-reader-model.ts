import type {
	SessionDetailTurnSummary,
	SessionDetailWindowTurn,
} from "@rudel/api-routes";
import type { SessionReaderStep } from "./session-reader-run-steps";

type TraceEvent = NonNullable<SessionReaderStep["toolEvent"]>;

export type SessionReaderBody = NonNullable<SessionDetailWindowTurn["body"]>;

export {
	flattenSteps,
	getReaderWaterfall,
	type SessionReaderStep,
	type SessionReaderWaterfall,
} from "./session-reader-run-steps";

/** What the member typed in this turn, with tool-result transport left out. */
export function getReaderMemberText(body: SessionReaderBody): string {
	return body.userItems
		.flatMap((item) => {
			if (item.kind !== "user") return [];
			if (typeof item.content === "string") return [item.content];
			return item.content.flatMap((part) => {
				if (typeof part === "string") return part ? [part] : [];
				return part.type === "text" && part.text ? [part.text] : [];
			});
		})
		.filter((text) => text.trim().length > 0)
		.join("\n");
}

/** The turn's answer: the last message the agent wrote before handing back. */
export function getReaderFinalMessage(body: SessionReaderBody): string | null {
	for (let i = body.responseItems.length - 1; i >= 0; i--) {
		const item = body.responseItems[i];
		if (item?.kind !== "agent") continue;
		for (let j = item.events.length - 1; j >= 0; j--) {
			const event = item.events[j];
			if (event?.kind === "message" && event.text.trim()) return event.text;
		}
	}
	return null;
}

export type SessionReaderTurnMarkKind =
	| "skill"
	| "file-added"
	| "file-edited"
	| "file-removed";

/** Something a turn changed or drew on, with the skills or files behind it. */
export type SessionReaderTurnMark = {
	items: string[];
	kind: SessionReaderTurnMarkKind;
};

const TURN_MARK_ORDER: readonly SessionReaderTurnMarkKind[] = [
	"skill",
	"file-added",
	"file-edited",
	"file-removed",
];

/**
 * Whether a turn used a skill or added, edited or removed files, each with the
 * names behind it. The summary has skills and added/edited files from the
 * start; removals are only in the body, so they show once it has loaded.
 */
export function getReaderTurnMarks(
	turn: Pick<SessionDetailTurnSummary, "editedFiles" | "fileEvents" | "skills">,
	body: SessionReaderBody | null,
): SessionReaderTurnMark[] {
	return collectMarks((add) => {
		for (const skill of turn.skills) add("skill", skill);
		for (const path of turn.editedFiles) add("file-edited", path);
		for (const event of turn.fileEvents ?? []) {
			if (event.operation === "created") add("file-added", event.path ?? "");
			if (event.operation === "edited") add("file-edited", event.path ?? "");
		}
		for (const item of body?.responseItems ?? []) {
			if (item.kind !== "agent") continue;
			for (const event of item.events) {
				if (event.kind === "tool") addActivity(add, event.activity);
			}
		}
	});
}

/** The skills and files a subagent's steps used and touched — the turn's
 * summary doesn't split them by subagent, so they're read off its calls. */
export function getStepMarks(
	steps: readonly SessionReaderStep[],
): SessionReaderTurnMark[] {
	return collectMarks((add) => {
		for (const step of steps) addActivity(add, step.toolEvent?.activity);
	});
}

type AddMark = (
	kind: SessionReaderTurnMarkKind,
	item: string | undefined,
) => void;

/** What a tool call's activity used and touched. */
function addActivity(add: AddMark, activity: TraceEvent["activity"]) {
	if (!activity) return;
	for (const skill of activity.skills) add("skill", skill);
	for (const file of activity.files) {
		if (file.operation === "created") add("file-added", file.path);
		if (file.operation === "edited") add("file-edited", file.path);
		if (file.operation === "deleted") add("file-removed", file.path);
	}
}

/** The marks `fill` adds, each kind's names once, in the rail's order. */
function collectMarks(fill: (add: AddMark) => void): SessionReaderTurnMark[] {
	const items = new Map<SessionReaderTurnMarkKind, Set<string>>(
		TURN_MARK_ORDER.map((kind) => [kind, new Set<string>()]),
	);
	fill((kind, item) => {
		if (item) items.get(kind)?.add(item);
	});
	// A file added in the turn is an addition, not also an edit.
	for (const path of items.get("file-added") ?? []) {
		items.get("file-edited")?.delete(path);
	}
	return TURN_MARK_ORDER.flatMap((kind) => {
		const names = [...(items.get(kind) ?? [])];
		return names.length > 0 ? [{ items: names, kind }] : [];
	});
}

/** A row of a large turn's outline: a step that stands out, or a quiet
 * stretch of steps folded into one. */
export type SessionReaderStretch =
	| { kind: "step"; step: SessionReaderStep }
	| { key: string; kind: "quiet"; steps: SessionReaderStep[] };

/** Turns longer than this fold their quiet stretches. */
const LARGE_TURN_STEPS = 12;
/** Fewer quiet steps in a row than this aren't worth a fold. */
const QUIET_MIN_RUN = 3;
/** The longest few steps stay out, when they're long next to the rest. */
const LONGEST_KEPT = 3;
/** "Long next to the rest": this many times the median step. */
const LONGEST_OVER_MEDIAN = 2;
/** A step taking this share of the turn stands out on its own. */
const LONG_STEP_SHARE = 0.1;

/**
 * A large turn's outline: steps that stand out stay as rows — failures,
 * subagents, the final message, the few steps far longer than the rest, and
 * any the caller keeps out — and each run of quiet steps between them folds
 * into one row. Small turns pass through unfolded.
 */
export function getReaderStretches(
	steps: readonly SessionReaderStep[],
	turnMs: number,
	keepOut: ReadonlySet<string> = new Set(),
): SessionReaderStretch[] {
	if (steps.length <= LARGE_TURN_STEPS) {
		return steps.map((step) => ({ kind: "step", step }));
	}
	const durationOf = (step: SessionReaderStep) => step.endMs - step.startMs;
	const byDuration = [...steps].sort((a, b) => durationOf(b) - durationOf(a));
	const median = durationOf(
		byDuration[Math.floor(byDuration.length / 2)] as SessionReaderStep,
	);
	const longest = new Set(
		byDuration
			.slice(0, LONGEST_KEPT)
			.filter(
				(step) =>
					durationOf(step) > 0 &&
					durationOf(step) >= median * LONGEST_OVER_MEDIAN,
			)
			.map((step) => step.id),
	);
	let finalMessageId: string | undefined;
	for (const step of steps) {
		if (step.kind === "message") finalMessageId = step.id;
	}
	const standsOut = (step: SessionReaderStep) =>
		keepOut.has(step.id) ||
		step.isError ||
		step.kind === "agent" ||
		step.id === finalMessageId ||
		longest.has(step.id) ||
		durationOf(step) >= turnMs * LONG_STEP_SHARE;

	const out: SessionReaderStretch[] = [];
	let quiet: SessionReaderStep[] = [];
	const flush = () => {
		const first = quiet[0];
		if (first && quiet.length >= QUIET_MIN_RUN) {
			out.push({ key: `quiet:${first.id}`, kind: "quiet", steps: quiet });
		} else {
			for (const step of quiet) out.push({ kind: "step", step });
		}
		quiet = [];
	};
	for (const step of steps) {
		if (standsOut(step)) {
			flush();
			out.push({ kind: "step", step });
		} else {
			quiet.push(step);
		}
	}
	flush();
	return out;
}

export type SessionReaderTurnSignal = "apology" | "positive" | "trouble";

/** The kinds of signal a turn carries, each once, in rail order: trouble (a
 * tool error or negative user language), an apology, positive language. */
export function getReaderTurnSignals(
	turn: Pick<SessionDetailTurnSummary, "errorCount" | "signalOccurrences">,
): SessionReaderTurnSignal[] {
	const has = (category: "apology" | "negative" | "positive") =>
		turn.signalOccurrences.some((signal) => signal.category === category);
	const signals: SessionReaderTurnSignal[] = [];
	if (turn.errorCount > 0 || has("negative")) signals.push("trouble");
	if (has("apology")) signals.push("apology");
	if (has("positive")) signals.push("positive");
	return signals;
}

/** 20/40/60/80th-percentile thresholds of the positive values (sorted-nearest). */
export function getCostQuintiles(values: readonly number[]): number[] {
	const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
	if (sorted.length === 0) return [];
	return [0.2, 0.4, 0.6, 0.8].map(
		(quantile) =>
			sorted[
				Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))
			] ?? 0,
	);
}

// Green = cheapest, red = priciest. Literal classes so Tailwind keeps them.
const COST_HEAT_SHADES = [
	"text-green-600 dark:text-green-400",
	"text-yellow-600 dark:text-yellow-400",
	"text-amber-600 dark:text-amber-400",
	"text-orange-600 dark:text-orange-400",
	"text-red-600 dark:text-red-400",
] as const;

export function getCostShade(
	cost: number | null,
	thresholds: readonly number[],
): string | undefined {
	if (!cost || cost <= 0 || thresholds.length === 0) return undefined;
	const bucket = thresholds.filter((threshold) => cost > threshold).length;
	return COST_HEAT_SHADES[Math.min(bucket, COST_HEAT_SHADES.length - 1)];
}

export function formatReaderDuration(seconds: number | null): string {
	if (seconds === null) return "—";
	if (seconds < 1) return "<1s";
	if (seconds < 60) return `${Math.round(seconds)}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		const rest = Math.round(seconds % 60);
		return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	const restMinutes = minutes % 60;
	return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

const costFormatter = new Intl.NumberFormat("en-US", {
	currency: "USD",
	maximumFractionDigits: 2,
	minimumFractionDigits: 2,
	style: "currency",
});

/** Cents precision: per-turn costs are compared at a glance, not audited. */
export function formatReaderCost(value: number | null): string {
	if (value === null) return "—";
	if (value > 0 && value < 0.01) return "<$0.01";
	return costFormatter.format(value);
}

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

/** A size in KB, MB or GB (binary units, as the upload limits count them). */
export function formatReaderBytes(bytes: number): string {
	if (bytes < KIB) return `${bytes} B`;
	if (bytes < MIB) return `${Math.round(bytes / KIB)} KB`;
	if (bytes < GIB) return `${(bytes / MIB).toFixed(1)} MB`;
	return `${(bytes / GIB).toFixed(2)} GB`;
}
