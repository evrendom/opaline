import { createHash } from "node:crypto";
import { CALL_FACTS_TABLE } from "@rudel/ch-schema/call-facts";
import type { RudelRunIndexRow } from "@rudel/ch-schema/generated";
import { RUN_SETUP_TABLE } from "@rudel/ch-schema/received-setup";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import {
	buildReceivedSetupBatchStatement,
	ReceivedSetupRecordSchema,
} from "../analysis/received-setup-sql.js";
import {
	buildDirectoryEvidenceBatchStatement,
	buildRunDirectoriesBatchStatement,
	DirectoryEvidenceRowSchema,
	RunDirectoryRowSchema,
} from "../analysis/run-directories.js";
import { isRunIndexColumnRecordable } from "../analysis/run-index-columns.js";
import { readCommittedRunIndex } from "../analysis/run-index-reader.js";
import {
	buildCodexLifecycleBatchStatement,
	buildCodexTurnMarksBatchStatement,
	buildMcpStateBatchStatement,
	buildRunIndexBatchStatement,
	buildRunIndexSessionBatchStatement,
	buildRunRequestsBatchStatement,
	buildUnattributedUsageBatchStatement,
	CodexLifecycleRowSchema,
	CodexTurnMarkSchema,
	McpStateRowSchema,
	RUN_FORK_REPLAY,
	RunIndexFactsRowSchema,
	RunIndexSessionFactsSchema,
	RunRequestFactsRowSchema,
	UnattributedUsageRowSchema,
	type UsageBoundGeneration,
} from "../analysis/run-index-sql.js";
import {
	buildRunMessagesBatchStatement,
	RunMessagesRowSchema,
} from "../analysis/run-messages.js";
import { queryCountedGenerations } from "../analysis/scope.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "../analysis/sql.js";
import type { SessionGeneration } from "../transcript-records-queries.js";
import {
	CallTuplesSchema,
	callFactsCtes,
	callTuplesBatchSql,
} from "./call-facts.js";
import { type SessionIdentity, sessionScopeId } from "./l1-edge-ids.js";
import { RUN_INDEX_TABLE, RUN_REQUESTS_TABLE } from "./l1-edge-tables.js";
import {
	assembleRunIndexRows,
	assertUsageConserved,
	planRunIndexBuild,
	RUN_INDEX_MAX_SESSION_RECORDS,
	type RunIndexBuild,
	type RunIndexReads,
	type RunIndexRows,
	RunIndexSessionRecordSchema,
	RunIndexUsageChangedError,
	readRunIndexUsageBatch,
	withoutTranscript,
} from "./run-index.service.js";

export interface RunIndexBatchLimits {
	readonly maxSessions: number;
	readonly maxRecords: number;
}

/**
 * Most of a small session's build is ClickHouse planning the statements, not
 * reading its records, so batches are as large as the result and memory
 * limits of one statement allow.
 */
export const RUN_INDEX_BATCH_LIMITS: RunIndexBatchLimits = {
	maxSessions: 48,
	maxRecords: 60_000,
};

const BATCH_RESULT_SETTINGS = {
	max_result_rows: "1000000",
	max_result_bytes: "268435456",
};

export interface RunIndexBatchClaim {
	readonly session: SessionIdentity;
	readonly buildRevision: number;
}

export type RunIndexBatchOutcome =
	| { readonly kind: "built"; readonly build: RunIndexBuild }
	| { readonly kind: "failed"; readonly error: unknown }
	| { readonly kind: "lease_lost" };

export interface RunIndexBatchInput {
	readonly executor: ClickHouseExecutor;
	readonly organizationId: string;
	readonly userId: string;
	readonly claims: readonly RunIndexBatchClaim[];
	readonly beforeWrite: (
		sessionIds: readonly string[],
	) => Promise<ReadonlySet<string>>;
	readonly now?: () => Date;
	readonly maxSessionRecords?: number;
	readonly limits?: RunIndexBatchLimits;
}

interface PlannedSession {
	readonly claim: RunIndexBatchClaim;
	readonly plan: Extract<
		ReturnType<typeof planRunIndexBuild>,
		{ kind: "build" }
	>;
}

