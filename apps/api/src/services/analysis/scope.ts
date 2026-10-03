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
export type AnalysisSession = z.infer<typeof SessionSchema>;

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

export async function resolveScope(
	executor: ClickHouseExecutor,
	scope: AnalysisScope,
	input: AnalysisFindInput,
	batchRecords = BATCH_RECORDS,
): Promise<ResolvedScope> {
	const { from, to } = defaultRange(input);
	const found = z
		.array(SessionSchema)
		.parse(
			await executor.query<unknown>(
				buildSessionsStatement(scope, input, from, to),
			),
		);
	const sessions = found.slice(0, MAX_SESSIONS);
	const resolved: ResolvedScope = {
		from,
		to,
		sessionsInScope: sessions.length,
		indexedSessions: 0,
		sessionCapReached: found.length > sessions.length,
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
		model_used: ["model", input.model],
		session_id: ["sessionId", input.sessionId],
	} as const;
	const params: Record<string, unknown> = {
		organizationId: scope.organizationId,
		from,
		to,
		latest: input.latest ?? MAX_SESSIONS + 1,
	};
	for (const [column, [name, value]] of Object.entries(optional)) {
		if (!value) continue;
		filters.push(`${column} = {${name}:String}`);
		params[name] = value;
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
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT session_id, user_id, source, model_used AS model,
				coalesce(nullIf(git_remote, ''), nullIf(package_name, ''), project_path) AS repository
			FROM ${getSafeClickHouseTable("rudel.session_analytics")} FINAL
			WHERE ${filters.join(" AND ")}
			ORDER BY session_date DESC, session_id, user_id LIMIT 1 BY user_id, session_id
			LIMIT {latest:UInt32}`,
		query_params: params,
	};
}

function shiftDays(day: string, days: number): string {
	return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000)
		.toISOString()
		.slice(0, 10);
}
