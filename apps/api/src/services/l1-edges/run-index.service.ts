import { TupleParam } from "@clickhouse/client-web";
import { TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX } from "@rudel/api-routes/transcript-records";
import { CALL_FACTS_TABLE } from "@rudel/ch-schema/call-facts";
import type {
	RudelCallFactsRow,
	RudelRunIndexRow,
	RudelRunRequestsRow,
	RudelRunSetupRow,
} from "@rudel/ch-schema/generated";
import { RUN_SETUP_TABLE } from "@rudel/ch-schema/received-setup";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import type { MaintenanceDeadline } from "../../lib/bounded-maintenance.js";
import {
	type CodexLifecycleFacts,
	codexLifecycleFactsByRun,
	NO_CODEX_LIFECYCLE_FACTS,
	streamTurnKey,
} from "../analysis/codex-lifecycle.js";
import {
	type ReceivedSetupRow,
	receivedSetupRows,
	repositoryKey,
} from "../analysis/received-setup.js";
import {
	buildReceivedSetupStatement,
	type ReceivedSetupRecord,
	ReceivedSetupRecordSchema,
	receivedSetupParts,
} from "../analysis/received-setup-sql.js";
import {
	buildDirectoryEvidenceStatement,
	buildRunDirectoriesStatement,
	type DirectoryEvidenceRow,
	DirectoryEvidenceRowSchema,
	directoryRepositories,
	NO_RUN_DIRECTORY,
	type RunDirectoryColumns,
	type RunDirectoryRow,
	RunDirectoryRowSchema,
	runDirectoryColumns,
} from "../analysis/run-directories.js";
import {
	gateRunIndexRow,
	isRunIndexColumnRecordable,
	RUN_PERMISSION_COLUMNS,
	type RunIndexFactColumn,
} from "../analysis/run-index-columns.js";
import { readCommittedRunIndex } from "../analysis/run-index-reader.js";
import {
	buildCodexLifecycleStatement,
	buildCodexTurnMarksStatement,
	buildMcpStateStatement,
	buildRunIndexSessionStatement,
	buildRunIndexStatement,
	buildRunRequestsStatement,
	buildUnattributedUsageStatement,
	type CodexLifecycleRow,
	CodexLifecycleRowSchema,
	type CodexTurnMark,
	CodexTurnMarkSchema,
	type McpStateRow,
	McpStateRowSchema,
	RUN_FORK_REPLAY,
	RUN_INDEX_PRICING_VERSION,
	RUN_INDEX_VERSION,
	type RunIndexFactsRow,
	RunIndexFactsRowSchema,
	type RunIndexSessionFacts,
	RunIndexSessionFactsSchema,
	type RunRequestFactsRow,
	RunRequestFactsRowSchema,
	type UnattributedUsageRow,
	UnattributedUsageRowSchema,
	type UsageBoundGeneration,
} from "../analysis/run-index-sql.js";
import {
	buildRunMessagesStatement,
	type RunMessageColumns,
	type RunMessagesRow,
	RunMessagesRowSchema,
	runMessageColumns,
} from "../analysis/run-messages.js";
import {
	type CountedGeneration,
	queryCountedGenerations,
} from "../analysis/scope.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "../analysis/sql.js";
import {
	buildKeyedDeleteOperations,
	type DeleteOperation,
	type DeleteOutcome,
	isDeleteSettled,
} from "../clickhouse-batched-delete.js";
import { runRetirementDeletes } from "../generation-retirement.js";
import {
	MAX_RETIRED_GENERATIONS_PER_PASS,
	selectRetiredGenerations,
} from "../transcript-records-ingest.service.js";
import type { SessionGeneration } from "../transcript-records-queries.js";
import {
	type CallTuple,
	CallTuplesSchema,
	callFactRows,
	callFactsCtes,
	callTuplesSql,
} from "./call-facts.js";
import {
	runNodeId,
	type SessionIdentity,
	sessionScopeId,
} from "./l1-edge-ids.js";
import { RUN_INDEX_TABLE, RUN_REQUESTS_TABLE } from "./l1-edge-tables.js";

/**
 * Records (receipt row counts) of the largest generation the build aggregates
 * in one statement, the same bound `find` gives one batch. A larger session
 * is frozen with its reason; `find` keeps computing its runs at query time.
 */
export const RUN_INDEX_MAX_SESSION_RECORDS = 200_000;
const UINT32_MAX = 4_294_967_295;
/** Relative tolerance of the cost conservation check (costs are rounded to 12 places). */
const COST_TOLERANCE = 1e-9;

/** A run index generation: the transcript generation and the index rules. */
export interface RunIndexGeneration {
	revision: string;
	parserVersion: number;
	indexVersion: number;
}

export interface RunIndexBuild {
	/** False when nothing was written: current already, frozen, or no transcript. */
	written: boolean;
	frozenReason: string | null;
	input: Record<string, unknown>;
	runCount: number;
}

/** The session's usage changed while a build read it; the build is retried. */
export class RunIndexUsageChangedError extends Error {
	constructor() {
		super("Usage changed while the run index was built; retrying");
		this.name = "RunIndexUsageChangedError";
	}
}

/**
 * The usage extraction a build prices. `none`: the session has no usage.
 * `consistent`: the newest receipt is complete and every event it counts is
 * active at its generation, so its events are priced, and only they.
 * `unknown`: anything else (incomplete, deleted, or events without a
 * receipt); usage is stored as unknown, never as zero or a partial set.
 * `key` names it on the receipt (`usage_receipt`), so a new extraction makes
 * the stored costs stale.
 */
export interface RunIndexUsage {
	state: "none" | "consistent" | "unknown";
	/** The receipt's `event_version`, bound into every usage read; '0' reads none. */
	generation: string;
	/** Events the receipt counts (consistent only). */
	events: number;
	key: string;
}

const count = z.coerce.number();
const UsageStateSchema = z.object({
	generation: z.coerce.string(),
	receipts: count,
	complete: count,
	expected_events: count,
	receipt_deleted: count,
	checksum: z.string(),
	generation_events: count,
	active_events: count,
});

/**
 * Builds the run index of one session (docs/l1-literal-schema.md, "Scale")
 * from its committed transcript-records generation as one immutable
 * snapshot: one aggregate statement for its runs, one each for the usage no
 * run claims and the session facts (and, for Codex, its turn lifecycle
 * rows), then the run rows and, last, the receipt that commits them. Until
 * the receipt lands, readers keep reading the previous snapshot; a build
 * that crashes before it changes nothing they read. `beforeWrite` runs
 * before each insert (purge fence and lease). A build is skipped when the
 * committed receipt already has this generation, index version, pricing and
 * usage receipt; when no transcript generation is committed any more (the
 * transcript no longer exists), the stored runs are kept. Age never removes a
 * transcript (docs/l1-retention.md), so the stored reason "transcript
 * expired" is historical wording.
 */
