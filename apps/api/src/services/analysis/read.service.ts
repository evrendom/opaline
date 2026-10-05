import { ORPCError } from "@orpc/server";
import type {
	AnalysisReadInput,
	AnalysisReadOutput,
	RunRef,
} from "@rudel/api-routes";
import { countCodePoints } from "@rudel/api-routes/transcript-records";
import { z } from "zod";
import { type ClickHouseExecutor, getClickhouse } from "../../clickhouse.js";
import {
	buildRecordBlocksStatement,
	buildTurnActionsStatement,
	type SessionGeneration,
} from "../transcript-records-queries.js";
import {
	readRecord,
	readTurn,
	TRANSCRIPT_READ_MIN_CHARS,
} from "../transcript-records-reader.service.js";
import { withAnalysisDeadline } from "./deadline.js";
import { errorLine } from "./failure-classifier.js";
import { fitReadOutput } from "./output-ceiling.js";
import { nextPromptReaction, runKey } from "./reactions.js";
import { budgetReadOutput } from "./read-output.js";
import {
	buildFailedResultsStatement,
	buildLastAssistantRecordStatement,
	buildLastEditStatement,
	buildPromptHeadStatement,
	type RunAddress,
} from "./read-queries.js";
import { queryRunFacts, type RunRow } from "./run-queries.js";
import { batchByRecords, queryCountedGenerations } from "./scope.js";
import { isAnalysisWorkLimit, query } from "./sql.js";
import {
	childRef,
	isDelegationTool,
	loadSessionSubagents,
	redactEncrypted,
	type SessionSubagents,
	type SubagentLink,
} from "./subagents.js";

type ReadResult = AnalysisReadOutput["reads"][number];

/** Characters still allowed for reading text; `take` cuts and records the cut. */
interface Budget {
	remaining: number;
	truncated: boolean;
	take(text: string): string;
}

const MAX_CHECKS = 300;
const MAX_FAILURES = 20;
const NEXT_PROMPT_CHARS = 160;
const CHECK_TARGET_CHARS = 160;

/**
 * Reads specific runs, never a whole session. The budget bounds what is read
 * from ClickHouse; `budgetReadOutput` then bounds what is emitted, framing
 * included, so the rendered text never exceeds `maxChars`, and
 * `fitReadOutput` bounds its JSON by `ANALYSIS_OUTPUT_MAX_BYTES`.
 */
export function readAnalysis(
	organizationId: string,
	owners: ReadonlyMap<string, string>,
	input: AnalysisReadInput,
	env: { executor: ClickHouseExecutor; deadlineMs?: number } = {
		executor: getClickhouse(),
	},
): Promise<AnalysisReadOutput> {
	return withAnalysisDeadline(
		"analysis.read",
		async (executor) => {
			try {
				const reads = await readRuns(executor, organizationId, owners, input);
				return fitReadOutput(
					budgetReadOutput(
						{ truncated: reads.some((read) => read.truncated), reads },
						input.maxChars,
					),
				);
			} catch (error) {
				if (!isAnalysisWorkLimit(error)) throw error;
				return budgetReadOutput(
					{
						truncated: true,
						reads: input.refs.map((ref) => ({
							ref,
							found: false,
							truncated: true,
							header: "SQL work ceiling reached; this run could not be read",
							sections: [],
						})),
					},
					input.maxChars,
				);
			}
		},
		env,
	);
}

