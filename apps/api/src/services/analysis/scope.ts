import type { AnalysisFindInput } from "@rudel/api-routes";
import { decodeTranscriptRecordsReceipt } from "@rudel/api-routes/transcript-records";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import {
	buildCommittedGenerationsStatement,
	type SessionGeneration,
	type TranscriptReadScope,
} from "../transcript-records-queries.js";
import {
	descendantSessions,
	type FamilyPosition,
	familyPosition,
	loadSessionFamilies,
	type SessionFamilies,
} from "./lineage.js";
import { ANALYSIS_QUERY_SETTINGS } from "./sql.js";

export interface AnalysisScope {
	organizationId: string;
	/** Null for a workspace admin looking across members. */
	userId: string | null;
}

const SessionSchema = z.object({
	session_id: z.string(),
	user_id: z.string(),
	source: z.enum(["claude_code", "codex"]),
	model: z.string(),
	repository: z.string(),
});
type SessionRow = z.infer<typeof SessionSchema>;

/** A session in scope with its place in its Codex subagent family. */
export interface AnalysisSession extends SessionRow, FamilyPosition {}

/** One owner's indexed sessions, small enough for one set of statements. */
export interface ScopeBatch {
	scope: TranscriptReadScope;
	generations: SessionGeneration[];
	sessions: AnalysisSession[];
}

export interface ResolvedScope {
	from: string;
	to: string;
	sessionsInScope: number;
	indexedSessions: number;
	/** The session census hit MAX_SESSIONS; only the newest are covered. */
	sessionCapReached: boolean;
	/** Sessions in scope that are Codex subagent threads of another session. */
	subagentThreads: number;
	batches: ScopeBatch[];
}

const MAX_SESSIONS = 10_000;
/** Small enough that parameter arrays fit in the request URL. */
const BATCH_SESSIONS = 50;
/**
 * Records of the pinned generations (receipt row counts) per batch. Run facts
 * take roughly 1 KiB of ClickHouse memory per record, so this keeps one
 * statement far below the 1 GiB `max_memory_usage`; a larger session gets a
 * batch of its own.
 */
const BATCH_RECORDS = 200_000;
const DEFAULT_DAYS = 7;
/**
 * Lineage read for a window starts this many days before it: a thread in
 * range resolves its parent chain through threads started up to a month
 * earlier, and older ancestors make it the top of its family.
 */
const FAMILY_LOOKBACK_DAYS = 30;

/**
 * The sessions a find covers, each with its family position, batched per
 * owner. Codex subagent threads count with the session that spawned them: a
 * session in scope brings all its native descendants (whatever their date or
 * model), and `latest` counts families (top sessions with their threads), not
 * threads. Each session appears once, so costs are never counted twice.
 */
export async function resolveScope(
	executor: ClickHouseExecutor,
	scope: AnalysisScope,
	input: AnalysisFindInput,
	batchRecords = BATCH_RECORDS,
): Promise<ResolvedScope> {
	const { from, to } = defaultRange(input);
	const [found, families] = await Promise.all([
		querySessions(executor, buildSessionsStatement(scope, input, from, to)),
		loadSessionFamilies(executor, scope, {
			childSince: shiftDays(from, -FAMILY_LOOKBACK_DAYS),
		}),
	]);
	const selected = input.latest
		? newestFamilies(found.slice(0, MAX_SESSIONS), input.latest, families)
		: found.slice(0, MAX_SESSIONS);
	const capReached =
		found.length > MAX_SESSIONS &&
		(!input.latest || familyCount(selected, families) < input.latest);
	// With refs only the named runs count, so their families are not pulled in.
	const threads = input.refs
		? []
		: await queryDescendants(executor, scope, selected, families);
	const sessions = [...selected, ...threads]
		.slice(0, MAX_SESSIONS)
		.map((session) => ({
			...session,
			...familyPosition(families, session.user_id, session.session_id),
		}));
	const resolved: ResolvedScope = {
		from,
		to,
		sessionsInScope: sessions.length,
		indexedSessions: 0,
		sessionCapReached:
			capReached || selected.length + threads.length > MAX_SESSIONS,
		subagentThreads: sessions.filter((session) => session.depth > 0).length,
		batches: [],
	};
	for (const userId of new Set(sessions.map((session) => session.user_id))) {
		const owned = sessions.filter((session) => session.user_id === userId);
		for (let offset = 0; offset < owned.length; offset += BATCH_SESSIONS) {
			const batchSessions = owned.slice(offset, offset + BATCH_SESSIONS);
			const ownerScope = { organizationId: scope.organizationId, userId };
			const generations = await queryCountedGenerations(
				executor,
				ownerScope,
				batchSessions.map((session) => session.session_id),
			);
			resolved.indexedSessions += generations.length;
			for (const batch of batchByRecords(generations, batchRecords)) {
				const ids = new Set(batch.map((generation) => generation.sessionId));
				resolved.batches.push({
					scope: ownerScope,
					generations: batch,
					sessions: batchSessions.filter((session) =>
						ids.has(session.session_id),
					),
				});
			}
		}
	}
	return resolved;
}

