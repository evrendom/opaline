import {
	cutPhases,
	type Phase,
	type PhaseCall,
	type PhaseRequest,
	type PhaseRule,
} from "./phases.js";
import { nextPromptReaction } from "./reactions.js";

/**
 * The run view (docs/retro-architecture.md, "The run view"): one run,
 * compact, with an id on every line. Levels are run → phase → request →
 * call → record; `expand` opens any list of ids under one character budget.
 * This module is pure: the service loads a `RunView` and the details of the
 * ids to expand, and this renders them.
 *
 * Tokens and cost exist per request (the usage of its model response);
 * calls show their duration only, since a call's share of a request's cost
 * has no defensible allocation.
 */

/** The run index version from which builds write requests (version 4 builds write none). */
export const REQUESTS_SINCE_INDEX_VERSION = 5;

export interface RunViewCall extends PhaseCall {
	readonly record: number;
}

export interface RunViewRequest extends PhaseRequest {
	/** Raw record index of its first response record: the request id is `q<record>`. */
	readonly record: number;
	readonly startedMs: number;
	readonly endedMs: number;
	readonly calls: readonly RunViewCall[];
	/** The request's last assistant text: its record, its block in it and its first characters. */
	readonly text: {
		readonly record: number;
		readonly block: number;
		readonly head: string;
	} | null;
	/** All tokens of its usage (input of every kind and output); null when unknown. */
	readonly tokens: number | null;
	readonly costUsd: number | null;
}

/** A neighbouring run of the same stream. */
export interface RunViewNeighbour {
	readonly id: string;
	readonly prompt: string | null;
}

export interface RunView {
	readonly id: string;
	readonly agent: string;
	/** The human prompt that starts the run; null when none was recorded. */
	readonly prompt: string | null;
	/** Without a human prompt: the task a parent agent delegated (a subagent run). */
	readonly task: string | null;
	readonly minutes: number;
	readonly tokens: number | null;
	readonly costUsd: number | null;
	/** False when the run's index build predates requests (`REQUESTS_SINCE_INDEX_VERSION`). */
	readonly requestsIndexed: boolean;
	/** The previous run and how it ended; null for the stream's first run. */
	readonly previous:
		| (RunViewNeighbour & { readonly end: string | null })
		| null;
	/** The next run, whose prompt is the user's reaction; null for the last run. */
	readonly next: RunViewNeighbour | null;
	readonly requests: readonly RunViewRequest[];
}

/** A call of an expanded request, as the service read it from its records. */
export interface RunViewCallDetail {
	/** `c<record>` of the tool call record (`c<record>.<block>` past block 0). */
	readonly id: string;
	readonly tool: string;
	readonly commandClass: string;
	/** The first characters of its input (the command, the path, the task). */
	readonly input: string;
	readonly durationMs: number | null;
	readonly failed: boolean;
	/** Whether the call started a subagent (expanding the call opens its run). */
	readonly startedSubagent: boolean;
	/** That subagent's run, when known without opening it. */
	readonly subagentRunId: string | null;
}

/** An exact text the service read: a record's, or a call's input or result. */
export interface RunViewText {
	/** What it is, after its id: `r94 assistant text`, `c71 Bash input`. */
	readonly label: string;
	readonly text: string;
	/** Characters (code points) of the whole text; more than `text` has when only part was read. */
	readonly totalChars: number;
}

/** What the service loaded for one id to expand (phases need nothing). */
export type RunViewDetail =
	| { readonly kind: "calls"; readonly calls: readonly RunViewCallDetail[] }
	| { readonly kind: "text"; readonly parts: readonly RunViewText[] }
	/** The run of the subagent a call started. */
	| { readonly kind: "run"; readonly view: RunView }
	/** The id is the run's, but its details cannot be read. */
	| { readonly kind: "missing"; readonly reason: string };

export interface RunViewOptions {
	readonly sections: readonly string[];
	readonly expand: readonly string[];
	readonly maxChars: number;
	readonly rule: PhaseRule;
	readonly details: ReadonlyMap<string, RunViewDetail>;
}

export interface RenderedRunView {
	readonly text: string;
	readonly truncated: boolean;
}

interface Context {
	readonly view: RunView;
	readonly phases: readonly Phase<RunViewRequest>[];
	readonly rule: PhaseRule;
	/**
	 * Whether lines carry the ids `expand` opens. A subagent's run shown
	 * inside its parent's view has none: `expand` resolves ids in the run
	 * opened, so its p1 or r12 would open the parent's.
	 */
	readonly handles: boolean;
}

