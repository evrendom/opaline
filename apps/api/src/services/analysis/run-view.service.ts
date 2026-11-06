import { ORPCError } from "@orpc/server";
import type { AnalysisRunInput, AnalysisRunOutput } from "@rudel/api-routes";
import type { RudelRunIndexRow } from "@rudel/ch-schema/generated";
import {
	RUN_SETUP_TABLE,
	SETUP_TEXTS_TABLE,
} from "@rudel/ch-schema/received-setup";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { runNodeId, splitL1NodeId } from "../l1-edges/l1-edge-ids.js";
import { RUN_REQUESTS_TABLE } from "../l1-edges/l1-edge-tables.js";
import type {
	SessionGeneration,
	TranscriptReadScope,
} from "../transcript-records-queries.js";
import { readRecord } from "../transcript-records-reader.service.js";
import { CURRENT_PHASE_RULE } from "./phases.js";
import {
	SETUP_SINCE_INDEX_VERSION,
	SETUP_SINCE_PARSER_VERSION,
} from "./received-setup.js";
import {
	describeRecordUuidHit,
	findRecordsByUuid,
	isRecordUuid,
	type RecordUuidHit,
	recordUuidExpandId,
	recordUuidNotFound,
} from "./record-uuid.js";
import { readCommittedRunIndex } from "./run-index-reader.js";
import { runToolErrorSql } from "./run-index-sql.js";
import {
	DEFAULT_RUN_VIEW_SECTIONS,
	lastText,
	REQUESTS_SINCE_INDEX_VERSION,
	RUN_VIEW_SECTIONS,
	type RunView,
	type RunViewCallDetail,
	type RunViewDetail,
	type RunViewRequest,
	type RunViewSetup,
	type RunViewText,
	renderRunView,
} from "./run-view.js";
import { queryCountedGenerations } from "./scope.js";
import {
	ANALYSIS_QUERY_SETTINGS,
	pinnedFilter,
	pinnedParams,
	query,
	records,
} from "./sql.js";
import {
	describeSqlFailure,
	quotaExceeded,
	withSqlLimits,
} from "./sql-gateway.js";
import type { SqlQuota } from "./sql-results.js";
import { loadSessionSubagents } from "./subagents.js";
import { isSubagentTool } from "./tool-groups.js";

/**
 * `run(id, expand?, sections?)`: loads one run of the run index (its
 * committed build), its neighbours in the stream and its requests, then the
 * details of the ids to expand (a request's calls, a call's or a record's
 * exact text, the run of a subagent a call started), and renders the run
 * view (`run-view.ts`). The phases are cut at read time by the current phase
 * rule, so a new rule re-cuts every run without a rebuild. `id` may also be a
 * record's own id from the raw transcript (Claude Code `uuid`): the view is
 * then the run that holds the record, with the record expanded.
 */

/** Results of one call read for its exact text. */
const MAX_CALL_RESULTS = 3;
/** Characters of a call's input shown when its request is expanded. */
const CALL_INPUT_CHARS = 120;
/** The largest raw record index (UInt32, the receipt's index excluded). */
const MAX_RECORD = 4_294_967_294;
/** Characters of a delegated task shown in place of a prompt. */
const TASK_CHARS = 160;

export interface RunViewEnv {
	/** Every read runs within the sql tool's limits (`withSqlLimits`). */
	readonly executor: ClickHouseExecutor;
	/** The owner of a session the caller may read; throws when it may not. */
	ownerOf(sessionId: string): Promise<string>;
	/** The workspace's quota, shared with sql: each call takes one. */
	readonly quota: SqlQuota;
}

interface RunAddress {
	readonly scope: TranscriptReadScope;
	readonly source: string;
	readonly sessionId: string;
	readonly agentId: string;
	readonly startRecord: number;
	/** Instead of `startRecord`: the run of the stream that holds this record. */
	readonly holding?: number;
}

