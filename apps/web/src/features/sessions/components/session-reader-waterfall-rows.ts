import {
	getReaderStretches,
	type SessionReaderStep,
} from "./session-reader-model";

// The rows of a turn waterfall, with its folds: a large turn's quiet
// stretches (see getReaderStretches) or, with a filter on, the steps it hides;
// and runs of identical tool calls as `×N name` rows. Folds can nest — a quiet
// stretch can hold a `×N` run — and an expanded fold stays as the header above
// its members, one level deeper, so it can be folded back up.

/** `depth` 1 sits under the turn; each open fold puts its members one deeper. */
export type WaterfallStepRow = {
	depth: number;
	kind: "step";
	step: SessionReaderStep;
	/** A subagent's call: whether its own steps show beneath it, and the key
	 * that toggles them. */
	subtrace?: { expanded: boolean; key: string };
};

export type WaterfallFoldRow = {
	depth: number;
	expanded: boolean;
	key: string;
	kind: "fold";
	steps: SessionReaderStep[];
	/** `quiet` folds a stretch with nothing notable, `filtered` the steps the
	 * filter hides, `repeat` identical calls. */
	variant: "filtered" | "quiet" | "repeat";
};

export type WaterfallRow = WaterfallStepRow | WaterfallFoldRow;

/** Below this, folding costs more than it saves — three rows of the same thing
 * is where a loop starts reading as noise. */
const REPEAT_MIN_RUN = 3;

export const isToolStep = (step: SessionReaderStep) =>
	step.kind === "agent" || step.kind === "tool";

/** Toggles the subagent steps under a call (a key in the same expanded set
 * as the folds). */
export const subtraceKey = (stepId: string) => `subtrace:${stepId}`;

/** Every subagent call's key — the waterfall opens them all to start. */
export function getSubtraceKeys(steps: readonly SessionReaderStep[]): string[] {
	return steps.flatMap((step) =>
		step.children.length > 0
			? [subtraceKey(step.id), ...getSubtraceKeys(step.children)]
			: [],
	);
}

/** The subagent calls a step sits under, outermost first. */
function getSubtraceKeysAround(
	steps: readonly SessionReaderStep[],
	stepId: string,
): string[] | null {
	for (const step of steps) {
		if (step.id === stepId) return [];
		const inner = getSubtraceKeysAround(step.children, stepId);
		if (inner) return [subtraceKey(step.id), ...inner];
	}
	return null;
}

/** A step's row, then — when its subagent's steps are open — theirs, one
 * level deeper. */
function pushStep(
	step: SessionReaderStep,
	isExpanded: (key: string) => boolean,
	depth: number,
	out: WaterfallRow[],
) {
	if (step.children.length === 0) {
		out.push({ depth, kind: "step", step });
		return;
	}
	const key = subtraceKey(step.id);
	const expanded = isExpanded(key);
	out.push({ depth, kind: "step", step, subtrace: { expanded, key } });
	if (expanded) foldRepeats(step.children, isExpanded, depth + 1, out);
}

/** Fold adjacent runs of identical tool calls into one row. A run containing an
 * error never folds, so a failure is never hidden behind a count, and neither
 * does a subagent's call, which keeps its subtree. */
function foldRepeats(
	steps: readonly SessionReaderStep[],
	isExpanded: (key: string) => boolean,
	depth: number,
	out: WaterfallRow[],
) {
	let i = 0;
	while (i < steps.length) {
		const head = steps[i] as SessionReaderStep;
		const foldable = (step: SessionReaderStep | undefined) =>
			step !== undefined &&
			isToolStep(step) &&
			!step.isError &&
			step.children.length === 0 &&
			step.kind === head.kind &&
			step.name === head.name;
		let end = i + 1;
		if (foldable(head)) while (foldable(steps[end])) end++;
		const run = steps.slice(i, end);
		if (run.length >= REPEAT_MIN_RUN) {
			const expanded = isExpanded(head.id);
			out.push({
				depth,
				expanded,
				key: head.id,
				kind: "fold",
				steps: run,
				variant: "repeat",
			});
			if (expanded) {
				for (const step of run) pushStep(step, isExpanded, depth + 1, out);
			}
		} else {
			for (const step of run) pushStep(step, isExpanded, depth, out);
		}
		i = end;
	}
}

/** What the waterfall filter calls a step: its tool (or subagent), or
 * Thinking / Messages for what the model wrote. */
export function getStepFilterKey(step: SessionReaderStep): string {
	if (step.kind === "message") return "Messages";
	if (step.kind === "thinking") return "Thinking";
	return step.name;
}

export type WaterfallFilterOption = {
	count: number;
	errorCount: number;
	key: string;
	/** A step of this kind, for the option's icon. */
	sample: Pick<SessionReaderStep, "icon" | "kind" | "name">;
};

/** The filter's choices: the turn's tools, most used first, then what the
 * model wrote. */
