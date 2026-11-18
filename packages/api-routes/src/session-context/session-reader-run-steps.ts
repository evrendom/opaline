import {
	type CommandKind,
	commandIdentity,
	describeCommand,
} from "../command-identity.js";
import type { RunCiJob, RunCiRun } from "../run-ci.js";
import type { SessionDetailTurnSummary } from "../schemas/session-detail-payload.js";
import { getCodexOperationMetadata } from "../session-transcript/codex-activity-graph.js";
import type { TraceEvent } from "../session-transcript/conversation-trace.js";
import { deriveTranscriptToolActivity } from "../session-transcript/transcript-tool-activity.js";
import {
	getShellCommand,
	getToolPresentation,
	type ToolIconName,
} from "./conversation-tools.js";
import { memoByIdentity } from "./memo-by-identity.js";
import { withBackground } from "./session-reader-background.js";
import type { SessionReaderBody } from "./session-reader-body.js";
import { runsAlongside } from "./session-reader-call-order.js";
import { type FileOp, getFileOps } from "./session-reader-files.js";
import { mcpTool } from "./session-reader-mcp-tool.js";
import { shellCommandOf } from "./session-reader-step-lanes.js";
import {
	afterWake,
	getHarnessSteps,
	getOutputStartMs,
	getWriteStartMs,
	INPUT_IS_THE_CALL,
	MIN_WRITE_MS,
	modelStep,
	runOnInBackground,
	WAITS_ON_YOU,
	writingMs,
} from "./session-reader-step-timing.js";

// A turn's run as timed steps — the reader's waterfall — with subagents
// nested under the calls that launched them: Codex's, which work inline in
// the turn, and Claude's, whose transcripts are fetched apart.

/** One row of the turn waterfall: something the agent did. */
export type SessionReaderStep = {
	/** What a tool call acted on, or the opening line of written text. */
	detail: string | null;
	endMs: number;
	/** A tool call's glyph, as the transcript draws it; null for written output. */
	icon: ToolIconName | null;
	id: string;
	isError: boolean;
	/** The agent's own id for the step (see TraceEvent's nativeId); null when
	 * the transcript gives none. */
	nativeId: string | null;
	kind: "agent" | "ci" | "message" | "thinking" | "tool";
	ci?: SessionReaderCi;
	backgroundFromMs?: number;
	files?: FileOp[];
	writtenUntilMs?: number;
	promptUntilMs?: number;
	harness?: "compaction" | "hooks" | "member" | "notification";
	compaction?: SessionReaderCompaction;
	notification?: { agent: boolean; taskId: string; toolUseId: string | null };
	queuedUntilMs?: number;
	waitsOnYou?: boolean;
	writes?: string;
	command?: { chain: string; kind: CommandKind; lead: string };
	/** The skill a tool call loaded — the Skill tool, or a read of its
	 * SKILL.md — which then names the step and lends it its mark. */
	skill?: string;
	model?: string;
	effort?: string;
	name: string;
	/** Tool output, flattened to text. */
	result: string | null;
	startMs: number;
	/** A subagent's own steps, nested under the call that launched it. */
	children: SessionReaderStep[];
	/** Message or reasoning text. */
	text: string | null;
	/** The call as recorded, for its rendered body in the inspector. */
	toolEvent: Extract<TraceEvent, { kind: "tool" }> | null;
};

export type SessionReaderCompaction = NonNullable<
	Extract<
		SessionReaderBody["responseItems"][number],
		{ kind: "system" }
	>["compaction"]
>;

export type SessionReaderCi =
	| { kind: "group"; dimmed: true }
	| { kind: "run"; dimmed: boolean; run: RunCiRun }
	| {
			kind: "job";
			dimmed: boolean;
			job: RunCiJob;
			run: RunCiRun;
			startedMs: number | null;
	  };

export type SessionReaderWaterfall = {
	/** Every step, subagents' included, depth-first: the order selection,
	 * ↑/↓ and the run's breakdowns walk. */
	allSteps: SessionReaderStep[];
	endMs: number;
	model: string | null;
	startMs: number;
	/** The main agent's steps; subagents' hang off their calls. */
	steps: SessionReaderStep[];
};