export async function buildRunIndexBatch(
	input: RunIndexBatchInput,
): Promise<Map<string, RunIndexBatchOutcome>> {
	const { executor, organizationId, userId } = input;
	const scope = { organizationId, userId };
	const outcomes = new Map<string, RunIndexBatchOutcome>();
	const sessionIds = input.claims.map((claim) => claim.session.sessionId);
	if (sessionIds.length === 0) return outcomes;
	const [committed, markers, usages] = await Promise.all([
		queryCountedGenerations(executor, scope, sessionIds),
		readCommittedRunIndex(executor, scope, sessionIds, "receipt"),
		readRunIndexUsageBatch(executor, organizationId, userId, sessionIds),
	]);
	const committedBySession = new Map(
		committed.map((generation) => [generation.sessionId, generation]),
	);
	const markerBySession = new Map<string, RudelRunIndexRow>();
	for (const marker of markers)
		if (!markerBySession.has(marker.session_id))
			markerBySession.set(marker.session_id, marker);
	const planned: PlannedSession[] = [];
	for (const claim of input.claims) {
		const { sessionId } = claim.session;
		const generation = committedBySession.get(sessionId);
		const marker = markerBySession.get(sessionId);
		if (!generation) {
			outcomes.set(sessionId, {
				kind: "built",
				build: withoutTranscript(marker),
			});
			continue;
		}
		const usage = usages.get(sessionId);
		if (!usage) throw new Error(`No usage state for session ${sessionId}`);
		const plan = planRunIndexBuild(
			generation,
			marker,
			usage,
			input.maxSessionRecords ?? RUN_INDEX_MAX_SESSION_RECORDS,
			claim.session.source,
		);
		if (plan.kind === "done")
			outcomes.set(sessionId, { kind: "built", build: plan.build });
		else planned.push({ claim, plan });
	}
	for (const batch of runIndexBatches(
		planned,
		input.limits ?? RUN_INDEX_BATCH_LIMITS,
	))
		for (const [sessionId, outcome] of await buildBatchSplitting(input, batch))
			outcomes.set(sessionId, outcome);
	return outcomes;
}

export function runIndexBatches<T extends { plan: { records: number } }>(
	sessions: readonly T[],
	limits: RunIndexBatchLimits,
): T[][] {
	const batches: T[][] = [];
	let current: T[] = [];
	let records = 0;
	for (const session of sessions) {
		if (
			current.length > 0 &&
			(current.length >= limits.maxSessions ||
				records + session.plan.records > limits.maxRecords)
		) {
			batches.push(current);
			current = [];
			records = 0;
		}
		current.push(session);
		records += session.plan.records;
	}
	if (current.length > 0) batches.push(current);
	return batches;
}

async function buildBatchSplitting(
	input: RunIndexBatchInput,
	batch: readonly PlannedSession[],
): Promise<Map<string, RunIndexBatchOutcome>> {
	try {
		return await buildBatch(input, batch);
	} catch (error) {
		if (error instanceof RunIndexBatchFencedError) throw error.cause;
		if (batch.length === 1) {
			const [only] = batch;
			return new Map([
				[only?.claim.session.sessionId ?? "", { kind: "failed", error }],
			]);
		}
		const half = Math.ceil(batch.length / 2);
		const outcomes = await buildBatchSplitting(input, batch.slice(0, half));
		for (const [sessionId, outcome] of await buildBatchSplitting(
			input,
			batch.slice(half),
		))
			outcomes.set(sessionId, outcome);
		return outcomes;
	}
}

class RunIndexBatchFencedError extends Error {
	constructor(readonly cause: unknown) {
		super("The batch's writes were fenced");
		this.name = "RunIndexBatchFencedError";
	}
}

