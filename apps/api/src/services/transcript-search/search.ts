import {
	type AnalysisSearchInput,
	type AnalysisSearchOutput,
	SEARCH_DEFAULT_DAYS,
	SEARCH_MAX_DAYS,
	SEARCH_MODES,
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
import { SEARCH_PAID_PLANS, type SearchAccess } from "./access.js";
import { CHUNK_OVERLAP_CHARS } from "./chunks.js";
import {
	estimateEmbeddingTokens,
	TRANSCRIPT_EMBEDDING_DIMENSIONS,
	type TranscriptEmbedder,
} from "./config.js";
import type { EmbeddingQuota } from "./quota.js";
import {
	TRANSCRIPT_CHUNK_HITS_TABLE,
	TRANSCRIPT_CHUNKS_TABLE,
} from "./tables.js";

/**
 * Hybrid search over transcripts (docs/retro-architecture.md, "Tools"): the
 * chunks nearest in meaning to the text (cosine over the 8-bit vectors) and
 * the chunks that contain it exactly (case-insensitive), each ranked, merged
 * per run by reciprocal-rank fusion, and returned as runs of the committed
 * run index with why each matched and a snippet. One statement serves the
 * `search` tool and `search('…')` inside sql, scoped like the views.
 *
 * Bounded for a small ClickHouse: chunks are read only from the window's
 * months (30 days by default, at most 180), and the 2,000 nearest and the
 * first 5,000 exact chunks there are candidates; the hits of the window are
 * read once and joined to them; a run matches only in the transcript
 * generation its committed run index build was made from. No ANN index: an
 * HNSW index needs Float vectors and lives in memory. The sql limits apply
 * (10 s, 512 MiB, rows and bytes read).
 */

export const SEARCH_LIMITS = {
	/** Runs the search tool returns. */
	toolResults: 20,
	/** Runs `search('…')` gives a sql query to filter, join and rank. */
	sqlResults: 200,
	/** Nearest chunks in the window's months: candidates for meaning. */
	meaningCandidates: 2_000,
	/** Chunks with the text in the window's months: candidates for exact. */
	exactCandidates: 5_000,
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
	/** Whether a workspace is indexed for search: a paid plan, or internal. */
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
});
const CoverageRowSchema = z.object({
	sessions: z.coerce.number(),
	indexed: z.coerce.number(),
	pending: z.coerce.number(),
	truncated: z.coerce.number(),
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
	);
	if (!read.ok) return read;
	const [rows, covered, quota] = read.value;
	const results = z
		.array(ResultRowSchema)
		.parse(rows)
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
	const notices = [
		...meaning.notices,
		...longTextNotice(text, meaning.mode),
		...coverageNotices(covered),
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
			coverage: {
				sessions: covered.sessions,
				indexed: covered.indexed,
				pending: covered.pending,
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
					? suggestRewrite(text, meaning.mode, covered)
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
							source: "",
							userId: "",
						}),
					);
					notices.push(
						...[
							...meaning.notices,
							...longTextNotice(args.text, meaning.mode),
						].map((notice) => `search('${args.text}'): ${notice}`),
					);
				}
				return { params, notices };
			} finally {
				embedding.dispose();
			}
		},
	};
}

/**
 * The search statement, its parameters named from `prefix`. Scoped by the
 * same bound parameters as the views: the workspace, and the member where the
 * reader is held to their own sessions. The chunk table is read once, in the
 * window's months; the hit table is read once, in the window; and a run
 * matches only through hits of the transcript generation its committed run
 * index build was made from, so a superseded build or generation never does.
 */
