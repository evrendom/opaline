import type { RunRef } from "@rudel/api-routes";
import { z } from "zod";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import {
	pinnedParams,
	pinnedRecords,
	type SessionGeneration,
	type TranscriptReadScope,
} from "../transcript-generations/generations.js";
import {
	childSessions,
	type FamilyPosition,
	familyPosition,
	loadFamiliesAround,
} from "./lineage.js";
import { queryCountedGenerations } from "./scope.js";
import { ANALYSIS_QUERY_SETTINGS, query, records } from "./sql.js";

/**
 * Where a Codex subagent thread meets the session that spawned it. The parent
 * only holds the delegation calls (`spawn_agent`, `followup_task`,
 * `send_message`), whose message is usually encrypted; the child holds the
 * task in plain text as its delegated prompt. Lineage says which threads
 * belong together; this file finds the call in the parent that spawned (or
 * later addressed) each thread, from what the transcripts record:
 *
 * 1. thread id: the spawn result names the child's session id (older Codex);
 * 2. task name: the spawn result's task path (or the call's task name) is the
 *    path the child's delegated task names (`Task name: /root/…`);
 * 3. time: otherwise the latest unclaimed spawn whose result names no thread,
 *    at most a few seconds after the child's first prompt.
 *
 * A thread none of these place keeps its parent link without a call.
 */

const DELEGATION_TOOLS = ["spawn_agent", "followup_task", "send_message"];
/** A child's first record can be written slightly before the parent's call. */
const SPAWN_TOLERANCE_MS = 5_000;
const TASK_CHARS = 400;
const MAX_CALLS = 2_000;
const TASKS_PER_CHILD = 50;
const BATCH_SESSIONS = 50;

/** A delegation call in the parent with what its result says it reached. */
export interface DelegationCall {
	readonly agentId: string;
	readonly turn: number;
	readonly record: number;
	readonly tool: string;
	readonly atMs: number;
	/** Head of the call's arguments: task name or target, message often encrypted. */
	readonly args: string;
	/** Thread id or task path the result names (`spawned_agent_id`), else ''. */
	readonly spawned: string;
	readonly failed: boolean;
}

/** A prompt of a child thread's main transcript. */
export interface ChildTask {
	readonly turn: number;
	readonly record: number;
	readonly atMs: number;
	readonly delegation: boolean;
	readonly text: string;
}

export interface ChildThread {
	readonly sessionId: string;
	/** Prompts in record order (the delegated tasks, or a plain first prompt). */
	readonly tasks: readonly ChildTask[];
}

/** A delegation call of the parent tied to one child thread. */
export interface SubagentLink {
	readonly call: DelegationCall;
	readonly childSessionId: string;
	/** The child's task this call gave it, when the child recorded one. */
	readonly task: ChildTask | null;
	readonly basis: "thread id" | "task name" | "time";
}

/** A session read with its family: the call that spawned it and the calls that reach its children. */
export interface SessionSubagents extends FamilyPosition {
	readonly spawnedBy: SubagentLink | null;
	/** This session's delegation calls that reach a linked child thread, in record order. */
	readonly calls: readonly SubagentLink[];
}

const CallRowSchema = z
	.object({
		agent_id: z.string(),
		turn_idx: z.number(),
		record_idx: z.number(),
		tool_name: z.string(),
		at_ms: z.coerce.number(),
		args: z.string(),
		spawned: z.string(),
		failed: z.coerce.number(),
	})
	.transform(
		(row): DelegationCall => ({
			agentId: row.agent_id,
			turn: row.turn_idx,
			record: row.record_idx,
			tool: row.tool_name,
			atMs: row.at_ms,
			args: row.args,
			spawned: row.spawned,
			failed: row.failed > 0,
		}),
	);

const TaskRowSchema = z.object({
	session_id: z.string(),
	turn_idx: z.number(),
	record_idx: z.number(),
	at_ms: z.coerce.number(),
	delegation: z.coerce.number(),
	text: z.string(),
});

/**
 * The family of each read session (one owner's sessions): its parent link and
 * the parent's call that spawned it, and the calls through which it reached
 * its own child threads. Sessions without native lineage get an empty entry.
 */
export async function loadSessionSubagents(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	sessionIds: readonly string[],
): Promise<Map<string, SessionSubagents>> {
	const families = await loadFamiliesAround(executor, scope, sessionIds);
	const positions = new Map(
		sessionIds.map((id) => [id, familyPosition(families, scope.userId, id)]),
	);
	const parents = new Set<string>();
	for (const [id, position] of positions) {
		if (position.parentSessionId) parents.add(position.parentSessionId);
		if (childSessions(families, scope.userId, id).length) parents.add(id);
	}
	const links = new Map<string, readonly SubagentLink[]>();
	for (const parent of parents)
		links.set(
			parent,
			await loadParentLinks(
				executor,
				scope,
				parent,
				childSessions(families, scope.userId, parent),
			),
		);
	return new Map(
		[...positions].map(([id, position]) => [
			id,
			{
				...position,
				spawnedBy:
					(position.parentSessionId
						? links
								.get(position.parentSessionId)
								?.find(
									(link) =>
										link.childSessionId === id &&
										link.call.tool === "spawn_agent",
								)
						: undefined) ?? null,
				calls: links.get(id) ?? [],
			},
		]),
	);
}