/** A setup file version of the run, with the hash its text is stored under. */
interface LoadedSetup extends RunViewSetup {
	readonly version: string;
}

interface LoadedRun {
	readonly address: RunAddress;
	readonly row: RudelRunIndexRow;
	/** Every committed run of the session, every stream, in start order. */
	readonly sessionRuns: readonly RudelRunIndexRow[];
	readonly view: RunView;
	/** The run's setup file versions; null when its received setup was not read. */
	readonly setup: readonly LoadedSetup[] | null;
}

/** The order setup is listed in: what the harness sends first, skills last. */
const SETUP_KIND_ORDER = [
	"system_prompt",
	"developer",
	"instructions",
	"agents_md",
	"nested_memory",
	"mcp_instructions",
	"skill_body",
];

export async function openRun(
	workspaceId: string,
	input: AnalysisRunInput,
	env: RunViewEnv,
): Promise<AnalysisRunOutput> {
	const sections = input.sections ?? DEFAULT_RUN_VIEW_SECTIONS;
	const unknown = sections.filter(
		(name) => !RUN_VIEW_SECTIONS.some((section) => section.name === name),
	);
	if (unknown.length > 0)
		throw new ORPCError("BAD_REQUEST", {
			message: `Unknown section ${unknown.join(", ")}; sections are ${RUN_VIEW_SECTIONS.map((section) => section.name).join(", ")}`,
		});
	const byRecord = isRecordUuid(input.id);
	const address = byRecord
		? null
		: await resolveRun(workspaceId, input.id, env);
	const quota = await env.quota.take(workspaceId);
	if (!quota.allowed) {
		const refusal = quotaExceeded(env.quota, quota.resetsAt);
		throw new ORPCError("FORBIDDEN", {
			message: describeSqlFailure(refusal),
			data: { kind: refusal.kind, fragment: null, fix: refusal.fix },
		});
	}
	const limited = { ...env, executor: withSqlLimits(env.executor) };
	const record = byRecord
		? await resolveRecord(workspaceId, input.id, limited)
		: null;
	const target = record?.address ?? address;
	const run = target ? await loadRun(limited.executor, target) : null;
	if (!run)
		throw new ORPCError("NOT_FOUND", {
			message: record
				? `Record ${input.id} is ${describeRecordUuidHit(record.hit)}, which no indexed run holds (the run may not be indexed yet); read the record with read depth=record`
				: "Run not found in the run index; pass a run_id from sql (the run may not be indexed yet)",
		});
	const expand = [
		...new Set([
			...(record ? [recordUuidExpandId(record.hit)] : []),
			...(input.expand ?? []),
		]),
	];
	const details = await loadDetails(limited, run, expand, input.maxChars);
	const located = record
		? recordLocation(input.id, record.hit, run, record.others)
		: "";
	const rendered = renderRunView(run.view, {
		sections,
		expand,
		maxChars: Math.max(1, input.maxChars - located.length),
		rule: CURRENT_PHASE_RULE,
		details,
	});
	return {
		id: input.id,
		phaseRule: CURRENT_PHASE_RULE.version,
		truncated: rendered.truncated,
		text: located + rendered.text,
		ref: {
			sessionId: run.address.sessionId,
			agentId: run.address.agentId,
			turn: run.row.turn_idx,
		},
		view: { ...run.view },
	};
}

/**
 * The record a record id names in the sessions the caller may read, and the
 * run of its stream to open: the oldest session that holds it (a resumed or
 * forked session repeats its parent's lines, ids included).
 */
async function resolveRecord(
	workspaceId: string,
	uuid: string,
	env: RunViewEnv,
): Promise<{
	readonly address: RunAddress;
	readonly hit: RecordUuidHit;
	readonly others: readonly RecordUuidHit[];
}> {
	const [hit, ...others] = await findRecordsByUuid(
		env.executor,
		workspaceId,
		uuid,
		env.ownerOf,
	);
	if (!hit) throw recordUuidNotFound(uuid);
	return {
		address: {
			scope: { organizationId: workspaceId, userId: hit.userId },
			source: hit.source,
			sessionId: hit.sessionId,
			agentId: hit.agentId,
			startRecord: hit.recordIdx,
			holding: hit.recordIdx,
		},
		hit,
		others,
	};
}

