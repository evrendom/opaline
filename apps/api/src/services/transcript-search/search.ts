import {
	type AnalysisSearchInput,
	type AnalysisSearchOutput,
	SEARCH_DEFAULT_DAYS,
	SEARCH_MAX_DAYS,
	SEARCH_MODES,
	SEARCH_REGEX_MAX_CHARS,
	SEARCH_TEXT_MAX_CHARS,
} from "@rudel/api-routes";
import { TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX } from "@rudel/api-routes/transcript-records";
import { filterKnownSecrets, redactReturnedValue } from "@rudel/secret-filter";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import type { AgentQueryLimiter } from "../analysis/agent-query-slots.js";
import { committedBuildSql } from "../analysis/run-index-reader.js";
import {
	SQL_SETTINGS,
	type SqlCaller,
	type SqlServerFunction,
	withAgentQuery,
} from "../analysis/sql-gateway.js";
import type {
	SqlFailure,
	SqlTableFunctionCall,
} from "../analysis/sql-guard.js";
import type { SqlQuota } from "../analysis/sql-results.js";
import { SQL_SCOPE_PARAMS } from "../analysis/sql-views.js";
import { RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";
import { readableSessionOwner } from "../session-visibility.js";
import type { SearchAccess } from "./access.js";
import {
	estimateEmbeddingTokens,
	TRANSCRIPT_EMBEDDING_DIMENSIONS,
	type TranscriptEmbedder,
} from "./config.js";
import type { EmbeddingQuota } from "./quota.js";
import {
	INJECTED_RECORD_KINDS,
	type LiteralMode,
	literalOf,
	recordKinds,
	recordMatchSql,
	recordPattern,
	TRANSCRIPT_RECORDS_TABLE,
} from "./record-match.js";
import {
	TRANSCRIPT_CHUNK_HITS_TABLE,
	TRANSCRIPT_CHUNKS_TABLE,
} from "./tables.js";

export const SEARCH_LIMITS = {
	/** Runs the search tool returns. */
	toolResults: 20,
	/** Runs `search('…')` gives a sql query to filter, join and rank. */
	sqlResults: 200,
	/** Nearest chunks in the window's months: candidates for meaning. */
	meaningCandidates: 2_000,
	exactCandidates: 100_000,
	scanChars: 2_000_000_000,
	/** Coverage of a window is counted at most this often per process. */
	coverageMs: 10 * 60_000,
	snippetChars: 240,
	/** `search()` calls one sql query may make: each embeds its text. */
	sqlCalls: 3,
	/** All query embeddings of one search or sql query, together. */
	embeddingMs: 5_000,
} as const;
/**
 * Cosine similarity below which a chunk is not close in meaning: unrelated
 * text scores about 0.1 with text-embedding-3-small.
 */
const MEANING_MIN_SIMILARITY = 0.2;
/** Reciprocal-rank fusion constant: a run ranked r adds 1 / (60 + r). */
const FUSION_K = 60;
const DAY_MS = 86_400_000;
const ZERO_VECTOR: readonly number[] = new Array<number>(
	TRANSCRIPT_EMBEDDING_DIMENSIONS,
).fill(0);

export const SEARCH_NOT_EVIDENCE =
	"not evidence: a match says where to look, not why. Open the runs with read (session_id, agent_id, and turn) before naming a cause.";

type SearchMode = (typeof SEARCH_MODES)[number];

export interface SearchEnv {
	readonly executor: ClickHouseExecutor;
	readonly quota: EmbeddingQuota;
	/** The per-workspace sql quota: a search is a query like any other. */
	readonly sqlQuota: SqlQuota;
	/** The query slots sql takes too: a search reads ClickHouse in one. */
	readonly limiter: AgentQueryLimiter;
	/** The embedder, or null where text is not embedded (no OpenAI key). */
	readonly embedderFor: (workspaceId: string) => TranscriptEmbedder | null;
	/** Whether a workspace is indexed for search: listed, or paid where paid plans are on. */
	readonly access: SearchAccess;
	readonly now?: () => Date;
	/** Overrides `SEARCH_LIMITS.embeddingMs`. */
	readonly embeddingDeadlineMs?: number;
}

export type SearchOutcome =
	| { readonly ok: true; readonly result: AnalysisSearchOutput }
	| { readonly ok: false; readonly error: SqlFailure };

const ResultRowSchema = z.object({
	run_id: z.string(),
	session_id: z.string(),
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	started_at: z.string(),
	score: z.coerce.number(),
	why: z.string(),
	snippet: z.string(),
	visible: z.coerce.number(),
	partial_sessions: z.coerce.number(),
	hidden_matches: z.coerce.number(),
	hidden_runs: z.coerce.number(),
	exact_runs: z.coerce.number(),
	exact_sessions: z.coerce.number(),
});
const CoverageRowSchema = z.object({
	sessions: z.coerce.number(),
	scanned: z.coerce.number(),
	indexed: z.coerce.number(),
	pending: z.coerce.number(),
	truncated: z.coerce.number(),
	unscanned_until: z.string(),
});
type Coverage = z.infer<typeof CoverageRowSchema>;

/** The search tool: runs that match the text, best first, within the caller's scope. */
export async function searchTranscripts(
	caller: SqlCaller,
	input: AnalysisSearchInput,
	env: SearchEnv,
	signal?: AbortSignal,
): Promise<SearchOutcome> {
	const now = (env.now ?? (() => new Date()))();
	const window = searchWindow(input.filters, now);
	if ("failure" in window) return { ok: false, error: window.failure };
	const length = textLengthFailure(input.text, input.mode);
	if (length) return { ok: false, error: length };
	const text = withoutSecrets(input.text);
	if (typeof text !== "string") return { ok: false, error: text.failure };
	const userId = input.filters?.userId;
	const only = readableSessionOwner(caller.reader);
	if (userId !== undefined && only !== null && userId !== only)
		return {
			ok: false,
			error: {
				kind: "fatal",
				message:
					"This workspace keeps members to their own sessions; filters.userId can name only you.",
				fragment: null,
				fix: "Do not retry with another member; leave filters.userId out.",
			},
		};
	// The text is embedded before the slot, which then holds only the reads;
	// the query quota is taken once, inside it.
	const embedding = embeddingDeadline(env);
	const meaning = await meaningOf(
		caller.workspaceId,
		text,
		input.mode,
		env,
		embedding.signal,
	).finally(embedding.dispose);
	if ("failure" in meaning) return { ok: false, error: meaning.failure };

	const memberOnly = only !== null;
	const scope = scopeParams(caller);
	const params = {
		...scope,
		...searchParams("opaline_search", {
			text,
			mode: meaning.mode,
			vector: meaning.vector,
			since: window.since,
			until: window.until,
			kinds: input.filters?.kinds ?? [],
			includeInjected: input.filters?.includeInjected ?? false,
			source: input.filters?.source ?? "",
			userId: userId ?? "",
		}),
	};
	const read = await withAgentQuery(
		caller.workspaceId,
		{ limiter: env.limiter, quota: env.sqlQuota },
		async () => ({
			ok: true as const,
			value: await Promise.all([
				env.executor.query<unknown>({
					clickhouse_settings: SQL_SETTINGS,
					query: searchStatement(
						"opaline_search",
						memberOnly,
						SEARCH_LIMITS.toolResults,
						{ literal: literalOf(meaning.mode), totals: true },
					),
					query_params: params,
				}),
				coverageOf(env.executor, {
					scope,
					memberOnly,
					since: window.since,
					until: window.until,
					source: input.filters?.source ?? "",
					userId: userId ?? "",
				}),
				meaning.embedded ? env.quota.usage(caller.workspaceId) : null,
			]),
		}),
		signal,
	).catch((error: unknown) => {
		const failure = readFailure(error);
		if (!failure) throw error;
		return { ok: false as const, error: failure };
	});
	if (!read.ok) return read;
	const [rows, covered, quota] = read.value;
	const parsed = z.array(ResultRowSchema).parse(rows);
	const totals = parsed[0] ?? {
		partial_sessions: 0,
		hidden_matches: 0,
		hidden_runs: 0,
		exact_runs: 0,
		exact_sessions: 0,
	};
	const results = parsed
		.filter((row) => row.visible > 0)
		.map((row) => ({
			runId: row.run_id,
			sessionId: row.session_id,
			agentId: row.agent_id,
			turn: row.turn_idx,
			startedAt: row.started_at,
			score: row.score,
			why: row.why,
			snippet: row.snippet,
		}));
	const searched = meaning.mode === "meaning" ? 0 : covered.scanned;
	const coverage = {
		sessions: covered.sessions,
		searched,
		partial: Math.min(totals.partial_sessions, searched),
		indexed: covered.indexed,
		pending: covered.pending,
	};
	const notices = [
		...meaning.notices,
		...coverageNotices(coverage, covered, meaning.mode),
		SEARCH_NOT_EVIDENCE,
	];
	return {
		ok: true,
		result: redactReturnedValue({
			text,
			requestedMode: input.mode,
			mode: meaning.mode,
			since: window.since.toISOString(),
			until: window.until.toISOString(),
			results,
			coverage,
			exactMatches: {
				runs: totals.exact_runs,
				sessions: totals.exact_sessions,
			},
			hiddenInjected: {
				matches: totals.hidden_matches,
				runs: totals.hidden_runs,
			},
			quota: quota
				? {
						usedTokens: quota.used,
						limitTokens: quota.limit,
						resetsAt: quota.resetsAt.toISOString(),
					}
				: null,
			suggestion:
				results.length === 0
					? suggestRewrite(text, meaning.mode, coverage)
					: null,
			notices,
		}),
	};
}

/**
 * `search(text[, mode[, days]])` inside sql: a table of up to 200 runs
 * (run_id, user_id, session_id, agent_id, turn_idx, started_at, score, why,
 * snippet) to join to the views and filter there.
 */
export function createSqlSearchFunction(
	env: Omit<SearchEnv, "sqlQuota" | "limiter">,
): SqlServerFunction {
	return {
		name: "search",
		statement(call, memberOnly) {
			if (call.index >= SEARCH_LIMITS.sqlCalls)
				return {
					failure: {
						kind: "recoverable",
						message: `A query may call search() at most ${SEARCH_LIMITS.sqlCalls} times.`,
						fragment: `search(${call.args.map((arg) => `'${arg}'`).join(", ")})`,
						fix: "Search fewer strings in one query, or run several queries.",
					},
				};
			const args = sqlSearchArgs(call);
			if ("failure" in args) return args;
			return {
				sql: searchStatement(
					callPrefix(call),
					memberOnly,
					SEARCH_LIMITS.sqlResults,
					{ literal: literalOf(args.mode), totals: false },
				),
			};
		},
		async bind(caller, calls) {
			const now = (env.now ?? (() => new Date()))();
			const parsed = [];
			for (const call of calls) {
				const args = sqlSearchArgs(call);
				if ("failure" in args) return args;
				parsed.push({ call, args });
			}
			// The calls embed together under one deadline; when one cannot run,
			// the others' requests are cancelled.
			const embedding = embeddingDeadline(env);
			try {
				const meanings = await Promise.all(
					parsed.map(async ({ args }) => {
						const meaning = await meaningOf(
							caller.workspaceId,
							args.text,
							args.mode,
							env,
							embedding.signal,
						);
						if ("failure" in meaning) embedding.cancel();
						return meaning;
					}),
				);
				const params: Record<string, unknown> = {};
				const notices: string[] = [];
				for (const [index, { call, args }] of parsed.entries()) {
					const meaning = meanings[index];
					if (!meaning) continue;
					if ("failure" in meaning) return meaning;
					Object.assign(
						params,
						searchParams(callPrefix(call), {
							text: args.text,
							mode: meaning.mode,
							vector: meaning.vector,
							since: new Date(now.getTime() - args.days * DAY_MS),
							until: new Date(now.getTime() + 60_000),
							kinds: [],
							includeInjected: false,
							source: "",
							userId: "",
						}),
					);
					notices.push(
						...meaning.notices.map(
							(notice) => `search('${args.text}'): ${notice}`,
						),
					);
				}
				return { params, notices };
			} finally {
				embedding.dispose();
			}
		},
	};
}

export function searchStatement(
	prefix: string,
	memberOnly: boolean,
	limit: number,
	options: { literal: LiteralMode; totals: boolean },
): string {
	const p = (name: string, type: string) => `{${prefix}_${name}:${type}}`;
	const scope = scopeSql(memberOnly);
	const since = p("since", "DateTime64(3, 'UTC')");
	const until = p("until", "DateTime64(3, 'UTC')");
	const source = `(${p("source", "String")} = '' OR source = ${p("source", "String")})`;
	const user = `(${p("user", "String")} = '' OR user_id = ${p("user", "String")})`;
	const months = `month >= toStartOfMonth(${since}) AND month <= toStartOfMonth(${until})`;
	const name = (cte: string) => `${prefix}_${cte}`;
	const snippet = SEARCH_LIMITS.snippetChars;
	const run =
		"user_id, session_id, agent_id, turn_idx, revision, parser_version";
	const record = recordMatchSql(options.literal, {
		text: p("text", "String"),
		pattern: p("pattern", "String"),
		snippetChars: snippet,
	});
	const injected = `(has(${p("injected_kinds", "Array(String)")}, kind) AND ${p("hide_injected", "UInt8")} = 1)`;
	const partial = `(${record.partial} AND NOT ${injected})`;
	const totals = options.totals
		? `uniqExactIf((user_id, session_id), partial_records > 0) OVER () AS partial_sessions,
				sum(hidden_hits) OVER () AS hidden_matches,
				countIf(exact_hits = 0 AND hidden_hits > 0) OVER () AS hidden_runs,
				countIf(exact_hits > 0) OVER () AS exact_runs,
				uniqExactIf((user_id, session_id), exact_hits > 0) OVER () AS exact_sessions`
		: "0 AS partial_sessions, 0 AS hidden_matches, 0 AS hidden_runs, 0 AS exact_runs, 0 AS exact_sessions";
	const output = options.totals
		? `,
		toUInt8(meaning = 1 OR exact_hits > 0) AS visible, max(partial_sessions) OVER () AS partial_sessions,
		max(hidden_matches) OVER () AS hidden_matches, max(hidden_runs) OVER () AS hidden_runs,
		max(exact_runs) OVER () AS exact_runs, max(exact_sessions) OVER () AS exact_sessions
	FROM ${name("ranked")}
	ORDER BY visible DESC, score DESC, started_at DESC, run_id`
		: `
	FROM ${name("ranked")}
	WHERE meaning = 1 OR exact_hits > 0
	ORDER BY score DESC, started_at DESC, run_id`;
	// arrayResize: ClickHouse computes the distance over whole blocks before
	// notEmpty filters them, and a chunk still waiting for its vector has none
	// (equal sizes are required); padded with zeros its similarity is NaN, which
	// never passes MEANING_MIN_SIMILARITY.
	return `WITH
		${name("sessions")} AS (
			SELECT user_id, session_id, revision, parser_version FROM (${windowSessionsSql(prefix, memberOnly)})
			WHERE scanned = 1
		),
		${name("records")} AS (
			SELECT ${run}, record_idx, block_idx, kind, ts, ${record.matched} AS matched, ${injected} AS injected,
				${options.totals ? partial : "0"} AS partial, if(matched, ${record.snippet}, '') AS snippet
			FROM ${TRANSCRIPT_RECORDS_TABLE}
			WHERE ${scope} AND ${p("exact", "UInt8")} = 1
				AND (user_id, session_id, revision, parser_version) IN (SELECT user_id, session_id, revision, parser_version FROM ${name("sessions")})
				AND record_idx < ${TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX} AND turn_idx >= 1 AND ts >= ${since} AND ts < ${until}
				AND kind IN ${p("record_kinds", "Array(String)")}
				AND (${record.matched}${options.totals ? ` OR ${partial}` : ""})
		),
		${name("found")} AS (
			SELECT *, ${totals}
			FROM (
				SELECT ${run},
					uniqExactIf((record_idx, block_idx), matched AND NOT injected) AS exact_hits,
					uniqExactIf((record_idx, block_idx), matched AND injected) AS hidden_hits,
					countIf(partial) AS partial_records,
					argMinIf(snippet, (record_idx, block_idx), matched AND NOT injected) AS exact_snippet,
					arraySort(groupUniqArrayIf(kind, matched AND NOT injected)) AS exact_kinds,
					maxIf(ts, matched) AS matched_at
				FROM ${name("records")}
				GROUP BY ${run}
			)
			ORDER BY exact_hits > 0 DESC, matched_at DESC
			LIMIT ${SEARCH_LIMITS.exactCandidates}
		),
		${name("chunks")} AS (
			SELECT user_id, chunk_hash, max(chunk_similarity) AS similarity, argMax(chunk_snippet, chunk_similarity) AS snippet
			FROM (
				SELECT user_id, chunk_hash, 1 - cosineDistance(arrayResize(embedding, length(${p("vector", "Array(Float32)")})), ${p("vector", "Array(Float32)")}) AS chunk_similarity,
					substringUTF8(text, 1, ${snippet}) AS chunk_snippet
				FROM ${TRANSCRIPT_CHUNKS_TABLE}
				WHERE ${scope} AND ${months} AND ${user} AND ${p("meaning", "UInt8")} = 1 AND notEmpty(embedding)
					AND chunk_similarity >= ${MEANING_MIN_SIMILARITY}
				ORDER BY chunk_similarity DESC LIMIT ${SEARCH_LIMITS.meaningCandidates}
			)
			GROUP BY user_id, chunk_hash
		),
		${name("meant")} AS (
			SELECT h.user_id AS user_id, h.session_id AS session_id, h.agent_id AS agent_id, h.turn_idx AS turn_idx,
				h.revision AS revision, h.parser_version AS parser_version, 1 AS meaning,
				max(c.similarity) AS similarity, argMax(c.snippet, c.similarity) AS meaning_snippet,
				argMax(h.kind, c.similarity) AS meaning_kind, argMax(h.tool_name, c.similarity) AS meaning_tool
			FROM (
				SELECT user_id, session_id, agent_id, turn_idx, chunk_hash, kind, tool_name, revision, parser_version
				FROM ${TRANSCRIPT_CHUNK_HITS_TABLE}
				WHERE ${scope} AND ${p("meaning", "UInt8")} = 1 AND record_idx < ${TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX}
					AND ts >= ${since} AND ts < ${until} AND ${user} AND ${source}
					AND (empty(${p("kinds", "Array(String)")}) OR has(${p("kinds", "Array(String)")}, kind))
			) AS h
			INNER JOIN ${name("chunks")} AS c ON h.user_id = c.user_id AND h.chunk_hash = c.chunk_hash
			GROUP BY h.user_id, h.session_id, h.agent_id, h.turn_idx, h.revision, h.parser_version
		),
		${name("matched")} AS (
			SELECT ${run}, m.meaning AS meaning, m.similarity AS similarity, m.meaning_snippet AS meaning_snippet,
				m.meaning_kind AS meaning_kind, m.meaning_tool AS meaning_tool, f.exact_hits AS exact_hits,
				f.exact_snippet AS exact_snippet, f.exact_kinds AS exact_kinds, f.partial_sessions AS partial_sessions,
				f.hidden_matches AS hidden_matches, f.hidden_runs AS hidden_runs, f.exact_runs AS exact_runs,
				f.exact_sessions AS exact_sessions
			FROM ${name("meant")} AS m
			FULL OUTER JOIN ${name("found")} AS f USING (${run})
		),
		${name("ranked")} AS (
			SELECT r.run_id AS run_id, x.user_id AS user_id, x.session_id AS session_id, x.agent_id AS agent_id,
				x.turn_idx AS turn_idx, r.started_at AS started_at, x.meaning AS meaning, x.similarity AS similarity,
				x.meaning_snippet AS meaning_snippet, x.meaning_kind AS meaning_kind, x.meaning_tool AS meaning_tool,
				x.exact_hits AS exact_hits, x.exact_snippet AS exact_snippet, x.exact_kinds AS exact_kinds,
				x.partial_sessions AS partial_sessions, x.hidden_matches AS hidden_matches, x.hidden_runs AS hidden_runs,
				x.exact_runs AS exact_runs, x.exact_sessions AS exact_sessions,
				if(x.meaning = 1, rank() OVER (PARTITION BY x.meaning ORDER BY x.similarity DESC), 0) AS meaning_rank,
				if(x.exact_hits > 0, rank() OVER (PARTITION BY x.exact_hits > 0 ORDER BY x.exact_hits DESC), 0) AS exact_rank
			FROM (${committedRunsSql(memberOnly)}) AS r
			INNER JOIN ${name("matched")} AS x
				ON r.user_id = x.user_id AND r.session_id = x.session_id AND r.agent_id = x.agent_id AND r.turn_idx = x.turn_idx
					AND r.revision = x.revision AND r.parser_version = x.parser_version
		)
	SELECT run_id, user_id, session_id, agent_id, turn_idx, toString(started_at) AS started_at,
		round(if(meaning_rank > 0, 1 / (${FUSION_K} + meaning_rank), 0)
			+ if(exact_rank > 0, 1 / (${FUSION_K} + exact_rank), 0), 6) AS score,
		arrayStringConcat(arrayFilter(part -> part != '', [
			if(meaning = 1, concat('meaning ', toString(round(similarity, 2)), ' in ', meaning_kind,
				if(meaning_tool != '', concat(' (', meaning_tool, ')'), '')), ''),
			if(exact_hits > 0, concat('${options.literal} ×', toString(exact_hits), ' in ', arrayStringConcat(exact_kinds, ', ')), '')
		]), '; ') AS why,
		if(exact_hits > 0, exact_snippet, meaning_snippet) AS snippet${output}
	LIMIT ${limit}`;
}

export function windowSessionsSql(prefix: string, memberOnly: boolean): string {
	const p = (name: string, type: string) => `{${prefix}_${name}:${type}}`;
	return `SELECT user_id, session_id, revision, parser_version, max(started_at) AS last_started,
			sum(sum(raw_chars)) OVER (ORDER BY max(started_at) DESC, user_id, session_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS scanned_through,
			toUInt8(scanned_through - sum(raw_chars) < ${SEARCH_LIMITS.scanChars}) AS scanned
		FROM (${committedRunsSql(memberOnly)})
		WHERE started_at >= ${p("since", "DateTime64(3, 'UTC')")} AND started_at < ${p("until", "DateTime64(3, 'UTC')")}
			AND (${p("source", "String")} = '' OR source = ${p("source", "String")})
			AND (${p("user", "String")} = '' OR user_id = ${p("user", "String")})
		GROUP BY user_id, session_id, revision, parser_version`;
}

/** The workspace's rows (and the member's, where held to their own sessions). */
function scopeSql(memberOnly: boolean): string {
	return `organization_id = {${SQL_SCOPE_PARAMS.workspace}:String}${
		memberOnly ? ` AND user_id = {${SQL_SCOPE_PARAMS.member}:String}` : ""
	}`;
}

/**
 * Runs of each session's committed run index build, with the transcript
 * generation the build was made from: the runs view's rows plus the
 * generation it leaves out.
 */
function committedRunsSql(memberOnly: boolean): string {
	const table = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const owner = scopeSql(memberOnly);
	return `SELECT run_id, user_id, session_id, agent_id, turn_idx, started_at, source, revision, parser_version, raw_chars
		FROM ${table} FINAL
		WHERE ${owner} AND row_kind = 'run' AND ${committedBuildSql(table, owner, ["user_id", "session_id"])}`;
}

/**
 * Sessions that ran in the window (of the source and member searched); those
 * indexed for search from the generation their committed run index build was
 * made from (a session re-uploaded since is not ready until both caught up);
 * of those, the ones with chunks still without a vector and the ones with
 * records searched only by their kept prefix and tail.
 */
function coverageStatement(memberOnly: boolean): string {
	return `SELECT count() AS sessions, countIf(s.scanned = 1) AS scanned, countIf(c.indexed = 1) AS indexed,
		countIf(c.pending > 0) AS pending, countIf(c.truncated > 0) AS truncated,
		toString(toDate(maxIf(s.last_started, s.scanned = 0))) AS unscanned_until
	FROM (${windowSessionsSql("opaline_search", memberOnly)}) AS s
	LEFT JOIN (
		SELECT user_id, session_id, revision, parser_version, 1 AS indexed,
			argMax(pending_chunks, written_at) AS pending, argMax(truncated_records, written_at) AS truncated
		FROM ${TRANSCRIPT_CHUNK_HITS_TABLE}
		WHERE ${scopeSql(memberOnly)} AND record_idx = ${TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX}
		GROUP BY user_id, session_id, revision, parser_version
	) AS c ON s.user_id = c.user_id AND s.session_id = c.session_id
		AND s.revision = c.revision AND s.parser_version = c.parser_version`;
}

/**
 * Coverage of a window, counted once per scope, filters and window days for
 * `SEARCH_LIMITS.coverageMs` per process: searches in a row over the same
 * window do not each scan the run index.
 */
const coverageCache = new Map<
	string,
	{ readonly expiresAt: number; readonly coverage: Promise<Coverage> }
>();
const COVERAGE_CACHE_ENTRIES = 500;

function coverageOf(
	executor: ClickHouseExecutor,
	window: {
		scope: Record<string, string>;
		memberOnly: boolean;
		since: Date;
		until: Date;
		source: string;
		userId: string;
	},
): Promise<Coverage> {
	const key = JSON.stringify([
		window.scope,
		window.source,
		window.userId,
		window.since.toISOString().slice(0, 10),
		window.until.toISOString().slice(0, 10),
	]);
	const now = Date.now();
	const cached = coverageCache.get(key);
	if (cached && cached.expiresAt > now) return cached.coverage;
	const coverage = executor
		.query<unknown>({
			clickhouse_settings: SQL_SETTINGS,
			query: coverageStatement(window.memberOnly),
			query_params: {
				...window.scope,
				opaline_search_since: chTime(window.since),
				opaline_search_until: chTime(window.until),
				opaline_search_source: window.source,
				opaline_search_user: window.userId,
			},
		})
		.then(([row]) =>
			CoverageRowSchema.parse(
				row ?? {
					sessions: 0,
					scanned: 0,
					indexed: 0,
					pending: 0,
					truncated: 0,
					unscanned_until: "",
				},
			),
		);
	coverageCache.delete(key);
	coverageCache.set(key, {
		expiresAt: now + SEARCH_LIMITS.coverageMs,
		coverage,
	});
	coverage.catch(() => {
		if (coverageCache.get(key)?.coverage === coverage)
			coverageCache.delete(key);
	});
	for (const stale of coverageCache.keys()) {
		if (coverageCache.size <= COVERAGE_CACHE_ENTRIES) break;
		coverageCache.delete(stale);
	}
	return coverage;
}

/**
 * The mode that can run and the query vector: meaning needs the workspace's
 * embedder and quota. Hybrid falls back to exact, saying why; meaning alone
 * fails with what to do instead.
 */
async function meaningOf(
	workspaceId: string,
	text: string,
	mode: SearchMode,
	env: Pick<SearchEnv, "embedderFor" | "quota" | "access">,
	signal: AbortSignal,
): Promise<
	| {
			mode: SearchMode;
			vector: readonly number[];
			embedded: boolean;
			notices: string[];
	  }
	| { failure: SqlFailure }
> {
	const indexed = await env.access.indexes(workspaceId);
	const embedder = indexed ? env.embedderFor(workspaceId) : null;
	if (mode === "exact" || mode === "regex")
		return {
			mode,
			vector: ZERO_VECTOR,
			embedded: embedder !== null,
			notices: [],
		};
	const unavailable = (reason: string) =>
		mode === "meaning"
			? {
					failure: {
						kind: "recoverable" as const,
						message: `Search by meaning is not available: ${reason}.`,
						fragment: null,
						fix: "Search with mode exact for a literal string (a flag, file name or error), or use sql and read.",
					},
				}
			: {
					mode: "exact" as const,
					vector: ZERO_VECTOR,
					embedded: embedder !== null,
					notices: [
						`only exact matches: search by meaning is not available (${reason}).`,
					],
				};
	if (!indexed) return unavailable(env.access.notIndexed);
	if (!embedder)
		return unavailable("this workspace's transcripts are not embedded");
	const usage = await env.quota.usage(workspaceId);
	if (usage.used >= usage.limit)
		return unavailable(
			`the workspace used its OpenAI quota of ${usage.limit.toLocaleString("en-US")} tokens; embedding stopped until ${usage.resetsAt.toISOString()}`,
		);
	let embedded: { vectors: number[][]; tokens: number };
	try {
		if (signal.aborted) throw signal.reason;
		embedded = await embedder.embed([text], signal);
	} catch {
		if (!signal.aborted)
			return unavailable("the embedding service did not answer; retry later");
		// Abandoned midway: OpenAI may still bill it, so it is charged as estimated.
		await env.quota
			.charge(workspaceId, estimateEmbeddingTokens([text]))
			.catch(() => {});
		return unavailable("the embedding service did not answer in time");
	}
	await env.quota.charge(
		workspaceId,
		embedded.tokens > 0 ? embedded.tokens : estimateEmbeddingTokens([text]),
	);
	const vector = embedded.vectors[0];
	if (!vector) return unavailable("the embedding service returned no vector");
	return { mode, vector, embedded: true, notices: [] };
}

/**
 * One deadline for every query embedding of a search or sql query, and a
 * way to cancel them all.
 */
function embeddingDeadline(env: Pick<SearchEnv, "embeddingDeadlineMs">): {
	signal: AbortSignal;
	cancel: () => void;
	dispose: () => void;
} {
	const cancelled = new AbortController();
	const timer = setTimeout(
		() => cancelled.abort(new Error("Search embedding deadline passed")),
		env.embeddingDeadlineMs ?? SEARCH_LIMITS.embeddingMs,
	);
	return {
		signal: cancelled.signal,
		cancel: () => cancelled.abort(new Error("Search embedding cancelled")),
		dispose: () => clearTimeout(timer),
	};
}

function searchParams(
	prefix: string,
	search: {
		text: string;
		mode: SearchMode;
		vector: readonly number[];
		since: Date;
		until: Date;
		kinds: readonly string[];
		includeInjected: boolean;
		source: string;
		userId: string;
	},
): Record<string, unknown> {
	const literal = search.mode === "exact" || search.mode === "regex";
	return {
		[`${prefix}_text`]: search.text,
		[`${prefix}_pattern`]: recordPattern(search.text, literalOf(search.mode)),
		[`${prefix}_vector`]: [...search.vector],
		[`${prefix}_meaning`]: literal ? 0 : 1,
		[`${prefix}_exact`]: search.mode === "meaning" ? 0 : 1,
		[`${prefix}_since`]: chTime(search.since),
		[`${prefix}_until`]: chTime(search.until),
		[`${prefix}_kinds`]: [...search.kinds],
		[`${prefix}_record_kinds`]: recordKinds(search.kinds),
		[`${prefix}_injected_kinds`]: [...INJECTED_RECORD_KINDS],
		[`${prefix}_hide_injected`]: search.includeInjected ? 0 : 1,
		[`${prefix}_source`]: search.source,
		[`${prefix}_user`]: search.userId,
	};
}

function scopeParams(caller: SqlCaller): Record<string, string> {
	const only = readableSessionOwner(caller.reader);
	return {
		[SQL_SCOPE_PARAMS.workspace]: caller.workspaceId,
		...(only === null ? {} : { [SQL_SCOPE_PARAMS.member]: only }),
	};
}

function callPrefix(call: SqlTableFunctionCall): string {
	return `opaline_search${call.index}`;
}

/** `search(text[, mode[, days]])`'s arguments, or why they are refused. */
function sqlSearchArgs(
	call: SqlTableFunctionCall,
): { text: string; mode: SearchMode; days: number } | { failure: SqlFailure } {
	const [text = "", mode = "hybrid", days = String(SEARCH_DEFAULT_DAYS)] =
		call.args;
	const refuse = (message: string) => ({
		failure: {
			kind: "recoverable" as const,
			message,
			fragment: `search(${call.args.map((arg) => `'${arg}'`).join(", ")})`,
			fix: `Call search('text'), search('text', 'hybrid' | 'meaning' | 'exact' | 'regex') or search('text', 'exact', days) with days from 1 to ${SEARCH_MAX_DAYS}.`,
		},
	});
	const trimmed = text.trim();
	const knownMode = SEARCH_MODES.find((candidate) => candidate === mode);
	if (
		call.args.length > 3 ||
		trimmed.length < 2 ||
		trimmed.length > maxTextChars(knownMode ?? "hybrid")
	)
		return refuse(
			`search() takes the text to find (2 to ${SEARCH_TEXT_MAX_CHARS} characters, ${SEARCH_REGEX_MAX_CHARS} for a regex), then optionally a mode and a number of days.`,
		);
	if (!knownMode)
		return refuse(
			`search() mode must be hybrid, meaning, exact or regex, not ${mode}.`,
		);
	const dayCount = Number(days);
	if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > SEARCH_MAX_DAYS)
		return refuse(
			`search() reads 1 to ${SEARCH_MAX_DAYS} days back, not ${days}.`,
		);
	const filtered = withoutSecrets(trimmed);
	if (typeof filtered !== "string") return filtered;
	return { text: filtered, mode: knownMode, days: dayCount };
}

