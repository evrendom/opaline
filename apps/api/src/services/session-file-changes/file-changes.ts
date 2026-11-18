import {
	buildConversationTrace,
	parseConversations,
	SESSION_FILE_TEXT_LIMIT,
	type SessionDetailTraceItem,
	type SessionFile,
	type SessionFileChange,
	type SessionFileChanges,
	type TraceItem,
	translateCodexToolCall,
} from "@rudel/api-routes";
import { absolutePath, callDirectory } from "@rudel/api-routes/call-paths";
import type { SessionDetailDerivation } from "../session-detail-derivation.service.js";
import { shellCommandOf } from "../session-detail-step-kinds.js";
import { collectRunTraces, traceStepOf } from "./run-trace.js";
import {
	EDIT_TOOLS,
	NUMBERED_LINE,
	READ_TOOLS,
	readResultText,
	resultText,
	type SessionToolCall,
	type ToolCallStream,
	WRITE_TOOLS,
} from "./tool-calls.js";

type Step =
	| {
			kind: "read";
			path: string;
			at: number;
			content: string | null;
			turnId: string | null;
			agentId: string;
	  }
	| {
			kind: "change";
			path: string;
			at: number;
			order: number;
			change: Omit<SessionFileChange, "line" | "cut" | "before"> & {
				before: string | null;
			};
			replaceAll: boolean;
			movedTo: string | null;
	  };