export function getWaterfallFilterOptions(
	steps: readonly SessionReaderStep[],
): WaterfallFilterOption[] {
	const options = new Map<string, WaterfallFilterOption>();
	for (const step of steps) {
		const key = getStepFilterKey(step);
		const option = options.get(key) ?? {
			count: 0,
			errorCount: 0,
			key,
			sample: { icon: step.icon, kind: step.kind, name: step.name },
		};
		option.count += 1;
		if (step.isError) option.errorCount += 1;
		options.set(key, option);
	}
	const written = (option: WaterfallFilterOption) =>
		option.sample.kind === "message" || option.sample.kind === "thinking";
	return [...options.values()].sort(
		(a, b) => Number(written(a)) - Number(written(b)) || b.count - a.count,
	);
}

type Stretch =
	| { kind: "step"; step: SessionReaderStep }
	| {
			key: string;
			kind: "fold";
			steps: SessionReaderStep[];
			variant: "filtered" | "quiet";
	  };

/** With a filter on, the steps it picks stay as rows and every run of the
 * rest folds into one — however short, so nothing it hides shows unasked. */
function getFilteredStretches(
	steps: readonly SessionReaderStep[],
	filter: ReadonlySet<string>,
): Stretch[] {
	const out: Stretch[] = [];
	let hidden: SessionReaderStep[] = [];
	const flush = () => {
		const first = hidden[0];
		if (first) {
			out.push({
				key: `filtered:${first.id}`,
				kind: "fold",
				steps: hidden,
				variant: "filtered",
			});
		}
		hidden = [];
	};
	for (const step of steps) {
		if (filter.has(getStepFilterKey(step))) {
			flush();
			out.push({ kind: "step", step });
		} else {
			hidden.push(step);
		}
	}
	flush();
	return out;
}

export function buildWaterfallRows(
	steps: readonly SessionReaderStep[],
	turnMs: number,
	isExpanded: (key: string) => boolean,
	filter: ReadonlySet<string> = new Set(),
): WaterfallRow[] {
	const stretches: Stretch[] =
		filter.size > 0
			? getFilteredStretches(steps, filter)
			: getReaderStretches(steps, turnMs).map((stretch) =>
					stretch.kind === "step"
						? stretch
						: { ...stretch, kind: "fold", variant: "quiet" },
				);
	const out: WaterfallRow[] = [];
	// Steps between folds still fold with identical neighbours, so they're
	// gathered up and folded together.
	let loose: SessionReaderStep[] = [];
	for (const stretch of stretches) {
		if (stretch.kind === "step") {
			loose.push(stretch.step);
			continue;
		}
		foldRepeats(loose, isExpanded, 1, out);
		loose = [];
		const expanded = isExpanded(stretch.key);
		out.push({
			depth: 1,
			expanded,
			key: stretch.key,
			kind: "fold",
			steps: stretch.steps,
			variant: stretch.variant,
		});
		if (expanded) foldRepeats(stretch.steps, isExpanded, 2, out);
	}
	foldRepeats(loose, isExpanded, 1, out);
	return out;
}

/** A row, and — when it's an open fold or subagent call — the rows it holds,
 * which freeze it at the top while they scroll up under it. */
export type WaterfallRowNode = {
	children: WaterfallRowNode[];
	row: WaterfallRow;
};

const isOpenGroup = (row: WaterfallRow) =>
	row.kind === "fold" ? row.expanded : row.subtrace?.expanded === true;

/** The flat rows as a tree: each open fold or subagent call holds the deeper
 * rows that follow it. */
export function nestWaterfallRows(
	rows: readonly WaterfallRow[],
): WaterfallRowNode[] {
	const top: WaterfallRowNode[] = [];
	const open: { depth: number; children: WaterfallRowNode[] }[] = [];
	for (const row of rows) {
		while (open.length > 0 && row.depth <= (open.at(-1)?.depth ?? 0)) {
			open.pop();
		}
		const node: WaterfallRowNode = { children: [], row };
		(open.at(-1)?.children ?? top).push(node);
		if (isOpenGroup(row))
			open.push({ children: node.children, depth: row.depth });
	}
	return top;
}

/** The folds that hide a step, so selecting it can open them. */
export function getFoldKeysAround(
	steps: readonly SessionReaderStep[],
	turnMs: number,
	stepId: string,
	filter: ReadonlySet<string>,
): string[] {
	// The subagent calls above it, then the folds around it or its call.
	const subtraces = getSubtraceKeysAround(steps, stepId) ?? [];
	const folds = buildWaterfallRows(steps, turnMs, () => true, filter)
		.filter(
			(row): row is WaterfallFoldRow =>
				row.kind === "fold" &&
				row.steps.some(
					(step) =>
						step.id === stepId || subtraces.includes(subtraceKey(step.id)),
				),
		)
		.map((row) => row.key);
	return [...subtraces, ...folds];
}

/** "Read ×4, Bash ×3, Thinking" — what a quiet stretch was busy with, most
 * frequent first. */
export function summarizeSteps(steps: readonly SessionReaderStep[]): string {
	const counts = new Map<string, number>();
	for (const step of steps) {
		counts.set(step.name, (counts.get(step.name) ?? 0) + 1);
	}
	return [...counts]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
		.join(", ");
}