async function buildBatch(
	input: RunIndexBatchInput,
	batch: readonly PlannedSession[],
): Promise<Map<string, RunIndexBatchOutcome>> {
	const { executor, organizationId, userId } = input;
	const now = input.now ?? (() => new Date());
	const outcomes = new Map<string, RunIndexBatchOutcome>();
	const reads = await readBatch(
		executor,
		{ organizationId, userId },
		batch.map(({ claim, plan }) => ({
			session: claim.session,
			bound: plan.bound,
		})),
	);
	const usages = await readRunIndexUsageBatch(
		executor,
		organizationId,
		userId,
		batch.map(({ claim }) => claim.session.sessionId),
	);
	const ready: { planned: PlannedSession; rows: RunIndexRows }[] = [];
	for (const planned of batch) {
		await new Promise<void>((resolve) => setImmediate(resolve));
		const { sessionId } = planned.claim.session;
		const read = reads.get(sessionId);
		try {
			if (!read)
				throw new Error("Run index session statements returned no row");
			if (usages.get(sessionId)?.key !== planned.plan.usage.key)
				throw new RunIndexUsageChangedError();
			assertUsageConserved(read.runs, read.unattributed, planned.plan.usage);
			ready.push({
				planned,
				rows: assembleRunIndexRows(
					{
						organizationId,
						session: planned.claim.session,
						generation: planned.plan.generation,
						parserVersion: planned.plan.bound.parserVersion,
						usage: planned.plan.usage,
						buildRevision: planned.claim.buildRevision,
						builtAt: now(),
					},
					read,
				),
			});
		} catch (error) {
			outcomes.set(sessionId, { kind: "failed", error });
		}
	}
	let writing = ready;
	const write = async (
		tag: string,
		table: string,
		values: (rows: RunIndexRows) => readonly object[],
	) => {
		if (writing.length === 0) return;
		let allowed: ReadonlySet<string>;
		try {
			allowed = await input.beforeWrite(
				writing.map(({ planned }) => planned.claim.session.sessionId),
			);
		} catch (error) {
			throw new RunIndexBatchFencedError(error);
		}
		for (const { planned } of writing)
			if (!allowed.has(planned.claim.session.sessionId))
				outcomes.set(planned.claim.session.sessionId, { kind: "lease_lost" });
		writing = writing.filter(({ planned }) =>
			allowed.has(planned.claim.session.sessionId),
		);
		const rows = writing.flatMap(({ rows }) => values(rows));
		if (rows.length === 0) return;
		await executor.insert({
			table,
			values: rows,
			asyncInsert: false,
			deduplicationToken: `${batchToken(organizationId, writing)}:${tag}`,
		});
	};
	await write("runs", RUN_INDEX_TABLE, (rows) => rows.runRows);
	await write("requests", RUN_REQUESTS_TABLE, (rows) => rows.requestRows);
	await write("setup", RUN_SETUP_TABLE, (rows) => rows.setupRows);
	await write("calls", CALL_FACTS_TABLE, (rows) => rows.callRows);
	const publishedAt = now();
	await write("receipt", RUN_INDEX_TABLE, (rows) => [
		rows.receipt(publishedAt),
	]);
	for (const { planned, rows } of writing)
		outcomes.set(planned.claim.session.sessionId, {
			kind: "built",
			build: {
				written: true,
				frozenReason: null,
				input: {
					...planned.plan.key,
					runs: rows.runRows.length,
					builtRevision: String(planned.claim.buildRevision),
				},
				runCount: rows.runRows.length,
			},
		});
	return outcomes;
}

function batchToken(
	organizationId: string,
	writing: readonly { planned: PlannedSession }[],
): string {
	const hash = createHash("sha256");
	for (const { planned } of writing) {
		const { generation } = planned.plan;
		hash.update(
			`${sessionScopeId(planned.claim.session)}:${generation.revision}:${generation.parserVersion}:${generation.indexVersion}:${planned.claim.buildRevision}\n`,
		);
	}
	return `run-index-batch:${organizationId}:${hash.digest("hex")}`;
}

const STATEMENTS_AT_ONCE = 3;

function limiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
	let running = 0;
	const waiting: (() => void)[] = [];
	return async (task) => {
		if (running >= limit)
			await new Promise<void>((resolve) => waiting.push(resolve));
		running++;
		try {
			return await task();
		} finally {
			running--;
			waiting.shift()?.();
		}
	};
}

const withSession = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
	schema.extend({ session_id: z.string() });

function bySession<T extends { session_id: string }>(
	rows: readonly T[],
): Map<string, T[]> {
	const grouped = new Map<string, T[]>();
	for (const row of rows) {
		const list = grouped.get(row.session_id);
		if (list) list.push(row);
		else grouped.set(row.session_id, [row]);
	}
	return grouped;
}