export async function buildRunIndex(input: {
	executor: ClickHouseExecutor;
	organizationId: string;
	session: SessionIdentity;
	/** The claimed build revision: the snapshot's id within its generation. */
	buildRevision: number;
	beforeWrite: () => Promise<void>;
	now?: () => Date;
	maxSessionRecords?: number;
}): Promise<RunIndexBuild> {
	const { executor, organizationId, session } = input;
	const now = input.now ?? (() => new Date());
	const scope = { organizationId, userId: session.userId };
	const [committed] = await queryCountedGenerations(executor, scope, [
		session.sessionId,
	]);
	const [marker] = await readCommittedRunIndex(
		executor,
		scope,
		[session.sessionId],
		"receipt",
	);
	if (!committed) return withoutTranscript(marker);
	const plan = planRunIndexBuild(
		committed,
		marker,
		await readRunIndexUsage(executor, organizationId, session),
		input.maxSessionRecords ?? RUN_INDEX_MAX_SESSION_RECORDS,
		session.source,
	);
	if (plan.kind === "done") return plan.build;
	const { generation, usage, key, bound } = plan;
	const reads = await readRunIndexParts(executor, scope, session, bound);
	// The statements read the usage separately: it must be the same
	// extraction after them as before, and every one of its events must be
	// counted exactly once, by a run or as unattributed.
	if (
		(await readRunIndexUsage(executor, organizationId, session)).key !==
		usage.key
	)
		throw new RunIndexUsageChangedError();
	assertUsageConserved(reads.runs, reads.unattributed, usage);
	const rows = assembleRunIndexRows(
		{
			organizationId,
			session,
			generation,
			parserVersion: committed.parserVersion,
			usage,
			buildRevision: input.buildRevision,
			builtAt: now(),
		},
		reads,
	);
	// Each build has its own insert tokens: a generation deleted by a fence
	// and rebuilt by a later claim is never dropped as a duplicate.
	const token = `run-index:${organizationId}:${sessionScopeId(session)}:${generation.revision}:${generation.parserVersion}:${generation.indexVersion}:${input.buildRevision}`;
	await input.beforeWrite();
	// One insert, so a build's runs land together.
	if (rows.runRows.length > 0)
		await executor.insert({
			table: RUN_INDEX_TABLE,
			values: rows.runRows,
			asyncInsert: false,
			deduplicationToken: `${token}:runs`,
		});
	// Requests before the receipt, so the receipt commits them with the runs.
	if (rows.requestRows.length > 0) {
		await input.beforeWrite();
		await executor.insert({
			table: RUN_REQUESTS_TABLE,
			values: rows.requestRows,
			asyncInsert: false,
			deduplicationToken: `${token}:requests`,
		});
	}
	// Received setup before the receipt too: the receipt commits it.
	if (rows.setupRows.length > 0) {
		await input.beforeWrite();
		await executor.insert({
			table: RUN_SETUP_TABLE,
			values: rows.setupRows,
			asyncInsert: false,
			deduplicationToken: `${token}:setup`,
		});
	}
	if (rows.callRows.length > 0) {
		await input.beforeWrite();
		await executor.insert({
			table: CALL_FACTS_TABLE,
			values: rows.callRows,
			asyncInsert: false,
			deduplicationToken: `${token}:calls`,
		});
	}
	await input.beforeWrite();
	// The receipt's time is its publication: superseded snapshots are kept
	// for the retirement grace from it.
	await executor.insert({
		table: RUN_INDEX_TABLE,
		values: [rows.receipt(now())],
		asyncInsert: false,
		deduplicationToken: `${token}:receipt`,
	});
	return {
		written: true,
		frozenReason: null,
		input: {
			...key,
			runs: rows.runRows.length,
			builtRevision: String(input.buildRevision),
		},
		runCount: rows.runRows.length,
	};
}

export const RunIndexSessionRecordSchema = z.object({
	repository: z.string(),
	git_remote: z.string(),
	project_path: z.string(),
	git_branch: z.string(),
	model: z.string(),
});
export type RunIndexSessionRecord = z.infer<typeof RunIndexSessionRecordSchema>;

export interface RunIndexReads {
	runs: RunIndexFactsRow[];
	requests: RunRequestFactsRow[];
	unattributed: UnattributedUsageRow;
	facts: RunIndexSessionFacts & { calls: CallTuple[] };
	messages: RunMessagesRow[];
	lifecycle: CodexLifecycleRow[];
	turnMarks: CodexTurnMark[];
	recorded: RunIndexSessionRecord | undefined;
	setupRecords: ReceivedSetupRecord[];
	directories: {
		rows: RunDirectoryRow[];
		evidence: DirectoryEvidenceRow[];
	} | null;
	mcpStates: McpStateRow[];
}

export function sessionRecordStatement(
	scope: { organizationId: string; userId: string },
	session: Pick<SessionIdentity, "sessionId" | "source">,
) {
	return {
		query: `SELECT coalesce(nullIf(git_remote, ''), nullIf(package_name, ''), project_path) AS repository,
				git_remote, project_path, ifNull(git_branch, '') AS git_branch, model_used AS model
			FROM ${getSafeClickHouseTable("rudel.session_analytics")} FINAL
			WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
				AND session_id = {sessionId:String} AND source = {source:String}
			ORDER BY session_date DESC LIMIT 1`,
		query_params: {
			...scope,
			sessionId: session.sessionId,
			source: session.source,
		},
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
	};
}

async function readRunIndexParts(
	executor: ClickHouseExecutor,
	scope: { organizationId: string; userId: string },
	session: SessionIdentity,
	bound: UsageBoundGeneration,
): Promise<RunIndexReads> {
	const committed: SessionGeneration = {
		sessionId: bound.sessionId,
		revision: bound.revision,
		parserVersion: bound.parserVersion,
	};
	const runs = await query(
		executor,
		RunIndexFactsRowSchema,
		buildRunIndexStatement(scope, bound),
	);
	const requests = await query(
		executor,
		RunRequestFactsRowSchema,
		buildRunRequestsStatement(scope, bound),
	);
	const [unattributed] = await query(
		executor,
		UnattributedUsageRowSchema,
		buildUnattributedUsageStatement(scope, bound),
	);
	const [facts] = await query(
		executor,
		RunIndexSessionFactsSchema.extend({ calls: CallTuplesSchema }),
		buildRunIndexSessionStatement(scope, committed, {
			ctes: callFactsCtes(),
			sql: callTuplesSql(),
		}),
	);
	if (!unattributed || !facts)
		throw new Error("Run index session statements returned no row");
	const messages = await query(
		executor,
		RunMessagesRowSchema,
		buildRunMessagesStatement(scope, committed),
	);
	const codex = session.source === "codex";
	const lifecycle = codex
		? await query(
				executor,
				CodexLifecycleRowSchema,
				buildCodexLifecycleStatement(scope, committed),
			)
		: [];
	const turnMarks = codex
		? await query(
				executor,
				CodexTurnMarkSchema,
				buildCodexTurnMarksStatement(scope, committed),
			)
		: [];
	const [recorded] = await query(
		executor,
		RunIndexSessionRecordSchema,
		sessionRecordStatement(scope, session),
	);
	const setupRecords = await query(
		executor,
		ReceivedSetupRecordSchema,
		buildReceivedSetupStatement(scope, committed),
	);
	const directories = isRunIndexColumnRecordable(
		"cwd",
		committed.parserVersion,
		session.source,
	)
		? {
				rows: await query(
					executor,
					RunDirectoryRowSchema,
					buildRunDirectoriesStatement(scope, committed, RUN_FORK_REPLAY),
				),
				evidence: await query(
					executor,
					DirectoryEvidenceRowSchema,
					buildDirectoryEvidenceStatement(
						scope,
						committed,
						{
							projectPath: recorded?.project_path ?? "",
							gitBranch: recorded?.git_branch ?? "",
						},
						RUN_FORK_REPLAY,
					),
				),
			}
		: null;
	const mcpStates = isRunIndexColumnRecordable(
		"mcp_unavailable",
		committed.parserVersion,
		session.source,
	)
		? await query(
				executor,
				McpStateRowSchema,
				buildMcpStateStatement(scope, committed),
			)
		: [];
	return {
		runs,
		requests,
		unattributed,
		facts,
		messages,
		lifecycle,
		turnMarks,
		recorded,
		setupRecords,
		directories,
		mcpStates,
	};
}