/**
 * The search text through the secret filter: a credential pasted into a
 * search is never embedded, bound or echoed; the redaction marker is searched
 * instead, as the stored chunks hold it.
 */
function withoutSecrets(text: string): string | { failure: SqlFailure } {
	try {
		return filterKnownSecrets(text).text;
	} catch {
		return {
			failure: {
				kind: "recoverable",
				message: "The search text could not be checked for credentials.",
				fragment: null,
				fix: "Search a shorter string without credentials.",
			},
		};
	}
}

/** The window of the search tool: whole UTC days, 30 by default, at most 180. */
function searchWindow(
	filters: AnalysisSearchInput["filters"],
	now: Date,
): { since: Date; until: Date } | { failure: SqlFailure } {
	const until = filters?.until
		? new Date(Date.parse(`${filters.until}T00:00:00Z`) + DAY_MS)
		: new Date(now.getTime() + 60_000);
	const since = filters?.since
		? new Date(`${filters.since}T00:00:00Z`)
		: new Date(until.getTime() - SEARCH_DEFAULT_DAYS * DAY_MS);
	if (
		since >= until ||
		until.getTime() - since.getTime() > (SEARCH_MAX_DAYS + 1) * DAY_MS
	)
		return {
			failure: {
				kind: "recoverable",
				message: `filters.since must come before filters.until, at most ${SEARCH_MAX_DAYS} days apart.`,
				fragment: null,
				fix: "Narrow the window, or search several windows one after another.",
			},
		};
	return { since, until };
}