async function readRuns(
	executor: ClickHouseExecutor,
	organizationId: string,
	owners: ReadonlyMap<string, string>,
	input: AnalysisReadInput,
): Promise<ReadResult[]> {
	const { generations, facts } = await pinRuns(
		executor,
		organizationId,
		owners,
		input.refs,
	);
	// A record read is the exact text of one record; families add nothing there.
	const families =
		input.depth === "record"
			? new Map<string, SessionSubagents>()
			: await loadFamilies(executor, organizationId, owners);
	const budget = createBudget(input.maxChars);
	const reads: ReadResult[] = [];
	for (const ref of new Map(
		input.refs.map((ref) => [runKey(ref), ref]),
	).values()) {
		const owner = owners.get(ref.sessionId);
		if (!owner) throw new ORPCError("NOT_FOUND");
		const generation = generations.get(ref.sessionId);
		const fact = facts.get(runKey(ref));
		const result: ReadResult = {
			ref,
			header: budget.take(runHeader(fact)),
			found: fact !== undefined,
			truncated: false,
			sections: [],
		};
		reads.push(result);
		if (!generation || !fact) continue;
		const run = { scope: { organizationId, userId: owner }, generation, ref };
		const family = families.get(ref.sessionId);
		const links =
			family?.calls.filter(
				(link) =>
					link.call.agentId === ref.agentId && link.call.turn === ref.turn,
			) ?? [];
		if (input.depth !== "record" && family?.parentSessionId)
			result.sections.push({
				name: "parent",
				text: budget.take(parentText(family)),
			});
		if (input.depth === "record")
			await readRecordDepth(executor, run, input, budget, result);
		else if (budget.remaining < TRANSCRIPT_READ_MIN_CHARS)
			result.truncated = true;
		else if (input.depth === "turn")
			await readTurnDepth(executor, run, links, budget, result);
		else await readExchange(executor, run, fact, links, budget, result);
		result.truncated ||= budget.truncated;
	}
	return reads;
}

/**
 * Codex subagent families of the read sessions, one owner at a time: a child
 * thread's parent and spawning call, a parent's calls into its threads.
 */
async function loadFamilies(
	executor: ClickHouseExecutor,
	organizationId: string,
	owners: ReadonlyMap<string, string>,
): Promise<Map<string, SessionSubagents>> {
	const families = new Map<string, SessionSubagents>();
	for (const userId of new Set(owners.values()))
		for (const [sessionId, family] of await loadSessionSubagents(
			executor,
			{ organizationId, userId },
			[...owners].filter(([, owner]) => owner === userId).map(([id]) => id),
		))
			families.set(sessionId, family);
	return families;
}

/** Committed generation per session and run facts per ref, one owner at a time. */
async function pinRuns(
	executor: ClickHouseExecutor,
	organizationId: string,
	owners: ReadonlyMap<string, string>,
	refs: readonly RunRef[],
) {
	const generations = new Map<string, SessionGeneration>();
	const facts = new Map<string, RunRow>();
	for (const userId of new Set(owners.values())) {
		const scope = { organizationId, userId };
		const sessionIds = [...owners]
			.filter(([, owner]) => owner === userId)
			.map(([id]) => id);
		const pinned = await queryCountedGenerations(executor, scope, sessionIds);
		if (!pinned.length) continue;
		const wanted = new Set(refs.map(runKey));
		for (const batch of batchByRecords(pinned)) {
			for (const generation of batch)
				generations.set(generation.sessionId, generation);
			for (const row of await queryRunFacts(executor, scope, batch)) {
				const key = runKey({
					sessionId: row.session_id,
					agentId: row.agent_id,
					turn: row.turn_idx,
				});
				if (wanted.has(key)) facts.set(key, row);
			}
		}
	}
	return { generations, facts };
}

async function readRecordDepth(
	executor: ClickHouseExecutor,
	run: RunAddress,
	input: AnalysisReadInput,
	budget: Budget,
	result: ReadResult,
): Promise<void> {
	const record = input.record;
	if (record === undefined) throw new ORPCError("BAD_REQUEST");
	const blocks = await query(
		executor,
		BlockSchema,
		buildRecordBlocksStatement(
			run.scope,
			run.generation,
			run.ref.agentId,
			record,
		),
	);
	const selected =
		input.block === undefined
			? (blocks.find((block) => block.text_chars > 0) ?? blocks[0])
			: blocks.find((block) => block.block_idx === input.block);
	if (selected && selected.turn_idx !== run.ref.turn)
		throw new ORPCError("BAD_REQUEST", {
			message: "Record does not belong to the requested run",
		});
	if (budget.remaining === 0) {
		result.truncated = true;
		return;
	}
	const from = input.fromChar ?? 0;
	const to = Math.min(
		input.toChar ?? Number.MAX_SAFE_INTEGER,
		from + Math.min(budget.remaining, Number.MAX_SAFE_INTEGER - from),
	);
	const slice = await readRecord(
		run.scope,
		run.ref.sessionId,
		record,
		from,
		to,
		{
			executor,
			generation: run.generation,
			agentId: run.ref.agentId,
			blockIdx: input.block,
		},
	);
	result.found = slice.found;
	result.sections.push({ name: "record", text: budget.take(slice.text) });
	result.truncated =
		slice.textTruncatedInStorage ||
		slice.to < Math.min(input.toChar ?? slice.textChars, slice.textChars);
}

