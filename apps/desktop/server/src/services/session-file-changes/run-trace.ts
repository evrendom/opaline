import {
	getRawToolInput,
	SESSION_RUN_SEEN_LIMIT,
	SESSION_RUN_STEP_LABEL_LIMIT,
	type SessionRunCheck,
	type SessionRunReadRange,
	type SessionRunSeen,
	type SessionRunStep,
	type SessionRunStepKind,
} from "@rudel/api-routes";
import { absolutePath, callDirectory } from "@rudel/api-routes/call-paths";
import { describeCommand } from "@rudel/api-routes/command-identity";
import {
	checkOfCommand,
	kindOfTool,
	shellCommandOf,
} from "../session-detail-step-kinds.js";
import { isLineRange, shellReadRanges } from "./read-ranges.js";
import {
	NUMBERED_LINE,
	readResultText,
	type SessionToolCall,
	type ToolCallStream,
	TRACE_EDIT_TOOLS,
	TRACE_READ_TOOLS,
} from "./tool-calls.js";

const SUBAGENT_TOOLS = new Set(["Task", "Agent", "spawn_agent"]);

function cut(text: string | null | undefined): string | null {
	if (!text) return null;
	const flat = text.replace(/\s+/gu, " ").trim();
	return flat.length > SESSION_RUN_STEP_LABEL_LIMIT
		? `${flat.slice(0, SESSION_RUN_STEP_LABEL_LIMIT - 1)}…`
		: flat || null;
}

const nameOf = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;

function shellReadStart(command: string | undefined): number {
	const from =
		/\bsed\s+-n\s+['"]?(\d+)(?:,\d+)?p/u.exec(command ?? "")?.[1] ??
		/\btail\s+-n\s*\+(\d+)/u.exec(command ?? "")?.[1];
	const line = Number(from);
	return Number.isSafeInteger(line) && line > 0 ? line : 1;
}

export function seenOfRead(
	content: unknown,
	command?: string,
): SessionRunSeen | null {
	const text = readResultText(content);
	if (!text.trim()) return null;
	const lines = text.split("\n");
	const numbered = lines.map((line) => NUMBERED_LINE.exec(line));
	const first = Number(numbered[0]?.[1]);
	const consecutive =
		Number.isSafeInteger(first) &&
		first > 0 &&
		numbered.every((match, index) => Number(match?.[1]) === first + index);
	const seen = consecutive
		? numbered.map((match) => match?.[2] ?? "").join("\n")
		: text;
	return {
		cut: seen.length > SESSION_RUN_SEEN_LIMIT,
		line: consecutive ? first : shellReadStart(command),
		text: seen.slice(0, SESSION_RUN_SEEN_LIMIT),
	};
}

function closedBy(
	ranges: SessionRunReadRange[],
	seen: SessionRunSeen | null,
	paths: readonly string[],
): SessionRunReadRange[] {
	const [only] = ranges;
	if (ranges.length !== 1 || !only || only.to !== null) return ranges;
	if (!seen || seen.cut || paths.length !== 1) return ranges;
	const to = only.from + seen.text.split("\n").length - 1;
	return [{ ...only, to }].filter(isLineRange);
}

function readOf(
	call: SessionToolCall,
	command: string | undefined,
	directory: string,
	paths: readonly string[],
	failed: boolean,
): Pick<SessionRunStep, "ranges" | "seen"> {
	const seen =
		call.result && !failed ? seenOfRead(call.result.content, command) : null;
	const ranges = command
		? closedBy(shellReadRanges(command, directory, paths), seen, paths)
		: seen && paths.length === 1 && paths[0]
			? [
					{
						from: seen.line,
						path: paths[0],
						to: seen.line + seen.text.split("\n").length - 1,
					},
				].filter(isLineRange)
			: [];
	return { seen, ...(ranges.length > 0 ? { ranges } : {}) };
}

function spokenCommand(command: string): string {
	return command
		.replace(/^(?:\s*(?:export\s+)?[A-Za-z_][\w]*=\S*\s*(?:;|&&)?)+/u, "")
		.replace(/^\s*cd\s+\S+\s*(?:&&|;)\s*/u, "")
		.trim();
}

export function traceStepOf(
	call: SessionToolCall,
	agentId: string,
	directory = "",
): SessionRunStep {
	const activity = call.activity;
	const command = shellCommandOf(call.toolName, call.input);
	const ranIn = callDirectory(command, directory);
	const files = (activity?.files ?? []).map((file) => ({
		...file,
		path: absolutePath(file.path, ranIn),
	}));
	const paths = [...new Set(files.map((file) => file.path))];
	const reads = files.filter(
		(file) => file.operation === "read" || file.operation === "viewed",
	);
	const failed = call.result?.isError === true || activity?.status === "failed";
	const launched = (call.result as { subagentId?: unknown } | undefined)
		?.subagentId;
	const step = (
		kind: SessionRunStepKind,
		label: string | null,
		check: SessionRunCheck | null = null,
	): SessionRunStep => ({
		agentId,
		at: call.timestamp,
		check,
		eventId: call.id,
		failed,
		kind,
		label: cut(label),
		launched: typeof launched === "string" ? launched : null,
		paths,
		...(ranIn ? { directory: ranIn } : {}),
		...(kind === "read" ? readOf(call, command, ranIn, paths, failed) : {}),
		verb: activity?.verb ?? call.toolName,
	});
	const named = paths.map(nameOf).join(", ");
	if (TRACE_EDIT_TOOLS.has(call.toolName) || /apply_patch/u.test(call.toolName))
		return step("edit", named || activity?.label || null);
	if (TRACE_READ_TOOLS.has(call.toolName)) return step("read", named || null);
	if (SUBAGENT_TOOLS.has(call.toolName) || typeof launched === "string") {
		const raw = getRawToolInput(call.input);
		return step(
			"subagent",
			typeof raw.description === "string"
				? raw.description
				: (activity?.label ?? null),
		);
	}
	const kind = kindOfTool(call.toolName, call.input);
	const lead = command ? (describeCommand(command)?.lead ?? command) : null;
	if (kind === "verify")
		return step("check", lead, command ? checkOfCommand(command) : null);
	if (kind === "search")
		return step(
			"search",
			command ? spokenCommand(command) : activity?.label || named || null,
		);
	if (kind === "git" || kind === "github") return step(kind, lead || named);
	if (kind === "mcp")
		return {
			...step(
				"tool",
				activity?.label || call.toolName.split("__").at(-1) || null,
			),
			tool: call.toolName,
		};
	if (command && reads.length > 0)
		return step("read", reads.map((file) => nameOf(file.path)).join(", "));
	if (command) return step("shell", lead);
	return step("tool", activity?.label || named || call.toolName);
}

export function collectRunTraces(
	streams: Iterable<ToolCallStream>,
): { turnId: string; steps: SessionRunStep[] }[] {
	const byTurn = new Map<string, SessionRunStep[]>();
	for (const stream of streams) {
		if (!stream.turnId) continue;
		const list = byTurn.get(stream.turnId) ?? [];
		byTurn.set(stream.turnId, list);
		for (const call of stream.calls)
			list.push(traceStepOf(call, stream.agentId, stream.directory));
	}
	return [...byTurn]
		.filter(([, steps]) => steps.length > 0)
		.map(([turnId, steps]) => ({
			steps: steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
			turnId,
		}));
}
