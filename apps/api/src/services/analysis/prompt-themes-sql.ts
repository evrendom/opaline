import {
	inPicked,
	type MeasureParams,
	pickedCte,
	sqlString,
	windowStart,
} from "./retro-measure-sql.js";
import { regexLiteral } from "./sql-measures.js";

export const THEME_MIN_SESSIONS = 3;
export const THEME_MIN_PROMPTS = 3;
const PROMPT_CHARS = 4000;
const BODY_CHARS = 600;
const LINE_CHARS = 500;
const PROSE_SHARE = 0.6;
const MAX_TOKENS = 120;
const OPENING_WORDS = 2;
const GRAM_SIZES = [2, 3, 4] as const;
const NESTED_SHARE = 0.8;
const TEMPLATE_WORDS = 4;
const TEMPLATE_HEAD = 300;
const TEMPLATE_CHARS = 1500;
const TEMPLATE_MIN_SESSIONS = 2;

const CODE_BLOCK = /```[\s\S]*?(?:```|$)/;
const TAG_BLOCK = /<([a-z][\w:-]*)[^>]{0,200}>[\s\S]*?<\/[a-z][\w:-]*>/i;
const LONE_TAG = /<\/?[a-z][\w:-]*[^>]{0,200}>/i;
const MARKER = /\[(?:image|pasted|attachment|file)[^\]]{0,200}\]/i;
const LOG_LINE =
	/^\s*(?:at\s+\S|[│├└╭╰┌┐┘┴┬─▶❯✓✗✔✘×⎿$>|]|\d{4}-\d{2}-\d{2}[T ]\d|\[\d|(?:error|warn|warning|info|debug|trace|fatal)\b\s*[:[])|\b\d{1,2}:\d{2}:\d{2}\b|\S+\.\w{1,5}:\d+/i;
const LINK_OR_PATH = /https?:\/\/\S+|\S*[/\\=@#]\S*/;
const WORD = /\p{L}[\p{L}'’]*/u;
const STRUCTURED = /^\s*[^\p{L}\s]/u;
const TEMPLATE_PATH = /\S*[/\\]\S*/;
const DIGITS = /\d+/;
const HEADING = /(?:^[ \t]{0,3}#{1,6}|[ \t]#{2,6})[ \t]+\S[^\n]{0,200}/m;
const FROM_HEADING = /(?:^[ \t]{0,3}#{1,6}|[ \t]#{2,6})[ \t][\s\S]*/m;
const LEADING_PATHS = /^\s*(?:\S*[/\\]\S*\s*)+/;

export const THEME_LEAD_WORDS = [
	"ok",
	"okay",
	"k",
	"now",
	"so",
	"and",
	"but",
	"also",
	"then",
	"pls",
	"plz",
	"please",
	"hey",
	"hi",
	"yes",
	"yeah",
	"yep",
	"great",
	"nice",
	"cool",
	"good",
	"perfect",
	"alright",
	"hmm",
	"well",
	"right",
	"thanks",
	"thank",
	"awesome",
	"oh",
];

export const THEME_EDGE_WORDS = [
	"a",
	"an",
	"the",
	"and",
	"or",
	"but",
	"of",
	"to",
	"so",
	"then",
	"with",
	"for",
	"at",
	"by",
	"from",
	"as",
	"if",
	"is",
	"was",
	"be",
	"it",
	"its",
	"it's",
	"that",
	"this",
];

export const THEME_PLAIN_WORDS: readonly string[] = [
	...new Set([
		...THEME_EDGE_WORDS,
		...THEME_LEAD_WORDS,
		"i",
		"i'm",
		"im",
		"i'll",
		"you",
		"u",
		"ur",
		"we",
		"me",
		"my",
		"your",
		"our",
		"us",
		"they",
		"them",
		"he",
		"she",
		"in",
		"on",
		"up",
		"out",
		"into",
		"about",
		"are",
		"were",
		"been",
		"am",
		"do",
		"does",
		"did",
		"done",
		"don't",
		"dont",
		"can",
		"can't",
		"cant",
		"could",
		"would",
		"should",
		"will",
		"won't",
		"have",
		"has",
		"had",
		"not",
		"no",
		"what",
		"what's",
		"whats",
		"how",
		"why",
		"when",
		"where",
		"which",
		"who",
		"there",
		"here",
		"these",
		"those",
		"all",
		"any",
		"some",
		"more",
		"just",
		"like",
		"want",
		"need",
		"get",
		"got",
		"make",
		"let",
		"let's",
		"lets",
		"see",
		"look",
		"know",
		"think",
		"thing",
		"things",
		"something",
		"one",
		"way",
		"still",
		"even",
		"really",
		"very",
		"much",
		"dude",
		"bro",
		"man",
		"tho",
		"though",
		"kinda",
		"gonna",
		"wanna",
		"lol",
		"use",
		"try",
		"only",
		"too",
		"go",
		"add",
		"remove",
		"change",
		"fix",
		"show",
		"tell",
		"give",
		"check",
		"keep",
		"put",
		"move",
		"update",
		"create",
		"find",
		"run",
		"help",
		"explain",
		"mean",
		"meant",
		"say",
		"said",
		"work",
		"works",
		"working",
		"based",
		"instead",
		"rather",
		"wanted",
		"love",
		"feel",
		"must",
		"same",
		"each",
		"other",
		"every",
		"single",
		"matter",
		"many",
		"happens",
		"happen",
		"going",
		"looks",
		"between",
		"within",
		"new",
		"else",
		"everything",
		"anything",
		"again",
		"than",
		"id",
		"ive",
		"thats",
		"theres",
	]),
];

const STOP = new Set(THEME_PLAIN_WORDS);
const EDGE = new Set(THEME_EDGE_WORDS);
const LEAD = new Set(THEME_LEAD_WORDS);

const global = (pattern: RegExp) =>
	new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);

function isProse(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed === "" || [...trimmed].length > LINE_CHARS) return false;
	if (LOG_LINE.test(line)) return false;
	const letters = trimmed.replace(/[^\p{L}\s]/gu, "");
	return [...letters].length >= PROSE_SHARE * [...trimmed].length;
}

export function promptBody(text: string): string {
	const stripped = [CODE_BLOCK, TAG_BLOCK, LONE_TAG, MARKER].reduce(
		(inner, pattern) => inner.replace(global(pattern), " "),
		[...text].slice(0, PROMPT_CHARS).join("").replace(FROM_HEADING, " "),
	);
	return [
		...stripped
			.split("\n")
			.filter(isProse)
			.join(" ")
			.replace(/\s+/gu, " ")
			.trim(),
	]
		.slice(0, BODY_CHARS)
		.join("");
}

export function promptTokens(body: string): string[] {
	return (
		body.toLowerCase().replace(global(LINK_OR_PATH), " ").match(global(WORD)) ??
		[]
	)
		.map((word) => word.replaceAll("’", "'"))
		.slice(0, MAX_TOKENS);
}

const isContent = (word: string) => !STOP.has(word) && [...word].length >= 2;

export function promptOpening(tokens: readonly string[]): string {
	const start = tokens.findIndex((word) => !LEAD.has(word));
	if (start < 0) return "";
	const words = tokens.slice(start, start + OPENING_WORDS);
	return words.some(isContent) ? words.join(" ") : "";
}

export function promptPhrases(tokens: readonly string[]): string[] {
	const phrases = new Set<string>();
	for (const size of GRAM_SIZES)
		for (let index = 0; index + size <= tokens.length; index++) {
			const words = tokens.slice(index, index + size);
			if (EDGE.has(words[0] ?? "") || EDGE.has(words[size - 1] ?? "")) continue;
			if (!words.some(isContent)) continue;
			phrases.add(words.join(" "));
		}
	return [...phrases];
}

function openingKey(text: string): string {
	const head = [...text]
		.slice(0, TEMPLATE_HEAD)
		.join("")
		.toLowerCase()
		.replace(global(TEMPLATE_PATH), "<path>")
		.replace(global(DIGITS), "n");
	return head.split(/\s+/u).filter(Boolean).slice(0, TEMPLATE_WORDS).join(" ");
}

const unwrapped = (text: string) =>
	text.replace(global(MARKER), " ").replace(LEADING_PATHS, "");

export function templateKeys(text: string): { block: string; whole: string } {
	return {
		block: openingKey(HEADING.exec(text)?.[0] ?? ""),
		whole: openingKey(unwrapped(text)),
	};
}

export interface ThemePrompt {
	readonly session: string;
	readonly text: string;
}

export interface Theme {
	readonly key: string;
	readonly sessions: number;
	readonly prompts: number;
}

export function promptThemes(prompts: readonly ThemePrompt[]): Theme[] {
	type Seen = { prompts: number; sessions: Set<string>; chars: number };
	const tally = (into: Map<string, Seen>, key: string, prompt: ThemePrompt) => {
		const seen = into.get(key) ?? { prompts: 0, sessions: new Set(), chars: 0 };
		seen.prompts += 1;
		seen.sessions.add(prompt.session);
		seen.chars += [...prompt.text].length;
		into.set(key, seen);
	};
	const blocks = new Map<string, Seen>();
	const wholes = new Map<string, Seen>();
	for (const prompt of prompts) {
		const keys = templateKeys(prompt.text);
		tally(blocks, keys.block, prompt);
		tally(wholes, keys.whole, prompt);
	}
	const recurs = (seen: Seen | undefined) =>
		seen !== undefined &&
		seen.prompts >= THEME_MIN_PROMPTS &&
		seen.sessions.size >= TEMPLATE_MIN_SESSIONS;
	const hits = new Map<string, { sessions: Set<string>; prompts: number }>();
	for (const prompt of prompts) {
		const { block, whole } = templateKeys(prompt.text);
		const isBlock = block !== "" && recurs(blocks.get(block));
		const wholeSeen = wholes.get(whole);
		const isWhole =
			!isBlock &&
			whole !== "" &&
			recurs(wholeSeen) &&
			(STRUCTURED.test(unwrapped(prompt.text)) ||
				(wholeSeen?.chars ?? 0) / (wholeSeen?.prompts ?? 1) >= TEMPLATE_CHARS);
		const tokens = promptTokens(promptBody(prompt.text));
		const opening = promptOpening(tokens);
		const keys = [
			...(isBlock ? [`template|${block}`] : []),
			...(isWhole ? [`template|${whole}`] : []),
			...(isWhole
				? []
				: [
						...(opening ? [`open|${opening}`] : []),
						...promptPhrases(tokens).map((phrase) => `phrase|${phrase}`),
					]),
		];
		for (const key of keys) {
			const seen = hits.get(key) ?? { sessions: new Set<string>(), prompts: 0 };
			seen.sessions.add(prompt.session);
			seen.prompts += 1;
			hits.set(key, seen);
		}
	}
	const kept = [...hits].filter(
		([, seen]) =>
			seen.sessions.size >= THEME_MIN_SESSIONS &&
			seen.prompts >= THEME_MIN_PROMPTS,
	);
	const covered = new Map<string, number>();
	for (const [key, seen] of kept) {
		const [kind, text = ""] = key.split("|");
		const words = text.split(" ");
		const subs =
			kind === "open"
				? [words]
				: kind === "phrase" && words.length >= 3
					? [words.slice(0, -1), words.slice(1)]
					: [];
		for (const sub of subs) {
			const name = `phrase|${sub.join(" ")}`;
			covered.set(name, Math.max(covered.get(name) ?? 0, seen.prompts));
		}
	}
	return kept
		.filter(
			([key, seen]) => (covered.get(key) ?? 0) < NESTED_SHARE * seen.prompts,
		)
		.map(([key, seen]) => ({
			key,
			sessions: seen.sessions.size,
			prompts: seen.prompts,
		}))
		.sort(
			(a, b) =>
				b.sessions - a.sessions ||
				b.prompts - a.prompts ||
				a.key.localeCompare(b.key),
		);
}

const sqlArray = (values: readonly string[]) =>
	`[${values.map(sqlString).join(", ")}]`;

function re2(pattern: RegExp): string {
	return pattern.flags.includes("m")
		? sqlString(`(?m)${pattern.source}`)
		: regexLiteral(pattern);
}

export function promptBodySql(text: string): string {
	const stripped = [CODE_BLOCK, TAG_BLOCK, LONE_TAG, MARKER].reduce(
		(inner, pattern) =>
			`replaceRegexpAll(${inner}, ${regexLiteral(pattern)}, ' ')`,
		`replaceRegexpOne(substringUTF8(${text}, 1, ${PROMPT_CHARS}), ${re2(FROM_HEADING)}, ' ')`,
	);
	const prose = `l -> trimBoth(l) != '' AND lengthUTF8(trimBoth(l)) <= ${LINE_CHARS}
				AND NOT match(l, ${regexLiteral(LOG_LINE)})
				AND lengthUTF8(replaceRegexpAll(trimBoth(l), '[^\\\\p{L}\\\\s]', '')) >= ${PROSE_SHARE} * lengthUTF8(trimBoth(l))`;
	return `substringUTF8(trimBoth(replaceRegexpAll(arrayStringConcat(arrayFilter(${prose}, splitByChar('\\n', ${stripped})), ' '), '\\\\s+', ' ')), 1, ${BODY_CHARS})`;
}

export function promptTokensSql(body: string): string {
	return `arraySlice(arrayMap(w -> replaceAll(w, '’', '\\''), extractAll(replaceRegexpAll(lowerUTF8(${body}), ${regexLiteral(LINK_OR_PATH)}, ' '), ${regexLiteral(WORD)})), 1, ${MAX_TOKENS})`;
}

function flagsSql(tokens: string): string {
	return `arrayMap(w -> NOT has(${sqlArray(THEME_PLAIN_WORDS)}, w) AND lengthUTF8(w) >= 2, ${tokens}) AS strong,
				arrayMap(w -> has(${sqlArray(THEME_EDGE_WORDS)}, w), ${tokens}) AS edge,
				arrayFirstIndex(w -> NOT has(${sqlArray(THEME_LEAD_WORDS)}, w), ${tokens}) AS lead`;
}

function openingSql(tokens: string): string {
	const last = `least(lead + ${OPENING_WORDS - 1}, length(${tokens}))`;
	return `if(lead > 0 AND arrayExists(x -> x, arraySlice(strong, lead, ${OPENING_WORDS})),
				arrayStringConcat(arraySlice(${tokens}, lead, ${last} - lead + 1), ' '), '')`;
}

function phrasesSql(tokens: string): string {
	const at = (size: number) =>
		`arrayMap(i -> if(NOT edge[i] AND NOT edge[i + ${size - 1}] AND arrayExists(x -> x, arraySlice(strong, i, ${size})),
				arrayStringConcat(arraySlice(${tokens}, i, ${size}), ' '), ''), range(1, toUInt32(greatest(length(${tokens}) - ${size - 2}, 1))))`;
	return `arrayDistinct(arrayFilter(g -> g != '', arrayConcat(${GRAM_SIZES.map(at).join(", ")})))`;
}

function openingKeySql(text: string): string {
	const head = `replaceRegexpAll(replaceRegexpAll(lowerUTF8(substringUTF8(${text}, 1, ${TEMPLATE_HEAD})), ${regexLiteral(TEMPLATE_PATH)}, '<path>'), ${regexLiteral(DIGITS)}, 'n')`;
	return `arrayStringConcat(arraySlice(splitByWhitespace(${head}), 1, ${TEMPLATE_WORDS}), ' ')`;
}

const words = (key: string) => `substring(${key}, position(${key}, '|') + 1)`;

export function themeCtes(params: MeasureParams): string[] {
	return [
		pickedCte(params),
		`th_prompts AS (
		SELECT user_id AS uid, session_id AS sid, run_id AS rid, turn_idx AS turn, at, text_chars AS chars,
			substringUTF8(text, 1, ${PROMPT_CHARS}) AS raw
		FROM prompts
		WHERE at >= ${windowStart(params)} AND genuine = 1 AND agent_id = '' AND run_id != '' AND ${inPicked()}
	)`,
		`th_marked AS (
		SELECT *, ${promptBodySql("raw")} AS body, ${openingKeySql(`extract(raw, ${re2(HEADING)})`)} AS bkey,
			${openingKeySql("unwrapped")} AS wkey, toUInt8(match(unwrapped, ${regexLiteral(STRUCTURED)})) AS structured,
			count() OVER (PARTITION BY bkey) AS b_prompts, uniqExact(sid) OVER (PARTITION BY bkey) AS b_sessions,
			count() OVER (PARTITION BY wkey) AS w_prompts, uniqExact(sid) OVER (PARTITION BY wkey) AS w_sessions,
			sum(chars) OVER (PARTITION BY wkey) AS w_chars
		FROM (SELECT *, replaceRegexpOne(replaceRegexpAll(raw, ${regexLiteral(MARKER)}, ' '), ${regexLiteral(LEADING_PATHS)}, '') AS unwrapped FROM th_prompts)
	)`,
		`th_keys AS (
		SELECT uid, sid, rid, turn, at, body, raw,
			arrayConcat(if(block, [concat('template|', bkey)], []), if(whole, [concat('template|', wkey)], []),
				if(whole, [], arrayConcat(if(opening != '', [concat('open|', opening)], []),
					arrayMap(g -> concat('phrase|', g), phrases)))) AS keys
		FROM (
			SELECT *, bkey != '' AND b_prompts >= ${THEME_MIN_PROMPTS} AND b_sessions >= ${TEMPLATE_MIN_SESSIONS} AS block,
				NOT block AND wkey != '' AND w_prompts >= ${THEME_MIN_PROMPTS} AND w_sessions >= ${TEMPLATE_MIN_SESSIONS}
					AND (structured = 1 OR w_chars >= ${TEMPLATE_CHARS} * w_prompts) AS whole
			FROM (
			SELECT *, ${openingSql("tok")} AS opening, ${phrasesSql("tok")} AS phrases
			FROM (SELECT *, ${flagsSql("tok")} FROM (SELECT *, ${promptTokensSql("body")} AS tok FROM th_marked))
			)
		)
	)`,
		`th_hits AS (
		SELECT uid, sid, rid, turn, at, body, raw, key FROM th_keys ARRAY JOIN keys AS key
	)`,
		`th_stats AS (
		SELECT key, uniqExact(sid) AS sessions, count() AS prompts
		FROM th_hits
		GROUP BY key
		HAVING sessions >= ${THEME_MIN_SESSIONS} AND prompts >= ${THEME_MIN_PROMPTS}
	)`,
		`th_nested AS (
		SELECT sub, max(prompts) AS covering
		FROM (
			SELECT prompts, arrayJoin(if(startsWith(key, 'open|'), [concat('phrase|', ${words("key")})],
				if(startsWith(key, 'phrase|') AND length(splitByChar(' ', ${words("key")})) >= 3,
					[concat('phrase|', arrayStringConcat(arrayPopBack(splitByChar(' ', ${words("key")})), ' ')),
						concat('phrase|', arrayStringConcat(arrayPopFront(splitByChar(' ', ${words("key")})), ' '))],
					CAST([], 'Array(String)')))) AS sub
			FROM th_stats
		)
		GROUP BY sub
	)`,
		`th_kept AS (
		SELECT s.key AS key FROM th_stats AS s
		LEFT JOIN th_nested AS n ON n.sub = s.key
		WHERE ifNull(n.covering, 0) < ${NESTED_SHARE} * s.prompts
	)`,
		`th_before AS (
		SELECT user_id AS uid, session_id AS sid, turn_idx + 1 AS next_turn, toUInt8(1) AS known,
			toUInt8(ifNull(said_done, false)) AS said, interrupt_markers AS intr, failed_calls AS fails,
			substringUTF8(trimBoth(replaceRegexpAll(ifNull(final_message, ''), '\\\\s+', ' ')), 1, 90) AS fin
		FROM runs
		WHERE agent_id = '' AND ${inPicked()}
	)`,
		`th_ev AS (
		SELECT h.uid AS uid, h.sid AS sid, 'theme' AS kind,
			multiIf(startsWith(h.key, 'template|'), 'template', startsWith(h.key, 'open|'), 'opening', 'phrase') AS sub,
			h.key AS key,
			multiIf(sub = 'template', concat('prompts holding templated text "', ${words("h.key")}, '…"'),
				sub = 'opening', concat('prompts that open "', ${words("h.key")}, '"'),
				concat('prompts that say "', ${words("h.key")}, '"')) AS signature,
			${words("h.key")} AS target, h.rid AS rid, '' AS aid, toUInt32(h.turn) AS turn,
			toDateTime64(h.at, 3, 'UTC') AS at, toFloat64(0) AS cm,
			substringUTF8(concat(if(h.body = '', substringUTF8(replaceRegexpAll(h.raw, '\\\\s+', ' '), 1, 120), substringUTF8(h.body, 1, 160)),
				' ← after ', multiIf(b.known = 0, 'the session start', b.intr > 0, 'an interrupt',
					b.said = 1, concat('said done: "', b.fin, '"'),
					b.fails > 0, concat(toString(b.fails), ' failed calls', if(b.fin != '', concat(', "', b.fin, '"'), '')),
					b.fin != '', concat('"', b.fin, '"'), 'no final message')), 1, 280) AS line,
			toUInt8(0) AS mech, toUInt32(1) AS hits, '' AS variant
		FROM th_hits AS h
		INNER JOIN th_kept AS k ON k.key = h.key
		LEFT JOIN th_before AS b ON b.uid = h.uid AND b.sid = h.sid AND b.next_turn = h.turn
	)`,
	];
}