type StepEvent = Extract<
	Extract<
		SessionReaderBody["responseItems"][number],
		{ kind: "agent" }
	>["events"][number],
	{ kind: "message" | "reasoning" | "tool" }
>;

type StepToolEvent = Extract<StepEvent, { kind: "tool" }>;

/** A Claude step id: its transcript line's UUID, then the block's place. */
const CLAUDE_STEP_ID =
	/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-\d+$/;

/**
 * The agent's own id for a step. Newer payloads carry it (`nativeId`). For
 * older ones a Claude step's id still starts with its line's UUID, Claude's
 * own id for that line, and a Codex tool call keeps its call id in the
 * operation metadata the parser attaches. Codex thinking and messages have
 * only derived ids, so they get none.
 */
function getNativeStepId(event: StepEvent): string | null {
	if (event.nativeId) return event.nativeId;
	if (event.provider === "codex") {
		return event.kind === "tool"
			? (getCodexOperationMetadata(event.input)?.operationId ?? null)
			: null;
	}
	return CLAUDE_STEP_ID.exec(event.id)?.[1] ?? null;
}

const SUBAGENT_TOOL_NAMES = new Set(["Agent", "Task", "spawn_agent"]);

/**
 * The subagent a call launched, as the key its steps are kept under: the
 * result's subagent id (Claude's, Codex's inline agents), or for Codex's
 * spawn_agent — whose subagent runs as a session of its own — the agent path
 * its output names (`{"task_name":"/root/athena_privacy"}`).
 */
export function getLaunchedSubagentKey(event: StepToolEvent): string | null {
	if (event.result?.subagentId) return event.result.subagentId;
	if (event.toolName !== "spawn_agent" || !event.result) return null;
	const text = getResultText(event.result);
	try {
		const output: unknown = JSON.parse(text);
		const taskName =
			output && typeof output === "object" && "task_name" in output
				? output.task_name
				: undefined;
		return typeof taskName === "string" && taskName ? taskName : null;
	} catch {
		return null;
	}
}

function firstLine(text: string): string | null {
	return (
		text
			.split("\n")
			.map((line) => line.trim())
			.find((line) => line.length > 0) ?? null
	);
}

function getResultText(result: NonNullable<StepToolEvent["result"]>): string {
	if (typeof result.content === "string") return result.content;
	return result.content
		.map((block) =>
			block.type === "text"
				? block.text
				: block.type === "image"
					? "[image]"
					: JSON.stringify(block.value, null, 2),
		)
		.join("\n");
}

const COMMANDS_HELD = 5_000;
function held<T>(cache: Map<string, T>, key: string, read: () => T): T {
	if (cache.has(key)) return cache.get(key) as T;
	const value = read();
	if (cache.size >= COMMANDS_HELD)
		cache.delete(cache.keys().next().value as string);
	cache.set(key, value);
	return value;
}
const described = new Map<string, ReturnType<typeof describeCommand>>();
const identified = new Map<string, ReturnType<typeof commandIdentity>>();
const describedCommand = (shell: string) =>
	held(described, shell, () => describeCommand(shell));
const identifiedCommand = (shell: string) =>
	held(identified, shell, () => commandIdentity(shell));

/** What kind of tool call this is: a subagent (named by its type), a skill
 * loaded (by the skill's name), or a tool (by its name), with the glyph the
 * transcript draws for it. */