function coverageNotices(
	coverage: AnalysisSearchOutput["coverage"],
	covered: Coverage,
	mode: SearchMode,
): string[] {
	const notices: string[] = [];
	if (mode === "meaning" || mode === "hybrid") {
		const unindexed = coverage.sessions - coverage.indexed;
		if (unindexed > 0)
			notices.push(
				mode === "meaning"
					? `not searched: ${unindexed} of ${coverage.sessions} sessions that ran in the window are not indexed for search yet (uploaded before search started, still indexing, or re-uploaded and not rebuilt yet); unknown, not absent.`
					: `not searched by meaning: ${unindexed} of ${coverage.sessions} sessions that ran in the window are not indexed for search yet; they were searched by exact string only.`,
			);
		if (coverage.pending > 0)
			notices.push(
				`exact only: ${coverage.pending} indexed sessions have chunks without a vector (the workspace's OpenAI quota or the upload's time ran out, or OpenAI failed); their runs match by exact string, not by meaning, until a later upload embeds them.`,
			);
	}
	if (mode !== "meaning" && coverage.searched < coverage.sessions)
		notices.push(
			`not searched: the oldest ${coverage.sessions - coverage.searched} of ${coverage.sessions} sessions that ran in the window, through ${covered.unscanned_until}, are past what one search reads (${SEARCH_LIMITS.scanChars / 1e9} billion characters of transcript, newest first); search them with filters.until ${covered.unscanned_until}; unknown, not absent.`,
		);
	const partial = mode === "meaning" ? covered.truncated : coverage.partial;
	if (partial > 0)
		notices.push(
			`partly searched: ${partial} ${mode === "meaning" ? "indexed" : "searched"} sessions have records too long to keep whole (long tool outputs or files); only their first 64K and last 1K characters are searched, so a match in the middle is unknown, not absent.`,
		);
	return notices;
}