export interface RunIndexRows {
	runRows: RudelRunIndexRow[];
	requestRows: RudelRunRequestsRow[];
	setupRows: RudelRunSetupRow[];
	callRows: RudelCallFactsRow[];
	receipt: (publishedAt: Date) => RudelRunIndexRow;
}

export function assembleRunIndexRows(
	build: {
		organizationId: string;
		session: SessionIdentity;
		generation: RunIndexGeneration;
		parserVersion: number;
		usage: RunIndexUsage;
		buildRevision: number;
		builtAt: Date;
	},
	reads: RunIndexReads,
): RunIndexRows {
	const { organizationId, session, generation, usage } = build;
	const { runs, requests, unattributed, facts, recorded } = reads;
	const messages = runMessageColumns(reads.messages);
	const lifecycle =
		session.source === "codex"
			? codexLifecycleFactsByRun(reads.lifecycle, reads.turnMarks)
			: new Map<string, CodexLifecycleFacts>();
	const directories =
		reads.directories === null
			? () => NO_RUN_DIRECTORY
			: runDirectoryColumns(
					reads.directories.rows,
					directoryRepositories(reads.directories.evidence, {
						projectPath: recorded?.project_path ?? "",
						gitRemote: recorded?.git_remote ?? "",
					}),
				);
	const context: RowContext = {
		organizationId,
		session,
		generation,
		buildRevision: build.buildRevision,
		builtAt: clickHouseTime(build.builtAt.getTime()),
		sessionDate: clickHouseTime(facts.session_date_ms),
		repository: recorded?.repository ?? "",
	};
	const finish = (
		row: RudelRunIndexRow,
		unknown: readonly RunIndexFactColumn[] = [],
	) =>
		gateRunIndexRow(row, { usageUnknown: usage.state === "unknown", unknown });
	const mcpUnavailable = carriedMcpUnavailable(reads.mcpStates);
	const runRows = runs.map((run) =>
		finish(
			runRow(
				run,
				lifecycle.get(streamTurnKey(run.agent_id, run.turn_idx)) ??
					NO_CODEX_LIFECYCLE_FACTS,
				context,
				messages(run.agent_id, run.turn_idx),
				directories(run.agent_id, run.turn_idx),
				mcpUnavailable(run),
			),
			runUnknownColumns(run),
		),
	);
	const requestRows = requests.map((request) =>
		requestRow(request, context, usage.state === "unknown"),
	);
	const setupRows = receivedSetupRows({
		...receivedSetupParts(reads.setupRecords),
		runs: runs.map((run) => ({
			agentId: run.agent_id,
			turnIdx: run.turn_idx,
			startRecord: run.start_record,
			endRecord: run.end_record,
			runId: runNodeId(session, run.agent_id, run.start_record),
			startedMs: run.started_ms,
		})),
		context: {
			source: session.source,
			repository: repositoryKey(recorded?.git_remote ?? ""),
			memberId: session.userId,
		},
	}).map((row) => setupRow(row, context));
	const callRows = callFactRows(facts.calls, runRows, requestRows, {
		organizationId,
		session,
		revision: generation.revision,
		parserVersion: generation.parserVersion,
		indexVersion: generation.indexVersion,
		buildRevision: build.buildRevision,
		builtAt: context.builtAt,
		sessionDate: context.sessionDate,
		repository: context.repository,
		setupRepository: repositoryKey(recorded?.git_remote ?? ""),
		threadSource: facts.thread_source,
	});
	return {
		runRows,
		requestRows,
		setupRows,
		callRows,
		receipt: (publishedAt) =>
			finish(
				receiptRow(
					{ ...context, builtAt: clickHouseTime(publishedAt.getTime()) },
					{
						runs,
						lifecycle,
						unattributed,
						facts,
						usageReceipt: usage.key,
						model: recorded?.model ?? "",
					},
				),
			),
	};
}

export function withoutTranscript(
	marker: RudelRunIndexRow | undefined,
): RunIndexBuild {
	return {
		written: false,
		frozenReason: marker ? "transcript expired; run index kept" : null,
		input: marker
			? {
					generation: markerGeneration(marker),
					builtRevision: String(marker.build_revision),
				}
			: { generation: null },
		runCount: marker?.run_count ?? 0,
	};
}

export type RunIndexPlan =
	| { kind: "done"; build: RunIndexBuild }
	| {
			kind: "build";
			generation: RunIndexGeneration;
			usage: RunIndexUsage;
			key: {
				generation: RunIndexGeneration;
				pricingVersion: string;
				usageReceipt: string;
			};
			bound: UsageBoundGeneration;
			records: number;
	  };

export function planRunIndexBuild(
	committed: CountedGeneration,
	marker: RudelRunIndexRow | undefined,
	usage: RunIndexUsage,
	maxRecords: number,
	source: string,
): RunIndexPlan {
	const generation: RunIndexGeneration = {
		revision: committed.revision,
		parserVersion: committed.parserVersion,
		indexVersion: RUN_INDEX_VERSION,
	};
	const key = {
		generation,
		pricingVersion: RUN_INDEX_PRICING_VERSION,
		usageReceipt: usage.key,
	};
	if (marker && isCurrentMarker(marker, key))
		return {
			kind: "done",
			build: {
				written: false,
				frozenReason: null,
				input: {
					...key,
					runs: marker.run_count,
					builtRevision: String(marker.build_revision),
				},
				runCount: marker.run_count,
			},
		};
	if (committed.records > maxRecords)
		return {
			kind: "done",
			build: {
				written: false,
				frozenReason: `session has ${committed.records} records, over the run index bound of ${maxRecords}`,
				input: { ...key, records: committed.records },
				runCount: 0,
			},
		};
	return {
		kind: "build",
		generation,
		usage,
		key,
		bound: {
			sessionId: committed.sessionId,
			revision: committed.revision,
			parserVersion: committed.parserVersion,
			usageGeneration: usage.generation,
			source,
		},
		records: committed.records,
	};
}

