import { type MeasureScope, PATTERN_KINDS } from "@rudel/api-routes";
import {
	type PatternFamily,
	patternFamilies,
	shardWindows,
} from "../../services/analysis/patterns-sql.js";
import {
	childBudget,
	inOrder,
	joinBudgets,
	LimitRefusal,
	limitRefusal,
	partConcurrency,
	runSplit,
	type SplitBudget,
	splitBudget,
} from "../../services/analysis/refused-split.js";
import {
	buildDigest,
	type Digest,
	type DigestPart,
	digestExampleRefs,
	exampleKey,
	joinDigestRuns,
	markPartial,
	markUnknown,
	noteMerged,
	type Row,
	renderDigest,
} from "../../services/analysis/retro-digest.js";
import {
	digestCuts,
	noteCuts,
} from "../../services/analysis/retro-digest-cuts.js";
import { mergeDigestRows } from "../../services/analysis/retro-digest-merge.js";
import {
	contextSizesStatement,
	digestCallsSql,
	digestEditsSql,
	digestExampleTimesSql,
	digestRunsSql,
	digestSessionsSql,
	digestSeveritySql,
	digestUsageSql,
	SEVERITY_SHARD_DAYS,
	startDirsStatement,
	type TrustedStatement,
} from "../../services/analysis/retro-digest-sql.js";
import type { MeasureParams } from "../../services/analysis/retro-measure-sql.js";
import {
	cohortSelect,
	measureParams,
} from "../../services/analysis/retro-measures.js";
import {
	execute,
	type SqlCaller,
	type SqlEnv,
	withCallQuota,
	withSqlLimits,
	wrapRows,
} from "../../services/analysis/sql-gateway.js";
import { badRequest } from "./measure-statement.js";
import { patternStatement } from "./pattern-statement.js";
import { sqlError } from "./sql-error.js";

export interface DigestReader {
	readonly workspaceId: string;
	view(query: string, cohort: string, rows?: number): Promise<Row[]>;
	trusted(statement: TrustedStatement): Promise<Row[]>;
}

export function digestReader(
	caller: SqlCaller,
	env: SqlEnv,
	signal?: AbortSignal,
): DigestReader {
	const sqlEnv = withCallQuota(env);
	const limited = withSqlLimits(env.executor);
	return {
		workspaceId: caller.workspaceId,
		view: async (query, cohort, rows) => {
			const outcome = await execute(
				caller,
				query,
				sqlEnv,
				signal,
				async (found) => found,
				rows ? wrapRows(rows) : undefined,
				cohort,
			);
			if (!outcome.ok)
				throw limitRefusal(outcome.error) ?? sqlError(outcome.error);
			return outcome.value;
		},
		trusted: (statement) =>
			limited.query({
				...statement,
				clickhouse_settings: { readonly: "1" },
			}),
	};
}

export interface DigestResult {
	readonly digest: Digest;
	readonly text: string;
	readonly ms: number;
	readonly from: string;
	readonly to: string;
}

const first = (rows: readonly Row[]): Row => rows[0] ?? {};

const STATEMENT_NAMES = {
	sessions: [
		"sessions",
		"repeats",
		"streams and models",
		"unrecorded facts",
		"links",
		"rules",
	],
	calls: ["calls ranked", "calls share", "pushes"],
	edits: ["edits"],
	usage: ["usage per session", "subagent spans", "compactions"],
	runs: ["runs", "run failures", "run prompts"],
} as const;

const FAMILY_KINDS = new Map(
	patternFamilies(PATTERN_KINDS).map((part) => [part.family, part.kinds]),
);