function maxTextChars(mode: SearchMode): number {
	return mode === "regex" ? SEARCH_REGEX_MAX_CHARS : SEARCH_TEXT_MAX_CHARS;
}

function textLengthFailure(text: string, mode: SearchMode): SqlFailure | null {
	if (text.length <= maxTextChars(mode)) return null;
	return {
		kind: "recoverable",
		message: `text is at most ${maxTextChars(mode)} characters for mode ${mode}.`,
		fragment: null,
		fix:
			mode === "regex"
				? "Shorten the regex: match the most specific part only."
				: `Search a shorter, specific part, or use mode regex for a pattern up to ${SEARCH_REGEX_MAX_CHARS} characters.`,
	};
}

function readFailure(error: unknown): SqlFailure | null {
	if (!(error instanceof Error)) return null;
	const type =
		"type" in error && typeof error.type === "string"
			? error.type
			: (/\(([A-Z][A-Z_]+)\)/u.exec(error.message)?.[1] ?? "");
	if (type === "CANNOT_COMPILE_REGEXP")
		return {
			kind: "recoverable",
			message: `The regex does not compile in RE2: ${/error: ([^.]*)/u.exec(error.message)?.[1] ?? "invalid pattern"}.`,
			fragment: null,
			fix: "RE2 has no lookaround or backreferences; escape . ( ) [ ] { } * + ? | ^ $ \\ to match them literally, prefix (?i) to ignore case, or search the literal string with mode exact.",
		};
	if (
		type === "TIMEOUT_EXCEEDED" ||
		type === "TOO_MANY_ROWS" ||
		type === "TOO_MANY_BYTES" ||
		type === "MEMORY_LIMIT_EXCEEDED"
	)
		return {
			kind: "recoverable",
			message:
				"The search read more than one query may: the window holds too much transcript text.",
			fragment: null,
			fix: "Narrow filters.since and filters.until, or add filters.kinds, filters.source or filters.userId, and search again.",
		};
	return null;
}