/**
 * Ties each delegation call to the child thread it reached. Spawns are matched
 * by thread id, then task name, then time (see the file comment); follow-ups
 * and messages by their target, each with the child's first task at or after
 * the call. Pure, so the matching rules are unit-tested.
 */
export function linkSubagents(
	calls: readonly DelegationCall[],
	children: readonly ChildThread[],
): SubagentLink[] {
	const usable = calls.filter((call) => !call.failed);
	const spawns = usable
		.filter((call) => call.tool === "spawn_agent")
		.sort(
			(left, right) => left.atMs - right.atMs || left.record - right.record,
		);
	const claimed = new Set<DelegationCall>();
	const links: SubagentLink[] = [];
	const spawnOf = new Map<string, SubagentLink>();
	const claim = (
		child: ChildThread,
		call: DelegationCall | undefined,
		basis: SubagentLink["basis"],
	) => {
		if (!call || spawnOf.has(child.sessionId)) return;
		claimed.add(call);
		const link = {
			call,
			childSessionId: child.sessionId,
			task: firstTask(child),
			basis,
		};
		spawnOf.set(child.sessionId, link);
		links.push(link);
	};
	for (const child of children)
		claim(
			child,
			spawns.find(
				(call) => !claimed.has(call) && call.spawned === child.sessionId,
			),
			"thread id",
		);
	for (const child of children) {
		const path = taskPath(child);
		if (!path) continue;
		const named = spawns.filter(
			(call) => !claimed.has(call) && spawnNames(call, path),
		);
		claim(
			child,
			latestBefore(named, startedAt(child)) ?? named[0],
			"task name",
		);
	}
	const byStart = children
		.filter((child) => child.tasks.length)
		.sort((left, right) => startedAt(left) - startedAt(right));
	for (const child of byStart)
		claim(
			child,
			latestBefore(
				spawns.filter((call) => !claimed.has(call) && call.spawned === ""),
				startedAt(child),
			),
			"time",
		);
	for (const call of usable) {
		if (call.tool === "spawn_agent") continue;
		const target = argument(call, "target");
		const child = target
			? children.find((thread) => {
					const path = taskPath(thread);
					return (
						thread.sessionId === target ||
						(path !== null && (path === target || lastSegment(path) === target))
					);
				})
			: undefined;
		if (!child) continue;
		const spawn = spawnOf.get(child.sessionId)?.task;
		links.push({
			call,
			childSessionId: child.sessionId,
			task:
				child.tasks.find(
					(task) =>
						task.delegation &&
						task !== spawn &&
						task.atMs >= call.atMs - SPAWN_TOLERANCE_MS,
				) ?? null,
			basis: "task name",
		});
	}
	return links.sort(
		(left, right) =>
			left.call.agentId.localeCompare(right.call.agentId) ||
			left.call.record - right.call.record,
	);
}

/** The ref of the child run a link leads to: the run of its task, else the first. */
export function childRef(link: SubagentLink): RunRef {
	return {
		sessionId: link.childSessionId,
		agentId: "",
		turn: link.task?.turn ?? 1,
	};
}

/** Encrypted delegation payloads (Fernet tokens) say nothing; they only cost characters. */
export function redactEncrypted(text: string): string {
	return text.replace(/gAAAAA[A-Za-z0-9_-]{20,}={0,2}/gu, "[encrypted]");
}

export function isDelegationTool(tool: string): boolean {
	return DELEGATION_TOOLS.includes(tool);
}

async function loadParentLinks(
	executor: ClickHouseExecutor,
	scope: TranscriptReadScope,
	parentSessionId: string,
	children: readonly string[],
): Promise<SubagentLink[]> {
	const [parent] = await queryCountedGenerations(executor, scope, [
		parentSessionId,
	]);
	if (!parent || !children.length) return [];
	const calls = await query(
		executor,
		CallRowSchema,
		buildDelegationCallsStatement(scope, parent),
	);
	const tasks = new Map<string, ChildTask[]>(children.map((id) => [id, []]));
	for (let offset = 0; offset < children.length; offset += BATCH_SESSIONS) {
		const generations = await queryCountedGenerations(
			executor,
			scope,
			children.slice(offset, offset + BATCH_SESSIONS),
		);
		if (!generations.length) continue;
		for (const row of await query(
			executor,
			TaskRowSchema,
			buildChildTasksStatement(scope, generations),
		))
			tasks.get(row.session_id)?.push({
				turn: row.turn_idx,
				record: row.record_idx,
				atMs: row.at_ms,
				delegation: row.delegation > 0,
				text: row.text,
			});
	}
	return linkSubagents(
		calls,
		[...tasks].map(([sessionId, list]) => ({ sessionId, tasks: list })),
	);
}

