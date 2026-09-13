import {
	getCodexOperationMetadata,
	getCodexRawOperationInput,
	isCodexOperationInput,
} from "./codex-activity-graph.js";
import { extractCustomExecInvocations } from "./codex-javascript-extractor.js";

import { splitShellCommands } from "./split-shell-commands.js";

const CODEX_CORRELATION_KEY = "__rudel_codex_correlation";

const DELEGATION_TOOL_NAMES = new Set([
	"close_agent",
	"followup_task",
	"interrupt_agent",
	"list_agents",
	"resume_agent",
	"send_message",
	"spawn_agent",
	"wait_agent",
]);

const RASTER_IMAGE_EXTENSIONS = new Set(["gif", "jpeg", "jpg", "png", "webp"]);

const SIMPLE_READ_COMMANDS = new Set(["cat", "head", "nl", "tail"]);
const SIMPLE_SEARCH_COMMANDS = new Set(["grep", "ls", "rg"]);
const SAFE_SEARCH_OPTIONS = new Set([
	"--files",
	"--fixed-strings",
	"--hidden",
	"--ignore-case",
	"--line-number",
	"--no-heading",
	"--recursive",
	"-F",
	"-H",
	"-I",
	"-R",
	"-S",
	"-i",
	"-l",
	"-n",
	"-r",
]);
const SEARCH_OPTIONS_WITH_VALUES = new Set([
	"--exclude",
	"--exclude-dir",
	"--glob",
	"--include",
	"--regexp",
	"--type",
	"-e",
	"-g",
	"-t",
]);

export type CodexActivity =
	| "delegating"
	| "editing"
	| "executing"
	| "external"
	| "interacting"
	| "planning"
	| "reading"
	| "searching"
	| "unmapped"
	| "viewing"
	| "web-research"
	| "writing";

export type CodexPatchOperation = "add" | "delete" | "update";

export type CodexPatchFile = {
	diff: string | undefined;
	movePath: string | undefined;
	operation: CodexPatchOperation;
	path: string;
};

export type CodexPlanStep = {
	status: string;
	step: string;
};

export type CodexToolTranslation = {
	activity: CodexActivity;
	command: string | undefined;
	exitCode: number | undefined;
	files: readonly CodexPatchFile[];
	mapped: boolean;
	planExplanation: string | undefined;
	planSteps: readonly CodexPlanStep[];
	primaryLabel: string | undefined;
	resolvedToolName: string;
	script: string | undefined;
	success: boolean | undefined;
	verb: string;
};

export type TranscriptFileActivity = {
	operation: "created" | "deleted" | "edited" | "read" | "viewed";
	path: string;
};

type ParsedShellCommand = {
	activity: "executing" | "reading" | "searching";
	command: string;
	files: readonly CodexPatchFile[];
	primaryLabel: string;
};

type ExtractedToolInvocation = {
	input: Readonly<Record<string, unknown>>;
	name: string;
};

type ToolTranslationInput = {
	command: string | undefined;
	computerUseTarget: string | undefined;
	endEvent: Readonly<Record<string, unknown>> | undefined;
	input: Readonly<Record<string, unknown>>;
	rawToolName: string;
};

export function attachCodexCorrelation(
	input: Readonly<Record<string, unknown>>,
	endEvent: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
	return { ...input, [CODEX_CORRELATION_KEY]: endEvent ?? {} };
}

export function isCodexToolInput(
	input: Readonly<Record<string, unknown>>,
	provider: "claude" | "codex" | undefined = undefined,
): boolean {
	return (
		isCodexOperationInput(input) ||
		(provider === "codex" && CODEX_CORRELATION_KEY in input)
	);
}

export function getRawToolInput(
	input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
	return getCodexRawOperationInput(
		Object.fromEntries(
			Object.entries(input).filter(([key]) => key !== CODEX_CORRELATION_KEY),
		),
	);
}

