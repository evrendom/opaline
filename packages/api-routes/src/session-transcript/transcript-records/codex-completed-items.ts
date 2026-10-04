import { classifyCommand } from "./command-class.js";
import {
	isRecord,
	type LineItem,
	metaItem,
	readString,
	type StreamState,
	safeStringify,
} from "./line-items.js";
import type { FileOperation } from "./types.js";

/**
 * Codex `event_msg` `item_completed` records.
 *
 * Code-mode `exec` scripts run their commands, MCP and app tools, patches and
 * searches without a `function_call` of their own: the script is one call, and
 * each nested operation is only visible as a completed item carrying its
 * command, exit code and output. Those items become first-class calls and
 * results (subtype `nested`) so failure analysis sees what ran inside a script.
 *
 * Nothing is counted twice:
 * - an item whose id is a known call id mirrors that call: it only lends its
 *   outcome to the call's output (like an end event) and stays meta;
 * - an item id is recorded once even when Codex completes it again;
 * - a `FileChange` path already read statically from the enclosing script's
 *   source keeps that file change; the item adds only the paths it did not see;
 * - a native web search completes before its `web_search_call` response item,
 *   which then stays meta (see `takeWebSearchMirror`).
 *
 * Messages, reasoning, compaction and lifecycle items mirror response items and
 * stay meta.
 */

const NESTED = "nested";

export function readCompletedItem(
	item: unknown,
	state: StreamState,
): LineItem[] {
	if (!isRecord(item)) return [metaItem("item_completed")];
	const type = readString(item.type) ?? "unknown";
	const label = `item_completed:${type}`;
	const id = readString(item.id) ?? "";
	if (id !== "" && state.calls.has(id)) {
		lendOutcomeToCall(id, type, item, state);
		return [metaItem(`${label}_mirror`, { callId: id })];
	}
	if (id !== "" && state.codexCompletedItems.has(id)) {
		return [metaItem(`${label}_repeat`, { callId: id })];
	}
	const items = readNewItem(type, id, item, state);
	if (items === undefined) return [metaItem(label)];
	if (id !== "") state.codexCompletedItems.add(id);
	return items;
}

/**
 * A completed native web search is followed by its `web_search_call` response
 * item; true when the call is that mirror and must not count again.
 */
export function takeWebSearchMirror(state: StreamState): boolean {
	if (state.codexPendingWebSearchMirrors === 0) return false;
	state.codexPendingWebSearchMirrors--;
	return true;
}

/** Command text of a Codex argv or command string (`bash -lc "..."` unwrapped). */
export function argvToCommand(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	const argv = value.filter((part): part is string => typeof part === "string");
	const shell = argv[0]?.split("/").at(-1);
	if (
		argv.length >= 3 &&
		(shell === "bash" || shell === "sh" || shell === "zsh") &&
		(argv[1] === "-lc" || argv[1] === "-c")
	) {
		return argv[2] ?? "";
	}
	return argv
		.map((part) =>
			/^[A-Za-z0-9_@%+=:,./-]+$/u.test(part)
				? part
				: `'${part.replaceAll("'", "'\\''")}'`,
		)
		.join(" ");
}

function readNewItem(
	type: string,
	id: string,
	item: Record<string, unknown>,
	state: StreamState,
): LineItem[] | undefined {
	switch (type) {
		case "CommandExecution":
			return readCommandExecution(id, item);
		case "McpToolCall":
			return readToolItem(id, mcpToolName(item), item.arguments, {
				isError:
					item.status === "failed" ||
					(isRecord(item.result) && item.result.isError === true) ||
					item.error !== undefined,
				output: isRecord(item.result)
					? readContentText(item.result.content)
					: errorText(item.error),
			});
		case "DynamicToolCall":
			return readToolItem(id, dynamicToolName(item), item.arguments, {
				isError: item.success === false || item.status === "failed",
				output: readContentText(item.content_items),
			});
		case "FileChange":
			return readFileChange(id, item, state);
		case "WebSearch":
			return readWebSearch(id, item, state);
		case "Extension":
			return readString(item.kind) === "web.search"
				? readWebSearch(id, item, state)
				: undefined;
		default:
			return undefined;
	}
}

function readCommandExecution(
	id: string,
	item: Record<string, unknown>,
): LineItem[] {
	const command = argvToCommand(item.command);
	const commandClass = classifyCommand(command);
	const exitCode = readFiniteInteger(item.exit_code);
	const base = {
		callId: id,
		commandClass,
		subtype: NESTED,
		toolName: "exec_command",
	};
	return [
		{ ...base, kind: "tool_call", text: command },
		{
			...base,
			exitCode,
			isError: exitCode !== null ? exitCode !== 0 : item.status === "failed",
			kind: "tool_result",
			// No exit code and not finished: still running when recorded.
			...(exitCode === null &&
			item.status !== "failed" &&
			item.status !== "completed"
				? { subtype: "running" }
				: {}),
			text:
				readString(item.aggregated_output) ??
				readString(item.formatted_output) ??
				[readString(item.stdout), readString(item.stderr)]
					.filter((part) => part !== undefined)
					.join("\n"),
		},
	];
}

