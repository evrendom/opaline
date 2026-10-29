import { duration } from "./rules/context.js";
import type { ExplainedStep, Segment } from "./sentence.js";

const WRAPPERS = new Set([
	"sudo",
	"nohup",
	"time",
	"command",
	"exec",
	"env",
	"npx",
	"bunx",
]);
export const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/su;
export const VARIABLE = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/gu;

export const basename = (program: string) => program.replace(/^.*\//u, "");

export function unwrap(words: string[]): {
	words: string[];
	notes: Segment[][];
} {
	const notes: Segment[][] = [];
	let rest = words;
	for (;;) {
		const set: string[] = [];
		while (rest.length > 1 && rest[0] && ASSIGNMENT.test(rest[0])) {
			set.push(ASSIGNMENT.exec(rest[0])?.[1] ?? "");
			rest = rest.slice(1);
		}
		if (set.length > 0)
			notes.push([
				{ text: "with " },
				...set.flatMap((name, i): Segment[] => [
					...(i > 0 ? [{ text: ", " }] : []),
					{ code: name },
				]),
				{ text: " set" },
			]);
		const head = rest[0] ? basename(rest[0]) : "";
		if (head === "timeout") {
			const index = rest.findIndex(
				(word, i) => i > 0 && /^[\d.]+[smhd]?$/u.test(word),
			);
			if (index < 0) break;
			notes.push([{ text: `stopped after ${duration(rest[index] ?? "")}` }]);
			rest = rest.slice(index + 1);
			continue;
		}
		if (
			WRAPPERS.has(head) &&
			rest
				.slice(1)
				.some((word) => !word.startsWith("-") && !ASSIGNMENT.test(word))
		) {
			if (head === "sudo") notes.push([{ text: "as administrator" }]);
			rest = rest.slice(1);
			while (
				rest[0]?.startsWith("-") ||
				(head === "env" && rest[0] && ASSIGNMENT.test(rest[0]))
			)
				rest = rest.slice(1);
			continue;
		}
		break;
	}
	return { notes, words: rest };
}

export const CONNECTORS = { "&&": "and", "||": "or", ";": "then" } as const;

export const BODY_KEYWORDS = new Set(["do", "then", "else", "{", "!"]);
export const CLOSING_KEYWORDS = new Set(["done", "fi", "esac", "}", "elif"]);

export function structureStep(
	words: string[],
	raw: string,
): Omit<ExplainedStep, "connector"> | null {
	const [head = "", ...rest] = words;
	const quiet = (title: string, ...sentence: Segment[]) => ({
		kind: "shell" as const,
		program: head,
		quiet: true,
		raw,
		sentence,
		title,
		words: [],
	});
	if (head === "for" || head === "select") {
		const at = rest.indexOf("in");
		const items = at >= 0 ? rest.slice(at + 1) : [];
		if (items.length === 1 && items[0] === "$")
			return quiet(
				"Repeat",
				{ text: "For each " },
				{ code: rest[0] ?? "" },
				{ text: " in what the next step prints:" },
			);
		return quiet(
			"Repeat",
			{ text: "For each " },
			{ code: rest[0] ?? "" },
			...(items.length > 0
				? [
						{ text: " in " },
						...items
							.slice(0, 6)
							.flatMap((item, i): Segment[] => [
								...(i > 0 ? [{ text: ", " }] : []),
								{ code: item },
							]),
						...(items.length > 6
							? [{ text: ` and ${items.length - 6} more` }]
							: []),
					]
				: []),
			{ text: ":" },
		);
	}
	if (head === "case")
		return quiet(
			"Depending on",
			{ text: "Depending on " },
			{ code: rest[0] === "$" ? "what the next step prints" : (rest[0] ?? "") },
			{ text: ":" },
		);
	if (head === "[" || head === "[[" || head === "test")
		return quiet("Check", { text: "Check that " }, { code: words.join(" ") });
	if (head === "set" && rest[0] === "--")
		return quiet(
			"Set the arguments",
			{ text: "Set " },
			{ code: "$1" },
			{ text: ", " },
			{ code: "$2" },
			{ text: "… to the words of " },
			{ code: rest.slice(1).join(" ") },
		);
	if (head === "set" || head === "shopt" || head === "umask")
		return quiet(
			"Shell options",
			{ text: "Set shell options " },
			{ code: rest.join(" ") },
		);
	if (head === "source" || head === ".")
		return quiet(
			"Load settings",
			{ text: "Load settings from " },
			/[$`]/u.test(rest[0] ?? "")
				? { code: rest[0] ?? "" }
				: { file: rest[0] ?? "" },
		);
	if (head === "export")
		return quiet(
			"Set a name",
			{ text: "Set " },
			...rest.flatMap((word, index): Segment[] => {
				const [, name = word, value] = /^([^=]+)=(.*)$/su.exec(word) ?? [];
				return [
					...(index > 0 ? [{ text: ", " }] : []),
					{ code: name },
					...(value !== undefined ? [{ text: " to " }, { code: value }] : []),
				];
			}),
		);
	if (head === "unset")
		return quiet("Clear a name", { text: "Clear " }, { code: rest.join(", ") });
	if (head === "break")
		return quiet("Stop the loop", { text: "Stop the loop" });
	if (head === "continue")
		return quiet("Next round", { text: "Go on to the loop's next round" });
	if (head === "exit" || head === "return") {
		const code = rest[0] ?? "0";
		const what = head === "exit" ? "Stop here" : "Leave the helper";
		return quiet(
			what,
			{ text: what },
			...(code !== "0" ? [{ text: ", failing with code " }, { code }] : []),
		);
	}
	return null;
}