export function translateCodexToolCall(
	rawToolName: string,
	input: Readonly<Record<string, unknown>>,
): CodexToolTranslation {
	const rawInput = getRawToolInput(input);
	const metadata = getCodexOperationMetadata(input);
	const endEvent =
		metadata?.lifecycle ?? readRecord(input[CODEX_CORRELATION_KEY]);
	const normalizedName = normalizeToolName(rawToolName);
	const isCustomExecCarrier = metadata
		? metadata.carrierName === "exec" && metadata.carrierSource !== undefined
		: CODEX_CORRELATION_KEY in input && typeof rawInput.input === "string";

	if (normalizedName === "exec" && isCustomExecCarrier) {
		return translateCustomExec(rawToolName, rawInput, endEvent);
	}
	if (
		normalizedName === "exec" &&
		metadata?.carrierName === "exec" &&
		metadata.carrierSource === undefined
	) {
		return baseTranslation({
			activity: "external",
			endEvent,
			files: [],
			primaryLabel: readString(rawInput.command),
			resolvedToolName: rawToolName,
			verb: "Used external tool",
		});
	}

	return translateResolvedTool({
		command: readString(rawInput.cmd),
		endEvent,
		input: rawInput,
		rawToolName,
		computerUseTarget: metadata?.computerUseTarget,
	});
}

export function getTranscriptToolFileActivities(
	toolName: string,
	input: Readonly<Record<string, unknown>>,
	provider: "claude" | "codex" | undefined = undefined,
): readonly TranscriptFileActivity[] {
	const metadata = getCodexOperationMetadata(input);
	if (
		metadata?.correlation === "ambiguous-positional" ||
		metadata?.correlation === "unmatched"
	) {
		return [];
	}
	const translation =
		provider === "codex" || isCodexToolInput(input, provider)
			? translateCodexToolCall(toolName, input)
			: undefined;
	if (translation?.mapped) {
		if (translation.success === false) {
			return [];
		}
		if (translation.command && translation.activity !== "reading") {
			return classifyShellCommandActivities(translation.command).flatMap(
				(part) =>
					part.files.map((file) => ({
						operation: "read" as const,
						path: file.path,
					})),
			);
		}
		return translation.files.map((file) => ({
			operation:
				translation.activity === "viewing"
					? "viewed"
					: file.operation === "add"
						? "created"
						: file.operation === "delete"
							? "deleted"
							: translation.activity === "reading"
								? "read"
								: "edited",
			path: file.path,
		}));
	}

	const normalizedName = normalizeToolName(toolName);
	const path = readFirstString(input, ["file_path", "notebook_path", "path"]);
	if (!path) {
		return [];
	}
	if (normalizedName === "read") {
		return [{ operation: isRasterImagePath(path) ? "viewed" : "read", path }];
	}
	if (normalizedName === "write") {
		return [{ operation: "created", path }];
	}
	if (["edit", "multiedit", "notebookedit"].includes(normalizedName)) {
		return [{ operation: "edited", path }];
	}
	return [];
}

export function extractCustomExecInvocation(
	source: string,
): ExtractedToolInvocation | undefined {
	const invocations = extractCustomExecInvocations(source);
	const invocation = invocations.length === 1 ? invocations[0] : undefined;
	return invocation?.resolvedInput
		? { input: invocation.input, name: invocation.name }
		: undefined;
}

export function classifySimpleShellCommand(
	command: string,
): ParsedShellCommand {
	const tokens = tokenizeSimpleShellCommand(
		command.replace(/\s+1?>\s*\/dev\/null$/u, ""),
	);
	if (!tokens || tokens.length === 0) {
		return executingShellCommand(command);
	}

	const executable = basename(tokens[0] ?? "").toLowerCase();
	if (executable === "find") {
		return executingShellCommand(command);
	}
	if (executable === "sed") {
		return classifySedCommand(command, tokens);
	}
	if (SIMPLE_READ_COMMANDS.has(executable)) {
		return classifyReadCommand(command, executable, tokens);
	}
	if (SIMPLE_SEARCH_COMMANDS.has(executable)) {
		return classifySearchCommand(command, executable, tokens);
	}
	return executingShellCommand(command);
}