function isCurrentMarker(
	marker: RudelRunIndexRow,
	key: {
		generation: RunIndexGeneration;
		pricingVersion: string;
		usageReceipt: string;
	},
): boolean {
	return (
		String(marker.revision) === key.generation.revision &&
		marker.parser_version === key.generation.parserVersion &&
		marker.index_version === key.generation.indexVersion &&
		marker.pricing_version === key.pricingVersion &&
		marker.usage_receipt === key.usageReceipt
	);
}

function markerGeneration(marker: RudelRunIndexRow): RunIndexGeneration {
	return {
		revision: String(marker.revision),
		parserVersion: marker.parser_version,
		indexVersion: marker.index_version,
	};
}

/**
 * The session's newest usage extraction and whether it is one complete,
 * consistent set (the checks of the usage analytics pipeline): its receipt
 * is complete and not deleted, and the active events at its generation are
 * exactly the events it counts.
 */
export async function readRunIndexUsage(
	executor: ClickHouseExecutor,
	organizationId: string,
	session: SessionIdentity,
): Promise<RunIndexUsage> {
	const [state] = await query(executor, UsageStateSchema, {
		query: `SELECT toString(any(receipt_generation)) AS generation, any(receipt_count) AS receipts,
				any(receipt_complete) AS complete, any(receipt_events) AS expected_events,
				any(receipt_is_deleted) AS receipt_deleted, toString(any(receipt_checksum_latest)) AS checksum,
				countIf(record_kind = 'event' AND is_deleted = 0 AND event_version = receipt_generation) AS generation_events,
				countIf(record_kind = 'event' AND is_deleted = 0) AS active_events
			FROM (
				SELECT record_kind, is_deleted, event_version,
					argMaxIf(event_version, event_version, record_kind = 'receipt') OVER () AS receipt_generation,
					countIf(record_kind = 'receipt') OVER () AS receipt_count,
					argMaxIf(receipt_is_complete, event_version, record_kind = 'receipt') OVER () AS receipt_complete,
					argMaxIf(receipt_event_count, event_version, record_kind = 'receipt') OVER () AS receipt_events,
					argMaxIf(is_deleted, event_version, record_kind = 'receipt') OVER () AS receipt_is_deleted,
					argMaxIf(receipt_checksum, event_version, record_kind = 'receipt') OVER () AS receipt_checksum_latest
				FROM ${getSafeClickHouseTable("rudel.usage_events")} FINAL
				WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
					AND source = {source:String} AND session_id = {sessionId:String}
			)`,
		query_params: {
			organizationId,
			userId: session.userId,
			source: session.source,
			sessionId: session.sessionId,
		},
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
	});
	return runIndexUsage(state);
}

export async function readRunIndexUsageBatch(
	executor: ClickHouseExecutor,
	organizationId: string,
	userId: string,
	sessionIds: readonly string[],
): Promise<Map<string, RunIndexUsage>> {
	const rows = await query(
		executor,
		UsageStateSchema.extend({ session_id: z.string() }),
		{
			query: `SELECT session_id, toString(any(receipt_generation)) AS generation, any(receipt_count) AS receipts,
					any(receipt_complete) AS complete, any(receipt_events) AS expected_events,
					any(receipt_is_deleted) AS receipt_deleted, toString(any(receipt_checksum_latest)) AS checksum,
					countIf(record_kind = 'event' AND is_deleted = 0 AND event_version = receipt_generation) AS generation_events,
					countIf(record_kind = 'event' AND is_deleted = 0) AS active_events
				FROM (
					SELECT session_id, record_kind, is_deleted, event_version,
						argMaxIf(event_version, event_version, record_kind = 'receipt') OVER session AS receipt_generation,
						countIf(record_kind = 'receipt') OVER session AS receipt_count,
						argMaxIf(receipt_is_complete, event_version, record_kind = 'receipt') OVER session AS receipt_complete,
						argMaxIf(receipt_event_count, event_version, record_kind = 'receipt') OVER session AS receipt_events,
						argMaxIf(is_deleted, event_version, record_kind = 'receipt') OVER session AS receipt_is_deleted,
						argMaxIf(receipt_checksum, event_version, record_kind = 'receipt') OVER session AS receipt_checksum_latest
					FROM ${getSafeClickHouseTable("rudel.usage_events")} FINAL
					WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
						AND session_id IN {sessionIds:Array(String)}
					WINDOW session AS (PARTITION BY session_id)
				)
				GROUP BY session_id`,
			query_params: { organizationId, userId, sessionIds: [...sessionIds] },
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		},
	);
	const bySession = new Map(rows.map((row) => [row.session_id, row]));
	return new Map(
		sessionIds.map((sessionId) => [
			sessionId,
			runIndexUsage(bySession.get(sessionId)),
		]),
	);
}

/** What a usage state means for a build (`readRunIndexUsage`). */
export function runIndexUsage(
	state: z.infer<typeof UsageStateSchema> | undefined,
): RunIndexUsage {
	if (!state || (state.receipts === 0 && state.active_events === 0))
		return { state: "none", generation: "0", events: 0, key: "" };
	const receipt = `${state.generation}:${state.checksum}`;
	if (
		state.receipts > 0 &&
		state.complete === 1 &&
		state.receipt_deleted === 0 &&
		state.generation_events === state.expected_events
	)
		return {
			state: "consistent",
			generation: state.generation,
			events: state.expected_events,
			key: receipt,
		};
	return {
		state: "unknown",
		generation: "0",
		events: 0,
		key:
			state.receipts > 0
				? `${receipt}:incomplete`
				: `unreceipted:${state.active_events}`,
	};
}

/**
 * Every event of the priced extraction is counted exactly once: the runs'
 * usage plus the unattributed usage is the whole set (observations, tokens
 * by kind, cost), and the whole set is what the receipt counts. Otherwise
 * the build is wrong and is not published.
 */
export function assertUsageConserved(
	runs: readonly RunIndexFactsRow[],
	unattributed: UnattributedUsageRow,
	usage: RunIndexUsage,
): void {
	const failures: string[] = [];
	const add = (pick: (row: UsageCounts) => number) =>
		runs.reduce((sum, run) => sum + pick(run), pick(unattributed));
	if (add((row) => row.usage_observations) !== unattributed.total_observations)
		failures.push("observations");
	if (add((row) => row.usage_unpriced) !== unattributed.total_unpriced)
		failures.push("unpriced");
	for (const kind of TOKEN_KINDS) {
		const sum = [...runs, unattributed].reduce(
			(total, row) => total + BigInt(row[kind] ?? "0"),
			0n,
		);
		if (sum !== BigInt(unattributed[`total_${kind}`] || "0"))
			failures.push(kind);
	}
	const cost = add((row) => row.cost_usd ?? 0);
	const totalCost = unattributed.total_cost_usd ?? 0;
	if (
		Math.abs(cost - totalCost) >
		COST_TOLERANCE * Math.max(1, Math.abs(totalCost))
	)
		failures.push("cost");
	if (unattributed.total_observations !== usage.events)
		failures.push("receipt event count");
	if (failures.length > 0)
		throw new Error(
			`Run index usage is not conserved (${failures.join(", ")})`,
		);
}