function readToolItem(
	id: string,
	toolName: string,
	input: unknown,
	outcome: { readonly isError: boolean; readonly output: string },
): LineItem[] {
	const base = { callId: id, subtype: NESTED, toolName };
	return [
		{
			...base,
			kind: "tool_call",
			text:
				typeof input === "string"
					? input
					: input === undefined
						? ""
						: safeStringify(input),
		},
		{
			...base,
			exitCode: null,
			isError: outcome.isError,
			kind: "tool_result",
			text: outcome.output,
		},
	];
}

function readFileChange(
	id: string,
	item: Record<string, unknown>,
	state: StreamState,
): LineItem[] {
	const changes = isRecord(item.changes) ? item.changes : {};
	const seen = state.codexExecScript?.patchPaths ?? new Set<string>();
	const base = { callId: id, subtype: NESTED, toolName: "apply_patch" };
	const fileChanges: LineItem[] = [];
	for (const [path, value] of Object.entries(changes)) {
		const change = isRecord(value) ? value : {};
		const movePath = readString(change.move_path);
		if (
			coversPath(seen, path) &&
			(movePath === undefined || coversPath(seen, movePath))
		)
			continue;
		fileChanges.push(...fileChangeItems(path, change, movePath, base));
	}
	const failed = item.status === "failed";
	if (fileChanges.length === 0 && !failed && Object.keys(changes).length > 0) {
		// Every path is already a file change of the script that applied it.
		return [metaItem("item_completed:FileChange_mirror", { callId: id })];
	}
	return [
		{ ...base, kind: "tool_call", text: Object.keys(changes).join("\n") },
		...fileChanges,
		{
			...base,
			exitCode: null,
			isError: failed,
			kind: "tool_result",
			text: [readString(item.stdout), readString(item.stderr)]
				.filter((part) => part !== undefined)
				.join("\n"),
		},
	];
}

/** A script's patch may name a file relative to its working directory; items use absolute paths. */
function coversPath(seen: ReadonlySet<string>, path: string): boolean {
	if (seen.has(path)) return true;
	for (const candidate of seen)
		if (!candidate.startsWith("/") && path.endsWith(`/${candidate}`))
			return true;
	return false;
}

function fileChangeItems(
	path: string,
	change: Record<string, unknown>,
	movePath: string | undefined,
	base: { callId: string; subtype: string; toolName: string },
): LineItem[] {
	const type = readString(change.type) ?? "update";
	const text = readString(change.unified_diff) ?? readString(change.content);
	const item = (fileOp: FileOperation, filePath: string, body?: string) => ({
		...base,
		fileOp,
		filePath,
		kind: "file_change" as const,
		...(body === undefined ? {} : { text: body }),
	});
	if (type === "delete") return [item("delete", path, text)];
	if (movePath !== undefined && movePath !== path) {
		return [item("delete", path), item("write", movePath, text)];
	}
	return [item(type === "add" ? "write" : "edit", path, text)];
}

function readWebSearch(
	id: string,
	item: Record<string, unknown>,
	state: StreamState,
): LineItem[] {
	const action = isRecord(item.action) ? item.action : {};
	const queries = Array.isArray(action.queries)
		? action.queries.filter(
				(query): query is string => typeof query === "string",
			)
		: [];
	const query =
		readString(item.query) ?? readString(action.query) ?? queries.join("\n");
	const results = Array.isArray(item.results) ? item.results : [];
	const resultText = results
		.flatMap((result) => {
			if (!isRecord(result)) return [];
			return [
				[
					readString(result.title),
					readString(result.url),
					readString(result.snippet),
				]
					.filter((part) => part !== undefined)
					.join(" — "),
			];
		})
		.join("\n");
	if (id.startsWith("ws_")) state.codexPendingWebSearchMirrors++;
	return readToolItem(id, "web_search", query, {
		isError: item.status === "failed",
		output: resultText,
	});
}

/** A completed item that mirrors a recorded call lends it an outcome its output may lack. */
function lendOutcomeToCall(
	id: string,
	type: string,
	item: Record<string, unknown>,
	state: StreamState,
): void {
	if (state.codexEndEvents.has(id)) return;
	const exitCode =
		type === "CommandExecution" ? readFiniteInteger(item.exit_code) : null;
	const failed =
		item.status === "failed" ||
		(isRecord(item.result) && item.result.isError === true) ||
		item.success === false;
	const completed =
		item.status === "completed" || item.success === true || exitCode === 0;
	if (exitCode === null && !failed && !completed) return;
	state.codexEndEvents.set(id, {
		exitCode,
		success: exitCode !== null ? exitCode === 0 : !failed,
	});
}

function mcpToolName(item: Record<string, unknown>): string {
	const server = readString(item.server) ?? "unknown";
	const tool = readString(item.tool) ?? "unknown";
	return `mcp__${server}__${tool}`;
}

function dynamicToolName(item: Record<string, unknown>): string {
	const tool = readString(item.tool) ?? "unknown";
	const namespace = readString(item.namespace);
	return namespace === undefined ? tool : `${namespace}.${tool}`;
}

function readContentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) {
		return content === undefined || content === null
			? ""
			: safeStringify(content);
	}
	return content
		.flatMap((part) => {
			if (isRecord(part) && typeof part.text === "string") return [part.text];
			if (isRecord(part) && part.type === "image") return ["[image]"];
			return part === undefined ? [] : [safeStringify(part)];
		})
		.join("\n");
}

function errorText(error: unknown): string {
	if (typeof error === "string") return error;
	if (isRecord(error)) return readString(error.message) ?? safeStringify(error);
	return "";
}

function readFiniteInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value)
		? value
		: null;
}