/** The line that says where a record id is, before the view of its run. */
function recordLocation(
	uuid: string,
	hit: RecordUuidHit,
	run: LoadedRun,
	others: readonly RecordUuidHit[],
): string {
	const also =
		others.length === 0
			? ""
			: `; the same id is also ${others.map(describeRecordUuidHit).join(", ")}`;
	return `record ${uuid} is ${describeRecordUuidHit(hit)} (run_id ${run.view.id})${also}\n`;
}

function notRunId(): ORPCError<string, unknown> {
	return new ORPCError("BAD_REQUEST", {
		message:
			"Not a run id; pass the run_id column of sql (user/source/session/agent/start record)",
	});
}

/** The run an id names, once its session's owner is known and readable. */
async function resolveRun(
	workspaceId: string,
	id: string,
	env: RunViewEnv,
): Promise<RunAddress> {
	let parts: string[];
	try {
		parts = splitL1NodeId(id);
	} catch {
		// A malformed percent escape.
		throw notRunId();
	}
	const [userId, source, sessionId, agentId, start] = parts;
	if (
		parts.length !== 5 ||
		!userId ||
		!sessionId ||
		agentId === undefined ||
		(source !== "claude_code" && source !== "codex") ||
		!/^\d{1,10}$/u.test(start ?? "") ||
		Number(start) > MAX_RECORD
	)
		throw notRunId();
	const owner = await env.ownerOf(sessionId);
	if (owner !== userId) throw new ORPCError("NOT_FOUND");
	return {
		scope: { organizationId: workspaceId, userId },
		source,
		sessionId,
		agentId,
		startRecord: Number(start),
	};
}

/** The run's committed row, its neighbours in the stream and its requests. */
async function loadRun(
	executor: ClickHouseExecutor,
	address: RunAddress,
): Promise<LoadedRun | null> {
	const sessionRuns = (
		await readCommittedRunIndex(
			executor,
			address.scope,
			[address.sessionId],
			"run",
		)
	).sort((a, b) => a.start_record - b.start_record);
	const stream = sessionRuns.filter((row) => row.agent_id === address.agentId);
	const { holding } = address;
	const index = stream.findIndex((row) =>
		holding === undefined
			? row.start_record === address.startRecord
			: row.start_record <= holding && holding < row.end_record,
	);
	const row = stream[index];
	if (!row) return null;
	const previous = stream[index - 1];
	const next = stream[index + 1];
	const requests = await readRequests(executor, address, row, [
		row.start_record,
		...(previous ? [previous.start_record] : []),
	]);
	const of = (start: number) =>
		requests.filter((request) => request.runStartRecord === start);
	const identity = {
		userId: address.scope.userId,
		source: address.source,
		sessionId: address.sessionId,
	};
	const neighbour = (other: RudelRunIndexRow) =>
		runNodeId(identity, other.agent_id, other.start_record);
	const setup =
		row.index_version >= SETUP_SINCE_INDEX_VERSION &&
		row.parser_version >= SETUP_SINCE_PARSER_VERSION
			? await readSetup(executor, address, row)
			: null;
	// The run found, by its start: later reads (a subagent's run) never look for `holding`.
	const { holding: _holding, ...located } = address;
	return {
		address: { ...located, startRecord: row.start_record },
		row,
		sessionRuns,
		setup,
		view: {
			id: neighbour(row),
			agent: row.source,
			prompt: row.prompt_head || null,
			task: row.prompt_head
				? null
				: await delegatedTask(executor, address, row),
			minutes: row.minutes,
			tokens: totalTokens(row),
			costUsd: row.cost_usd,
			requestsIndexed: row.index_version >= REQUESTS_SINCE_INDEX_VERSION,
			previous: previous
				? {
						id: neighbour(previous),
						prompt: previous.prompt_head || null,
						end: lastText(of(previous.start_record))?.head ?? null,
						queuedBoundary: row.prompt_subtype === "queued",
					}
				: null,
			next: next
				? {
						id: neighbour(next),
						prompt: next.prompt_head || null,
						queuedBoundary: next.prompt_subtype === "queued",
					}
				: null,
			requests: of(row.start_record),
			setup,
		},
	};
}

