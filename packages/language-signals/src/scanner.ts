import { LANGUAGE_SIGNAL_RULES, SWEAR_INTENSIFIED_POSITIVES } from "./rules.js";
import type {
	BuiltInLanguageSignalCategory,
	LanguageSignalMatch,
	ModelLanguageSignalMatch,
} from "./types.js";

interface CompiledSurface {
	readonly category: BuiltInLanguageSignalCategory;
	readonly ruleId: string;
	readonly source: string;
	readonly surfaceLength: number;
	readonly categoryPrecedence: number;
	readonly ruleOrder: number;
	readonly surfaceOrder: number;
	readonly lead: string | null;
}

const CATEGORY_PRECEDENCE: Readonly<
	Record<BuiltInLanguageSignalCategory, number>
> = {
	negative: 0,
	swear: 1,
	apology: 2,
	positive: 3,
};

const NEGATIVE_QUESTION_RUN: CompiledSurface = {
	category: "negative",
	ruleId: "negative.question-run",
	source: "(?<=\\p{L})\\?{2,}|\\?{2,}(?=[\\s]*$)",
	surfaceLength: 2,
	categoryPrecedence: CATEGORY_PRECEDENCE.negative,
	ruleOrder: -1,
	surfaceOrder: 0,
	lead: null,
};

const NEGATIVE_EXCLAMATION_RUN: CompiledSurface = {
	category: "negative",
	ruleId: "negative.exclamation-run",
	source: "!{2,}|\\?!|!\\?",
	surfaceLength: 2,
	categoryPrecedence: CATEGORY_PRECEDENCE.negative,
	ruleOrder: -1,
	surfaceOrder: 1,
	lead: null,
};

export const MAX_LANGUAGE_SIGNAL_MATCHES = 10_000;

const COMPILED_SURFACES = groupedByLead(
	LANGUAGE_SIGNAL_RULES.flatMap((rule, ruleOrder): CompiledSurface[] => [
		...rule.surfaces.map((surface, surfaceOrder) => ({
			category: rule.category,
			ruleId: rule.ruleId,
			source: compileSurfaceSource(surface),
			surfaceLength: surface.length,
			categoryPrecedence: CATEGORY_PRECEDENCE[rule.category],
			ruleOrder,
			surfaceOrder,
			lead: compileSurfaceSource(surface.slice(0, 1).toLowerCase()),
		})),
		...(rule.patterns ?? []).map((pattern, patternOrder) => ({
			category: rule.category,
			ruleId: rule.ruleId,
			source: pattern,
			surfaceLength: 0,
			categoryPrecedence: CATEGORY_PRECEDENCE[rule.category],
			ruleOrder,
			surfaceOrder: rule.surfaces.length + patternOrder,
			lead: null,
		})),
	]).sort(compareCompiledSurfaces),
);

export const LANGUAGE_SIGNAL_PATTERN = new RegExp(
	`(${NEGATIVE_QUESTION_RUN.source})|(${NEGATIVE_EXCLAMATION_RUN.source})|(?<![\\p{L}\\p{N}])${alternationSource(COMPILED_SURFACES, true)}(?![\\p{L}\\p{N}])`,
	"giu",
);

const NEGATED_POSITIVE_SOURCE = `(?:not|n['’]?t)\\s+(?:${COMPILED_SURFACES.filter(
	(surface) => surface.category === "positive",
)
	.map(({ source }) => source)
	.join("|")})`;

/**
 * Cheap check that a text could contain a match of one category: the
 * category's compiled surfaces without the word-boundary guards, plus the
 * surfaces that can turn into it (negated positives, swears next to praise),
 * so it can only over-match. Callers run the full scan only when it passes, which keeps
 * results identical while skipping texts that cannot match.
 */
const CATEGORY_PREFILTERS = new Map(
	(["negative", "swear", "apology", "positive"] as const).map((category) => [
		category,
		new RegExp(
			[
				...(category === "negative"
					? [
							NEGATIVE_QUESTION_RUN.source,
							NEGATIVE_EXCLAMATION_RUN.source,
							NEGATED_POSITIVE_SOURCE,
						]
					: []),
				...COMPILED_SURFACES.filter(
					(surface) =>
						surface.category === category ||
						(category === "positive" && surface.category === "swear"),
				).map(({ source }) => source),
			].join("|"),
			"iu",
		),
	]),
);

export function mayContainLanguageSignal(
	text: string,
	category: BuiltInLanguageSignalCategory,
): boolean {
	return CATEGORY_PREFILTERS.get(category)?.test(text) ?? false;
}

