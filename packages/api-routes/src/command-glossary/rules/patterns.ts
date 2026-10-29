import { code, list, type Segment } from "../sentence.js";
import { has, type RuleContext } from "./context.js";

export function termItems(
	pattern: string,
	syntax: "basic" | "extended" | "fixed" = "basic",
): Segment[] {
	if (syntax === "fixed") return [{ term: pattern }];
	const parts = splitTopLevel(pattern, syntax).filter(Boolean);
	return parts.map((part) => {
		let term = part;
		const atStart = term.startsWith("^");
		if (atStart) term = term.slice(1);
		if (term.endsWith("$") && !term.endsWith("\\$")) term = term.slice(0, -1);
		const special =
			syntax === "basic"
				? /[*[\]"']|\\[(){}+?]/u.test(part.replace(/\\b/gu, ""))
				: /[*+?[\]{}()"'|]/u.test(
						term.replace(/\\b/gu, "").replace(/\\(.)/gu, "$1"),
					);
		term = term.replace(/\\b/gu, "").replace(/\\(.)/gu, "$1");
		if (special) return code(part);
		return { term: atStart ? `${term} (at line start)` : term };
	});
}

export const terms = (
	pattern: string,
	syntax: "basic" | "extended" | "fixed" = "basic",
) => list(termItems(pattern, syntax), "or");

function splitTopLevel(
	pattern: string,
	syntax: "basic" | "extended",
): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i] ?? "";
		const next = pattern[i + 1] ?? "";
		if (char === "\\") {
			if (syntax === "basic" && next === "|" && depth === 0) {
				parts.push(current);
				current = "";
				i++;
				continue;
			}
			if (syntax === "basic" && (next === "(" || next === ")"))
				depth += next === "(" ? 1 : -1;
			current += char + next;
			i++;
			continue;
		}
		if (syntax === "extended") {
			if (char === "(") depth++;
			if (char === ")") depth = Math.max(0, depth - 1);
			if (char === "|" && depth === 0) {
				parts.push(current);
				current = "";
				continue;
			}
		}
		current += char;
	}
	parts.push(current);
	return parts;
}

export const isBlankPattern = (pattern: string) =>
	/^\^(?:\\s\*|\[\[:space:\]\]\*)?\$$/u.test(pattern);

export function alternation(
	context: RuleContext,
): "basic" | "extended" | "fixed" {
	if (has(context, "-F", "--fixed-strings")) return "fixed";
	if (
		context.program === "rg" ||
		context.program === "egrep" ||
		has(context, "-E", "--extended-regexp", "-P", "--perl-regexp")
	)
		return "extended";
	return "basic";
}