const SetupRowSchema = z.object({
	kind: z.string(),
	setup_file: z.string(),
	version: z.string(),
	version_name: z.string(),
	chars: z.coerce.number(),
	carried: z.boolean(),
	compacted_since: z.boolean(),
	received_record: z.coerce.number(),
});

/**
 * The run's setup file versions, from the build that wrote `row`, in a
 * stable order so their ids (`s1`, `s2`, …) name the same version on every
 * call.
 */
async function readSetup(
	executor: ClickHouseExecutor,
	address: RunAddress,
	row: RudelRunIndexRow,
): Promise<LoadedSetup[]> {
	const rows = await query(executor, SetupRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT kind, setup_file, version, version_name, chars, carried, compacted_since, received_record
			FROM ${getSafeClickHouseTable(RUN_SETUP_TABLE)} FINAL
			WHERE organization_id = {organizationId:String} AND user_id = {userId:String} AND session_id = {sessionId:String}
				AND revision = {revision:UInt64} AND parser_version = {parserVersion:UInt16}
				AND index_version = {indexVersion:UInt16} AND build_revision = {buildRevision:UInt64}
				AND agent_id = {agentId:String} AND run_start_record = {runStart:UInt32}`,
		query_params: {
			...address.scope,
			sessionId: address.sessionId,
			revision: String(row.revision),
			parserVersion: row.parser_version,
			indexVersion: row.index_version,
			buildRevision: String(row.build_revision),
			agentId: address.agentId,
			runStart: row.start_record,
		},
	});
	const rank = (kind: string) => {
		const index = SETUP_KIND_ORDER.indexOf(kind);
		return index === -1 ? SETUP_KIND_ORDER.length : index;
	};
	return rows
		.sort(
			(a, b) =>
				rank(a.kind) - rank(b.kind) ||
				a.setup_file.localeCompare(b.setup_file) ||
				a.received_record - b.received_record ||
				a.version.localeCompare(b.version),
		)
		.map((setup, index) => ({
			id: `s${index + 1}`,
			kind: setup.kind,
			setupFile: setup.setup_file,
			version: setup.version,
			versionName: setup.version_name,
			chars: setup.chars,
			carried: setup.carried,
			compactedSince: setup.compacted_since,
		}));
}

const SetupTextSchema = z.object({
	text: z.string(),
	chars: z.coerce.number(),
});

/**
 * The exact text of one of the run's setup file versions, as the run
 * received it, up to the budget: the run owner's stored copy of that
 * version.
 */
async function setupText(
	env: RunViewEnv,
	run: LoadedRun,
	id: string,
	maxChars: number,
): Promise<RunViewDetail | null> {
	const setup = run.setup?.find((candidate) => candidate.id === id);
	if (!setup) return null;
	const [stored] = await query(env.executor, SetupTextSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT substringUTF8(text, 1, {maxChars:UInt32}) AS text, chars
			FROM ${getSafeClickHouseTable(SETUP_TEXTS_TABLE)} FINAL
			WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
				AND version = {version:String}
			LIMIT 1`,
		query_params: {
			...run.address.scope,
			version: setup.version,
			maxChars,
		},
	});
	if (!stored)
		return {
			kind: "missing",
			reason:
				"its text is not stored: the session was extracted before setup texts were kept",
		};
	return {
		kind: "text",
		parts: [
			{
				label: `${id} ${setup.kind} ${setup.setupFile} version ${setup.versionName}`,
				text: stored.text,
				totalChars: setup.chars,
			},
		],
	};
}