function getToolIdentity(
	event: StepToolEvent,
): Pick<SessionReaderStep, "command" | "icon" | "kind" | "name" | "skill"> {
	// Claude names the subagent's type; Codex's spawn_agent its task.
	const subagentType = event.input.subagent_type ?? event.input.task_name;
	const isAgent =
		event.result?.subagentId !== undefined ||
		SUBAGENT_TOOL_NAMES.has(event.toolName);
	const skill = isAgent
		? undefined
		: (event.activity ?? deriveTranscriptToolActivity(event)).skills[0];
	if (skill)
		return {
			icon: getToolPresentation(event.toolName, event.input, event.provider)
				.icon,
			kind: "tool",
			name: skill,
			skill,
		};
	const shell = isAgent
		? undefined
		: getShellCommand(event.toolName, event.input);
	const command = shell ? describedCommand(shell) : null;
	return {
		...(command ? { command } : {}),
		icon: isAgent
			? "bot"
			: getToolPresentation(event.toolName, event.input, event.provider).icon,
		kind: isAgent ? "agent" : "tool",
		// A subagent with no type named is just that, whatever the tool's name.
		name: isAgent
			? typeof subagentType === "string" && subagentType
				? subagentType
				: "Subagent"
			: (command?.lead ??
				(shell ? identifiedCommand(shell)?.argv0 : undefined) ??
				mcpName(event.toolName) ??
				event.toolName),
	};
}

function mcpName(toolName: string): string | undefined {
	const named = mcpTool(toolName);
	return named ? `${named.server}:${named.tool}` : undefined;
}

export function getToolStep(
	event: StepToolEvent,
	atMs: number,
): SessionReaderStep {
	const identity = getToolIdentity(event);
	const description = event.input.description;
	const target = event.activity?.actions[0]?.targets[0];
	const detail =
		identity.kind === "agent" && typeof description === "string"
			? description
			: (target ?? event.activity?.label ?? null);
	const model = event.input.model;
	return {
		...identity,
		...(identity.kind === "agent" && typeof model === "string" && model
			? { model }
			: {}),
		// Codex's spawn_agent targets its own task name, which the row already
		// shows as the subagent's name.
		detail: detail === identity.name ? null : detail,
		endMs: atMs,
		id: event.id,
		isError: event.result?.isError === true,
		result: event.result ? getResultText(event.result) : null,
		startMs: atMs,
		children: [],
		text: null,
		// The transcript's event type spells out a missing result.
		nativeId: getNativeStepId(event),
		toolEvent: { ...event, result: event.result },
	};
}

/**
 * The turn as a waterfall of what the agent did, in order: its thinking, what
 * it wrote, and each tool it called. Transcripts stamp when each block was
 * written, so a tool runs from its call to its result, and written output
 * runs from whatever the model was waiting on — the prompt, its previous
 * output, or the last result it needed. Results recorded without a time (older
 * API builds) fall back to ending when the model writes again; output after
 * those can't be told apart from the tool's wait, so it shows as a point.
 */
export type AgentItem = Extract<
	SessionReaderBody["responseItems"][number],
	{ kind: "agent" }
>;
type OpenTool = {
	alongside: boolean;
	resultMs: number | null;
	step: SessionReaderStep;
};

/** The session's own agent, as opposed to a subagent working inline. */
function isRootAgentName(agentName: string | undefined): boolean {
	return (
		agentName === undefined || agentName === "/root" || agentName === "root"
	);
}

/**
 * One agent's steps from its items, timed as the doc on getReaderWaterfall
 * says. A tool call whose result names a subagent working inline in this
 * turn (Codex's spawn_agent) gets that subagent's steps as its children,
 * built the same way from when it was launched.
 */