/** The parent's delegation calls with their result's named thread, in record order. */
function buildDelegationCallsStatement(
	scope: TranscriptReadScope,
	generation: SessionGeneration,
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT c.agent_id AS agent_id, c.turn_idx AS turn_idx, c.record_idx AS record_idx,
				c.tool_name AS tool_name, toUnixTimestamp64Milli(c.ts) AS at_ms, c.args AS args,
				r.spawned AS spawned, r.failed AS failed
			FROM (
				SELECT agent_id, turn_idx, record_idx, block_idx, call_id, tool_name, ts,
					substringUTF8(head, 1, 1024) AS args
				FROM ${records()}
				WHERE ${pinnedRecords()} AND kind = 'tool_call' AND tool_name IN {tools:Array(String)}
				ORDER BY agent_id, record_idx, block_idx
				LIMIT 1 BY agent_id, record_idx, block_idx
			) c
			LEFT ANY JOIN (
				SELECT agent_id, call_id, max(spawned_agent_id) AS spawned,
					max(toUInt8(is_error)) AS failed
				FROM ${records()}
				WHERE ${pinnedRecords()} AND kind = 'tool_result' AND call_id != ''
					AND (agent_id, call_id) IN (
						SELECT agent_id, call_id FROM ${records()}
						WHERE ${pinnedRecords()} AND kind = 'tool_call' AND tool_name IN {tools:Array(String)})
				GROUP BY agent_id, call_id
			) r ON c.agent_id = r.agent_id AND c.call_id = r.call_id AND c.call_id != ''
			ORDER BY c.agent_id, c.record_idx, c.block_idx
			LIMIT {limit:UInt32}`,
		query_params: {
			...pinnedParams(scope, [generation]),
			tools: DELEGATION_TOOLS,
			limit: MAX_CALLS,
		},
	};
}

/** Prompts of the children's main transcripts, delegated tasks marked, heads only. */
function buildChildTasksStatement(
	scope: TranscriptReadScope,
	generations: readonly SessionGeneration[],
): ClickHouseStatement {
	return {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT session_id, turn_idx, record_idx, at_ms, delegation, text FROM (
				SELECT session_id, turn_idx, record_idx, block_idx,
					toUnixTimestamp64Milli(ts) AS at_ms,
					toUInt8(subtype = 'delegation') AS delegation,
					substringUTF8(head, 1, {chars:UInt32}) AS text
				FROM ${records()}
				WHERE ${pinnedRecords()} AND agent_id = '' AND kind = 'user_prompt'
				ORDER BY session_id, record_idx, block_idx
				LIMIT 1 BY session_id, record_idx, block_idx
			)
			ORDER BY session_id, record_idx, block_idx
			LIMIT {perChild:UInt32} BY session_id`,
		query_params: {
			...pinnedParams(scope, generations),
			chars: TASK_CHARS,
			perChild: TASKS_PER_CHILD,
		},
	};
}

/** The task that started the thread: its first delegated prompt, else its first prompt. */
function firstTask(child: ChildThread): ChildTask | null {
	return child.tasks.find((task) => task.delegation) ?? child.tasks[0] ?? null;
}

/** The path a child's delegated task names (`Task name: /root/review`). */
function taskPath(child: ChildThread): string | null {
	const task = firstTask(child);
	return task?.text.match(/^Task name:\s*(\S+)/mu)?.[1] ?? null;
}

function startedAt(child: ChildThread): number {
	return firstTask(child)?.atMs ?? Number.POSITIVE_INFINITY;
}

/** Whether a spawn call or its result names the child's task path. */
function spawnNames(call: DelegationCall, path: string): boolean {
	if (call.spawned) return call.spawned === path;
	const name = argument(call, "task_name");
	return name !== null && (name === path || name === lastSegment(path));
}

/** The latest call at or before `atMs` (with tolerance), else none. */
function latestBefore(
	calls: readonly DelegationCall[],
	atMs: number,
): DelegationCall | undefined {
	return calls.filter((call) => call.atMs <= atMs + SPAWN_TOLERANCE_MS).at(-1);
}

/** A string argument of the call, read from its JSON head even when cut. */
function argument(call: DelegationCall, name: string): string | null {
	const match = new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`, "u").exec(call.args);
	return match?.[1] ?? null;
}

function lastSegment(path: string): string {
	return path.split("/").at(-1) ?? path;
}