async function readBatch(
	executor: ClickHouseExecutor,
	scope: { organizationId: string; userId: string },
	sessions: readonly {
		session: SessionIdentity;
		bound: UsageBoundGeneration;
	}[],
): Promise<Map<string, RunIndexReads>> {
	const bounds = sessions.map(({ bound }) => bound);
	const generations: SessionGeneration[] = bounds.map((bound) => ({
		sessionId: bound.sessionId,
		revision: bound.revision,
		parserVersion: bound.parserVersion,
	}));
	const where = (keep: (entry: (typeof sessions)[number]) => boolean) =>
		sessions.filter(keep).map(({ bound }) => ({
			sessionId: bound.sessionId,
			revision: bound.revision,
			parserVersion: bound.parserVersion,
		}));
	const codex = where(({ session }) => session.source === "codex");
	const withCwd = where(({ session, bound }) =>
		isRunIndexColumnRecordable("cwd", bound.parserVersion, session.source),
	);
	const withMcp = where(({ session, bound }) =>
		isRunIndexColumnRecordable(
			"mcp_unavailable",
			bound.parserVersion,
			session.source,
		),
	);
	const limit = limiter(STATEMENTS_AT_ONCE);
	const runs = limit(() =>
		query(
			executor,
			RunIndexFactsRowSchema,
			buildRunIndexBatchStatement(scope, bounds, BATCH_RESULT_SETTINGS),
		),
	);
	const requests = limit(() =>
		query(
			executor,
			withSession(RunRequestFactsRowSchema),
			buildRunRequestsBatchStatement(scope, bounds, BATCH_RESULT_SETTINGS),
		),
	);
	const unattributed = limit(() =>
		query(
			executor,
			withSession(UnattributedUsageRowSchema),
			buildUnattributedUsageBatchStatement(
				scope,
				bounds,
				BATCH_RESULT_SETTINGS,
			),
		),
	);
	const facts = limit(() =>
		query(
			executor,
			withSession(RunIndexSessionFactsSchema).extend({
				calls: CallTuplesSchema,
			}),
			buildRunIndexSessionBatchStatement(
				scope,
				generations,
				{ ctes: callFactsCtes(), sql: callTuplesBatchSql() },
				{ max_result_rows: BATCH_RESULT_SETTINGS.max_result_rows },
			),
		),
	);
	const messages = limit(() =>
		query(
			executor,
			withSession(RunMessagesRowSchema),
			buildRunMessagesBatchStatement(scope, generations, BATCH_RESULT_SETTINGS),
		),
	);
	const setup = limit(() =>
		query(
			executor,
			withSession(ReceivedSetupRecordSchema),
			buildReceivedSetupBatchStatement(
				scope,
				generations,
				BATCH_RESULT_SETTINGS,
			),
		),
	);
	const lifecycle =
		codex.length === 0
			? Promise.resolve([])
			: limit(() =>
					query(
						executor,
						withSession(CodexLifecycleRowSchema),
						buildCodexLifecycleBatchStatement(
							scope,
							codex,
							BATCH_RESULT_SETTINGS,
						),
					),
				);
	const turnMarks =
		codex.length === 0
			? Promise.resolve([])
			: limit(() =>
					query(
						executor,
						withSession(CodexTurnMarkSchema),
						buildCodexTurnMarksBatchStatement(
							scope,
							codex,
							BATCH_RESULT_SETTINGS,
						),
					),
				);
	const directoryRows =
		withCwd.length === 0
			? Promise.resolve([])
			: limit(() =>
					query(
						executor,
						withSession(RunDirectoryRowSchema),
						buildRunDirectoriesBatchStatement(
							scope,
							withCwd,
							RUN_FORK_REPLAY,
							BATCH_RESULT_SETTINGS,
						),
					),
				);
	const mcpStates =
		withMcp.length === 0
			? Promise.resolve([])
			: limit(() =>
					query(
						executor,
						withSession(McpStateRowSchema),
						buildMcpStateBatchStatement(scope, withMcp, BATCH_RESULT_SETTINGS),
					),
				);
	for (const pending of [
		runs,
		requests,
		unattributed,
		facts,
		messages,
		setup,
		lifecycle,
		turnMarks,
		directoryRows,
		mcpStates,
	])
		pending.catch(() => undefined);
	const records = await limit(() =>
		query(
			executor,
			withSession(RunIndexSessionRecordSchema),
			sessionRecordsStatement(
				scope,
				sessions.map(({ session }) => session),
			),
		),
	);
	const recordedBySession = new Map(
		records.map((row) => [row.session_id, row]),
	);
	const evidence =
		withCwd.length === 0
			? Promise.resolve([])
			: limit(() =>
					query(
						executor,
						withSession(DirectoryEvidenceRowSchema),
						buildDirectoryEvidenceBatchStatement(
							scope,
							withCwd,
							new Map(
								withCwd.map((generation) => {
									const recorded = recordedBySession.get(generation.sessionId);
									return [
										generation.sessionId,
										{
											projectPath: recorded?.project_path ?? "",
											gitBranch: recorded?.git_branch ?? "",
										},
									];
								}),
							),
							RUN_FORK_REPLAY,
							BATCH_RESULT_SETTINGS,
						),
					),
				);
	const settled = await Promise.allSettled([
		runs,
		requests,
		unattributed,
		facts,
		messages,
		setup,
		lifecycle,
		turnMarks,
		directoryRows,
		mcpStates,
		evidence,
	]);
	for (const result of settled)
		if (result.status === "rejected") throw result.reason;
	const runsBy = bySession(await runs);
	const requestsBy = bySession(await requests);
	const unattributedBy = bySession(await unattributed);
	const factsBy = bySession(await facts);
	const messagesBy = bySession(await messages);
	const setupBy = bySession(await setup);
	const lifecycleBy = bySession(await lifecycle);
	const marksBy = bySession(await turnMarks);
	const directoriesBy = bySession(await directoryRows);
	const evidenceBy = bySession(await evidence);
	const mcpBy = bySession(await mcpStates);
	const cwdSessions = new Set(
		withCwd.map((generation) => generation.sessionId),
	);
	const reads = new Map<string, RunIndexReads>();
	for (const { session } of sessions) {
		const id = session.sessionId;
		const [sessionUnattributed] = unattributedBy.get(id) ?? [];
		const [sessionFacts] = factsBy.get(id) ?? [];
		if (!sessionUnattributed || !sessionFacts) continue;
		reads.set(id, {
			runs: runsBy.get(id) ?? [],
			requests: requestsBy.get(id) ?? [],
			unattributed: sessionUnattributed,
			facts: sessionFacts,
			messages: messagesBy.get(id) ?? [],
			lifecycle: lifecycleBy.get(id) ?? [],
			turnMarks: marksBy.get(id) ?? [],
			recorded: recordedBySession.get(id),
			setupRecords: setupBy.get(id) ?? [],
			directories: cwdSessions.has(id)
				? {
						rows: directoriesBy.get(id) ?? [],
						evidence: evidenceBy.get(id) ?? [],
					}
				: null,
			mcpStates: mcpBy.get(id) ?? [],
		});
	}
	return reads;
}

function sessionRecordsStatement(
	scope: { organizationId: string; userId: string },
	sessions: readonly Pick<SessionIdentity, "sessionId" | "source">[],
) {
	return {
		query: `SELECT session_id, coalesce(nullIf(git_remote, ''), nullIf(package_name, ''), project_path) AS repository,
				git_remote, project_path, ifNull(git_branch, '') AS git_branch, model_used AS model
			FROM ${getSafeClickHouseTable("rudel.session_analytics")} FINAL
			WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
				AND session_id IN {sessionIds:Array(String)}
				AND (session_id, source) IN (
					SELECT s.1, s.2 FROM (SELECT arrayJoin(arrayZip({sessionIds:Array(String)}, {sources:Array(String)})) AS s))
			ORDER BY session_id, session_date DESC
			LIMIT 1 BY session_id`,
		query_params: {
			...scope,
			sessionIds: sessions.map((session) => session.sessionId),
			sources: sessions.map((session) => session.source),
		},
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
	};
}