function buildAgentSteps(
	items: readonly AgentItem[],
	startMs: number | null,
	branches: ReadonlyMap<string, AgentItem[]>,
	seen: Set<string>,
	resumes: readonly number[] = [],
): { openTools: OpenTool[]; steps: SessionReaderStep[] } {
	const steps: SessionReaderStep[] = [];
	// Tool calls since the model last wrote, with when their result came back
	// (null when it wasn't recorded).
	let openTools: OpenTool[] = [];
	let previousOutputMs = startMs;
	const wakes: number[] = [...resumes];
	for (const item of items) {
		for (const event of item.events) {
			if (event.kind === "orphan-result") continue;
			const atMs = Date.parse(event.timestamp);
			if (!Number.isFinite(atMs)) continue;
			if (event.kind === "tool") {
				const step = getToolStep(event, atMs);
				const resultMs = event.result?.timestamp
					? Date.parse(event.result.timestamp)
					: Number.NaN;
				const subagentId = getLaunchedSubagentKey(event);
				const branch = subagentId ? branches.get(subagentId) : undefined;
				if (subagentId && branch && !seen.has(subagentId)) {
					seen.add(subagentId);
					step.children = closeOpenTools(
						buildAgentSteps(branch, atMs, branches, seen),
					);
					const ranOn = branch.find((item) => item.modelSetting)?.modelSetting;
					if (ranOn) step.effort = ranOn;
				}
				const writeFromMs = getWriteStartMs(
					atMs,
					openTools,
					previousOutputMs,
					wakes,
				);
				const ownsInput =
					SUBAGENT_TOOL_NAMES.has(event.toolName) ||
					INPUT_IS_THE_CALL.has(event.toolName);
				const fromInput = ownsInput
					? Math.max(writeFromMs, atMs - writingMs(event.input))
					: atMs;
				const writtenFromMs =
					atMs - fromInput < MIN_WRITE_MS ? atMs : fromInput;
				if (writtenFromMs - writeFromMs >= MIN_WRITE_MS)
					steps.push(modelStep(step, writeFromMs, writtenFromMs, !ownsInput));
				if (atMs - writtenFromMs >= MIN_WRITE_MS) {
					step.startMs = writtenFromMs;
					if (SUBAGENT_TOOL_NAMES.has(event.toolName))
						step.promptUntilMs = atMs;
					else step.writtenUntilMs = atMs;
				}
				if (WAITS_ON_YOU.has(event.toolName)) step.waitsOnYou = true;
				const files = getFileOps(event);
				if (files.length > 0) step.files = files;
				const alongside =
					item.provider !== "codex" &&
					runsAlongside(event.toolName, shellCommandOf(step) || undefined);
				const before = openTools.flatMap((tool) =>
					tool.resultMs !== null &&
					tool.resultMs > atMs &&
					(!Number.isFinite(resultMs) || tool.resultMs <= resultMs) &&
					!(alongside && tool.alongside)
						? [tool.resultMs]
						: [],
				);
				if (before.length > 0) step.queuedUntilMs = Math.max(...before);
				const finishedMs = event.background?.finishedAt
					? Date.parse(event.background.finishedAt)
					: Number.NaN;
				if (Number.isFinite(finishedMs)) wakes.push(finishedMs);
				steps.push(step);
				openTools.push({
					alongside,
					resultMs: Number.isFinite(resultMs) ? Math.max(resultMs, atMs) : null,
					step,
				});
				previousOutputMs = atMs;
				continue;
			}
			const text = event.text.trim();
			if (!text) continue;
			for (const tool of openTools) {
				tool.step.endMs = tool.resultMs ?? Math.max(atMs, tool.step.startMs);
			}
			const outputStartMs = afterWake(
				getOutputStartMs(atMs, openTools, previousOutputMs),
				atMs,
				wakes,
			);
			openTools = [];
			steps.push({
				children: [],
				detail: firstLine(text),
				endMs: atMs,
				icon: null,
				nativeId: getNativeStepId(event),
				id: event.id,
				isError: false,
				kind: event.kind === "reasoning" ? "thinking" : "message",
				name: event.kind === "reasoning" ? "Thinking" : "Message",
				result: null,
				startMs: outputStartMs,
				text,
				toolEvent: null,
			});
			previousOutputMs = atMs;
		}
	}
	return { openTools, steps };
}

/** A step's latest end, its subtree's included. */
function subtreeEndMs(step: SessionReaderStep): number {
	return Math.max(step.endMs, ...step.children.map(subtreeEndMs));
}

/** A subagent's steps with the calls it ended on closed at their result, or
 * at the subagent's last moment. */
function closeOpenTools(built: {
	openTools: OpenTool[];
	steps: SessionReaderStep[];
}): SessionReaderStep[] {
	const lastMs = Math.max(
		...built.steps.map(subtreeEndMs),
		...built.openTools.map((tool) => tool.resultMs ?? tool.step.endMs),
	);
	for (const tool of built.openTools) tool.step.endMs = tool.resultMs ?? lastMs;
	return built.steps;
}