/** A committed generation with its record count from the receipt. */
export interface CountedGeneration extends SessionGeneration {
	readonly records: number;
}

const CountedGenerationRowSchema = z
	.object({
		session_id: z.string(),
		revision_text: z.string(),
		parser_version: z.number(),
		receipt: z.string(),
	})
	.transform(
		(row): CountedGeneration => ({
			sessionId: row.session_id,
			revision: row.revision_text,
			parserVersion: row.parser_version,
			// An unreadable receipt counts as a full batch, so its session is read alone.
			records:
				decodeTranscriptRecordsReceipt(row.receipt)?.rowCount ?? BATCH_RECORDS,
		}),
	);

/** Committed generations of the given sessions (at most `BATCH_SESSIONS`), in session order. */
export async function queryCountedGenerations(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	sessionIds: readonly string[],
): Promise<CountedGeneration[]> {
	return z
		.array(CountedGenerationRowSchema)
		.parse(
			await executor.query<unknown>(
				buildCommittedGenerationsStatement(scope, sessionIds),
			),
		);
}

/**
 * Consecutive groups whose records sum to at most `maxRecords`; order is
 * kept, so scans that page through batches in turn see the same sequence.
 */
export function batchByRecords(
	generations: readonly CountedGeneration[],
	maxRecords = BATCH_RECORDS,
): SessionGeneration[][] {
	const batches: SessionGeneration[][] = [];
	let current: SessionGeneration[] = [];
	let records = 0;
	for (const { records: count, ...generation } of generations) {
		if (current.length && records + count > maxRecords) {
			batches.push(current);
			current = [];
			records = 0;
		}
		current.push(generation);
		records += count;
	}
	if (current.length) batches.push(current);
	return batches;
}

/**
 * Sessions of the newest `latest` families, newest first: a family is ranked
 * by its newest matching session and contributes all its matching sessions.
 */
function newestFamilies(
	sessions: readonly SessionRow[],
	latest: number,
	families: SessionFamilies,
): SessionRow[] {
	const roots = new Set<string>();
	for (const session of sessions) {
		if (roots.size === latest) break;
		roots.add(rootKey(session, families));
	}
	return sessions.filter((session) => roots.has(rootKey(session, families)));
}

function familyCount(
	sessions: readonly SessionRow[],
	families: SessionFamilies,
): number {
	return new Set(sessions.map((session) => rootKey(session, families))).size;
}

function rootKey(session: SessionRow, families: SessionFamilies): string {
	const { rootSessionId } = familyPosition(
		families,
		session.user_id,
		session.session_id,
	);
	return JSON.stringify([session.user_id, rootSessionId]);
}

