import type { CommandKind } from "../command-identity.js";
import type { FileEdit } from "./python-edits.js";

export type Segment =
	| { text: string }
	| { file: string }
	| { term: string }
	| { code: string };

export type ExplainedStep = {
	connector: "and" | "or" | "then" | "pipe" | null;
	quiet: boolean;
	kind: CommandKind;
	title: string;
	sentence: Segment[];
	program: string;
	words: { text: string; meaning: string }[];
	raw: string;
	edits?: FileEdit[];
	stages?: { raw: string; sentence: Segment[] }[];
};

export const text = (value: string): Segment => ({ text: value });
export const file = (value: string): Segment =>
	/[$`]/u.test(value) ? { code: value } : { file: value };
export const code = (value: string): Segment => ({ code: value });

export function list(items: Segment[], last: "and" | "or" = "and"): Segment[] {
	return items.flatMap((item, index) => [
		...(index === 0
			? []
			: [text(index === items.length - 1 ? ` ${last} ` : ", ")]),
		item,
	]);
}

export const files = (paths: string[]) => list(paths.map(file));

export const plural = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;

export const lines = (which: "first" | "last", count: number) =>
	count === 1 ? `the ${which} line` : `the ${which} ${count} lines`;