const ADJACENT_POSITIVE_NEGATION_PATTERN =
	/(?:do\s+not|don['’]?t|does\s+not|doesn['’]?t|did\s+not|didn['’]?t|not)\s+$/iu;
const POSITIVE_WORDS_SOURCE = `(?:${[
	...LANGUAGE_SIGNAL_RULES.filter(
		(rule) => rule.ruleId === "positive.praise",
	).flatMap((rule) => rule.surfaces),
	...SWEAR_INTENSIFIED_POSITIVES,
]
	.map(compileSurfaceSource)
	.join("|")})`;
const SWEAR_BEFORE_POSITIVE_PATTERN = new RegExp(
	`^[\\s,]+(?:(?:so|really|very|super|too)\\s+)?${POSITIVE_WORDS_SOURCE}(?![\\p{L}\\p{N}])`,
	"iu",
);
const POSITIVE_BEFORE_SWEAR_PATTERN = new RegExp(
	`(?<![\\p{L}\\p{N}])${POSITIVE_WORDS_SOURCE}\\s+(?:as\\s+)?$`,
	"iu",
);
const SYSTEM_INSTRUCTION_BLOCK_PATTERN =
	/<system_instruction>[\s\S]*?<\/system_instruction>/giu;

const QUOTED_TEXT_PATTERN = new RegExp(
	[
		"```[\\s\\S]*?```",
		"<([\\w-]+)(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1>",
		"`[^`\\n]+`",
		"^[ \\t]*>[^\\n]*",
		'"[^"\\n]{1,300}"',
		"“[^”\\n]{1,300}”",
		"\\[(?:Image|File|Attached image|Pasted text)\\b[^\\]\\n]*\\]",
	].join("|"),
	"gmu",
);

const LANGUAGE_SIGNAL_CANDIDATE_PATTERN = new RegExp(
	`${NEGATIVE_QUESTION_RUN.source}|${NEGATIVE_EXCLAMATION_RUN.source}|(?<![\\p{L}\\p{N}])${alternationSource(COMPILED_SURFACES, false)}`,
	"giu",
);
const LANGUAGE_SIGNAL_AT_PATTERN = new RegExp(
	LANGUAGE_SIGNAL_PATTERN.source,
	"iuy",
);

export function scanLanguageSignals(
	text: string,
): ReadonlyArray<LanguageSignalMatch> {
	const matches: LanguageSignalMatch[] = [];

	for (const match of languageSignalPatternMatches(text)) {
		const compiledSurface = findCompiledSurface(match);
		if (
			compiledSurface !== undefined &&
			!isSuppressed(text, match.index, compiledSurface, matches)
		) {
			matches.push(buildLanguageSignalMatch(text, match, compiledSurface));
		}

		if (matches.length >= MAX_LANGUAGE_SIGNAL_MATCHES) {
			break;
		}
	}

	return matches;
}

export function* languageSignalPatternMatches(
	text: string,
): Generator<RegExpExecArray> {
	const candidates = new RegExp(LANGUAGE_SIGNAL_CANDIDATE_PATTERN);
	const signalAt = new RegExp(LANGUAGE_SIGNAL_AT_PATTERN);
	let from = 0;
	while (from < text.length) {
		candidates.lastIndex = from;
		const candidate = candidates.exec(text);
		if (candidate === null) return;
		signalAt.lastIndex = candidate.index;
		const match = signalAt.exec(text);
		if (match === null) {
			from =
				candidate.index +
				((text.codePointAt(candidate.index) ?? 0) > 0xffff ? 2 : 1);
			continue;
		}
		yield match;
		from = match.index + match[0].length;
	}
}

export function scanMemberLanguageSignals(
	text: string,
): ReadonlyArray<LanguageSignalMatch> {
	const matches: LanguageSignalMatch[] = [];
	let cursor = 0;
	for (const quoted of text.matchAll(QUOTED_TEXT_PATTERN)) {
		appendSegmentMatches(matches, text.slice(cursor, quoted.index), cursor);
		cursor = quoted.index + quoted[0].length;
		if (matches.length >= MAX_LANGUAGE_SIGNAL_MATCHES) break;
	}
	appendSegmentMatches(matches, text.slice(cursor), cursor);
	return matches.slice(0, MAX_LANGUAGE_SIGNAL_MATCHES);
}

export function stripSystemInstructionBlocks(text: string) {
	return text.replace(SYSTEM_INSTRUCTION_BLOCK_PATTERN, "");
}

function appendSegmentMatches(
	matches: LanguageSignalMatch[],
	segment: string,
	offset: number,
) {
	if (segment.trim() === "") return;
	for (const match of scanLanguageSignals(segment)) {
		matches.push({
			...match,
			end: match.end + offset,
			start: match.start + offset,
		});
		if (matches.length >= MAX_LANGUAGE_SIGNAL_MATCHES) return;
	}
}

const ASKS_IF_UNDERSTOOD_PATTERN = /what\s+$/iu;

const PROBE_FOR_PROBLEMS_PATTERN =
	/(?:find|spot|see|notice|anything|something|what['’]?s|what\s+is|any)\s+(?:[\p{L}\p{N}]+\s+){0,2}$/iu;

function isSuppressed(
	text: string,
	index: number,
	compiledSurface: CompiledSurface,
	earlier: readonly LanguageSignalMatch[],
): boolean {
	switch (compiledSurface.ruleId) {
		case "negative.fishy":
			return PROBE_FOR_PROBLEMS_PATTERN.test(
				text.slice(Math.max(0, index - 40), index),
			);
		case "negative.again-alone":
			return !startsSentence(text, index);
		case "negative.correction-no":
		case "negative.correction-wrong-lead":
			return !startsClause(text, index);
		case "negative.correction-meant":
			return ASKS_IF_UNDERSTOOD_PATTERN.test(
				text.slice(Math.max(0, index - 20), index),
			);
		case "negative.exclamation-run":
			return followsPositiveInSentence(text, index, earlier);
		default:
			return false;
	}
}

function followsPositiveInSentence(
	text: string,
	index: number,
	earlier: readonly LanguageSignalMatch[],
): boolean {
	for (let at = earlier.length - 1; at >= 0; at--) {
		const match = earlier[at];
		if (match?.category === "positive")
			return !/[.?!\n]/u.test(text.slice(match.end, index));
	}
	return false;
}

function startsClause(text: string, index: number): boolean {
	for (let at = index - 1; at >= 0; at--) {
		const character = text[at] ?? "";
		if (/[.!?…\n]/u.test(character)) return true;
		if (!/\s/u.test(character)) return false;
	}
	return true;
}

function startsSentence(text: string, index: number): boolean {
	for (let at = index - 1; at >= 0; at--) {
		const character = text[at] ?? "";
		if (character === "." || character === "!" || character === "?")
			return true;
		if (!/\s/u.test(character)) return false;
	}
	return true;
}

function buildLanguageSignalMatch(
	text: string,
	match: RegExpExecArray,
	compiledSurface: CompiledSurface,
): LanguageSignalMatch {
	const negation =
		compiledSurface.category === "positive"
			? text
					.slice(0, match.index)
					.match(ADJACENT_POSITIVE_NEGATION_PATTERN)?.[0]
			: undefined;
	const start = match.index - (negation?.length ?? 0);
	const end = match.index + match[0].length;
	if (
		compiledSurface.category === "swear" &&
		(SWEAR_BEFORE_POSITIVE_PATTERN.test(text.slice(end, end + 40)) ||
			(compiledSurface.ruleId === "swear.as-fuck" &&
				POSITIVE_BEFORE_SWEAR_PATTERN.test(
					text.slice(Math.max(0, start - 40), start),
				)))
	)
		return {
			category: "positive",
			ruleId: "positive.swear-intensified",
			matchedText: text.slice(start, end),
			start,
			end,
		};

	return {
		category: negation === undefined ? compiledSurface.category : "negative",
		ruleId:
			negation === undefined
				? compiledSurface.ruleId
				: "negative.negated-positive",
		matchedText: text.slice(start, end),
		start,
		end,
	};
}

export function scanModelLanguageSignals(
	text: string,
): ReadonlyArray<ModelLanguageSignalMatch> {
	return scanLanguageSignals(text).filter(
		(match): match is ModelLanguageSignalMatch => match.category !== "positive",
	);
}

function findCompiledSurface(
	match: RegExpExecArray,
): CompiledSurface | undefined {
	if (match[1] !== undefined) {
		return NEGATIVE_QUESTION_RUN;
	}
	if (match[2] !== undefined) {
		return NEGATIVE_EXCLAMATION_RUN;
	}

	for (let captureIndex = 3; captureIndex < match.length; captureIndex += 1) {
		if (match[captureIndex] !== undefined) {
			return COMPILED_SURFACES[captureIndex - 3];
		}
	}

	return undefined;
}

function groupedByLead(
	surfaces: readonly CompiledSurface[],
): CompiledSurface[] {
	const groups = new Map<string | null, CompiledSurface[]>();
	for (const surface of surfaces) {
		const group = groups.get(surface.lead) ?? [];
		group.push(surface);
		groups.set(surface.lead, group);
	}
	const unled = groups.get(null) ?? [];
	groups.delete(null);
	return [...[...groups.values()].flat(), ...unled];
}

function alternationSource(
	surfaces: readonly CompiledSurface[],
	capture: boolean,
): string {
	const wrap = (source: string) => (capture ? `(${source})` : source);
	const branches: string[] = [];
	let index = 0;
	while (index < surfaces.length) {
		const lead = surfaces[index]?.lead ?? null;
		let end = index;
		while (end < surfaces.length && (surfaces[end]?.lead ?? null) === lead)
			end += 1;
		const group = surfaces.slice(index, end).map(({ source }) => wrap(source));
		if (lead === null) branches.push(...group);
		else branches.push(`(?=${lead})(?:${group.join("|")})`);
		index = end;
	}
	return `(?:${branches.join("|")})`;
}

function compareCompiledSurfaces(
	left: CompiledSurface,
	right: CompiledSurface,
): number {
	return (
		right.surfaceLength - left.surfaceLength ||
		left.categoryPrecedence - right.categoryPrecedence ||
		left.ruleOrder - right.ruleOrder ||
		left.surfaceOrder - right.surfaceOrder
	);
}

function compileSurfaceSource(surface: string): string {
	let source = "";
	let previousWasWhitespace = false;

	for (const character of surface) {
		if (/\s/u.test(character)) {
			if (!previousWasWhitespace) {
				source += "\\s+";
			}
			previousWasWhitespace = true;
			continue;
		}

		previousWasWhitespace = false;
		if (character === "'" || character === "’") {
			source += "['’]";
			continue;
		}

		source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	return source;
}
