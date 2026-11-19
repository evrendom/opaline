import type { SessionRunReadRange } from "@rudel/api-routes";
import { absolutePath } from "@rudel/api-routes/call-paths";

function words(text: string): string[] {
	return [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/gu)].map(
		(match) => match[1] ?? match[2] ?? match[3] ?? "",
	);
}

function fileWords(args: readonly string[], takesValue: ReadonlySet<string>) {
	const out: string[] = [];
	for (let index = 0; index < args.length; index++) {
		const arg = args[index] ?? "";
		if (takesValue.has(arg)) {
			index++;
			continue;
		}
		if (arg.startsWith("-") || /^\d*[<>]/u.test(arg)) continue;
		out.push(arg);
	}
	return out;
}

function sedLines(script: string): { from: number; to: number | null } | null {
	const match = /^(\d+)(?:,(\d+|\$))?p$/u.exec(script.trim());
	if (!match) return null;
	const from = Number(match[1]);
	const to =
		match[2] === undefined ? from : match[2] === "$" ? null : Number(match[2]);
	return from > 0 ? { from, to } : null;
}

function headCount(args: readonly string[]): number {
	for (let index = 0; index < args.length; index++) {
		const arg = args[index] ?? "";
		const attached = /^-n?(\d+)$/u.exec(arg);
		if (attached) return Number(attached[1]);
		if (arg === "-n") {
			const count = Number(args[index + 1]);
			return Number.isNaN(count) ? 10 : count;
		}
	}
	return 10;
}

function stageLines(
	program: string,
	args: readonly string[],
): { files: string[]; from: number; to: number | null } | null {
	if (program === "sed") {
		if (!args.includes("-n")) return null;
		const rest = args.filter((arg) => arg !== "-n");
		const script = rest.find((arg) => sedLines(arg));
		const lines = script ? sedLines(script) : null;
		if (!script || !lines) return null;
		return {
			files: fileWords(
				rest.filter((arg) => arg !== script),
				new Set(["-e"]),
			),
			...lines,
		};
	}
	if (program === "head")
		return {
			files: fileWords(args, new Set(["-n", "-c"])),
			from: 1,
			to: headCount(args),
		};
	if (program === "tail") {
		const index = args.indexOf("-n");
		const from = /^\+(\d+)$/u.exec(args[index + 1] ?? "")?.[1];
		if (index === -1 || !from) return null;
		return {
			files: fileWords(args, new Set(["-n", "-c"])),
			from: Number(from),
			to: null,
		};
	}
	if (program === "cat" || program === "nl" || program === "bat")
		return {
			files: fileWords(args, new Set(["-b", "-w", "-s", "-v", "-i"])),
			from: 1,
			to: null,
		};
	return null;
}

export function shellReadRanges(
	command: string,
	directory: string,
	paths: readonly string[],
): SessionRunReadRange[] {
	const wanted = new Set(paths);
	const out: SessionRunReadRange[] = [];
	for (const segment of command.split(/&&|\|\||;|\n/u)) {
		const stages = segment.split(/(?<!\|)\|(?!\|)/u).map(words);
		const [first, ...rest] = stages;
		const head = first?.[0];
		if (!first || !head) continue;
		const read = stageLines(head, first.slice(1));
		if (!read) continue;
		let { from, to } = read;
		for (const stage of rest) {
			const narrowed = stage[0] ? stageLines(stage[0], stage.slice(1)) : null;
			if (!narrowed || narrowed.files.length > 0) continue;
			const start = from + narrowed.from - 1;
			const end = narrowed.to === null ? to : from + narrowed.to - 1;
			from = start;
			to = to === null ? end : end === null ? to : Math.min(to, end);
		}
		for (const word of read.files) {
			const path = absolutePath(word, directory);
			const range = { from, path, to };
			if (wanted.has(path) && isLineRange(range)) out.push(range);
		}
	}
	return out;
}

export function isLineRange(range: {
	from: number;
	to: number | null;
}): boolean {
	return (
		Number.isSafeInteger(range.from) &&
		range.from >= 1 &&
		(range.to === null ||
			(Number.isSafeInteger(range.to) && range.to >= range.from))
	);
}