async function readTurnDepth(
	executor: ClickHouseExecutor,
	run: RunAddress,
	links: readonly SubagentLink[],
	budget: Budget,
	result: ReadResult,
): Promise<void> {
	const turn = await readTurn(
		run.scope,
		run.ref.sessionId,
		run.ref.turn,
		"raw",
		budget.remaining,
		{
			executor,
			generation: run.generation,
			agentId: run.ref.agentId,
		},
	);
	result.truncated = turn.truncated;
	for (const row of turn.records) {
		const delegation = row.kind === "tool_call" && isDelegationTool(row.tool);
		const shown = delegation ? redactEncrypted(row.text) : row.text;
		const text = budget.take(shown);
		result.sections.push({
			name: "record",
			text,
			record: {
				index: row.recordIdx,
				block: row.blockIdx,
				kind: row.kind,
				tool: row.tool,
				callId: row.callId,
				path: row.filePath,
				commandClass: row.commandClass,
				isError: row.isError,
				exitCode: row.exitCode,
				cut: row.textTruncated || text.length < shown.length,
			},
		});
		for (const link of delegation ? links : [])
			if (link.call.record === row.recordIdx)
				result.sections.push({
					name: "subagent",
					text: budget.take(subagentLine(link)),
				});
	}
}

/**
 * Prompt → files edited → checks run after the last successful edit → failed
 * calls → final assistant message → how the user's next prompt reacted (a
 * label; the prompt's text is not returned).
 */
async function readExchange(
	executor: ClickHouseExecutor,
	run: RunAddress,
	fact: RunRow,
	links: readonly SubagentLink[],
	budget: Budget,
	result: ReadResult,
): Promise<void> {
	const add = (name: string, text: string) =>
		result.sections.push({ name, text: budget.take(text) });
	const turn = await readTurn(
		run.scope,
		run.ref.sessionId,
		run.ref.turn,
		"compact",
		budget.remaining,
		{
			executor,
			generation: run.generation,
			agentId: run.ref.agentId,
		},
	);
	result.truncated = turn.truncated;
	if (turn.prompt && fact.genuine_prompt > 0) add("prompt", turn.prompt.text);
	// A subagent run opens with the task its parent delegated, not a human prompt.
	else if (turn.prompt) add("task", turn.prompt.text);
	add(
		"files edited",
		[...new Set(turn.changedFiles.map((file) => file.path))].join("\n"),
	);

	const [boundary] = await query(
		executor,
		LastEditSchema,
		buildLastEditStatement(run),
	);
	const checks = await query(
		executor,
		CheckSchema,
		buildTurnActionsStatement(
			run.scope,
			run.generation,
			run.ref.agentId,
			run.ref.turn,
			MAX_CHECKS + 1,
			CHECK_TARGET_CHARS,
			boundary?.last_edit ?? 0,
		),
	);
	result.truncated ||= checks.length > MAX_CHECKS;
	add(
		"checks after last edit",
		checks
			.slice(0, MAX_CHECKS)
			.map(
				(check) =>
					`${checkStatus(check)}\t${check.command_class || check.tool_name}\t${isDelegationTool(check.tool_name) ? redactEncrypted(check.target) : check.target}`,
			)
			.join("\n"),
	);

	const failures = await query(
		executor,
		FailureSchema,
		buildFailedResultsStatement(run, MAX_FAILURES + 1),
	);
	result.truncated ||= failures.length > MAX_FAILURES;
	add(
		"failed calls",
		failures
			.slice(0, MAX_FAILURES)
			.map(
				(failure) =>
					`${failure.record_idx}\t${failure.tool_name}\t${errorLine(failure.head, failure.tail)}`,
			)
			.join("\n"),
	);

	if (links.length) add("subagents", links.map(subagentLine).join("\n"));
	await addFinalMessage(executor, run, budget, result);
	if (budget.remaining === 0) {
		result.truncated = true;
		return;
	}
	const [next] = await query(
		executor,
		TextSchema,
		buildPromptHeadStatement(
			{ ...run, ref: { ...run.ref, turn: run.ref.turn + 1 } },
			Math.min(NEXT_PROMPT_CHARS, budget.remaining),
		),
	);
	add(
		"next prompt reaction",
		next ? nextPromptReaction(next.text) : "no next prompt",
	);
}

