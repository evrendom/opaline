import type { MomentKind, SessionDetailTurnSummary } from "@rudel/api-routes";
import { useMemo } from "react";
import { MOMENT_KINDS_APPEARANCE } from "@/features/compass/moment-labels";
import { shortRunId } from "@/features/sessions/run-id";
import {
	getReaderAgentMessages,
	getReaderWaterfall,
	type SessionReaderBody,
} from "../model/session-reader-model";
import { flattenSteps } from "../model/session-reader-run-steps";
import { apologySnippets } from "../summary/session-reader-said";
import {
	errorTypesOf,
	type RunCall,
} from "../summary/session-reader-summary-errors";
import {
	messageLabelOf,
	placeOf,
	promptLabelOf,
	YOU_KEY,
} from "./session-reader-context-collect";
import type { ContextPart } from "./session-reader-context-map";
import type { ContextMeasure } from "./session-reader-context-measure";

export const TYPES = [
	{ key: "stuck", label: "Stuck", words: "stuck" },
	{ key: "never", label: "Never worked again", words: "never worked again" },
	{ key: "later", label: "Worked again later", words: "back later" },
	{ key: "quick", label: "Fixed right away", words: "fixed right away" },
	{ key: "blocked", label: "Blocked or declined", words: "blocked" },
	{ key: "exit", label: "Exit code only", words: "exit code only" },
] as const;

export type TypeKey = (typeof TYPES)[number]["key"];

const rank = (key: TypeKey) => TYPES.findIndex((type) => type.key === key);

export type Tone = "later" | "minor" | "never";

const TONE_RANK: readonly Tone[] = ["never", "later", "minor"];

const worse = (a: Tone, b: Tone) =>
	TONE_RANK.indexOf(a) < TONE_RANK.indexOf(b) ? a : b;

export const toneOf = (key: TypeKey): Tone =>
	key === "stuck" || key === "never"
		? "never"
		: key === "later"
			? "later"
			: "minor";

const FLAG_BOX: Partial<Record<MomentKind, string>> = {
	edit_churn: "files:edit",
	git_reverted: "program:git",
	interrupted: YOU_KEY,
	mid_run_redirect: YOU_KEY,
	model_apology: "model:messages",
	search_before_edit: "files:read",
	user_frustrated: YOU_KEY,
};

const RUN_FLAGS: ReadonlySet<MomentKind> = new Set([
	"expensive_run",
	"long_run",
]);

export type RunFlags = ReadonlyMap<string, readonly MomentKind[]>;

export type InRun = {
	calls: Map<TypeKey, RunCall[]>;
	flags: MomentKind[];
	frustrated: SessionDetailTurnSummary | null;
};

export type BoxProblems = {
	count: number;
	headline: string;
	items: Map<string, Tone>;
	runs: Map<string, InRun>;
	strokes: MomentKind[];
	tone: Tone;
};

const label = (kind: MomentKind) => MOMENT_KINDS_APPEARANCE[kind].label;

