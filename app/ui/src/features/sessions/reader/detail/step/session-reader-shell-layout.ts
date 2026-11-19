const ONE_LINE_CHARS = 60;

export function layoutShellCommand(command: string): string {
	if (
		command.length <= ONE_LINE_CHARS ||
		command.includes("\n") ||
		command.includes("<<")
	)
		return command;
	let out = "";
	let quote: "'" | '"' | "`" | null = null;
	let depth = 0;
	for (let i = 0; i < command.length; i++) {
		const char = command[i] ?? "";
		const next = command[i + 1] ?? "";
		if (quote) {
			out += char;
			if (char === "\\" && quote !== "'") {
				out += next;
				i++;
			} else if (char === quote) quote = null;
			continue;
		}
		if (char === "\\") {
			out += char + next;
			i++;
			continue;
		}
		if (char === "'" || char === '"' || char === "`") {
			quote = char;
			out += char;
			continue;
		}
		if (char === "(" || char === "{") depth++;
		if ((char === ")" || char === "}") && depth > 0) depth--;
		if (depth === 0) {
			const operator =
				(char === "&" && next === "&") || (char === "|" && next === "|")
					? char + next
					: char === "|" && next !== "&"
						? "|"
						: null;
			if (operator && !/[<>]$/u.test(out)) {
				out = `${out.trimEnd()}\n${operator} `;
				i += operator.length;
				while (command[i] === " ") i++;
				i--;
				continue;
			}
			if (char === ";" && next !== ";") {
				out = `${out.trimEnd()}\n`;
				while (command[i + 1] === " ") i++;
				continue;
			}
		}
		out += char;
	}
	return out.trimEnd();
}

export function shortFolder(dir: string): string {
	const path = dir
		.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/u, "~")
		.replace(/\/+$/u, "");
	const parts = path.split("/");
	if (parts[0] === "~" && parts.length >= 3) {
		const [, , project = "", ...rest] = parts;
		if (rest.length === 0) return project;
		return `${project} · ${rest.length > 1 ? "…/" : ""}${rest.at(-1)}`;
	}
	const folders = parts.filter(Boolean);
	return folders.length > 3 ? `…/${folders.slice(-2).join("/")}` : path;
}

type ColoredToken = { color: string | undefined; content: string };