/**
 * The transcript generation a run index row was built from: every record a
 * view of the row reads is read from it, so a newer upload committed while
 * the view loads changes nothing it shows.
 */
function rowGeneration(row: RudelRunIndexRow): SessionGeneration {
	return {
		sessionId: row.session_id,
		revision: String(row.revision),
		parserVersion: row.parser_version,
	};
}

/**
 * The task a parent delegated to a subagent run: the head of the run's first
 * prompt record, which is not a human prompt and so is not its prompt_head.
 */
async function delegatedTask(
	executor: ClickHouseExecutor,
	address: RunAddress,
	row: RudelRunIndexRow,
): Promise<string | null> {
	const generation = rowGeneration(row);
	const [task] = await query(executor, z.object({ text: z.string() }), {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT substringUTF8(head, 1, ${TASK_CHARS}) AS text FROM ${records()}
			WHERE ${pinnedFilter()} AND agent_id = {agentId:String} AND kind = 'user_prompt'
				AND record_idx >= {from:UInt32} AND record_idx < {to:UInt32}
			ORDER BY record_idx, block_idx LIMIT 1`,
		query_params: {
			...pinnedParams(address.scope, [generation]),
			agentId: address.agentId,
			from: row.start_record,
			to: row.end_record,
		},
	});
	return task?.text ?? null;
}

const RequestRowSchema = z.object({
	run_start_record: z.number(),
	start_record: z.number(),
	end_record: z.number(),
	started_ms: z.coerce.number(),
	ended_ms: z.coerce.number(),
	call_records: z.array(z.number()),
	call_tools: z.array(z.string()),
	call_groups: z.array(z.string()),
	call_classes: z.array(z.string()),
	call_failed: z.array(z.number()),
	text_record: z.number().nullable(),
	text_block: z.number().nullable(),
	text_head: z.string().nullable(),
	cost_usd: z.number().nullable(),
	tokens: z.string().nullable(),
});

interface LoadedRequest extends RunViewRequest {
	readonly runStartRecord: number;
	readonly endRecord: number;
}

/**
 * Requests of the given runs of one stream, from the build that wrote `row`
 * (the committed build when the row was read), never a build committed since.
 */
async function readRequests(
	executor: ClickHouseExecutor,
	address: RunAddress,
	row: RudelRunIndexRow,
	runStarts: readonly number[],
): Promise<LoadedRequest[]> {
	const table = getSafeClickHouseTable(RUN_REQUESTS_TABLE);
	const rows = await query(executor, RequestRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT run_start_record, start_record, end_record,
				toUnixTimestamp64Milli(started_at) AS started_ms, toUnixTimestamp64Milli(ended_at) AS ended_ms,
				call_records, call_tools, call_groups, call_classes, call_failed, text_record, text_block, text_head, cost_usd,
				if(uncached_input_tokens IS NULL, NULL, toString(uncached_input_tokens + ifNull(cache_read_input_tokens, 0)
					+ ifNull(cache_write_5m_input_tokens, 0) + ifNull(cache_write_1h_input_tokens, 0) + ifNull(output_tokens, 0))) AS tokens
			FROM ${table} FINAL
			WHERE organization_id = {organizationId:String} AND user_id = {userId:String} AND session_id = {sessionId:String}
				AND revision = {revision:UInt64} AND parser_version = {parserVersion:UInt16}
				AND index_version = {indexVersion:UInt16} AND build_revision = {buildRevision:UInt64}
				AND agent_id = {agentId:String} AND run_start_record IN {runStarts:Array(UInt32)}
			ORDER BY run_start_record, start_record`,
		query_params: {
			...address.scope,
			sessionId: address.sessionId,
			revision: String(row.revision),
			parserVersion: row.parser_version,
			indexVersion: row.index_version,
			buildRevision: String(row.build_revision),
			agentId: address.agentId,
			runStarts: [...runStarts],
		},
	});
	return rows.map((row) => ({
		runStartRecord: row.run_start_record,
		endRecord: row.end_record,
		record: row.start_record,
		startedMs: row.started_ms,
		endedMs: row.ended_ms,
		calls: row.call_records.map((record, index) => ({
			record,
			tool: row.call_tools[index] ?? "",
			group: row.call_groups[index] ?? "",
			commandClass: row.call_classes[index] ?? "",
			failed: (row.call_failed[index] ?? 0) > 0,
		})),
		text:
			row.text_record === null
				? null
				: {
						record: row.text_record,
						block: row.text_block ?? 0,
						head: row.text_head ?? "",
					},
		tokens: row.tokens === null ? null : Number(row.tokens),
		costUsd: row.cost_usd,
	}));
}

