import {
	classifyCommandParts,
	extractShellFileReads,
	type ShellContext,
} from "./command-class.js";
import type { LineFacts } from "./line-items.js";
import { type ExtraFacts, setList } from "./record-facts.js";

export function callReadFacts(input: {
	readonly commands?: readonly string[];
	readonly context: ShellContext;
	readonly reads?: readonly string[];
}): LineFacts | undefined {
	const commands = input.commands ?? [];
	const reads = distinct([
		...(input.reads ?? []).map((path) => resolveToolPath(path, input.context)),
		...commands.flatMap((command) =>
			extractShellFileReads(command, input.context),
		),
	]);
	const classes = distinct(commands.flatMap(classifyCommandParts));
	const extra: ExtraFacts = {};
	if (reads.length > 0) setList(extra, "files_read", "files_read_more", reads);
	if (classes.length > 0) extra.command_classes = JSON.stringify(classes);
	return Object.keys(extra).length === 0 ? undefined : { extra };
}

export function resolveToolPath(path: string, context: ShellContext): string {
	if (path === "") return path;
	if ((path === "~" || path.startsWith("~/")) && context.home !== undefined)
		return normalize(`${context.home}${path.slice(1)}`);
	if (path.startsWith("/") || path.startsWith("~")) return path;
	if (/^[A-Za-z]:[\\/]/u.test(path) || context.cwd?.startsWith("/") !== true)
		return path;
	return normalize(`${context.cwd}/${path}`);
}

function normalize(path: string): string {
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `/${parts.join("/")}`;
}

function distinct<T>(values: readonly T[]): T[] {
	return [...new Set(values)];
}
