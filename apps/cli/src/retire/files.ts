import { randomUUID } from "node:crypto";
import {
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export const UNPARSEABLE = Symbol("unparseable");

export type FileUpdate =
	| "changed"
	| "unchanged"
	| "missing"
	| "unparseable"
	| "busy"
	| "failed";

/**
 * Rewrites a file the user and their agents also write. The new content goes
 * to a temporary file beside the real target (symlinks are followed, not
 * replaced) with the same mode, and replaces it only if the file still holds
 * what was read. A file that keeps changing is left for the next run.
 */
export function updateFile(
	path: string,
	transform: (text: string) => string | undefined | typeof UNPARSEABLE,
): FileUpdate {
	let target: string;
	try {
		target = realpathSync(path);
	} catch {
		return "missing";
	}
	try {
		for (let attempt = 0; attempt < 3; attempt++) {
			const text = readFileSync(target, "utf8");
			const next = transform(text);
			if (next === UNPARSEABLE) return "unparseable";
			if (next === undefined || next === text) return "unchanged";
			const temporary = join(
				dirname(target),
				`.${basename(target)}.opaline-${process.pid}-${randomUUID()}.tmp`,
			);
			try {
				writeFileSync(temporary, next, {
					mode: statSync(target).mode & 0o777,
					flag: "wx",
				});
				if (readFileSync(target, "utf8") !== text) continue;
				renameSync(temporary, target);
				return "changed";
			} finally {
				rmSync(temporary, { force: true });
			}
		}
		return "busy";
	} catch {
		return "failed";
	}
}

/** Serialises JSON with the file's own indentation and final newline. */
export function formatJsonLike(original: string, value: unknown): string {
	const indent = /^[{[][ \t]*\r?\n([ \t]+)\S/u.exec(original)?.[1] ?? 2;
	const newline = original.includes("\r\n") ? "\r\n" : "\n";
	const body = JSON.stringify(value, null, indent).replaceAll("\n", newline);
	return /\r?\n$/u.test(original) ? `${body}${newline}` : body;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
