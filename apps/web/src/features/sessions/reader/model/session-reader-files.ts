import {
	getRawToolInput,
	getTranscriptToolFileActivities,
} from "@rudel/api-routes";
import {
	extractScriptFileAccess,
	extractShellFileMutations,
	extractShellFileReads,
	parseShellCommand,
} from "@rudel/api-routes/command-identity";
import { getShellCommand } from "@/components/conversation/conversation-tools";

export type FileOperation = "edit" | "read" | "write";
export type FileOp = { path: string; operation: FileOperation };

type ToolEvent = {
	input: Readonly<Record<string, unknown>>;
	provider?: "claude" | "codex";
	toolName: string;
};

const OPERATION: Record<string, FileOperation> = {
	created: "write",
	delete: "edit",
	deleted: "edit",
	edit: "edit",
	edited: "edit",
	read: "read",
	viewed: "read",
	write: "write",
};

function appendTargets(command: string): Set<string> {
	const targets = new Set<string>();
	for (const simple of parseShellCommand(command)) {
		for (const redirect of simple.redirects)
			if (redirect.operator.endsWith(">>")) targets.add(redirect.target);
		const [program, ...args] = simple.words;
		if (
			program === "tee" &&
			args.some((arg) => arg === "-a" || arg === "--append")
		)
			for (const arg of args) if (!arg.startsWith("-")) targets.add(arg);
	}
	return targets;
}

const opsByEvent = new WeakMap<ToolEvent, FileOp[]>();

export function getFileOps(event: ToolEvent): FileOp[] {
	const held = opsByEvent.get(event);
	if (held) return held;
	const ops = readFileOps(event);
	opsByEvent.set(event, ops);
	return ops;
}

function readFileOps(event: ToolEvent): FileOp[] {
	const input = getRawToolInput(event.input);
	const ops = new Map<string, FileOp>();
	const add = (path: string, seen: string) => {
		const operation = OPERATION[seen];
		if (!path || !operation) return;
		const key = `${operation}:${path}`;
		if (!ops.has(key)) ops.set(key, { operation, path });
	};
	for (const activity of getTranscriptToolFileActivities(
		event.toolName,
		input,
		event.provider,
	))
		add(activity.path, activity.operation);
	const command = getShellCommand(event.toolName, input);
	if (command) {
		for (const path of extractShellFileReads(command)) add(path, "read");
		const appended = appendTargets(command);
		for (const mutation of extractShellFileMutations(command))
			if (mutation.basis === "direct")
				add(
					mutation.path,
					mutation.operation === "write" && appended.has(mutation.path)
						? "edit"
						: mutation.operation,
				);
		for (const edit of extractScriptFileAccess(command))
			if (edit.basis === "direct") add(edit.path, edit.operation);
	}
	return [...ops.values()];
}