/**
 * The sections of the view, in display order. Each reads only what the run
 * view loads (the run, its neighbours, its requests) and formats it in a
 * line or a few; the defaults are configuration, not data.
 */
export const RUN_VIEW_SECTIONS: readonly {
	readonly name: string;
	lines(context: Context): string[];
}[] = [
	{ name: "header", lines: headerLines },
	{ name: "prev", lines: previousLines },
	{ name: "end", lines: endLines },
	{ name: "next", lines: nextLines },
	{ name: "phases", lines: phaseLines },
];

export const DEFAULT_RUN_VIEW_SECTIONS: readonly string[] = [
	"header",
	"prev",
	"end",
	"next",
	"phases",
];

export function renderRunView(
	view: RunView,
	options: RunViewOptions,
): RenderedRunView {
	const context = contextOf(view, options.rule);
	const [heading, ...rest] = viewLines(view, options.sections, options.rule);
	const budget = { remaining: options.maxChars, truncated: false };
	const [top = []] =
		heading === undefined
			? []
			: fitBlocks(
					[
						{
							heading,
							items: rest,
							separator: "\n",
							cut: (shown, total) =>
								cutLine(`${shown + 1} of ${total + 1} lines of the view`),
						},
					],
					budget,
				);
	const expanded = fitBlocks(
		[...new Set(options.expand)].flatMap((id) =>
			expansion(context, id, options.details.get(id)),
		),
		budget,
	);
	return {
		text: [top, ...expanded].flat().join("\n"),
		truncated: budget.truncated,
	};
}

function contextOf(view: RunView, rule: PhaseRule, handles = true): Context {
	return {
		view,
		phases: cutPhases(view.requests, rule).phases,
		rule,
		handles,
	};
}

/** The lines of the named sections, in the view's order. */
function viewLines(
	view: RunView,
	sections: readonly string[],
	rule: PhaseRule,
	handles = true,
): string[] {
	const context = contextOf(view, rule, handles);
	return RUN_VIEW_SECTIONS.filter((section) =>
		sections.includes(section.name),
	).flatMap((section) => section.lines(context));
}

/** An expanded id: a heading, then items shown in order until the budget runs out. */
interface Block {
	readonly heading: string;
	readonly items: readonly string[];
	/** Lines are items joined by newlines; an exact text is cut into pieces joined by nothing. */
	readonly separator: "\n" | "";
	/** The line that says what was left out, from the items shown and their total. */
	cut(shown: number, total: number): string;
	/** False when even every item is not the whole: the text was read only in part. */
	readonly complete?: boolean;
}

/** Code points per piece of an exact text, so a budget cuts it close to its end. */
const TEXT_PIECE = 80;

/** The lines an expanded id opens, under a heading that names it. */
function expansion(
	context: Context,
	id: string,
	detail: RunViewDetail | undefined,
): Block[] {
	if (detail?.kind === "text") return detail.parts.map(textBlock);
	if (detail?.kind === "missing")
		return [
			{
				heading: `▸ ${id}: ${detail.reason}`,
				items: [],
				separator: "\n",
				cut: () => cutLine(id),
			},
		];
	if (detail?.kind === "run")
		return [
			{
				heading: `▸ ${id} started subagent run ${detail.view.id}; open it with run to expand its phases, requests and records`,
				items: viewLines(
					detail.view,
					DEFAULT_RUN_VIEW_SECTIONS,
					context.rule,
					false,
				).map((line) => `  ${line}`),
				separator: "\n",
				cut: (shown, total) =>
					cutLine(
						`${shown} of ${total} lines of ${id}; open the run with its id`,
					),
			},
		];
	return [lineExpansion(context, id, detail)];
}

/** An exact text, in pieces the budget can stop between; the cut line counts characters. */
function textBlock(part: RunViewText): Block {
	const points = [...part.text];
	const pieces: string[] = [];
	for (let start = 0; start < points.length; start += TEXT_PIECE)
		pieces.push(points.slice(start, start + TEXT_PIECE).join(""));
	const id = part.label.split(" ", 1)[0];
	return {
		heading: `▸ ${part.label}, ${part.totalChars} characters`,
		items: pieces,
		separator: "",
		complete: points.length >= part.totalChars,
		cut: (shown) =>
			cutLine(
				`${[...pieces.slice(0, shown).join("")].length} of ${part.totalChars} characters of ${id}`,
			),
	};
}