const TOKEN_KINDS = [
	"uncached_input_tokens",
	"cache_read_input_tokens",
	"cache_write_5m_input_tokens",
	"cache_write_1h_input_tokens",
	"output_tokens",
	"reasoning_output_tokens",
] as const;

type UsageCounts = Pick<
	UnattributedUsageRow,
	| "usage_observations"
	| "usage_unpriced"
	| "usage_model"
	| "cost_usd"
	| "model_costs"
	| (typeof TOKEN_KINDS)[number]
	| "context_input_tokens_at_start"
>;

interface RowContext {
	organizationId: string;
	session: SessionIdentity;
	generation: RunIndexGeneration;
	buildRevision: number;
	builtAt: string;
	sessionDate: string;
	/** The session repository key as recorded; every row of the build carries it. */
	repository: string;
}

/** A run with no genuine prompt, no final message and no system prompt recorded; the receipt has none. */
const NO_RUN_MESSAGES: RunMessageColumns = {
	prompt_reactions: [],
	final_message: null,
	final_message_cut: false,
	system_prompt_recorded: false,
};

/** Columns every row of a build shares, and the not-recorded defaults of the rest. */
function baseRow(context: RowContext): RudelRunIndexRow {
	return {
		organization_id: context.organizationId,
		user_id: context.session.userId,
		session_id: context.session.sessionId,
		revision: context.generation.revision,
		parser_version: context.generation.parserVersion,
		index_version: context.generation.indexVersion,
		agent_id: "",
		start_record: 0,
		row_kind: "run",
		source: context.session.source,
		turn_idx: 0,
		run_id: "",
		build_revision: String(context.buildRevision),
		built_at: context.builtAt,
		session_date: context.sessionDate,
		unrecorded_facts: [],
		agent_version: null,
		entrypoint: null,
		started_at: context.sessionDate,
		ended_at: context.sessionDate,
		end_record: 0,
		minutes: 0,
		active_minutes: 0,
		record_count: 0,
		raw_chars: "0",
		duration_ms: null,
		time_to_first_token_ms: null,
		prompt_head: null,
		genuine_prompts: 0,
		prompt_subtype: null,
		...NO_RUN_MESSAGES,
		turn_origin: null,
		prompt_source: null,
		origin_kind: null,
		trigger_turn: null,
		thread_source: null,
		prompt_origin_basis: "",
		permission_mode: null,
		permission_modes: [],
		auto_mode_bash_first: null,
		auto_mode_bash_first_steer: null,
		auto_mode_bypass: null,
		auto_mode_steer_only: null,
		auto_mode_consent_flow: null,
		approval_policy: null,
		approvals_reviewer: null,
		sandbox_policy: null,
		sandbox_network_access: null,
		permission_profile: null,
		collaboration_mode: null,
		model: null,
		models: [],
		effort: null,
		efforts: [],
		per_turn_effort: null,
		context_window: null,
		context_input_tokens_at_start: null,
		tool_calls: 0,
		failed_calls: 0,
		edits: 0,
		failed_edits: null,
		refused_edits: null,
		reads: 0,
		searches: 0,
		not_found: 0,
		denied_calls: null,
		interrupted_calls: null,
		timed_out_calls: null,
		approvals_by_user: null,
		approvals_by_hook: null,
		approvals_by_config: null,
		permission_prompts: null,
		mcp_calls: null,
		mcp_servers: [],
		mcp_unavailable: [],
		skills: [],
		slash_commands: [],
		subagent_types: [],
		compactions: 0,
		compact_trigger: null,
		compact_pre_tokens: null,
		aborted: null,
		abort_reason: null,
		turn_error: null,
		turn_error_kind: null,
		interrupt_markers: 0,
		stop_reason: null,
		hook_stop_reason: null,
		prevented_continuation: null,
		hook_count: null,
		hook_errors: null,
		hook_runs: null,
		api_errors: null,
		api_error: null,
		api_error_statuses: [],
		retry_attempts: null,
		rate_limit_max_used_percent: null,
		rate_limited: null,
		refusals: null,
		fallback_model: null,
		goal: null,
		git_operations: [],
		pushed_branches: [],
		commit_shas: [],
		pr_urls: [],
		usage_observations: 0,
		usage_unpriced: 0,
		usage_model: "",
		cost_usd: null,
		model_costs: [],
		uncached_input_tokens: null,
		cache_read_input_tokens: null,
		cache_write_5m_input_tokens: null,
		cache_write_1h_input_tokens: null,
		output_tokens: null,
		reasoning_output_tokens: null,
		pricing_version: RUN_INDEX_PRICING_VERSION,
		facts_truncated: null,
		run_count: 0,
		usage_receipt: "",
		cost_state: {},
		title: null,
		repository: context.repository,
		...NO_RUN_DIRECTORY,
		session_model: "",
	};
}

/** The usage columns of a run or of the receipt's unattributed usage. */
function usageColumns(
	usage: UsageCounts,
): Pick<
	RudelRunIndexRow,
	| "usage_observations"
	| "usage_unpriced"
	| "usage_model"
	| "cost_usd"
	| "model_costs"
	| "uncached_input_tokens"
	| "cache_read_input_tokens"
	| "cache_write_5m_input_tokens"
	| "cache_write_1h_input_tokens"
	| "output_tokens"
	| "reasoning_output_tokens"
	| "context_input_tokens_at_start"
> {
	return {
		usage_observations: usage.usage_observations,
		usage_unpriced: usage.usage_unpriced,
		usage_model: usage.usage_model,
		cost_usd: usage.cost_usd,
		model_costs: usage.model_costs.map(([model, cost, unpriced]) => [
			model,
			cost,
			Math.min(UINT32_MAX, unpriced),
		]),
		uncached_input_tokens: usage.uncached_input_tokens,
		cache_read_input_tokens: usage.cache_read_input_tokens,
		cache_write_5m_input_tokens: usage.cache_write_5m_input_tokens,
		cache_write_1h_input_tokens: usage.cache_write_1h_input_tokens,
		output_tokens: usage.output_tokens,
		reasoning_output_tokens: usage.reasoning_output_tokens,
		context_input_tokens_at_start: usage.context_input_tokens_at_start,
	};
}

/**
 * The fact columns a run's own records cannot say, though its generation
 * records them: who approved its calls, when it has tool results and none
 * records a permission decision (a Claude Code version before 2.1.293, or a
 * subagent stream that writes none). A run whose only results are refusals
 * still says its prompts: a user's rejection is recorded in every version.
 */
export function runUnknownColumns(
	run: Pick<RunIndexFactsRow, "l_permissions_unrecorded">,
): readonly RunIndexFactColumn[] {
	return run.l_permissions_unrecorded > 0 ? RUN_PERMISSION_COLUMNS : [];
}

/**
 * Each run's MCP servers that are unavailable: those its stream's latest
 * server-state record at or before the run's end lists, a run without such
 * a record keeping the previous one's (a stream records its servers' state
 * at its start, before or after its first prompt, and when it changes).
 * Each stream reads only its own records.
 */
