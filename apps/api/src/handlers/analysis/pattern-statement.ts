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
	for (const row of rows) {
		const id = String(row.id);
		const seen = byId.get(id);
		const ids = list(row.sids);
		const known = sessionsOf.get(id) ?? new Set<string>();
		for (const session of ids) known.add(session);
		sessionsOf.set(id, known);
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
			members: Math.max(number(seen.members), number(row.members)),
			minutes:
				Math.round((number(seen.minutes) + number(row.minutes)) * 10) / 10,
			first_seen: [seen.first_seen, row.first_seen].map(String).sort()[0],
			last_seen: [seen.last_seen, row.last_seen].map(String).sort()[1],
			weekly: weekly(seen.weekly, row.weekly),
			examples: [...list(seen.examples), ...list(row.examples)].slice(0, 5),
			...(row.detail === undefined && seen.detail === undefined
				? {}
				: { detail: mergeDetail(seen.detail, row.detail) }),
		});
	}
	return sectionedRows(
		[...byId.values()]
			.filter(
				(row) =>
					number(row.count) >= minCount &&
					number(row.runs) >= 2 &&
					number(row.sessions) >= minSessions,
			)
			.map(({ sids: _sids, ...row }) => row),
		limit,
	);
}

function mergeDrill(rows: Row[], limit: number): Row[] {
	const kept = rows.slice(0, limit);
	const about = rows.map((row) => String(row.pattern ?? "")).find(Boolean);
	const hits = rows.reduce((sum, row) => sum + number(row.hits), 0);
	return kept.map((row, index) => ({
		...row,
		pattern:
			index === 0 && about
				? about.replace(
						/ · \d+ in \d+ runs · /u,
						` · ${hits} in ${rows.length} runs · `,
					)
				: "",
	}));
}

interface Part {
	readonly query: string;
	readonly cohort: string;
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
		}));
	});
}

const NOT_AN_ID =
	"is not a pattern id: ids start with the kind's two letters (fc, rl, wr, co, in, th) and come from patterns action=list";

export function patternStatement(
	request: PatternRequest,
	today: Date,
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
				patternsListSql(sharded ? { ...shard, limit: 200 } : shard, family, {
					kinds: part,
					minCount: sharded ? 1 : request.minCount,
					minRuns: sharded ? 1 : 2,
					minSessions: sharded ? 1 : PATTERN_MIN_SESSIONS,
					weeksOf: params,
				}),
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