export function problemsByBox(
	runs: readonly { body: SessionReaderBody; turn: SessionDetailTurnSummary }[],
	flags: RunFlags,
	model: string | null,
): Map<string, BoxProblems> {
	const boxes = new Map<string, BoxProblems>();
	const tools = new Map<
		string,
		Map<string, { count: number; worst: TypeKey }>
	>();
	const runIn = (key: string, turnId: string): [BoxProblems, InRun] => {
		const box = boxes.get(key) ?? {
			count: 0,
			headline: "",
			items: new Map(),
			runs: new Map(),
			strokes: [],
			tone: "minor",
		};
		boxes.set(key, box);
		const run = box.runs.get(turnId) ?? {
			calls: new Map(),
			flags: [],
			frustrated: null,
		};
		box.runs.set(turnId, run);
		return [box, run];
	};
	const failIn = (
		key: string,
		turnId: string,
		typeKey: TypeKey,
		call: RunCall,
		items: readonly string[],
	) => {
		const [box, run] = runIn(key, turnId);
		for (const item of items)
			box.items.set(
				item,
				worse(box.items.get(item) ?? "minor", toneOf(typeKey)),
			);
		run.calls.set(typeKey, [...(run.calls.get(typeKey) ?? []), call]);
		box.count += 1;
		box.tone = worse(box.tone, toneOf(typeKey));
		const name = call.shown.name.replace(/^[^:\s]+:/u, "");
		const inBox = tools.get(key) ?? new Map();
		const tool = inBox.get(name) ?? { count: 0, worst: typeKey };
		tool.count += 1;
		if (rank(typeKey) < rank(tool.worst)) tool.worst = typeKey;
		inBox.set(name, tool);
		tools.set(key, inBox);
	};
	const flagIn = (
		key: string,
		turn: SessionDetailTurnSummary,
		kind: MomentKind,
	) => {
		const [box, run] = runIn(key, turn.turnId);
		if (run.flags.includes(kind)) return;
		run.flags.push(kind);
		if (kind === "user_frustrated") {
			run.frustrated = turn;
			if (key === YOU_KEY)
				box.items.set(promptLabelOf(turn.userPreview), "never");
		}
		box.count += 1;
		box.tone = worse(box.tone, kind === "user_frustrated" ? "never" : "later");
	};
	for (const { body, turn } of runs) {
		const waterfall = getReaderWaterfall(body, turn, model);
		for (const kind of flags.get(turn.turnId) ?? []) {
			flagIn(`run:${turn.turnId}`, turn, kind);
			if (RUN_FLAGS.has(kind)) {
				const box = boxes.get(`run:${turn.turnId}`);
				if (box && !box.strokes.includes(kind)) box.strokes.push(kind);
			} else flagIn(FLAG_BOX[kind] ?? `flag:${kind}`, turn, kind);
			if (kind === "model_apology") {
				const box = boxes.get("model:messages");
				for (const text of getReaderAgentMessages(body)) {
					const label = messageLabelOf(text);
					if (box && label && apologySnippets([text]).length > 0)
						box.items.set(
							label,
							worse(box.items.get(label) ?? "minor", "later"),
						);
				}
			}
		}
		const types = errorTypesOf(body, turn.turnId);
		if (types.length === 0) continue;
		const steps = new Map(
			flattenSteps(waterfall?.steps ?? []).map((step) => [step.id, step]),
		);
		for (const type of types)
			for (const each of type.what)
				for (const call of each.calls) {
					const typeKey = type.key as TypeKey;
					const step = steps.get(call.step);
					const place = step ? placeOf(step) : null;
					failIn(
						`run:${turn.turnId}`,
						turn.turnId,
						typeKey,
						call,
						place ? [place.label] : [],
					);
					if (place) failIn(place.key, turn.turnId, typeKey, call, place.items);
				}
	}
	for (const [key, box] of boxes) {
		const kinds = [
			...new Set([...box.runs.values()].flatMap((run) => run.flags)),
		];
		const [name, worst] =
			[...(tools.get(key) ?? [])].sort(
				([, a], [, b]) => rank(a.worst) - rank(b.worst) || b.count - a.count,
			)[0] ?? [];
		const said = [
			...(key === YOU_KEY && kinds.includes("user_frustrated")
				? [
						`${box.runs.size} frustrated ${box.runs.size === 1 ? "prompt" : "prompts"}`,
					]
				: kinds.map(label)),
			...(name && worst
				? [`${name} ${TYPES[rank(worst.worst)]?.words} ×${worst.count}`]
				: []),
		];
		if (key.startsWith("flag:"))
			said.push([...box.runs.keys()].map(shortRunId).join(", "));
		box.headline = said.join(" · ");
	}
	return boxes;
}

export function problemsOf(
	problems: ReadonlyMap<string, BoxProblems> | undefined,
	part: Pick<ContextPart, "folded" | "key"> | null | undefined,
): BoxProblems | undefined {
	if (!part || !problems) return undefined;
	const own = (key: string) =>
		problems.get(key.replace(/^(?:compacted|earlier):/u, ""));
	const found = (part.folded ?? [part.key])
		.map(own)
		.filter((each): each is BoxProblems => each !== undefined);
	if (found.length <= 1) return found[0];
	const sorted = [...found].sort(
		(a, b) => TONE_RANK.indexOf(a.tone) - TONE_RANK.indexOf(b.tone),
	);
	return {
		count: sorted.reduce((sum, each) => sum + each.count, 0),
		headline: sorted[0]?.headline ?? "",
		items: new Map(sorted.flatMap((each) => [...each.items])),
		runs: new Map(sorted.flatMap((each) => [...each.runs])),
		strokes: [...new Set(sorted.flatMap((each) => each.strokes))],
		tone: sorted[0]?.tone ?? "minor",
	};
}

export function useOwnProblems(
	problems: ReadonlyMap<string, BoxProblems> | undefined,
	measure: ContextMeasure,
) {
	const byRun = measure === "runs";
	return useMemo(() => {
		const own = [...(problems ?? [])].filter(
			([key]) => key.startsWith("run:") === byRun,
		);
		return { keep: new Set(own.map(([key]) => key)), own };
	}, [byRun, problems]);
}