export function carriedMcpUnavailable(
	states: readonly McpStateRow[],
): (run: { agent_id: string; turn_idx: number }) => readonly string[] {
	const byStream = new Map<string, McpStateRow[]>();
	for (const state of states) {
		const stream = byStream.get(state.agent_id) ?? [];
		stream.push(state);
		byStream.set(state.agent_id, stream);
	}
	for (const stream of byStream.values())
		stream.sort((a, b) => a.turn_idx - b.turn_idx);
	return (run) => {
		let unavailable: readonly string[] = [];
		for (const state of byStream.get(run.agent_id) ?? []) {
			if (state.turn_idx > run.turn_idx) break;
			unavailable = state.unavailable;
		}
		return unavailable;
	};
}

/**
 * A run row from its stored facts, before gating. `lifecycle` holds the
 * Codex lifecycle facts attributed to the run by `turn_id`; where a fact can
 * come from either kind of record (model, effort, aborted), an agent writes
 * it in only one of them.
 */
export function runRow(
	run: RunIndexFactsRow,
	lifecycle: CodexLifecycleFacts,
	context: RowContext,
	messages: RunMessageColumns = NO_RUN_MESSAGES,
	directory: RunDirectoryColumns = NO_RUN_DIRECTORY,
	mcpUnavailable: readonly string[] = [],
): RudelRunIndexRow {
	const origin = [
		run.l_turn_origin,
		run.l_prompt_source,
		run.l_origin_kind,
		run.l_trigger_turn,
		run.thread_source,
	];
	return {
		...baseRow(context),
		agent_id: run.agent_id,
		start_record: run.start_record,
		turn_idx: run.turn_idx,
		run_id: runNodeId(context.session, run.agent_id, run.start_record),
		agent_version: run.l_agent_version,
		entrypoint: run.l_entrypoint,
		started_at: clickHouseTime(run.started_ms),
		ended_at: clickHouseTime(run.ended_ms),
		end_record: run.end_record,
		minutes: run.minutes,
		active_minutes: run.active_minutes,
		record_count: run.record_count,
		raw_chars: run.raw_chars,
		duration_ms:
			lifecycle.durationMs === null
				? null
				: Math.min(UINT32_MAX, lifecycle.durationMs),
		time_to_first_token_ms: uint32OrNull(lifecycle.timeToFirstTokenMs),
		prompt_head: run.prompt_head,
		genuine_prompts: run.genuine_prompts,
		prompt_subtype: run.l_prompt_subtype,
		...messages,
		...directory,
		turn_origin: run.l_turn_origin,
		prompt_source: run.l_prompt_source,
		origin_kind: run.l_origin_kind,
		trigger_turn: run.l_trigger_turn,
		thread_source: run.thread_source,
		prompt_origin_basis: origin.some((value) => value !== "")
			? "native"
			: "wrapper",
		permission_mode: run.l_permission_mode,
		permission_modes: run.l_permission_modes,
		auto_mode_bash_first: run.l_auto_mode_bash_first,
		auto_mode_bash_first_steer: run.l_auto_mode_bash_first_steer,
		auto_mode_bypass: run.l_auto_mode_bypass,
		auto_mode_steer_only: run.l_auto_mode_steer_only,
		auto_mode_consent_flow: run.l_auto_mode_consent_flow,
		approval_policy: lifecycle.approvalPolicy,
		approvals_reviewer: lifecycle.approvalsReviewer,
		sandbox_policy: lifecycle.sandboxPolicy,
		sandbox_network_access: lifecycle.sandboxNetworkAccess,
		permission_profile: lifecycle.permissionProfile,
		collaboration_mode: lifecycle.collaborationMode,
		model: lifecycle.model || run.l_model,
		models: sortedUnion(run.l_models, lifecycle.models),
		effort: lifecycle.effort || run.l_effort,
		efforts: sortedUnion(run.l_efforts, lifecycle.efforts),
		per_turn_effort:
			context.session.source === "codex"
				? lifecycle.effort || run.l_effort
				: run.l_per_turn_effort,
		context_window: uint32OrNull(lifecycle.contextWindow),
		tool_calls: run.tool_calls,
		failed_calls: run.failed_calls,
		edits: run.edits,
		failed_edits: run.failed_edits,
		refused_edits: run.refused_edits,
		reads: run.reads,
		searches: run.searches,
		not_found: run.not_found,
		denied_calls: run.l_denied_calls,
		interrupted_calls: run.l_interrupted_calls,
		timed_out_calls: run.l_timed_out_calls,
		approvals_by_user: run.l_approvals_by_user,
		approvals_by_hook: run.l_approvals_by_hook,
		approvals_by_config: run.l_approvals_by_config,
		permission_prompts: run.l_permission_prompts,
		mcp_calls: run.l_mcp_calls,
		mcp_servers: run.l_mcp_servers,
		mcp_unavailable: [...mcpUnavailable],
		skills: run.l_skills,
		slash_commands: run.l_slash_commands,
		subagent_types: run.subagent_types,
		compactions: run.l_compactions,
		compact_trigger: run.l_compact_trigger,
		compact_pre_tokens: /^\d+$/u.test(run.l_compact_pre_tokens)
			? run.l_compact_pre_tokens
			: null,
		aborted: recordedFlag(
			run.l_aborted_true + lifecycle.abortedTrue,
			run.l_aborted_false + lifecycle.abortedFalse,
		),
		abort_reason: lifecycle.abortReason || run.l_abort_reason,
		turn_error: lifecycle.turnError,
		turn_error_kind: lifecycle.turnErrorKind,
		interrupt_markers:
			run.l_interrupt_markers +
			(lifecycle.abortReason === "interrupted" ? lifecycle.abortedTrue : 0),
		stop_reason: run.l_stop_reason,
		hook_stop_reason: run.l_hook_stop_reason,
		prevented_continuation: recordedFlag(
			run.l_prevented_true,
			run.l_prevented_false,
		),
		hook_count:
			run.l_hook_summaries > 0 ? Math.min(UINT32_MAX, run.l_hook_count) : null,
		hook_errors: jsonList(run.l_hook_errors),
		hook_runs: jsonList(run.l_hook_runs),
		api_errors: run.l_api_errors,
		api_error: run.l_api_error,
		api_error_statuses: run.l_api_error_statuses,
		retry_attempts: run.l_retry_attempts,
		rate_limit_max_used_percent: run.l_rate_limit_max_used_percent,
		rate_limited: run.l_rate_limited > 0 || lifecycle.usageLimited,
		refusals: run.l_refusals,
		fallback_model: run.l_fallback_model,
		goal: run.l_goal,
		git_operations: run.l_git_operations,
		pushed_branches: run.l_pushed_branches,
		commit_shas: run.l_commit_shas,
		pr_urls: run.l_pr_urls,
		...usageColumns(run),
		facts_truncated: run.l_facts_truncated > 0,
	};
}