/** Input, cache and output tokens of a run; null when its usage is unknown or absent. */
function totalTokens(row: RudelRunIndexRow): number | null {
	const kinds = [
		row.uncached_input_tokens,
		row.cache_read_input_tokens,
		row.cache_write_5m_input_tokens,
		row.cache_write_1h_input_tokens,
		row.output_tokens,
	];
	if (kinds.every((value) => value === null)) return null;
	return kinds.reduce((sum, value) => sum + Number(value ?? 0), 0);
}

/** The details of the ids to expand that need reading: requests, calls and records. */
async function loadDetails(
	env: RunViewEnv,
	run: LoadedRun,
	ids: readonly string[],
	maxChars: number,
): Promise<Map<string, RunViewDetail>> {
	const details = new Map<string, RunViewDetail>();
	for (const id of ids.filter((candidate) => /^s\d+$/u.test(candidate))) {
		const detail = await setupText(env, run, id, maxChars);
		if (detail) details.set(id, detail);
	}
	const reads = ids.filter((id) => /^[qcr]\d+(\.\d+)?$/u.test(id));
	if (reads.length === 0) return details;
	// An expired transcript keeps its run index, not its records.
	const [stored] = await queryCountedGenerations(
		env.executor,
		run.address.scope,
		[run.address.sessionId],
	);
	if (!stored) {
		for (const id of reads)
			details.set(id, {
				kind: "missing",
				reason:
					"its records cannot be read: the session's transcript is not indexed now",
			});
		return details;
	}
	const reader: RecordReader = {
		env,
		run,
		generation: rowGeneration(run.row),
		maxChars,
	};
	for (const id of reads) {
		const detail = id.startsWith("q")
			? await requestCalls(reader, Number(id.slice(1)))
			: id.startsWith("c")
				? await callDetail(reader, id)
				: await recordText(reader, id);
		if (detail) details.set(id, detail);
	}
	return details;
}

interface RecordReader {
	readonly env: RunViewEnv;
	readonly run: LoadedRun;
	readonly generation: SessionGeneration;
	readonly maxChars: number;
}

const CallRowSchema = z.object({
	record_idx: z.number(),
	block_idx: z.number(),
	tool_name: z.string(),
	command_class: z.string(),
	input: z.string(),
	call_id: z.string(),
	duration_ms: z.number().nullable(),
	failed: z.coerce.number(),
	spawned: z.string(),
	result_records: z.array(z.tuple([z.number(), z.number()])),
});
type CallRow = z.infer<typeof CallRowSchema>;

/**
 * The tool calls on lines [from, to) of the run's stream, with what their
 * results record: duration (recorded, else from the call to its first
 * result), failure, the subagent they started, and the result records.
 */