function lineExpansion(
	context: Context,
	id: string,
	detail: RunViewDetail | undefined,
): Block {
	const request = context.view.requests.find(
		(candidate) => `q${candidate.record}` === id,
	);
	if (request && detail?.kind === "calls")
		return {
			heading: `▸ ${id} ${count(detail.calls.length, "call")} · ${requestTotals(request)}`,
			items: [
				...detail.calls.map(callLine),
				...(request.text
					? [
							`  ${textId(request.text).padEnd(5)} text: ${quote(request.text.head)}`,
						]
					: []),
			],
			separator: "\n",
			cut: (shown, total) => cutLine(`${shown} of ${total} lines of ${id}`),
		};
	const phase = context.phases.find((candidate) => candidate.id === id);
	if (phase)
		return {
			heading: `▸ ${phase.id} ${phase.kind}: ${count(phase.requests.length, "request")}`,
			items: phase.requests.map(requestLine),
			separator: "\n",
			cut: (shown, total) => cutLine(`${shown} of ${total} requests of ${id}`),
		};
	return {
		heading: `▸ ${id} not found in this view`,
		items: [],
		separator: "\n",
		cut: () => cutLine(id),
	};
}

function requestLine(request: RunViewRequest): string {
	const failed = request.calls.filter((call) => call.failed).length;
	return [
		`  q${String(request.record).padEnd(4)} ${request.calls.length === 0 ? "text" : countLabels(request.calls.map(callLabel))}`,
		requestTotals(request),
		...(failed > 0 ? [`${failed} failed`] : []),
	].join(" · ");
}

function requestTotals(request: RunViewRequest): string {
	return [
		minutes(request.endedMs - request.startedMs),
		`${tokens(request.tokens)} tokens`,
		cost(request.costUsd),
	].join(" · ");
}

/** A call: its tool, input and duration; never tokens or cost, which belong to its request. */
function callLine(call: RunViewCallDetail): string {
	return [
		`  ${call.id.padEnd(5)} ${callLabel({ ...call, group: "", failed: call.failed })}`,
		quote(call.input),
		call.durationMs === null ? "duration unknown" : duration(call.durationMs),
		...(call.failed ? ["failed"] : []),
		...(call.subagentRunId
			? [`started subagent run ${call.subagentRunId} (expand ${call.id})`]
			: call.startedSubagent
				? [`started a subagent (expand ${call.id})`]
				: []),
	].join(" · ");
}

/** Says what a block left out; the tool description says how to see the rest. */
function cutLine(what: string): string {
	return `  [cut: ${what} shown]`;
}

/**
 * Fits the blocks into the budget, each line costing its length and a
 * newline. Every block first gets its heading and room for its cut line;
 * then the blocks take one item each in turn while items fit, so expanding
 * several ids at once shares the budget between them. A block that could
 * not show every item ends with its cut line; one whose heading and cut line
 * do not fit is left out. Either way the view is marked truncated.
 */
function fitBlocks(
	blocks: readonly Block[],
	budget: { remaining: number; truncated: boolean },
): string[][] {
	const placed = blocks.map((block) => {
		const reserve =
			block.heading.length + 1 + cutCost(block, block.items.length);
		if (reserve > budget.remaining) {
			budget.truncated = true;
			return null;
		}
		budget.remaining -= reserve;
		return { block, shown: 0, text: [] as string[] };
	});
	for (let progress = true; progress; ) {
		progress = false;
		for (const entry of placed) {
			const item = entry?.block.items[entry.shown];
			if (!entry || item === undefined) continue;
			const cost =
				item.length + (entry.shown === 0 ? 1 : entry.block.separator.length);
			if (cost > budget.remaining) continue;
			budget.remaining -= cost;
			entry.text.push(item);
			entry.shown++;
			progress = true;
		}
	}
	return placed.map((entry) => {
		if (!entry) return [];
		const { block, shown, text } = entry;
		const body = text.length > 0 ? [text.join(block.separator)] : [];
		if (shown === block.items.length && block.complete !== false) {
			budget.remaining += cutCost(block, block.items.length);
			return [block.heading, ...body];
		}
		budget.truncated = true;
		return [block.heading, ...body, block.cut(shown, block.items.length)];
	});
}

/**
 * Room for a block's cut line: the longest it can be, and its newline. A
 * block with nothing to show needs none, unless it is only part of a text
 * (a text read in part can have no piece at all).
 */
function cutCost(block: Block, total: number): number {
	return total === 0 && block.complete !== false
		? 0
		: block.cut(total, total).length + 1;
}

function headerLines({ view, rule }: Context): string[] {
	return [
		[
			`run ${view.id}`,
			view.agent,
			view.prompt === null && view.task !== null
				? `task ${quote(view.task)}`
				: quote(view.prompt),
			minutes(view.minutes * 60_000),
			`${tokens(view.tokens)} tokens`,
			cost(view.costUsd),
			`phases by rule ${rule.version}`,
		].join(" · "),
	];
}

