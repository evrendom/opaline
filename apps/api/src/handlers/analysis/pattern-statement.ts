import {
	type AnalysisSqlOutput,
	PATTERN_KINDS,
	type PatternKind,
	type PatternsDrillInput,
	type PatternsListInput,
	type PatternsVerifyInput,
} from "@rudel/api-routes";
import {
	PATTERN_DETAILS,
	PATTERN_MIN_SESSIONS,
	type PatternFamily,
	patternDrillSql,
	patternFamilies,
	patternKindOf,
	patternsListSql,
	patternsVerifySql,
	SESSION_IDS,
	SHARDED_FAMILIES,
	shardWindows,
} from "../../services/analysis/patterns-sql.js";
import type { MeasureParams } from "../../services/analysis/retro-measure-sql.js";
import {
	cohortSelect,
	measureHash,
	measureParams,
} from "../../services/analysis/retro-measures.js";
import type { SqlParts } from "../../services/analysis/sql-gateway.js";
import { badRequest } from "./measure-statement.js";

export type PatternRequest =
	| ({ action: "list" } & PatternsListInput)
	| ({ action: "drill" } & PatternsDrillInput)
	| ({ action: "verify" } & PatternsVerifyInput);

export const PATTERNS_MEASURE = "patterns";

type Row = Record<string, unknown>;

const number = (value: unknown) => Number(value ?? 0) || 0;

export const PATTERN_SECTIONS: readonly (readonly PatternKind[])[] = [
	["failing_call", "retry_loop", "wrong_route"],
	["incomplete"],
	["correction"],
	["theme"],
];

const sectionOf = (row: Row) =>
	Math.max(
		0,
		PATTERN_SECTIONS.findIndex((kinds) =>
			kinds.includes(String(row.kind) as PatternKind),
		),
	);

function byRank(left: Row, right: Row): number {
	return (
		number(right.sessions) - number(left.sessions) ||
		number(right.minutes) - number(left.minutes) ||
		number(right.count) - number(left.count) ||
		String(left.id).localeCompare(String(right.id))
	);
}

function ranked(rows: Row[], limit: number): Row[] {
	return [...rows].sort(byRank).slice(0, limit);
}

export function sideSectionRows(limit: number): number {
	return Math.max(3, Math.ceil(limit / 5));
}

export function sectionedRows(rows: Row[], limit: number): Row[] {
	const sections = PATTERN_SECTIONS.map((_, index) =>
		rows.filter((row) => sectionOf(row) === index).sort(byRank),
	).filter((section) => section.length > 0);
	if (sections.length <= 1) return (sections[0] ?? []).slice(0, limit);
	return sections.flatMap((section) =>
		section.slice(
			0,
			sectionOf(section[0] ?? {}) === 0 ? limit : sideSectionRows(limit),
		),
	);
}

const VARIANT = /^(\d+)× (.*)$/su;

export function mergeDetail(left: unknown, right: unknown): string[] {
	const lines = [...list(left), ...list(right)];
	if (!lines.every((line) => VARIANT.test(line)))
		return lines.slice(0, PATTERN_DETAILS);
	const counts = new Map<string, number>();
	for (const line of lines) {
		const [, count = "0", text = ""] = VARIANT.exec(line) ?? [];
		counts.set(text, (counts.get(text) ?? 0) + Number(count));
	}
	return [...counts]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, PATTERN_DETAILS)
		.map(([text, count]) => `${count}× ${text}`);
}