function str(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

/** The most lines Claude Code's Read returns unasked: a read this long
 * may have stopped short of the file's end. */
const READ_LINE_CAP = 2000;

export function wholeFileFromRead(
	input: Record<string, unknown>,
	content: unknown,
): string | null {
	if (input.offset !== undefined || input.limit !== undefined) return null;
	const lines = readResultText(content).split("\n");
	const out: string[] = [];
	for (const [index, line] of lines.entries()) {
		const match = NUMBERED_LINE.exec(line);
		if (!match || Number(match[1]) !== index + 1) return null;
		out.push(match[2] ?? "");
	}
	if (out.length === 0 || out.length >= READ_LINE_CAP) return null;
	return `${out.join("\n")}\n`;
}

function patchSides(diff: string): { before: string; after: string }[] {
	const hunks: { before: string[]; after: string[] }[] = [];
	let current: { before: string[]; after: string[] } | null = null;
	for (const line of diff.split("\n")) {
		if (line.startsWith("@@") || !current) {
			current = { after: [], before: [] };
			hunks.push(current);
			if (line.startsWith("@@")) continue;
		}
		const mark = line[0];
		const text = line.slice(1);
		if (mark === "+") current.after.push(text);
		else if (mark === "-") current.before.push(text);
		else {
			current.before.push(mark === " " ? text : line);
			current.after.push(mark === " " ? text : line);
		}
	}
	return hunks
		.filter((hunk) => hunk.before.length > 0 || hunk.after.length > 0)
		.map((hunk) => ({
			after: hunk.after.join("\n"),
			before: hunk.before.join("\n"),
		}));
}

function stepsOf(
	call: SessionToolCall,
	stream: ToolCallStream,
	order: () => number,
): Step[] {
	const at = Date.parse(call.timestamp);
	if (!Number.isFinite(at)) return [];
	const failed = call.result?.isError === true;
	const base = {
		agentId: stream.agentId,
		at: call.timestamp,
		eventId: call.id,
		failed,
		turnId: stream.turnId,
	};
	const directory = stream.directory ?? "";
	const named = str(call.input.file_path) ?? str(call.input.path);
	const path = named === null ? null : absolutePath(named, directory);
	if (READ_TOOLS.has(call.toolName) && path) {
		return [
			{
				at,
				content:
					call.result && !failed
						? wholeFileFromRead(call.input, call.result.content)
						: null,
				kind: "read",
				path,
				turnId: stream.turnId,
				agentId: stream.agentId,
			},
		];
	}
	if (WRITE_TOOLS.has(call.toolName) && path) {
		const after = str(call.input.content) ?? "";
		const created = /created/iu.test(resultText(call.result?.content));
		return [
			{
				at,
				change: {
					...base,
					after,
					before: null,
					operation: created ? "created" : "edited",
					tool: "write",
				},
				kind: "change",
				movedTo: null,
				order: order(),
				path,
				replaceAll: false,
			},
		];
	}
	if (EDIT_TOOLS.has(call.toolName) && path) {
		const edits = Array.isArray(call.input.edits)
			? (call.input.edits as Record<string, unknown>[])
			: [call.input];
		return edits.map((edit) => ({
			at,
			change: {
				...base,
				after: str(edit.new_string) ?? "",
				before: str(edit.old_string) ?? "",
				operation: "edited" as const,
				tool: "edit" as const,
			},
			kind: "change" as const,
			movedTo: null,
			order: order(),
			path,
			replaceAll: edit.replace_all === true,
		}));
	}
	if (call.provider === "codex" || /apply_patch/u.test(call.toolName)) {
		const translation = translateCodexToolCall(call.toolName, call.input);
		if (translation.resolvedToolName === "apply_patch")
			return translation.files.flatMap((file) => {
				const operation =
					file.operation === "add"
						? ("created" as const)
						: file.operation === "delete"
							? ("deleted" as const)
							: ("edited" as const);
				const sides =
					file.operation === "delete"
						? [{ after: "", before: "" }]
						: patchSides(file.diff ?? "");
				return sides.map((side) => ({
					at,
					change: {
						...base,
						after: side.after,
						before: file.operation === "add" ? null : side.before,
						operation,
						tool: "patch" as const,
					},
					kind: "change" as const,
					movedTo: file.movePath
						? absolutePath(file.movePath, directory)
						: null,
					order: order(),
					path: absolutePath(file.path, directory),
					replaceAll: false,
				}));
			});
	}
	const command = shellCommandOf(call.toolName, call.input);
	if (command && !failed) {
		const step = traceStepOf(call, stream.agentId, directory);
		const readPaths =
			step.kind === "read"
				? step.paths
				: shellReadPaths(call, command, directory);
		return readPaths.map((readPath) => ({
			agentId: stream.agentId,
			at,
			content: null,
			kind: "read" as const,
			path: readPath,
			turnId: stream.turnId,
		}));
	}
	return [];
}

function shellReadPaths(
	call: SessionToolCall,
	command: string,
	directory: string,
): string[] {
	const ranIn = callDirectory(command, directory);
	return [
		...new Set(
			(call.activity?.files ?? [])
				.filter(
					(file) => file.operation === "read" || file.operation === "viewed",
				)
				.map((file) => absolutePath(file.path, ranIn)),
		),
	];
}

function cut(text: string): { text: string; cut: boolean } {
	return text.length > SESSION_FILE_TEXT_LIMIT
		? { cut: true, text: text.slice(0, SESSION_FILE_TEXT_LIMIT) }
		: { cut: false, text };
}

function lineAt(text: string, index: number): number {
	let line = 1;
	for (let at = text.indexOf("\n"); at !== -1 && at < index; ) {
		line += 1;
		at = text.indexOf("\n", at + 1);
	}
	return line;
}

export function collectSessionFileChanges(
	streams: Iterable<ToolCallStream>,
): Pick<SessionFileChanges, "files"> {
	let next = 0;
	const order = () => next++;
	const byPath = new Map<string, Step[]>();
	for (const stream of streams)
		for (const call of stream.calls)
			for (const step of stepsOf(call, stream, order)) {
				const list = byPath.get(step.path) ?? [];
				byPath.set(step.path, list);
				list.push(step);
			}
	const files: SessionFile[] = [];
	for (const [path, steps] of byPath) {
		steps.sort(
			(a, b) =>
				a.at - b.at ||
				(a.kind === "change" ? a.order : -1) -
					(b.kind === "change" ? b.order : -1),
		);
		let content: string | null = null;
		let reads = 0;
		const readTurns: string[] = [];
		const readBy: { turnId: string; agentId: string }[] = [];
		let movedTo: string | null = null;
		const changes: SessionFileChange[] = [];
		for (const step of steps) {
			if (step.kind === "read") {
				reads += 1;
				if (step.turnId && !readTurns.includes(step.turnId))
					readTurns.push(step.turnId);
				const { agentId, turnId } = step;
				if (
					turnId &&
					!readBy.some(
						(entry) => entry.turnId === turnId && entry.agentId === agentId,
					)
				)
					readBy.push({ agentId, turnId });
				if (step.content !== null) content = step.content;
				continue;
			}
			const { change } = step;
			let line: number | null = null;
			let before = change.before;
			if (change.tool === "write" || change.operation === "created") {
				before = change.tool === "write" ? (content ?? "") : "";
				if (!change.failed) content = change.after;
				line = 1;
			} else if (change.operation === "deleted") {
				before = content ?? "";
				if (!change.failed) content = null;
			} else if (content !== null && before !== null) {
				const index = content.indexOf(before);
				if (index === -1) {
					if (!change.failed) content = null;
				} else {
					line = lineAt(content, index);
					if (!change.failed)
						content = step.replaceAll
							? content.split(before).join(change.after)
							: content.slice(0, index) +
								change.after +
								content.slice(index + before.length);
				}
			}
			if (step.movedTo) movedTo = step.movedTo;
			const beforeText = cut(before ?? "");
			const afterText = cut(change.after);
			changes.push({
				...change,
				after: afterText.text,
				before: beforeText.text,
				cut: beforeText.cut || afterText.cut,
				line: line !== null && line > 0 ? line : null,
			});
		}
		const whole = content === null ? null : cut(content);
		files.push({
			changes,
			content: whole?.text ?? null,
			contentCut: whole?.cut ?? false,
			movedTo,
			path,
			readBy,
			readTurns,
			reads,
		});
	}
	return {
		files: files.sort(
			(a, b) =>
				Number(b.changes.length > 0) - Number(a.changes.length > 0) ||
				a.path.localeCompare(b.path),
		),
	};
}

function* toolCalls(
	items: Iterable<SessionDetailTraceItem | TraceItem>,
): Generator<SessionToolCall> {
	for (const item of items) {
		if (item.kind !== "agent") continue;
		for (const event of item.events) if (event.kind === "tool") yield event;
	}
}

function* streamsOf(
	derivation: SessionDetailDerivation,
): Generator<ToolCallStream> {
	const directory = derivation.overviewBase.session.projectPath;
	const launchedIn = new Map<string, string>();
	for (const turn of derivation.turnSummaries) {
		for (const event of turn.subagentEvents ?? [])
			if (event.subagentId && !launchedIn.has(event.subagentId))
				launchedIn.set(event.subagentId, turn.turnId);
		const body = derivation.turnBodies.get(turn.turnId);
		if (body)
			yield {
				agentId: "",
				calls: toolCalls(body.responseItems),
				directory,
				turnId: turn.turnId,
			};
	}
	for (const [subagentId, content] of Object.entries(derivation.rawSubagents))
		yield {
			agentId: subagentId,
			calls: toolCalls(buildConversationTrace(parseConversations(content))),
			directory,
			turnId: launchedIn.get(subagentId) ?? null,
		};
}

export function collectDerivationFileChanges(
	derivation: SessionDetailDerivation,
): SessionFileChanges {
	const streams = [...streamsOf(derivation)].map((stream) => ({
		...stream,
		calls: [...stream.calls],
	}));
	return {
		...collectSessionFileChanges(streams),
		runs: collectRunTraces(streams),
	};
}