/** Usage columns of a request, unknown when the session's usage extraction was incomplete. */
const REQUEST_USAGE_COLUMNS = [
	"usage_observations",
	"usage_unpriced",
	"usage_model",
	"cost_usd",
	"uncached_input_tokens",
	"cache_read_input_tokens",
	"cache_write_5m_input_tokens",
	"cache_write_1h_input_tokens",
	"output_tokens",
	"reasoning_output_tokens",
] as const satisfies readonly (keyof RudelRunRequestsRow)[];

/**
 * A request row of the build: its run's identity and the request's calls,
 * text and usage as the statement read them. Usage that is unknown is NULL
 * and named in `unrecorded_facts`, never zero.
 */
export function requestRow(
	request: RunRequestFactsRow,
	context: RowContext,
	usageUnknown: boolean,
): RudelRunRequestsRow {
	const known = !usageUnknown && request.usage_observations > 0;
	return {
		organization_id: context.organizationId,
		user_id: context.session.userId,
		session_id: context.session.sessionId,
		revision: context.generation.revision,
		parser_version: context.generation.parserVersion,
		index_version: context.generation.indexVersion,
		build_revision: String(context.buildRevision),
		agent_id: request.agent_id,
		start_record: request.start_record,
		source: context.session.source,
		run_id: runNodeId(
			context.session,
			request.agent_id,
			request.run_start_record,
		),
		run_start_record: request.run_start_record,
		turn_idx: request.turn_idx,
		built_at: context.builtAt,
		session_date: context.sessionDate,
		unrecorded_facts: usageUnknown ? [...REQUEST_USAGE_COLUMNS] : [],
		end_record: request.end_record,
		started_at: clickHouseTime(request.started_ms),
		ended_at: clickHouseTime(request.ended_ms),
		call_records: request.calls.map(([record]) => record),
		call_tools: request.calls.map(([, , tool]) => tool),
		call_groups: request.calls.map(([, , , group]) => group),
		call_classes: request.calls.map(([, , , , commandClass]) => commandClass),
		call_failed: request.calls.map(([, , , , , failed]) => failed),
		text_record: request.texts > 0 ? request.text_record : null,
		text_block: request.texts > 0 ? request.text_block : null,
		text_head: request.texts > 0 ? request.text_head : null,
		usage_observations: usageUnknown ? 0 : request.usage_observations,
		usage_unpriced: usageUnknown ? 0 : request.usage_unpriced,
		usage_model: known ? request.usage_model : "",
		cost_usd: known ? request.cost_usd : null,
		uncached_input_tokens: known ? request.uncached_input_tokens : null,
		cache_read_input_tokens: known ? request.cache_read_input_tokens : null,
		cache_write_5m_input_tokens: known
			? request.cache_write_5m_input_tokens
			: null,
		cache_write_1h_input_tokens: known
			? request.cache_write_1h_input_tokens
			: null,
		output_tokens: known ? request.output_tokens : null,
		reasoning_output_tokens: known ? request.reasoning_output_tokens : null,
	};
}

/** A received setup row of the build: the run's identity and the setup file version it had. */
export function setupRow(
	row: ReceivedSetupRow,
	context: RowContext,
): RudelRunSetupRow {
	return {
		organization_id: context.organizationId,
		user_id: context.session.userId,
		session_id: context.session.sessionId,
		revision: context.generation.revision,
		parser_version: context.generation.parserVersion,
		index_version: context.generation.indexVersion,
		build_revision: String(context.buildRevision),
		agent_id: row.agentId,
		run_start_record: row.runStartRecord,
		setup_file: row.setupFile,
		version: row.version,
		source: context.session.source,
		run_id: row.runId,
		turn_idx: row.turnIdx,
		built_at: context.builtAt,
		session_date: context.sessionDate,
		run_started_at: clickHouseTime(row.runStartedMs),
		kind: row.kind,
		scope: row.scope,
		owner: row.owner,
		path: row.path,
		recorded_path: row.recordedPath,
		cwd: row.cwd,
		chars: Math.min(UINT32_MAX, row.chars),
		version_name: row.versionName,
		uncommitted: row.uncommitted,
		carried: row.carried,
		compacted_since: row.compactedSince,
		received_record: row.record,
		received_block: row.block,
		received_at: clickHouseTime(row.atMs),
	};
}

/**
 * The receipt: written last, it commits the build and holds the session's
 * facts. Calls, denials and API errors total the runs; skills, slash
 * commands, subagent types and models merge them; usage is what no run can
 * claim.
 */
export function receiptRow(
	context: RowContext,
	session: {
		runs: readonly RunIndexFactsRow[];
		lifecycle: ReadonlyMap<string, CodexLifecycleFacts>;
		unattributed: UnattributedUsageRow;
		facts: RunIndexSessionFacts;
		usageReceipt: string;
		model: string;
	},
): RudelRunIndexRow {
	const runs = session.runs;
	const total = (pick: (run: RunIndexFactsRow) => number) =>
		Math.min(
			UINT32_MAX,
			runs.reduce((sum, run) => sum + pick(run), 0),
		);
	const merged = (pick: (run: RunIndexFactsRow) => readonly string[]) =>
		sortedUnion(...runs.map(pick));
	const costStateDuration = session.facts.cost_state_duration_ms;
	return {
		...baseRow(context),
		start_record: TRANSCRIPT_RECORDS_RECEIPT_RECORD_IDX,
		row_kind: "receipt",
		thread_source: session.facts.thread_source,
		models: merged((run) => [
			...run.l_models,
			...(session.lifecycle.get(streamTurnKey(run.agent_id, run.turn_idx))
				?.models ?? []),
		]),
		efforts: merged((run) => [
			...run.l_efforts,
			...(session.lifecycle.get(streamTurnKey(run.agent_id, run.turn_idx))
				?.efforts ?? []),
		]),
		tool_calls: total((run) => run.tool_calls),
		failed_calls: total((run) => run.failed_calls),
		denied_calls: total((run) => run.l_denied_calls),
		api_errors: total((run) => run.l_api_errors),
		skills: merged((run) => run.l_skills),
		slash_commands: merged((run) => run.l_slash_commands),
		subagent_types: merged((run) => run.subagent_types),
		...usageColumns(session.unattributed),
		facts_truncated: runs.some((run) => run.l_facts_truncated > 0),
		run_count: runs.length,
		usage_receipt: session.usageReceipt,
		cost_state:
			session.facts.has_cost_state > 0
				? {
						...session.facts.cost_state,
						...(costStateDuration === null
							? {}
							: { duration_ms: String(costStateDuration) }),
					}
				: {},
		title: session.facts.title,
		session_model: session.model,
	};
}

const SnapshotRowSchema = z.object({
	revision_text: z.string(),
	parser_version: count,
	index_version: count,
	build_text: z.string(),
	receipts: count,
	receipt_built_ms: count,
	written_ms: count,
});

/** A build's snapshot: its generation and build revision. */
export interface RunIndexSnapshot extends RunIndexGeneration {
	buildRevision: string;
}

const SessionSnapshotRowSchema = SnapshotRowSchema.extend({
	user_id: z.string(),
	session_id: z.string(),
});