/** Native descendants of `selected` that it does not already hold, by owner. */
async function queryDescendants(
	executor: ClickHouseExecutor,
	scope: AnalysisScope,
	selected: readonly SessionRow[],
	families: SessionFamilies,
): Promise<SessionRow[]> {
	const threads: SessionRow[] = [];
	for (const userId of new Set(selected.map((session) => session.user_id))) {
		const ids = descendantSessions(
			families,
			userId,
			selected
				.filter((session) => session.user_id === userId)
				.map((session) => session.session_id),
		);
		for (let offset = 0; offset < ids.length; offset += BATCH_SESSIONS)
			threads.push(
				...(await querySessions(
					executor,
					buildSessionsByIdStatement(
						{ organizationId: scope.organizationId, userId },
						ids.slice(offset, offset + BATCH_SESSIONS),
					),
				)),
			);
	}
	return threads;
}

async function querySessions(
	executor: ClickHouseExecutor,
	statement: ClickHouseStatement,
): Promise<SessionRow[]> {
	return z.array(SessionSchema).parse(await executor.query<unknown>(statement));
}

export function defaultRange(input: Pick<AnalysisFindInput, "from" | "to">) {
	const to = input.to ?? new Date().toISOString().slice(0, 10);
	return { from: input.from ?? shiftDays(to, 1 - DEFAULT_DAYS), to };
}

function buildSessionsStatement(
	scope: AnalysisScope,
	input: AnalysisFindInput,
	from: string,
	to: string,
): ClickHouseStatement {
	const filters = [
		"organization_id = {organizationId:String}",
		"toDate(session_date, 'UTC') BETWEEN {from:Date} AND {to:Date}",
	];
	const optional = {
		user_id: ["userId", scope.userId],
		source: ["agent", input.agent],
		session_id: ["sessionId", input.sessionId],
	} as const;
	const params: Record<string, unknown> = {
		organizationId: scope.organizationId,
		from,
		to,
		limit: MAX_SESSIONS + 1,
	};
	for (const [column, [name, value]] of Object.entries(optional)) {
		if (!value) continue;
		filters.push(`${column} = {${name}:String}`);
		params[name] = value;
	}
	if (input.model) {
		// A session qualifies by its recorded model or by any usage of the model;
		// find then keeps only the runs whose usage includes it.
		filters.push(`(model_used = {model:String} OR session_id IN (
			SELECT session_id FROM ${getSafeClickHouseTable("rudel.usage_events")}
			WHERE organization_id = {organizationId:String}
				${scope.userId ? "AND user_id = {userId:String}" : ""}
				AND usage_date >= {from:Date} AND record_kind = 'event' AND is_deleted = 0
				AND (resolved_model = {model:String} OR raw_model = {model:String})))`);
		params.model = input.model;
	}
	if (input.repository) {
		filters.push(
			"(git_remote = {repository:String} OR package_name = {repository:String} OR project_path = {repository:String})",
		);
		params.repository = input.repository;
	}
	if (input.refs) {
		filters.push("session_id IN {refSessions:Array(String)}");
		params.refSessions = [...new Set(input.refs.map((ref) => ref.sessionId))];
	}
	return sessionsStatement(filters, params);
}

/** One owner's sessions by id, whatever their date (subagent threads of sessions in scope). */
function buildSessionsByIdStatement(
	scope: { organizationId: string; userId: string },
	sessionIds: readonly string[],
): ClickHouseStatement {
	return sessionsStatement(
		[
			"organization_id = {organizationId:String}",
			"user_id = {userId:String}",
			"session_id IN {sessionIds:Array(String)}",
		],
		{ ...scope, sessionIds: [...sessionIds], limit: sessionIds.length },
	);
}

function sessionsStatement(
	filters: readonly string[],
	params: Record<string, unknown>,
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT session_id, user_id, source, model_used AS model,
				coalesce(nullIf(git_remote, ''), nullIf(package_name, ''), project_path) AS repository
			FROM ${getSafeClickHouseTable("rudel.session_analytics")} FINAL
			WHERE ${filters.join(" AND ")}
			ORDER BY session_date DESC, session_id, user_id LIMIT 1 BY user_id, session_id
			LIMIT {limit:UInt32}`,
		query_params: params,
	};
}

function shiftDays(day: string, days: number): string {
	return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000)
		.toISOString()
		.slice(0, 10);
}