async function readCalls(
	reader: RecordReader,
	from: number,
	to: number,
): Promise<CallRow[]> {
	const { scope, agentId } = reader.run.address;
	return query(reader.env.executor, CallRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH results AS (
				SELECT call_id, max(duration_ms) AS recorded_ms,
					if(countIf(kind = 'tool_result') = 0, NULL, toUnixTimestamp64Milli(minIf(ts, kind = 'tool_result'))) AS result_ms,
					max(${runToolErrorSql()}) AS failed, anyIf(spawned_agent_id, spawned_agent_id != '') AS spawned,
					arraySort(groupUniqArrayIf(tuple(record_idx, block_idx), kind = 'tool_result')) AS result_records
				FROM ${records()}
				WHERE ${pinnedFilter()} AND agent_id = {agentId:String} AND kind IN ('tool_result', 'meta')
					AND call_id IN (
						SELECT call_id FROM ${records()}
						WHERE ${pinnedFilter()} AND agent_id = {agentId:String} AND kind = 'tool_call'
							AND record_idx >= {from:UInt32} AND record_idx < {to:UInt32} AND call_id != '')
				GROUP BY call_id
			)
			SELECT c.record_idx AS record_idx, c.block_idx AS block_idx, c.tool_name AS tool_name,
				toString(c.command_class) AS command_class, substringUTF8(c.head, 1, ${CALL_INPUT_CHARS}) AS input, c.call_id AS call_id,
				if(r.call_id = '', NULL, coalesce(r.recorded_ms, greatest(0, r.result_ms - toUnixTimestamp64Milli(c.ts)))) AS duration_ms,
				r.failed AS failed, r.spawned AS spawned, r.result_records AS result_records
			FROM (
				SELECT DISTINCT record_idx, block_idx, tool_name, command_class, head, call_id, ts FROM ${records()}
				WHERE ${pinnedFilter()} AND agent_id = {agentId:String} AND kind = 'tool_call'
					AND record_idx >= {from:UInt32} AND record_idx < {to:UInt32}
			) c
			LEFT ANY JOIN results r ON c.call_id = r.call_id AND c.call_id != ''
			ORDER BY record_idx, block_idx`,
		query_params: {
			...pinnedParams(scope, [reader.generation]),
			agentId,
			from,
			to,
		},
	});
}

async function requestCalls(
	reader: RecordReader,
	record: number,
): Promise<RunViewDetail | null> {
	const request = (reader.run.view.requests as readonly LoadedRequest[]).find(
		(candidate) => candidate.record === record,
	);
	if (!request) return null;
	const calls = await readCalls(reader, request.record, request.endRecord);
	return {
		kind: "calls",
		calls: await Promise.all(
			calls.map(
				async (call): Promise<RunViewCallDetail> => ({
					id: recordId("c", call.record_idx, call.block_idx),
					tool: call.tool_name,
					commandClass: call.command_class,
					input: call.input,
					durationMs: call.duration_ms,
					failed: call.failed > 0,
					startedSubagent:
						call.spawned !== "" || isSubagentTool(call.tool_name),
					subagentRunId: streamSubagentRunId(reader.run, call),
				}),
			),
		),
	};
}

/** A call: the run of the subagent it started, else its input and results as exact text. */
async function callDetail(
	reader: RecordReader,
	id: string,
): Promise<RunViewDetail | null> {
	const [record, block] = parseRecordId(id);
	const [call] = (await readCalls(reader, record, record + 1)).filter(
		(candidate) => block === undefined || candidate.block_idx === block,
	);
	if (!call || !inRun(reader.run, record)) return null;
	const subagent = await subagentRun(reader, call);
	if (subagent) return { kind: "run", view: subagent };
	const texts = [
		await exactText(reader, id, record, call.block_idx),
		...(await Promise.all(
			call.result_records
				.slice(0, MAX_CALL_RESULTS)
				.map(([resultRecord, resultBlock]) =>
					exactText(
						reader,
						recordId("r", resultRecord, resultBlock),
						resultRecord,
						resultBlock,
					),
				),
		)),
	];
	return {
		kind: "text",
		parts: texts.filter((part): part is RunViewText => part !== null),
	};
}

async function recordText(
	reader: RecordReader,
	id: string,
): Promise<RunViewDetail | null> {
	const [record, block] = parseRecordId(id);
	if (!inRun(reader.run, record)) return null;
	const part = await exactText(reader, id, record, block);
	return part ? { kind: "text", parts: [part] } : null;
}

/** One record's exact text (the stored text, else its raw line), up to the budget. */
async function exactText(
	reader: RecordReader,
	id: string,
	record: number,
	block: number | undefined,
): Promise<RunViewText | null> {
	const { scope, sessionId, agentId } = reader.run.address;
	const slice = await readRecord(scope, sessionId, record, 0, reader.maxChars, {
		executor: reader.env.executor,
		generation: reader.generation,
		agentId,
		blockIdx: block,
	});
	if (!slice.found) return null;
	return {
		label: [id, slice.kind ?? "record", slice.tool].filter(Boolean).join(" "),
		text: slice.text,
		totalChars: slice.textChars,
	};
}

/**
 * The run of the subagent a call started: a Claude Code subagent is a stream
 * of the same session named by the call's result; a Codex subagent thread is
 * a session of its own, found through the session's lineage.
 */
async function subagentRun(
	reader: RecordReader,
	call: CallRow,
): Promise<RunView | null> {
	const { address } = reader.run;
	if (call.spawned === "" && !isSubagentTool(call.tool_name)) return null;
	const stream = call.spawned
		? await firstRun(reader.env.executor, { ...address, agentId: call.spawned })
		: null;
	if (stream) return stream.view;
	if (address.source !== "codex") return null;
	const family = (
		await loadSessionSubagents(reader.env.executor, address.scope, [
			address.sessionId,
		])
	).get(address.sessionId);
	const link = family?.calls.find(
		(candidate) =>
			candidate.call.agentId === address.agentId &&
			candidate.call.record === call.record_idx,
	);
	if (!link) return null;
	const owner = await reader.env.ownerOf(link.childSessionId);
	return (
		(
			await firstRun(reader.env.executor, {
				...address,
				scope: { ...address.scope, userId: owner },
				sessionId: link.childSessionId,
				agentId: "",
			})
		)?.view ?? null
	);
}

/**
 * The run id of a Claude Code subagent a call started (the first run of the
 * stream its result names), from the session's runs already read; a Codex
 * thread is found only when the call itself is expanded.
 */
function streamSubagentRunId(run: LoadedRun, call: CallRow): string | null {
	if (call.spawned === "") return null;
	const first = run.sessionRuns.find((row) => row.agent_id === call.spawned);
	return first
		? runNodeId(
				{
					userId: run.address.scope.userId,
					source: run.address.source,
					sessionId: run.address.sessionId,
				},
				first.agent_id,
				first.start_record,
			)
		: null;
}

/** The first run of a stream, as a run view without its neighbours' ends. */
async function firstRun(
	executor: ClickHouseExecutor,
	stream: Omit<RunAddress, "startRecord">,
): Promise<LoadedRun | null> {
	const [first] = (
		await readCommittedRunIndex(
			executor,
			stream.scope,
			[stream.sessionId],
			"run",
		)
	)
		.filter((row) => row.agent_id === stream.agentId)
		.sort((a, b) => a.start_record - b.start_record);
	return first
		? loadRun(executor, { ...stream, startRecord: first.start_record })
		: null;
}

/** Whether a record lies in the run: its lines are [start_record, end_record). */
function inRun(run: LoadedRun, record: number): boolean {
	return record >= run.row.start_record && record < run.row.end_record;
}

function recordId(prefix: "c" | "r", record: number, block: number): string {
	return block === 0 ? `${prefix}${record}` : `${prefix}${record}.${block}`;
}

function parseRecordId(id: string): [number, number | undefined] {
	const [record = "0", block] = id.slice(1).split(".");
	return [Number(record), block === undefined ? undefined : Number(block)];
}