/** Every text block of the run's last assistant message, within the budget. */
async function addFinalMessage(
	executor: ClickHouseExecutor,
	run: RunAddress,
	budget: Budget,
	result: ReadResult,
): Promise<void> {
	const [last] = await query(
		executor,
		RecordIdxSchema,
		buildLastAssistantRecordStatement(run),
	);
	if (!last) return;
	const blocks = (
		await query(
			executor,
			BlockSchema,
			buildRecordBlocksStatement(
				run.scope,
				run.generation,
				run.ref.agentId,
				last.record_idx,
			),
		)
	).filter((block) => block.kind === "assistant_text");
	const parts: string[] = [];
	for (const block of blocks) {
		if (budget.remaining <= 1) {
			result.truncated = true;
			break;
		}
		if (parts.length) parts.push(budget.take("\n"));
		const slice = await readRecord(
			run.scope,
			run.ref.sessionId,
			last.record_idx,
			0,
			budget.remaining,
			{
				executor,
				generation: run.generation,
				agentId: run.ref.agentId,
				blockIdx: block.block_idx,
			},
		);
		parts.push(budget.take(slice.text));
		result.truncated ||=
			slice.textTruncatedInStorage ||
			countCodePoints(slice.text) < slice.textChars;
	}
	result.sections.push({ name: "final", text: parts.join("") });
}

/** Where a Codex subagent thread came from: the parent's spawning run and call. */
function parentText(family: SessionSubagents): string {
	const link = family.spawnedBy;
	const from = link
		? `spawned by ${JSON.stringify({ sessionId: family.parentSessionId, agentId: link.call.agentId, turn: link.call.turn })} at record ${link.call.record} (${link.call.tool}${link.basis === "time" ? ", matched by time" : ""})`
		: `spawned by session ${family.parentSessionId} (spawning call not found)`;
	return `${from}; depth ${family.depth}, top session ${family.rootSessionId}`;
}

/** A delegation call with the child run it reached and the task the child recorded. */
function subagentLine(link: SubagentLink): string {
	const task = link.task
		? ` task: ${link.task.text.replace(/\s+/gu, " ").trim()}`
		: "";
	return `record ${link.call.record} ${link.call.tool} -> ${JSON.stringify(childRef(link))}${link.basis === "time" ? " (matched by time)" : ""}${task}`;
}

function runHeader(fact: RunRow | undefined): string {
	if (!fact) return "run not found or not indexed";
	return `${new Date(fact.started_ms).toISOString()} minutes=${fact.minutes} activeMinutes=${fact.active_minutes} costUsd=${fact.cost ?? "unpriced"} rawChars=${fact.raw_chars}`;
}

/**
 * A check passed only when its result finished without an error. A result
 * recorded while the process was still running ("Process running", "Script
 * running", a background launch) has no outcome yet: `running`.
 */
function checkStatus(
	check: z.infer<typeof CheckSchema>,
): "fail" | "pass" | "running" | "unknown" {
	if (
		check.result_is_error ||
		(check.result_exit_code !== null && check.result_exit_code !== 0)
	)
		return "fail";
	if (!check.has_result) return "unknown";
	return check.result_running ? "running" : "pass";
}

function createBudget(maxChars: number): Budget {
	return {
		remaining: maxChars,
		truncated: false,
		take(text) {
			const chars = Array.from(text);
			const kept = chars.slice(0, this.remaining).join("");
			this.truncated ||= chars.length > this.remaining;
			this.remaining -= countCodePoints(kept);
			return kept;
		},
	};
}

const BlockSchema = z.object({
	kind: z.string(),
	block_idx: z.number(),
	turn_idx: z.number(),
	text_chars: z.number(),
});
const LastEditSchema = z.object({ last_edit: z.number() });
const RecordIdxSchema = z.object({ record_idx: z.number() });
const TextSchema = z.object({ text: z.string() });
const CheckSchema = z.object({
	target: z.string(),
	tool_name: z.string(),
	command_class: z.string(),
	has_result: z.union([z.number(), z.boolean()]),
	result_is_error: z.number().nullable(),
	result_exit_code: z.number().nullable(),
	result_running: z.number().nullable(),
});
const FailureSchema = z.object({
	record_idx: z.number(),
	tool_name: z.string(),
	head: z.string(),
	tail: z.string(),
});