const RUN_INDEX_SNAPSHOT_KEY_COLUMNS = [
	{ name: "user_id", type: "String" },
	{ name: "session_id", type: "String" },
	{ name: "revision", type: "UInt64" },
	{ name: "parser_version", type: "UInt16" },
	{ name: "index_version", type: "UInt16" },
	{ name: "build_revision", type: "UInt64" },
] as const;

export interface RunIndexSnapshotRetirement {
	snapshots: number;
	retired: number;
	settled: boolean;
	outcomes: DeleteOutcome[];
}

/**
 * Retires the snapshots no reader can pin or will pin again of one
 * organization's sessions, found from all their rows, receipts or not:
 *
 * - older than the committed snapshot (the newest with a receipt) and never
 *   committed: a crashed build, at once;
 * - older and committed: once the grace since the snapshot that superseded
 *   it was published has passed (a reader may still hold it);
 * - newer than the committed snapshot, or with no committed snapshot at all,
 *   and never committed: a crashed build once its last write is older than
 *   the grace (a build in flight writes its receipt within its lease).
 *
 * The committed snapshot itself is never retired, even after its transcript
 * expired. Requests and setup first: the run index rows are what finds a
 * snapshot again, so a pass that stops between the deletes is finished by the
 * next.
 */
export async function retireRunIndexSnapshots(
	executor: ClickHouseExecutor,
	organizationId: string,
	sessions: readonly Pick<SessionIdentity, "userId" | "sessionId">[],
	retirement: {
		abortSignal?: AbortSignal;
		deadline?: MaintenanceDeadline;
		graceMs: number;
		now: Date;
	},
): Promise<RunIndexSnapshotRetirement> {
	const result: RunIndexSnapshotRetirement = {
		snapshots: 0,
		retired: 0,
		settled: true,
		outcomes: [],
	};
	if (sessions.length === 0) return result;
	const rows = await query(executor, SessionSnapshotRowSchema, {
		abortSignal: retirement.abortSignal,
		query: `SELECT user_id, session_id, toString(revision) AS revision_text, parser_version, index_version,
				toString(build_revision) AS build_text,
				countIf(row_kind = 'receipt') AS receipts,
				maxIf(toUnixTimestamp64Milli(built_at), row_kind = 'receipt') AS receipt_built_ms,
				max(toUnixTimestamp64Milli(built_at)) AS written_ms
			FROM ${getSafeClickHouseTable(RUN_INDEX_TABLE)}
			WHERE organization_id = {organizationId:String}
				AND (user_id, session_id) IN {sessions:Array(Tuple(String, String))}
			GROUP BY user_id, session_id, revision, parser_version, index_version, build_revision
			ORDER BY user_id, session_id, revision DESC, parser_version DESC, index_version DESC, build_revision DESC
			LIMIT {snapshotLimit:UInt32} BY user_id, session_id`,
		query_params: {
			organizationId,
			sessions: sessions.map(
				(session) => new TupleParam([session.userId, session.sessionId]),
			),
			snapshotLimit: 10 * MAX_RETIRED_GENERATIONS_PER_PASS,
		},
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
	});
	const bySession = new Map<string, z.infer<typeof SnapshotRowSchema>[]>();
	for (const row of rows) {
		const key = `${row.user_id}\u0000${row.session_id}`;
		const list = bySession.get(key) ?? [];
		list.push(row);
		bySession.set(key, list);
	}
	const keys: (string | number)[][] = [];
	for (const [key, snapshots] of bySession) {
		const [userId = "", sessionId = ""] = key.split("\u0000");
		for (const snapshot of selectRetiredSnapshots(snapshots, retirement))
			keys.push([
				userId,
				sessionId,
				snapshot.revision,
				snapshot.parserVersion,
				snapshot.indexVersion,
				snapshot.buildRevision,
			]);
	}
	result.snapshots = keys.length;
	const byTable = [
		CALL_FACTS_TABLE,
		RUN_SETUP_TABLE,
		RUN_REQUESTS_TABLE,
		RUN_INDEX_TABLE,
	].map((table) =>
		buildKeyedDeleteOperations({
			table,
			organizationId,
			columns: RUN_INDEX_SNAPSHOT_KEY_COLUMNS,
			keys,
		}),
	);
	const [calls = [], setup = [], requests = [], index = []] = byTable;
	for (let chunk = 0; chunk < index.length; chunk++) {
		const operations = [
			calls[chunk],
			setup[chunk],
			requests[chunk],
			index[chunk],
		].filter(
			(operation): operation is DeleteOperation => operation !== undefined,
		);
		const outcomes = await runRetirementDeletes(
			executor,
			operations,
			{ signal: retirement.abortSignal, deadline: retirement.deadline },
			true,
		);
		result.outcomes.push(...outcomes);
		const last = outcomes.at(-1);
		if (
			outcomes.length === operations.length &&
			last !== undefined &&
			isDeleteSettled(last)
		)
			result.retired += last.keyCount;
		else {
			result.settled = false;
			break;
		}
	}
	return result;
}

/** The snapshots `retireRunIndexSnapshots` deletes, from rows newest first. */
export function selectRetiredSnapshots(
	snapshots: readonly z.infer<typeof SnapshotRowSchema>[],
	retirement: { graceMs: number; now: Date },
): RunIndexSnapshot[] {
	const snapshotOf = (
		row: z.infer<typeof SnapshotRowSchema>,
	): RunIndexSnapshot => ({
		revision: row.revision_text,
		parserVersion: row.parser_version,
		indexVersion: row.index_version,
		buildRevision: row.build_text,
	});
	const committed = snapshots.findIndex((row) => row.receipts > 0);
	const graceStart = retirement.now.getTime() - retirement.graceMs;
	// Never committed and not written for longer than the grace: crashed.
	const abandoned = (committed < 0 ? snapshots : snapshots.slice(0, committed))
		.filter((row) => row.receipts === 0 && row.written_ms <= graceStart)
		.map(snapshotOf);
	const head = snapshots[committed];
	const superseded = head
		? selectRetiredGenerations(
				snapshots.slice(committed + 1).map((row) => ({
					generation: snapshotOf(row),
					// A rebuild's newer receipt only keeps the snapshot below longer.
					publishedAtMs: row.receipts > 0 ? row.receipt_built_ms : null,
				})),
				{ ...retirement, publishedAtMs: head.receipt_built_ms },
			)
		: [];
	return [...abandoned, ...superseded].slice(
		0,
		MAX_RETIRED_GENERATIONS_PER_PASS,
	);
}

/** 'true' when a record says true, 'false' when records say only false, '' when none says. */
function recordedFlag(trueCount: number, falseCount: number): string {
	return trueCount > 0 ? "true" : falseCount > 0 ? "false" : "";
}

/** Raw JSON entries as one JSON array; '' when there are none. */
function jsonList(entries: readonly string[]): string {
	return entries.length === 0 ? "" : `[${entries.join(",")}]`;
}

function sortedUnion(...lists: readonly (readonly string[])[]): string[] {
	return [...new Set(lists.flat())].sort();
}

function uint32OrNull(value: string): number | null {
	if (!/^\d+$/u.test(value)) return null;
	return Math.min(UINT32_MAX, Number(value));
}

function clickHouseTime(ms: number): string {
	return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}