export function classifyShellCommandActivities(
	command: string,
): readonly ParsedShellCommand[] {
	return (splitShellCommands(command) ?? [command]).map(
		classifySimpleShellCommand,
	);
}

export function parseCodexPatch(patch: string): readonly CodexPatchFile[] {
	const normalizedPatch = patch.replace(/\r\n?/gu, "\n");
	const lines = normalizedPatch.split("\n");
	const files: CodexPatchFile[] = [];
	let current:
		| {
				diffLines: string[];
				movePath: string | undefined;
				operation: CodexPatchOperation;
				path: string;
		  }
		| undefined;

	function flushCurrent() {
		if (!current) {
			return;
		}
		files.push({
			diff: current.diffLines.join("\n").trimEnd() || undefined,
			movePath: current.movePath,
			operation: current.operation,
			path: current.path,
		});
		current = undefined;
	}

	for (const line of lines) {
		const fileMatch = /^\*\*\* (Add|Delete|Update) File: (.+)$/u.exec(line);
		if (fileMatch) {
			flushCurrent();
			const operationName = fileMatch[1];
			const path = fileMatch[2]?.trim();
			if (!path) {
				continue;
			}
			current = {
				diffLines: [],
				movePath: undefined,
				operation:
					operationName === "Add"
						? "add"
						: operationName === "Delete"
							? "delete"
							: "update",
				path,
			};
			continue;
		}
		if (!current) {
			continue;
		}
		const moveMatch = /^\*\*\* Move to: (.+)$/u.exec(line);
		if (moveMatch) {
			current.movePath = moveMatch[1]?.trim() || undefined;
			continue;
		}
		if (line === "*** End Patch") {
			flushCurrent();
			continue;
		}
		current.diffLines.push(line);
	}
	flushCurrent();
	return files;
}