function previousLines({ view }: Context): string[] {
	const previous = view.previous;
	if (!previous) return ["PREV none: the first run of its stream"];
	return [
		`PREV ${previous.id} · ${quote(previous.prompt)} → END ${quote(previous.end)}`,
	];
}

/** The last text a run's requests wrote: how the run ended. */
export function lastText(
	requests: readonly RunViewRequest[],
): RunViewRequest["text"] {
	return (
		[...requests].reverse().find((request) => request.text !== null)?.text ??
		null
	);
}

function endLines({ view, handles }: Context): string[] {
	const text = lastText(view.requests);
	if (!text)
		return [
			view.requestsIndexed
				? "END  none: the run's last request wrote no text"
				: "END  unknown: this run's requests are not indexed yet",
		];
	return [
		handles
			? `END  ${textId(text)} · ${quote(text.head)}`
			: `END  ${quote(text.head)}`,
	];
}

/** The id that opens a request's text: `r<record>`, `r<record>.<block>` past block 0. */
function textId(text: NonNullable<RunViewRequest["text"]>): string {
	return text.block === 0 ? `r${text.record}` : `r${text.record}.${text.block}`;
}

function nextLines({ view }: Context): string[] {
	const next = view.next;
	if (!next) return ["NEXT none: the last run of its stream"];
	return [
		`NEXT ${next.id} · user: ${quote(next.prompt)} · reaction: ${next.prompt === null ? "unknown" : nextPromptReaction(next.prompt)}`,
	];
}

function phaseLines({ view, phases, handles }: Context): string[] {
	if (!view.requestsIndexed)
		return [
			`phases unknown: this run's requests are not indexed yet (run index before version ${REQUESTS_SINCE_INDEX_VERSION})`,
		];
	return [
		row(
			handles ? "id" : "",
			"what happened",
			"requests",
			"time",
			"tokens",
			"cost",
		),
		...phases.map((phase) =>
			row(
				handles ? phase.id : "",
				phaseSummary(phase),
				String(phase.requests.length),
				minutes(
					sum(phase.requests, (request) => request.endedMs - request.startedMs),
				),
				tokens(knownSum(phase.requests, (request) => request.tokens)),
				cost(knownSum(phase.requests, (request) => request.costUsd)),
			),
		),
	];
}

/** The kind of work and its calls, most frequent first: `running checks: Bash test×2 (1 failed)`. */
function phaseSummary(phase: Phase<RunViewRequest>): string {
	const calls = phase.requests.flatMap((request) => request.calls);
	if (calls.length === 0) return phase.kind;
	const failed = calls.filter((call) => call.failed).length;
	return `${phase.kind}: ${countLabels(calls.map(callLabel))}${failed > 0 ? ` (${failed} failed)` : ""}`;
}

function callLabel(call: PhaseCall): string {
	return call.commandClass && call.commandClass !== "other"
		? `${call.tool} ${call.commandClass}`
		: call.tool;
}

function countLabels(labels: readonly string[]): string {
	const counts = new Map<string, number>();
	for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
	return [...counts]
		.sort((a, b) => b[1] - a[1])
		.map(([label, count]) => (count > 1 ? `${label}×${count}` : label))
		.join(", ");
}

function row(
	id: string,
	what: string,
	requests: string,
	time: string,
	tokenText: string,
	costText: string,
): string {
	return `${id.padEnd(4)} ${what.padEnd(44)} ${requests.padStart(8)}  ${time.padEnd(7)} ${tokenText.padStart(6)}  ${costText}`;
}

function quote(text: string | null): string {
	return text === null
		? "(not recorded)"
		: JSON.stringify(text.replace(/\s+/gu, " ").trim());
}

function minutes(ms: number): string {
	if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
	return `${Math.round(ms / 60_000)} min`;
}

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function duration(ms: number): string {
	return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : minutes(ms);
}

function tokens(count: number | null): string {
	if (count === null) return "–";
	if (count < 1_000) return String(count);
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

function cost(usd: number | null): string {
	return usd === null ? "cost unknown" : `$${usd.toFixed(2)}`;
}

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
	return items.reduce((total, item) => total + pick(item), 0);
}

/** The sum of the known values; null when none is known. */
function knownSum<T>(
	items: readonly T[],
	pick: (item: T) => number | null,
): number | null {
	const known = items.map(pick).filter((value) => value !== null);
	return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}