export function searchStatement(
	prefix: string,
	memberOnly: boolean,
	limit: number,
): string {
	const p = (name: string, type: string) => `{${prefix}_${name}:${type}}`;
	const scope = scopeSql(memberOnly);
	const text = p("text", "String");
	const since = p("since", "DateTime64(3, 'UTC')");
	const until = p("until", "DateTime64(3, 'UTC')");
	const user = `(${p("user", "String")} = '' OR user_id = ${p("user", "String")})`;
	const months = `month >= toStartOfMonth(${since}) AND month <= toStartOfMonth(${until})`;
	const name = (cte: string) => `${prefix}_${cte}`;
	const snippet = SEARCH_LIMITS.snippetChars;
	return `WITH
		${name("chunks")} AS (
			SELECT user_id, chunk_hash, max(chunk_similarity) AS similarity, max(chunk_meaning) AS in_meaning,
				max(chunk_exact) AS in_exact, argMax(chunk_snippet, (chunk_exact, chunk_similarity)) AS snippet
			FROM (
				(SELECT user_id, chunk_hash, 1 - cosineDistance(embedding, ${p("vector", "Array(Float32)")}) AS chunk_similarity,
					1 AS chunk_meaning, 0 AS chunk_exact, substringUTF8(text, 1, ${snippet}) AS chunk_snippet
				FROM ${TRANSCRIPT_CHUNKS_TABLE}
				WHERE ${scope} AND ${months} AND ${user} AND ${p("meaning", "UInt8")} = 1 AND notEmpty(embedding)
					AND chunk_similarity >= ${MEANING_MIN_SIMILARITY}
				ORDER BY chunk_similarity DESC LIMIT ${SEARCH_LIMITS.meaningCandidates})
				UNION ALL
				(SELECT user_id, chunk_hash, 0 AS chunk_similarity, 0 AS chunk_meaning, 1 AS chunk_exact,
					substringUTF8(text, greatest(1, toInt64(positionCaseInsensitiveUTF8(text, ${text})) - 80), ${snippet}) AS chunk_snippet
				FROM ${TRANSCRIPT_CHUNKS_TABLE}
				WHERE ${scope} AND ${months} AND ${user} AND ${p("exact", "UInt8")} = 1 AND positionCaseInsensitiveUTF8(text, ${text}) > 0
				LIMIT ${SEARCH_LIMITS.exactCandidates})
			)
			GROUP BY user_id, chunk_hash
		),
		${name("matched")} AS (
			SELECT h.user_id AS user_id, h.session_id AS session_id, h.agent_id AS agent_id, h.turn_idx AS turn_idx,
				h.revision AS revision, h.parser_version AS parser_version,
				max(c.in_meaning) AS meaning, maxIf(c.similarity, c.in_meaning = 1) AS similarity,
				argMaxIf(c.snippet, c.similarity, c.in_meaning = 1) AS meaning_snippet,
				argMaxIf(h.kind, c.similarity, c.in_meaning = 1) AS meaning_kind,
				argMaxIf(h.tool_name, c.similarity, c.in_meaning = 1) AS meaning_tool,
				uniqExactIf((h.record_idx, h.block_idx, h.chunk_idx), c.in_exact = 1) AS exact_hits,
				anyIf(c.snippet, c.in_exact = 1) AS exact_snippet,
				arraySort(groupUniqArrayIf(h.kind, c.in_exact = 1)) AS exact_kinds
			FROM (
				SELECT user_id, session_id, agent_id, turn_idx, record_idx, block_idx, chunk_idx, chunk_hash, kind, tool_name,
					revision, parser_version
				FROM ${TRANSCRIPT_CHUNK_HITS_TABLE}
				WHERE ${scope} AND record_idx < ${TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX}
					AND ts >= ${since} AND ts < ${until} AND ${user}
					AND (empty(${p("kinds", "Array(String)")}) OR has(${p("kinds", "Array(String)")}, kind))
					AND (${p("source", "String")} = '' OR source = ${p("source", "String")})
			) AS h
			INNER JOIN ${name("chunks")} AS c ON h.user_id = c.user_id AND h.chunk_hash = c.chunk_hash
			GROUP BY h.user_id, h.session_id, h.agent_id, h.turn_idx, h.revision, h.parser_version
		),
		${name("ranked")} AS (
			SELECT r.run_id AS run_id, x.user_id AS user_id, x.session_id AS session_id, x.agent_id AS agent_id,
				x.turn_idx AS turn_idx, r.started_at AS started_at, x.meaning AS meaning, x.similarity AS similarity,
				x.meaning_snippet AS meaning_snippet, x.meaning_kind AS meaning_kind, x.meaning_tool AS meaning_tool,
				x.exact_hits AS exact_hits, x.exact_snippet AS exact_snippet, x.exact_kinds AS exact_kinds,
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
			if(exact_hits > 0, concat('exact ×', toString(exact_hits), ' in ', arrayStringConcat(exact_kinds, ', ')), '')
		]), '; ') AS why,
		if(exact_hits > 0, exact_snippet, meaning_snippet) AS snippet
	FROM ${name("ranked")}
	ORDER BY score DESC, started_at DESC, run_id
	LIMIT ${limit}`;
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
	return `SELECT run_id, user_id, session_id, agent_id, turn_idx, started_at, source, revision, parser_version
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
	return `SELECT count() AS sessions, countIf(c.indexed = 1) AS indexed, countIf(c.pending > 0) AS pending,
		countIf(c.truncated > 0) AS truncated
	FROM (
		SELECT DISTINCT user_id, session_id, revision, parser_version FROM (${committedRunsSql(memberOnly)})
		WHERE started_at >= {opaline_search_since:DateTime64(3, 'UTC')} AND started_at < {opaline_search_until:DateTime64(3, 'UTC')}
			AND ({opaline_search_source:String} = '' OR source = {opaline_search_source:String})
			AND ({opaline_search_user:String} = '' OR user_id = {opaline_search_user:String})
	) AS s
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
				row ?? { sessions: 0, indexed: 0, pending: 0, truncated: 0 },
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
	if (mode === "exact")
		return {
			mode,
			vector: ZERO_VECTOR,
			embedded: embedder !== null,
			notices: indexed
				? []
				: [`${SEARCH_PAID_PLANS}; only sessions indexed before can match.`],
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
	if (!indexed) return unavailable(SEARCH_PAID_PLANS);
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
		source: string;
		userId: string;
	},
): Record<string, unknown> {
	return {
		[`${prefix}_text`]: search.text,
		[`${prefix}_vector`]: [...search.vector],
		[`${prefix}_meaning`]: search.mode === "exact" ? 0 : 1,
		[`${prefix}_exact`]: search.mode === "meaning" ? 0 : 1,
		[`${prefix}_since`]: chTime(search.since),
		[`${prefix}_until`]: chTime(search.until),
		[`${prefix}_kinds`]: [...search.kinds],
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
			fix: `Call search('text'), search('text', 'hybrid' | 'meaning' | 'exact') or search('text', 'exact', days) with days from 1 to ${SEARCH_MAX_DAYS}.`,
		},
	});
	const trimmed = text.trim();
	if (
		call.args.length > 3 ||
		trimmed.length < 2 ||
		trimmed.length > SEARCH_TEXT_MAX_CHARS
	)
		return refuse(
			`search() takes the text to find (2 to ${SEARCH_TEXT_MAX_CHARS} characters), then optionally a mode and a number of days.`,
		);
	const knownMode = SEARCH_MODES.find((candidate) => candidate === mode);
	if (!knownMode)
		return refuse(
			`search() mode must be hybrid, meaning or exact, not ${mode}.`,
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

function coverageNotices(coverage: Coverage): string[] {
	const notices: string[] = [];
	if (coverage.indexed < coverage.sessions)
		notices.push(
			`not searched: ${coverage.sessions - coverage.indexed} of ${coverage.sessions} sessions that ran in the window are not indexed for search yet (uploaded before search started, still indexing, or re-uploaded and not rebuilt yet); unknown, not absent.`,
		);
	if (coverage.pending > 0)
		notices.push(
			`exact only: ${coverage.pending} indexed sessions have chunks without a vector (the workspace's OpenAI quota or the upload's time ran out, or OpenAI failed); their runs match by exact string, not by meaning, until a later upload embeds them.`,
		);
	if (coverage.truncated > 0)
		notices.push(
			`partly searched: ${coverage.truncated} indexed sessions have records too long to keep whole (long tool outputs or files); only their first 64K and last 1K characters are searched, so a match in the middle is unknown, not absent.`,
		);
	return notices;
}

/** Exact matching is complete up to the chunks' overlap; past it, a string across a cut is missed. */
function longTextNotice(text: string, mode: SearchMode): string[] {
	return mode !== "meaning" && text.length > CHUNK_OVERLAP_CHARS
		? [
				`exact matches longer than ${CHUNK_OVERLAP_CHARS} characters are found only inside one chunk; one that crosses a chunk boundary is missed. Search a shorter, specific part for a complete exact search.`,
			]
		: [];
}

/** A rewrite to try when nothing matched, from what was asked and what was searched. */
function suggestRewrite(
	text: string,
	mode: SearchMode,
	coverage: { sessions: number; indexed: number },
): string {
	if (coverage.indexed === 0)
		return "No session in the window is indexed for search yet; widen filters.since, or rank runs with sql and open them with read.";
	const words = text.split(/\s+/u).filter(Boolean);
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