export function stripCodexInjectedBlocks(text: string): string {
	return text
		.replace(
			/<(?:environment_context|system_instruction|recommended_plugins)>[\s\S]*?<\/(?:environment_context|system_instruction|recommended_plugins)>/giu,
			"",
		)
		.replace(/<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gu, "")
		.replace(/^# AGENTS\.md instructions[^\n]*(?:\n|$)/gmu, "")
		.trim();
}

export function isCodexToolFailure(
	output: string,
	endEvent: Readonly<Record<string, unknown>> | undefined,
): boolean {
	const exitCode = readNumber(endEvent?.exit_code);
	if (exitCode !== undefined) {
		return exitCode !== 0;
	}
	const success = readBoolean(endEvent?.success);
	if (success !== undefined) {
		return !success;
	}
	const result = readRecord(endEvent?.result);
	if (result && ("Err" in result || "err" in result)) {
		return true;
	}
	const ok = readRecord(result?.Ok) ?? readRecord(result?.ok);
	if (readBoolean(ok?.isError) === true) {
		return true;
	}
	const transportExitCode = readTransportExitCode(output);
	if (transportExitCode !== undefined) {
		return transportExitCode !== 0;
	}
	return /(?:Error(?:\s+\[[A-Z0-9_]+\])?|Exception):|apply_patch verification failed:|command not found/iu.test(
		output,
	);
}

export function isRasterImagePath(path: string): boolean {
	const cleanPath = path.split(/[?#]/u)[0] ?? path;
	const extension = cleanPath.split(".").at(-1)?.toLowerCase();
	return extension ? RASTER_IMAGE_EXTENSIONS.has(extension) : false;
}

function translateCustomExec(
	rawToolName: string,
	input: Readonly<Record<string, unknown>>,
	endEvent: Readonly<Record<string, unknown>> | undefined,
): CodexToolTranslation {
	const source = readString(input.input) ?? "";
	const invocation = extractCustomExecInvocation(source);
	if (!invocation) {
		return {
			activity: "executing",
			command: undefined,
			exitCode: readNumber(endEvent?.exit_code),
			files: [],
			mapped: true,
			planExplanation: undefined,
			planSteps: [],
			primaryLabel: undefined,
			resolvedToolName: rawToolName,
			script: source,
			success: readBoolean(endEvent?.success),
			verb: "Ran script",
		};
	}

	const translation = translateResolvedTool({
		command: readString(invocation.input.cmd),
		computerUseTarget: undefined,
		endEvent,
		input: invocation.input,
		rawToolName: invocation.name,
	});
	return translation.mapped
		? translation
		: {
				activity: "executing",
				command: undefined,
				exitCode: readNumber(endEvent?.exit_code),
				files: [],
				mapped: true,
				planExplanation: undefined,
				planSteps: [],
				primaryLabel: undefined,
				resolvedToolName: rawToolName,
				script: source,
				success: readBoolean(endEvent?.success),
				verb: "Ran script",
			};
}

function translateResolvedTool({
	command,
	computerUseTarget,
	endEvent,
	input,
	rawToolName,
}: ToolTranslationInput): CodexToolTranslation {
	const normalizedName = normalizeToolName(rawToolName);
	if (computerUseTarget !== undefined) {
		return baseTranslation({
			activity: "interacting",
			endEvent,
			files: [],
			primaryLabel: computerUseTarget,
			resolvedToolName: rawToolName,
			verb: "Interacted with",
		});
	}
	if (normalizedName === "exec_command") {
		return translateExecCommand(command, input, endEvent);
	}
	if (normalizedName === "apply_patch") {
		return translateApplyPatch(input, endEvent);
	}
	if (normalizedName === "view_image") {
		const path = readString(input.path);
		return baseTranslation({
			activity: "viewing",
			endEvent,
			files: path
				? [{ diff: undefined, movePath: undefined, operation: "update", path }]
				: [],
			primaryLabel: path ? basename(path) : undefined,
			resolvedToolName: rawToolName,
			verb: "Viewed",
		});
	}
	if (normalizedName === "write_stdin") {
		const chars = readString(input.chars) ?? "";
		return baseTranslation({
			activity: "executing",
			endEvent,
			files: [],
			primaryLabel: readString(input.session_id),
			resolvedToolName: rawToolName,
			verb: chars === "" ? "Checked process" : "Sent input",
		});
	}
	if (normalizedName === "wait") {
		return baseTranslation({
			activity: "executing",
			endEvent,
			files: [],
			primaryLabel: readString(input.cell_id),
			resolvedToolName: rawToolName,
			verb: "Waited on process",
		});
	}
	if (normalizedName === "update_plan") {
		return translatePlan(input, rawToolName, endEvent);
	}
	if (normalizedName === "web_search_call" || rawToolName === "web__run") {
		return baseTranslation({
			activity: "web-research",
			endEvent,
			files: [],
			primaryLabel: readWebAction(input).target,
			resolvedToolName: rawToolName,
			verb: readWebAction(input).verb,
		});
	}
	if (DELEGATION_TOOL_NAMES.has(normalizedName)) {
		return baseTranslation({
			activity: "delegating",
			endEvent,
			files: [],
			primaryLabel: readFirstString(input, [
				"task_name",
				"target",
				"agent_id",
				"id",
				"description",
				"message",
			]),
			resolvedToolName: rawToolName,
			verb: agentActionVerb(normalizedName),
		});
	}
	if (rawToolName.startsWith("mcp__") || rawToolName.startsWith("_")) {
		return baseTranslation({
			activity: "external",
			endEvent,
			files: [],
			primaryLabel: rawToolName,
			resolvedToolName: rawToolName,
			verb: "Used external tool",
		});
	}
	if (endEvent?.type === "mcp_tool_call_end") {
		return baseTranslation({
			activity: "external",
			endEvent,
			files: [],
			primaryLabel: rawToolName,
			resolvedToolName: rawToolName,
			verb: "Used external tool",
		});
	}
	return {
		activity: "unmapped",
		command: undefined,
		exitCode: readNumber(endEvent?.exit_code),
		files: [],
		mapped: false,
		planExplanation: undefined,
		planSteps: [],
		primaryLabel: undefined,
		resolvedToolName: rawToolName,
		script: undefined,
		success: readBoolean(endEvent?.success),
		verb: "Used",
	};
}

function translateExecCommand(
	command: string | undefined,
	input: Readonly<Record<string, unknown>>,
	endEvent: Readonly<Record<string, unknown>> | undefined,
): CodexToolTranslation {
	const resolvedCommand = command ?? readEndEventCommand(endEvent) ?? "";
	const heredocPatch = extractApplyPatchHeredoc(resolvedCommand);
	if (heredocPatch) {
		return translateApplyPatch({ ...input, input: heredocPatch }, endEvent);
	}

	const parsedCommand = translateParsedCommand(endEvent, resolvedCommand);
	const parts = classifyShellCommandActivities(resolvedCommand);
	const allReads =
		parts.length > 0 && parts.every((part) => part.activity === "reading");
	const allSearches =
		parts.length > 0 && parts.every((part) => part.activity === "searching");
	const files = parts.flatMap((part) => part.files);
	const shell =
		parsedCommand && parsedCommand.activity !== "executing"
			? parsedCommand
			: allReads
				? {
						activity: "reading" as const,
						files,
						primaryLabel:
							files.length === 1
								? (parts[0]?.primaryLabel ?? "")
								: `${files.length} files`,
					}
				: allSearches
					? {
							activity: "searching" as const,
							files: [],
							primaryLabel: resolvedCommand,
						}
					: (parsedCommand ?? classifySimpleShellCommand(resolvedCommand));
	return {
		activity: shell.activity,
		command: resolvedCommand || undefined,
		exitCode: readNumber(endEvent?.exit_code),
		files: shell.files,
		mapped: true,
		planExplanation: undefined,
		planSteps: [],
		primaryLabel: shell.primaryLabel,
		resolvedToolName: "exec_command",
		script: undefined,
		success:
			readBoolean(endEvent?.success) ??
			(readNumber(endEvent?.exit_code) === undefined
				? undefined
				: endEvent?.exit_code === 0),
		verb:
			shell.activity === "reading"
				? "Read"
				: shell.activity === "searching"
					? "Searched"
					: "Ran",
	};
}

function translateApplyPatch(
	input: Readonly<Record<string, unknown>>,
	endEvent: Readonly<Record<string, unknown>> | undefined,
): CodexToolTranslation {
	const endFiles = readPatchEndFiles(endEvent);
	const patch = readFirstString(input, ["input", "patch", "arguments"]);
	const files =
		endFiles.length > 0 ? endFiles : patch ? parseCodexPatch(patch) : [];
	const onlyAdds =
		files.length > 0 && files.every((file) => file.operation === "add");
	return {
		activity: onlyAdds ? "writing" : "editing",
		command: undefined,
		exitCode: undefined,
		files,
		mapped: true,
		planExplanation: undefined,
		planSteps: [],
		primaryLabel:
			files.length === 1
				? basename(files[0]?.movePath ?? files[0]?.path ?? "")
				: files.length > 1
					? `${files.length.toLocaleString()} files`
					: undefined,
		resolvedToolName: "apply_patch",
		script: undefined,
		success: readBoolean(endEvent?.success),
		verb: onlyAdds ? "Wrote" : "Edited",
	};
}

function translatePlan(
	input: Readonly<Record<string, unknown>>,
	rawToolName: string,
	endEvent: Readonly<Record<string, unknown>> | undefined,
): CodexToolTranslation {
	const plan = Array.isArray(input.plan) ? input.plan : [];
	const planSteps = plan.flatMap((item) => {
		const record = readRecord(item);
		const step = readString(record?.step);
		const status = readString(record?.status);
		return step && status ? [{ status, step }] : [];
	});
	return {
		...baseTranslation({
			activity: "planning",
			endEvent,
			files: [],
			primaryLabel:
				planSteps.length > 0
					? `${planSteps.length.toLocaleString()} steps`
					: undefined,
			resolvedToolName: rawToolName,
			verb: "Updated plan",
		}),
		planExplanation: readString(input.explanation),
		planSteps,
	};
}

function baseTranslation({
	activity,
	endEvent,
	files,
	primaryLabel,
	resolvedToolName,
	verb,
}: {
	activity: CodexActivity;
	endEvent: Readonly<Record<string, unknown>> | undefined;
	files: readonly CodexPatchFile[];
	primaryLabel: string | undefined;
	resolvedToolName: string;
	verb: string;
}): CodexToolTranslation {
	return {
		activity,
		command: undefined,
		exitCode: readNumber(endEvent?.exit_code),
		files,
		mapped: true,
		planExplanation: undefined,
		planSteps: [],
		primaryLabel,
		resolvedToolName,
		script: undefined,
		success: readBoolean(endEvent?.success),
		verb,
	};
}

function translateParsedCommand(
	endEvent: Readonly<Record<string, unknown>> | undefined,
	command: string,
): ParsedShellCommand | undefined {
	const parsedCommands = Array.isArray(endEvent?.parsed_cmd)
		? endEvent.parsed_cmd
		: [];
	if (parsedCommands.length === 0) {
		return undefined;
	}

	const records = parsedCommands.flatMap((item) => {
		const record = readRecord(item);
		return record ? [record] : [];
	});
	if (records.length !== parsedCommands.length) {
		return executingShellCommand(command);
	}
	const types = new Set(records.map((record) => readString(record.type)));
	if (types.size === 1 && types.has("read")) {
		const paths = records.flatMap((record) => {
			const path = readString(record.path);
			return path ? [path] : [];
		});
		return {
			activity: "reading",
			command,
			files: paths.map((path) => ({
				diff: undefined,
				movePath: undefined,
				operation: "update",
				path,
			})),
			primaryLabel:
				paths.length === 1
					? basename(paths[0] ?? "")
					: paths.length > 1
						? `${paths.length.toLocaleString()} files`
						: command,
		};
	}
	if (types.size === 1 && (types.has("search") || types.has("list_files"))) {
		return {
			activity: "searching",
			command,
			files: [],
			primaryLabel: command,
		};
	}
	return executingShellCommand(command);
}

function classifySedCommand(
	command: string,
	tokens: readonly string[],
): ParsedShellCommand {
	if (tokens.length !== 4 || tokens[1] !== "-n") {
		return executingShellCommand(command);
	}
	const range = /^(\d+),(\d+)p$/u.exec(tokens[2] ?? "");
	const path = tokens[3];
	if (!range || !path || path.startsWith("-")) {
		return executingShellCommand(command);
	}
	return {
		activity: "reading",
		command,
		files: [
			{ diff: undefined, movePath: undefined, operation: "update", path },
		],
		primaryLabel: `${basename(path)} (${range[1]}–${range[2]})`,
	};
}

function classifyReadCommand(
	command: string,
	executable: string,
	tokens: readonly string[],
): ParsedShellCommand {
	const operands = readCommandOperands(executable, tokens.slice(1));
	if (!operands || operands.length === 0) {
		return executingShellCommand(command);
	}
	const path = operands[0];
	if (!path || path === "-" || path.startsWith("-")) {
		return executingShellCommand(command);
	}
	return {
		activity: "reading",
		command,
		files: operands.map((path) => ({
			diff: undefined,
			movePath: undefined,
			operation: "update",
			path,
		})),
		primaryLabel:
			operands.length === 1 ? basename(path) : `${operands.length} files`,
	};
}

function classifySearchCommand(
	command: string,
	executable: string,
	tokens: readonly string[],
): ParsedShellCommand {
	const operands = readSearchOperands(executable, tokens.slice(1));
	const maximumOperands = executable === "ls" ? 1 : 2;
	const isFilesOnlySearch = executable === "rg" && tokens.includes("--files");
	if (
		!operands ||
		(operands.length === 0 && !isFilesOnlySearch) ||
		operands.length > maximumOperands
	) {
		return executingShellCommand(command);
	}
	return {
		activity: "searching",
		command,
		files: [],
		primaryLabel: command,
	};
}

function readSearchOperands(
	executable: string,
	args: readonly string[],
): readonly string[] | undefined {
	const operands: string[] = [];
	for (let index = 0; index < args.length; index++) {
		const argument = args[index] ?? "";
		if (argument === "--") {
			operands.push(...args.slice(index + 1));
			break;
		}
		if (!argument.startsWith("-") || argument === "-") {
			operands.push(argument);
			continue;
		}
		if (
			executable === "rg" &&
			(argument === "--pre" || argument.startsWith("--pre="))
		) {
			return undefined;
		}
		const consumesValue = SEARCH_OPTIONS_WITH_VALUES.has(argument);
		if (consumesValue) {
			if (args[index + 1] === undefined) {
				return undefined;
			}
			index += 1;
			continue;
		}
		if (!SAFE_SEARCH_OPTIONS.has(argument) && !/^-[A-Za-z]+$/u.test(argument)) {
			return undefined;
		}
	}
	return operands;
}

function readCommandOperands(
	executable: string,
	args: readonly string[],
): readonly string[] | undefined {
	const operands: string[] = [];
	for (let index = 0; index < args.length; index++) {
		const arg = args[index] ?? "";
		if (arg === "--") {
			operands.push(...args.slice(index + 1));
			break;
		}
		if (!arg.startsWith("-") || arg === "-") {
			operands.push(arg);
			continue;
		}
		const consumesValue =
			(executable === "head" || executable === "tail") &&
			(arg === "-n" || arg === "-c");
		if (consumesValue) {
			if (args[index + 1] === undefined) {
				return undefined;
			}
			index += 1;
		}
	}
	return operands;
}

function executingShellCommand(command: string): ParsedShellCommand {
	return {
		activity: "executing",
		command,
		files: [],
		primaryLabel: command,
	};
}

function tokenizeSimpleShellCommand(
	command: string,
): readonly string[] | undefined {
	const tokens: string[] = [];
	let current = "";
	let quote: "double" | "single" | undefined;
	let escaped = false;

	for (let index = 0; index < command.length; index++) {
		const character = command[index] ?? "";
		if (escaped) {
			if (character !== "\n") current += character;
			escaped = false;
			continue;
		}
		if (quote === "single") {
			if (character === "'") {
				quote = undefined;
			} else {
				current += character;
			}
			continue;
		}
		if (quote === "double") {
			if (character === '"') {
				quote = undefined;
			} else if (character === "\\") {
				escaped = true;
			} else if (/[`$]/u.test(character)) {
				return undefined;
			} else {
				current += character;
			}
			continue;
		}
		if (character === "'") {
			quote = "single";
			continue;
		}
		if (character === '"') {
			quote = "double";
			continue;
		}
		if (character === "\\") {
			escaped = true;
			continue;
		}
		if (/\s/u.test(character)) {
			if (character === "\n" || character === "\r") {
				return undefined;
			}
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		if (
			character === "|" ||
			character === "&" ||
			character === ";" ||
			character === ">" ||
			character === "<" ||
			character === "`" ||
			character === "$" ||
			/[(){}*?[\]~]/u.test(character)
		) {
			return undefined;
		}
		current += character;
	}
	if (quote || escaped) {
		return undefined;
	}
	if (current) {
		tokens.push(current);
	}
	return tokens;
}

function readPatchEndFiles(
	endEvent: Readonly<Record<string, unknown>> | undefined,
): readonly CodexPatchFile[] {
	const changes = readRecord(endEvent?.changes);
	if (!changes) {
		return [];
	}
	return Object.entries(changes).flatMap(([path, value]) => {
		const change = readRecord(value);
		const operation = readString(change?.type);
		if (
			operation !== "add" &&
			operation !== "delete" &&
			operation !== "update"
		) {
			return [];
		}
		return [
			{
				diff: readString(change?.unified_diff),
				movePath: readString(change?.move_path),
				operation,
				path,
			},
		];
	});
}

function extractApplyPatchHeredoc(command: string): string | undefined {
	if (!/\bapply_patch\s*<</u.test(command)) {
		return undefined;
	}
	const patchStart = command.indexOf("*** Begin Patch");
	const patchEnd = command.indexOf("*** End Patch", patchStart);
	if (patchStart === -1 || patchEnd === -1) {
		return undefined;
	}
	return command.slice(patchStart, patchEnd + "*** End Patch".length);
}

function readEndEventCommand(
	endEvent: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
	const command = endEvent?.command;
	if (!Array.isArray(command)) {
		return undefined;
	}
	for (let index = command.length - 1; index >= 0; index--) {
		const part = readString(command[index]);
		if (part) {
			return part;
		}
	}
	return undefined;
}

export function readWebActions(
	input: Readonly<Record<string, unknown>>,
): { verb: string; target: string | undefined }[] {
	const verbs: Record<string, string> = {
		search_query: "Searched",
		image_query: "Searched images",
		open: "Opened",
		open_page: "Opened",
		click: "Followed link",
		find: "Found in page",
		find_in_page: "Found in page",
		screenshot: "Captured page",
		search: "Searched",
	};
	const actions = Object.entries(verbs).flatMap(([key, verb]) => {
		const values = input[key];
		return Array.isArray(values)
			? values.map((value) => {
					const record = readRecord(value);
					const target = record
						? readFirstString(record, ["q", "pattern", "ref_id", "rid", "url"])
						: undefined;
					return { verb, target };
				})
			: [];
	});
	const action = readRecord(input.action);
	if (actions.length === 0 && action) {
		const type = readString(action.type) ?? "search";
		actions.push({
			verb: verbs[type] ?? "Researched",
			target: readFirstString(action, [
				"query",
				"pattern",
				"url",
				"ref_id",
				"rid",
			]),
		});
	}
	return actions.length > 0
		? actions
		: [{ verb: "Searched", target: readWebQuery(input) }];
}

function readWebAction(input: Readonly<Record<string, unknown>>) {
	const actions = readWebActions(input);
	return actions.length === 1 && actions[0]
		? actions[0]
		: { verb: "Researched", target: `${actions.length} web actions` };
}

export function agentActionVerb(name: string): string {
	const verbs: Record<string, string> = {
		spawn_agent: "Delegated",
		followup_task: "Assigned follow-up",
		send_message: "Messaged agent",
		interrupt_agent: "Interrupted agent",
		close_agent: "Closed agent",
		resume_agent: "Resumed agent",
		list_agents: "Listed agents",
		wait_agent: "Waited for agent",
	};
	return verbs[name] ?? "Delegated";
}

function readWebQuery(
	input: Readonly<Record<string, unknown>>,
): string | undefined {
	const action = readRecord(input.action);
	return (
		readString(action?.query) ??
		readString(action?.url) ??
		readString(input.query) ??
		readString(input.url) ??
		readNestedQuery(input.search_query) ??
		readNestedQuery(input.image_query)
	);
}

function readNestedQuery(value: unknown): string | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	for (const item of value) {
		const record = readRecord(item);
		const query = readString(record?.q);
		if (query) {
			return query;
		}
	}
	return undefined;
}

function readTransportExitCode(output: string): number | undefined {
	const match = /Process exited with code\s+(-?\d+)/iu.exec(output);
	return match?.[1] === undefined ? undefined : Number(match[1]);
}

function readFirstString(
	record: Readonly<Record<string, unknown>>,
	keys: readonly string[],
): string | undefined {
	for (const key of keys) {
		const value = readString(record[key]);
		if (value) {
			return value;
		}
	}
	return undefined;
}

function readRecord(
	value: unknown,
): Readonly<Record<string, unknown>> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	return Object.fromEntries(Object.entries(value));
}

function readString(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim() !== "") {
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	return undefined;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function readBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function normalizeToolName(toolName: string): string {
	return toolName.split(".").at(-1)?.toLowerCase() ?? toolName.toLowerCase();
}

function basename(path: string): string {
	return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}