function list(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String);
	try {
		const parsed = JSON.parse(String(value ?? "[]"));
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

function weekly(left: unknown, right: unknown): string {
	const a = String(left ?? "").split(" ");
	const b = String(right ?? "").split(" ");
	return Array.from({ length: Math.max(a.length, b.length) }, (_, index) =>
		String(number(a[index]) + number(b[index])),
	).join(" ");
}

export function mergePatternRows(
	rows: Row[],
	minCount: number,
	limit: number,
	minSessions = PATTERN_MIN_SESSIONS,
): Row[] {
	const byId = new Map<string, Row>();
	const sessionsOf = new Map<string, Set<string>>();
	const membersOf = new Map<string, Set<string>>();
	const cutKinds = new Set<string>();
	const fullSessions = new Set<string>();
	const union = (into: Map<string, Set<string>>, id: string, ids: unknown) => {
		const known = into.get(id) ?? new Set<string>();
		for (const value of list(ids)) known.add(value);
		into.set(id, known);
		return known;
	};
	for (const row of rows) {
		const id = String(row.id);
		if (number(row.kind_cut) === 1 || row.kind_cut === true)
			cutKinds.add(String(row.kind));
		if (list(row.sids).length >= SESSION_IDS) fullSessions.add(id);
		const seen = byId.get(id);
		const known = union(sessionsOf, id, row.sids);
		const members = union(membersOf, id, row.uids);
		if (!seen) {
			byId.set(id, {
				...row,
				...(row.detail === undefined ? {} : { detail: list(row.detail) }),
				examples: list(row.examples),
			});
			continue;
		}
		const lead = number(row.runs) > number(seen.runs) ? row : seen;
		byId.set(id, {
			...lead,
			count: number(seen.count) + number(row.count),
			runs: number(seen.runs) + number(row.runs),
			sessions:
				known.size > 0
					? known.size
					: number(seen.sessions) + number(row.sessions),
			members:
				members.size > 0
					? members.size
					: Math.max(number(seen.members), number(row.members)),
			minutes: number(seen.minutes) + number(row.minutes),
			first_seen: [seen.first_seen, row.first_seen].map(String).sort()[0],
			last_seen: [seen.last_seen, row.last_seen].map(String).sort()[1],
			weekly: weekly(seen.weekly, row.weekly),
			examples: [...list(seen.examples), ...list(row.examples)].slice(0, 5),
			...(row.detail === undefined && seen.detail === undefined
				? {}
				: { detail: mergeDetail(seen.detail, row.detail) }),
		});
	}
	const merged = sectionedRows(
		[...byId.values()]
			.filter(
				(row) =>
					number(row.count) >= minCount &&
					number(row.runs) >= 2 &&
					number(row.sessions) >= minSessions,
			)
			.map(({ sids: _sids, uids: _uids, kind_cut: _cut, ...row }) => ({
				...row,
				minutes: Math.round(number(row.minutes) * 10) / 10,
			})),
		limit,
	);
	const bounds = merged.map((row) =>
		cutKinds.has(String(row.kind))
			? `lower bound: a window kept only its top ${String(row.kind)} patterns`
			: fullSessions.has(String(row.id))
				? `lower bound: a window listed only ${SESSION_IDS} of its sessions`
				: "",
	);
	return bounds.some(Boolean)
		? merged.map((row, index) => ({ ...row, lower_bound: bounds[index] }))
		: merged;
}

const DRILL_TOTALS = / · (\d+) in (\d+) runs · /u;

export function mergeDrill(rows: Row[], limit: number): Row[] {
	const pieces = rows
		.map((row) => String(row.pattern ?? ""))
		.flatMap((about) => {
			const totals = DRILL_TOTALS.exec(about);
			return totals
				? [{ about, count: Number(totals[1]), runs: Number(totals[2]) }]
				: [];
		});
	const lead = pieces.reduce<(typeof pieces)[number] | undefined>(
		(best, piece) => (!best || piece.runs > best.runs ? piece : best),
		undefined,
	);
	const count = pieces.reduce((sum, piece) => sum + piece.count, 0);
	const runs = pieces.reduce((sum, piece) => sum + piece.runs, 0);
	return rows.slice(0, limit).map((row, index) => ({
		...row,
		pattern:
			index === 0 && lead
				? lead.about.replace(DRILL_TOTALS, ` · ${count} in ${runs} runs · `)
				: "",
	}));
}

type Part = SqlParts["queries"][number];

export const PIECE_ROWS = 1000;

const APPROXIMATE: Partial<Record<PatternFamily, string>> = {
	talk: "a correction's phrase is grouped where it recurs within one window, so its counts can be lower than over the whole window",
	theme:
		"a theme counts where it recurs within one window (3 sessions, 3 prompts), so its counts are a lower bound and a theme thin in every window is missing",
};

export function patternSplit(
	scope: MeasureParams,
	family: PatternFamily,
	build: (window: MeasureParams) => string,
): NonNullable<Part["split"]> {
	const approximate = APPROXIMATE[family];
	return {
		stage: `patterns ${family}`,
		window: scope,
		build: (window) => ({
			query: build(window),
			cohort: cohortSelect(window),
			rows: PIECE_ROWS,
		}),
		...(approximate ? { approximate } : {}),
	};
}

function parts(
	params: MeasureParams,
	kinds: readonly PatternKind[],
	build: (
		scope: MeasureParams,
		family: PatternFamily,
		kinds: PatternKind[],
		sharded: boolean,
	) => string,
): Part[] {
	return patternFamilies(kinds).flatMap((part) => {
		const shards = SHARDED_FAMILIES.includes(part.family)
			? shardWindows(params)
			: [params];
		return shards.map((scope) => ({
			query: build(scope, part.family, part.kinds, shards.length > 1),
			cohort: cohortSelect(scope),
			...(shards.length > 1 ? { rows: PIECE_ROWS } : {}),
			split: patternSplit(scope, part.family, (window) =>
				build(window, part.family, part.kinds, true),
			),
		}));
	});
}

const NOT_AN_ID =
	"is not a pattern id: ids start with the kind's two letters (fc, rl, wr, co, in, th) and come from patterns action=list";

export function patternStatement(
	request: PatternRequest,
	today: Date,
	options: { readonly withRuns?: boolean } = {},
): {
	query: string;
	parts: SqlParts;
	title: string;
	cohort: string;
	measure: NonNullable<AnalysisSqlOutput["measure"]>;
	analysis?: string;
} {
	const params = measureParams(request, today);
	if ("error" in params) throw badRequest(params.error);
	const scope = `${params.from}..${params.to}${params.repository ? `, ${params.repository}` : ""}${params.latest ? `, latest ${params.latest}` : ""}`;
	const built = ((): {
		queries: Part[];
		merge: SqlParts["merge"];
		title: string;
		drill: Record<string, string> | undefined;
	} => {
		if (request.action === "drill") {
			const kind = patternKindOf(request.id);
			if (!kind) throw badRequest(`${request.id} ${NOT_AN_ID}`);
			return {
				queries: parts(params, [kind], (shard, family) =>
					patternDrillSql(shard, family, request.id),
				),
				merge: (rows) => mergeDrill(rows, params.limit),
				title: `Runs behind pattern ${request.id}, ${scope}`,
				drill: { id: request.id },
			};
		}
		const id = request.action === "verify" ? request.id : undefined;
		const single = id ? patternKindOf(id) : undefined;
		if (id && !single) throw badRequest(`${id} ${NOT_AN_ID}`);
		const kinds: readonly PatternKind[] = single
			? [single]
			: request.kind
				? [request.kind]
				: PATTERN_KINDS;
		if (request.action === "verify")
			return {
				queries: patternFamilies(kinds).map((part) => ({
					query: patternsVerifySql(params, part.family, {
						kinds: part.kinds,
						minCount: request.minCount,
						...(id ? { ids: [id] } : {}),
						...(request.since ? { since: request.since } : {}),
					}),
					cohort: cohortSelect(params),
				})),
				merge: (rows) => ranked(rows, params.limit),
				title: `Patterns before and after ${request.since ?? "the last setup change"}, ${scope}`,
				drill: { verify: id ?? "top" },
			};
		return {
			queries: parts(params, kinds, (shard, family, part, sharded) =>
				patternsListSql(
					sharded
						? { ...shard, limit: Math.floor(PIECE_ROWS / part.length) }
						: shard,
					family,
					{
						kinds: part,
						minCount: sharded ? 1 : request.minCount,
						minRuns: sharded ? 1 : 2,
						minSessions: sharded ? 1 : PATTERN_MIN_SESSIONS,
						...(sharded ? { piece: true } : {}),
						weeksOf: params,
						...(options.withRuns ? { withRuns: true } : {}),
					},
				),
			),
			merge: (rows) => mergePatternRows(rows, request.minCount, params.limit),
			title: `Recurring patterns${request.kind ? ` (${request.kind})` : ""}, ${scope}`,
			drill: undefined,
		};
	})();
	return {
		query: built.queries.map((part) => part.query).join("\n;\n"),
		parts: { queries: built.queries, merge: built.merge },
		title: built.title.slice(0, 120),
		cohort: cohortSelect(params),
		measure: {
			name: PATTERNS_MEASURE,
			status: "approved",
			hash: measureHash(PATTERNS_MEASURE) ?? "",
			from: params.from,
			to: params.to,
			...(built.drill ? { drill: built.drill } : {}),
		},
		...(request.analysis ? { analysis: request.analysis } : {}),
	};
}