export async function runDigest(
	reader: DigestReader,
	input: MeasureScope,
	today: Date,
	budget: SplitBudget = splitBudget(),
): Promise<DigestResult> {
	const started = performance.now();
	const params = measureParams({ ...input, limit: 20 }, today);
	if ("error" in params) throw badRequest(params.error);
	const cohort = cohortSelect(params);
	const unknown = new Map<DigestPart, string[]>();
	const view = (query: string, window: MeasureParams) =>
		reader.view(query, cohortSelect(window));
	const part = async (
		name: keyof typeof STATEMENT_NAMES,
		into: DigestPart,
		build: (window: MeasureParams, piece: boolean) => readonly string[],
		own: SplitBudget = budget,
	): Promise<Row> => {
		const row: Row = {};
		for (const [index, stage] of STATEMENT_NAMES[name].entries()) {
			const outcome = await runSplit(
				`digest ${stage}`,
				params,
				(window, piece) => view(build(window, piece)[index] ?? "", window),
				own,
			);
			if (!outcome.ok) {
				if (name === "sessions" && index === 0)
					throw outcome.refusal
						? new LimitRefusal({
								...outcome.refusal.failure,
								message: `${outcome.refusal.failure.message} ${outcome.line}`,
							})
						: new Error(outcome.line);
				unknown.set(into, [...(unknown.get(into) ?? []), outcome.line]);
				return row;
			}
			Object.assign(
				row,
				outcome.values.length > 1
					? mergeDigestRows(outcome.values.map(first))
					: first(outcome.values[0] ?? []),
			);
		}
		return row;
	};
	const sessions = await part("sessions", "facts", (window) =>
		digestSessionsSql(window),
	);
	const listed = Array.isArray(sessions.sessions)
		? (sessions.sessions as unknown[][])
		: [];
	const scope = {
		workspaceId: reader.workspaceId,
		sessions: listed.map((t) => String(t[0])),
		users: listed.map((t) => String(t[14])),
	};
	const empty = scope.sessions.length === 0;
	const partial = new Map<DigestPart, string[]>();
	const severityShards = async (own: SplitBudget): Promise<Row[]> => {
		const rows: Row[] = [];
		const failed: string[] = [];
		let read = 0;
		for (const shard of shardWindows(params, SEVERITY_SHARD_DAYS))
			for (const [index, rule] of ["commands", "output"].entries()) {
				const outcome = await runSplit(
					`digest severity ${rule} ${shard.from}..${shard.to}`,
					shard,
					(window) => view(digestSeveritySql(window)[index] ?? "", window),
					own,
				);
				if (!outcome.ok) {
					failed.push(outcome.line);
					continue;
				}
				read += 1;
				for (const found of outcome.values) rows.push(...found);
			}
		if (failed.length) (read ? partial : unknown).set("severity", failed);
		return rows;
	};
	const approximate: string[] = [];
	const listPatterns = async (own: SplitBudget): Promise<Row[]> => {
		const statement = patternStatement(
			{ action: "list", ...input, minCount: 2, limit: 100 },
			today,
			{ withRuns: true },
		);
		const rows: Row[] = [];
		const merged = new Map<string, string>();
		const outcomes = await inOrder(
			statement.parts.queries.map((query) => async () => {
				const piece = childBudget(own);
				const split = query.split;
				if (!split)
					return {
						query,
						piece,
						rows: await reader.view(
							query.query,
							query.cohort ?? cohort,
							query.rows,
						),
					};
				return {
					query,
					piece,
					outcome: await runSplit(
						`digest ${split.stage}`,
						split.window,
						(window, part) => {
							const built = part ? split.build(window) : query;
							return reader.view(
								built.query,
								built.cohort ?? cohort,
								built.rows,
							);
						},
						piece,
						split.approximate ? { approximate: split.approximate } : {},
					),
				};
			}),
			1,
		);
		for (const done of outcomes) {
			joinBudgets(own, [done.piece]);
			const split = done.query.split;
			if (!split || !done.outcome) {
				rows.push(...(done.rows ?? []));
				continue;
			}
			const outcome = done.outcome;
			if (!outcome.ok) {
				unknown.set("patterns", [
					...(unknown.get("patterns") ?? []),
					outcome.line,
				]);
				continue;
			}
			rows.push(...outcome.values.flat());
			const family = split.stage.replace(/^patterns /u, "");
			if (outcome.values.length > 1 && split.approximate) {
				approximate.push(
					`the ${family} patterns it cites were merged from ${outcome.values.length} windows, so what they explain can be lower`,
				);
				for (const kind of FAMILY_KINDS.get(family as PatternFamily) ?? [])
					merged.set(
						kind,
						`merged from ${outcome.values.length} windows: ${split.approximate}`,
					);
			}
		}
		const cited = new Map<string, Set<string>>();
		for (const row of rows) {
			const id = String(row.id);
			const known = cited.get(id) ?? new Set<string>();
			for (const rid of Array.isArray(row.rids) ? row.rids : [])
				known.add(String(rid));
			cited.set(id, known);
		}
		return statement.parts.merge(rows).map((row) => ({
			...row,
			rids: [...(cited.get(String(row.id)) ?? [])],
			...(merged.has(String(row.kind))
				? { merged: merged.get(String(row.kind)) }
				: {}),
		}));
	};
	const steps = {
		startDirs: (_own: SplitBudget) => reader.trusted(startDirsStatement(scope)),
		calls: (own: SplitBudget) =>
			part(
				"calls",
				"calls",
				(window, piece) => digestCallsSql(window, piece),
				own,
			),
		edits: (own: SplitBudget) =>
			part("edits", "edits", (window) => [digestEditsSql(window)], own),
		usage: (own: SplitBudget) =>
			part("usage", "usage", (window) => digestUsageSql(window), own),
		contextSizes: (_own: SplitBudget) =>
			reader.trusted(contextSizesStatement(scope)),
		runs: async (own: SplitBudget) =>
			joinDigestRuns(
				await part("runs", "runs", (window) => digestRunsSql(window), own),
			),
		severity: severityShards,
		patterns: listPatterns,
	};
	const read = empty
		? null
		: await inOrder(
				Object.values(steps).map((step) => async () => {
					const own = childBudget(budget);
					return { own, value: await step(own) };
				}),
				partConcurrency(),
			);
	for (const done of read ?? []) joinBudgets(budget, [done.own]);
	const value = <K extends keyof typeof steps>(name: K) =>
		read?.[Object.keys(steps).indexOf(name)]?.value as
			| Awaited<ReturnType<(typeof steps)[K]>>
			| undefined;
	const startDirs = value("startDirs") ?? [];
	const calls = value("calls") ?? {};
	const edits = value("edits") ?? {};
	const usage = value("usage") ?? {};
	const contextSizes = value("contextSizes") ?? [];
	const runs = value("runs") ?? {};
	const severity = value("severity") ?? [];
	const patterns: Row[] = value("patterns") ?? [];
	const inputs = {
		sessions,
		calls,
		edits,
		usage,
		startDirs,
		contextSizes,
		runs,
		severity,
		patterns,
	};
	const digest = markPartial(
		markUnknown(
			noteCuts(
				noteMerged(
					buildDigest(inputs, {
						repository: params.repository ?? null,
						from: params.from,
						to: params.to,
						latest: params.latest ?? null,
						listed: params.sessions?.length ?? null,
					}),
					approximate,
				),
				digestCuts(inputs),
			),
			unknown,
		),
		partial,
	);
	const { times, note } = await exampleTimes(digest, (refs) =>
		reader.view(digestExampleTimesSql(params, refs), cohort),
	);
	const ms = Math.round(performance.now() - started);
	return {
		digest,
		text: renderDigest(
			digest,
			ms,
			[...budget.notes, ...budget.partial, ...(note ? [note] : [])],
			times,
		),
		ms,
		from: params.from,
		to: params.to,
	};
}

async function exampleTimes(
	digest: Digest,
	read: (refs: ReturnType<typeof digestExampleRefs>) => Promise<Row[]>,
): Promise<{ times: Map<string, string>; note: string | null }> {
	const refs = digestExampleRefs(digest);
	if (refs.length === 0) return { times: new Map(), note: null };
	let rows: Row[];
	try {
		rows = await read(refs);
	} catch (error) {
		return {
			times: new Map(),
			note: `example times unknown: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	const times = new Map(
		rows.flatMap((row) => {
			const at = Date.parse(`${String(row.at).replace(" ", "T")}Z`);
			if (Number.isNaN(at)) return [];
			const key = exampleKey({
				sessionId: String(row.session_id),
				agentId: String(row.agent_id ?? ""),
				turn: Number(row.turn_idx),
			});
			return [[key, new Date(at).toISOString()] as const];
		}),
	);
	return { times, note: null };
}