export function tokenColor(
	lines: readonly (readonly ColoredToken[])[] | undefined,
	named: string,
): string | undefined {
	const word = named.replace(/ \(at line start\)$/u, "").trim();
	if (!lines || !word) return undefined;
	if (/^#\d+$/u.test(word)) return tokenColor(lines, word.slice(1));
	const tokens = lines.flatMap((line, index) => [
		...line,
		...(index < lines.length - 1 ? [{ color: undefined, content: "\n" }] : []),
	]);
	const text = tokens.map((token) => token.content).join("");
	const at =
		word.length >= 2
			? text.indexOf(word)
			: text.search(
					new RegExp(
						`(?<![\\w-])${word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\w-])`,
						"u",
					),
				);
	if (at < 0) return undefined;
	let best: { color: string | undefined; overlap: number } | null = null;
	let offset = 0;
	for (const token of tokens) {
		const start = offset;
		offset += token.content.length;
		const overlap = Math.min(offset, at + word.length) - Math.max(start, at);
		if (overlap <= 0 || !token.color || !token.content.trim()) continue;
		if (!best || overlap > best.overlap) best = { color: token.color, overlap };
	}
	return best?.color;
}

export type Span = { start: number; end: number };

export function stageSpans(
	raw: string,
	stages: readonly string[],
): Span[] | null {
	const spans: Span[] = [];
	let from = 0;
	for (const stage of stages) {
		const at = raw.indexOf(stage, from);
		if (at < 0) return null;
		spans.push({ end: at + stage.length, start: at });
		from = at + stage.length;
	}
	const [first] = spans;
	const last = spans.at(-1);
	if (first) first.start = 0;
	if (last) last.end = raw.length;
	return spans;
}

export type Piece = {
	text: string;
	color: string | undefined;
	mark?: "open" | "close";
	spaces?: number;
};

export function quoteMarks(line: string): Map<number, "open" | "close"> {
	const marks = new Map<number, "open" | "close">();
	for (const match of line.matchAll(/(["'])((?:\\.|(?!\1)[^\\])*)\1/gu)) {
		const start = match.index ?? 0;
		marks.set(start, "open");
		marks.set(start + match[0].length - 1, "close");
	}
	return marks;
}

export function wordsOf(
	code: string,
	lines: readonly (readonly ColoredToken[])[] | undefined,
	span: Span,
): Piece[][] {
	const tokens: { color: string | undefined; start: number; text: string }[] =
		[];
	if (lines) {
		let offset = 0;
		lines.forEach((line, index) => {
			if (index > 0) {
				tokens.push({ color: undefined, start: offset, text: "\n" });
				offset++;
			}
			for (const token of line) {
				tokens.push({ color: token.color, start: offset, text: token.content });
				offset += token.content.length;
			}
		});
	} else tokens.push({ color: undefined, start: 0, text: code });
	const marks = quoteMarks(code);
	const words: Piece[][] = [];
	let word: Piece[] = [];
	const add = (text: string, color: string | undefined, at: number) => {
		const mark = marks.get(at);
		const piece: Piece = mark ? { color, mark, text } : { color, text };
		const last = word.at(-1);
		if (last && !mark && !last.mark && last.color === color) last.text += text;
		else word.push(piece);
	};
	let inQuote = false;
	let gap = 0;
	for (const token of tokens) {
		for (let i = 0; i < token.text.length; i++) {
			const at = token.start + i;
			const char = token.text[i] ?? "";
			const mark = marks.get(at);
			if (at >= span.start && at < span.end) {
				if (/\s/u.test(char)) {
					if (word.length > 0) words.push(word);
					word = [];
					if (inQuote) gap++;
				} else {
					const first = word.length === 0;
					add(char, token.color, at);
					const [opening] = word;
					if (first && opening && gap > 1) opening.spaces = gap;
					gap = 0;
				}
			}
			if (mark === "open") inQuote = true;
			else if (mark === "close") inQuote = false;
		}
	}
	if (word.length > 0) words.push(word);
	return words;
}

export type Alternatives = { quoted: Span; alternatives: Span[] };

export function orSyntax(line: string, span: Span): "basic" | "extended" {
	const words = line.slice(span.start, span.end).split(/\s+/u);
	const program = words.findIndex((word) =>
		/^(?:.*\/)?(?:grep|egrep|rg)$/u.test(word),
	);
	if (program < 0) return "basic";
	const name = words[program]?.replace(/^.*\//u, "");
	if (name === "egrep" || name === "rg") return "extended";
	return words
		.slice(program + 1)
		.some(
			(word) =>
				/^-[A-Za-z]*[EP][A-Za-z]*$/u.test(word) ||
				word === "--extended-regexp" ||
				word === "--perl-regexp",
		)
		? "extended"
		: "basic";
}

export function alternativesIn(
	line: string,
	span: Span,
	syntax: "basic" | "extended" = "basic",
): Alternatives[] {
	const found: Alternatives[] = [];
	const quoted = /(["'])((?:\\.|(?!\1)[^\\])*)\1/gu;
	quoted.lastIndex = span.start;
	for (let match = quoted.exec(line); match; match = quoted.exec(line)) {
		const start = match.index;
		const end = start + match[0].length;
		if (end > span.end) break;
		const alternatives: Span[] = [];
		let from = start + 1;
		let depth = 0;
		let inClass = false;
		for (let at = start + 1; at < end - 1; at++) {
			const char = line[at] ?? "";
			const next = line[at + 1] ?? "";
			if (inClass) {
				if (char === "]") inClass = false;
				continue;
			}
			if (char === "[") {
				inClass = true;
				continue;
			}
			if (char === "\\") {
				if (syntax === "basic" && next === "|" && depth === 0) {
					alternatives.push({ end: at, start: from });
					from = at + 2;
				} else if (syntax === "basic" && (next === "(" || next === ")"))
					depth = Math.max(0, depth + (next === "(" ? 1 : -1));
				at++;
				continue;
			}
			if (syntax === "extended") {
				if (char === "(") depth++;
				else if (char === ")") depth = Math.max(0, depth - 1);
				else if (char === "|" && depth === 0) {
					alternatives.push({ end: at, start: from });
					from = at + 1;
				}
			}
		}
		if (alternatives.length === 0) continue;
		alternatives.push({ end: end - 1, start: from });
		found.push({ alternatives, quoted: { end, start } });
	}
	return found;
}

export const leadingSpaces = (line: string, span: Span) =>
	(/^ */u.exec(line.slice(span.start, span.end))?.[0] ?? "").length;

export type Substitution = {
	quoted: Span;
	find: Span;
	replace: Span;
	flags: Span;
};

export function substitutionIn(line: string, span: Span): Substitution | null {
	const words = line.slice(span.start, span.end).split(/\s+/u);
	if (!words.some((word) => /^(?:.*\/)?g?sed$/u.test(word))) return null;
	const quoted =
		/(["'])s(.)((?:\\.|(?!\2).)*)\2((?:\\.|(?!\2).)*)\2([a-zA-Z0-9]*)\1/gu;
	quoted.lastIndex = span.start;
	const match = quoted.exec(line);
	if (!match || match.index + match[0].length > span.end) return null;
	const start = match.index;
	const find = start + 3;
	const replace = find + (match[3] ?? "").length + 1;
	const flags = replace + (match[4] ?? "").length + 1;
	return {
		find: { end: replace - 1, start: find },
		flags: { end: flags + (match[5] ?? "").length, start: flags },
		quoted: { end: start + match[0].length, start },
		replace: { end: flags - 1, start: replace },
	};
}