function stretchToChildren(steps: readonly SessionReaderStep[]) {
	for (const step of steps) {
		stretchToChildren(step.children);
		const returnedMs = step.endMs;
		step.endMs = subtreeEndMs(step);
		if (
			step.kind === "agent" &&
			step.backgroundFromMs === undefined &&
			step.endMs - returnedMs >= 1_000
		)
			step.backgroundFromMs = returnedMs;
	}
}

/** Every step, depth-first: each one, then its subagent's. */
export function flattenSteps(
	steps: readonly SessionReaderStep[],
): SessionReaderStep[] {
	return steps.flatMap((step) => [step, ...flattenSteps(step.children)]);
}

type WaterfallTurn = Pick<
	SessionDetailTurnSummary,
	"endedAt" | "startedAt" | "usageCalls"
>;

export const getReaderWaterfall: (
	body: SessionReaderBody,
	turn: WaterfallTurn,
	model: string | null,
	fetchedBranches?: ReadonlyMap<string, readonly AgentItem[]>,
) => SessionReaderWaterfall | null = memoByIdentity(buildReaderWaterfall);

function buildReaderWaterfall(
	body: SessionReaderBody,
	turn: WaterfallTurn,
	model: string | null,
	fetchedBranches?: ReadonlyMap<string, readonly AgentItem[]>,
): SessionReaderWaterfall | null {
	const promptMs = turn.startedAt ? Date.parse(turn.startedAt) : Number.NaN;
	// The main agent's items, and each subagent working inline (Codex) by name.
	const rootItems: AgentItem[] = [];
	const branches = new Map<string, AgentItem[]>();
	for (const item of body.responseItems) {
		if (item.kind !== "agent") continue;
		if (isRootAgentName(item.agentName)) {
			rootItems.push(item);
			continue;
		}
		const name = item.agentName as string;
		branches.set(name, [...(branches.get(name) ?? []), item]);
	}
	// A fetched transcript only fills in for a subagent not already inline.
	for (const [id, items] of fetchedBranches ?? []) {
		if (!branches.has(id)) branches.set(id, [...items]);
	}
	const harness = getHarnessSteps(body);
	const { openTools, steps: agentSteps } = buildAgentSteps(
		withBackground(rootItems, body),
		Number.isFinite(promptMs) ? promptMs : null,
		branches,
		new Set(),
		harness
			.filter(
				(step) =>
					step.harness === "compaction" || step.harness === "notification",
			)
			.map((step) => step.endMs),
	);
	if (agentSteps.length === 0 && harness.length === 0) return null;
	const notified = (step: SessionReaderStep) =>
		step.harness === "notification" ? 0 : 1;
	const steps = [...agentSteps, ...harness].sort(
		(a, b) => a.startMs - b.startMs || notified(a) - notified(b),
	);

	const endedMs = turn.endedAt ? Date.parse(turn.endedAt) : Number.NaN;
	const allSteps = flattenSteps(steps);
	const firstMs = Math.min(...allSteps.map((step) => step.startMs));
	const lastMs = Math.max(
		...steps.map((step) => step.endMs),
		...openTools.map((tool) => tool.resultMs ?? tool.step.endMs),
	);
	const endMs = Math.max(lastMs, Number.isFinite(endedMs) ? endedMs : lastMs);
	// Tools the turn ended on ran until their result, or until the turn did.
	for (const tool of openTools) tool.step.endMs = tool.resultMs ?? endMs;
	runOnInBackground(allSteps);
	stretchToChildren(steps);
	// The message the turn ends on, with no tool after it, is the answer.
	for (let i = steps.length - 1; i >= 0; i--) {
		const step = steps[i] as SessionReaderStep;
		if (step.harness) continue;
		if (step.kind === "message" && !step.writes) step.name = "Response";
		if (step.kind !== "thinking") break;
	}

	return {
		allSteps,
		endMs,
		model: turn.usageCalls.find((call) => call.model !== null)?.model ?? model,
		startMs: Math.min(firstMs, Number.isFinite(promptMs) ? promptMs : firstMs),
		steps,
	};
}