/** A rewrite to try when nothing matched, from what was asked and what was searched. */
function suggestRewrite(
	text: string,
	mode: SearchMode,
	coverage: { sessions: number; indexed: number },
): string {
	if (coverage.sessions === 0)
		return "No session ran in the window; widen filters.since, or rank runs with sql and open them with read.";
	if (mode === "meaning" && coverage.indexed === 0)
		return "No session in the window is indexed for search yet; widen filters.since, search with mode exact, or rank runs with sql and open them with read.";
	const words = text.split(/\s+/u).filter(Boolean);
	if (mode === "regex")
		return `No run matches the regex ${text}. RE2 is case-sensitive unless the pattern starts with (?i); loosen it, widen filters.since, or search a literal part with mode exact.`;
	if (mode === "exact")
		return words.length > 1
			? `No run contains "${text}" exactly. Search its most specific part alone (a flag, file name or error code, e.g. "${words.reduce((longest, word) => (word.length > longest.length ? word : longest), "")}"), or search by meaning with a description of what happened.`
			: `No run contains "${text}" exactly. Check the spelling, widen filters.since, or search by meaning with a description of what happened.`;
	return `Nothing close to "${text}". Describe what happened in other words (e.g. "the agent could not find the billing file"), widen filters.since, drop filters.kinds, or search a literal string with mode exact.`;
}

/** ClickHouse DateTime64 text in UTC. */
function chTime(date: Date): string {
	return date.toISOString().replace("T", " ").replace("Z", "");
}
