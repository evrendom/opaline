export type FileEdit = { file: string; before: string; after: string };

export type PythonEdits = {
	edits: FileEdit[];
	checksFirst: boolean;
};

const LITERAL_START = /([rRbBuU]{0,2})('''|"""|'|")/uy;

function readLiteral(
	source: string,
	at: number,
): { value: string; end: number } | null {
	LITERAL_START.lastIndex = at;
	const start = LITERAL_START.exec(source);
	if (!start) return null;
	const prefix = start[1] ?? "";
	const quote = start[2] ?? "";
	const raw = /r/iu.test(prefix);
	let index = at + start[0].length;
	let value = "";
	while (index < source.length) {
		if (source.startsWith(quote, index))
			return { end: index + quote.length, value };
		const char = source[index] ?? "";
		if (quote.length === 1 && char === "\n") return null;
		if (char === "\\" && !raw) {
			const next = source[index + 1] ?? "";
			value +=
				{ "\n": "", "'": "'", '"': '"', "\\": "\\", n: "\n", r: "\r", t: "\t" }[
					next
				] ?? `\\${next}`;
			index += 2;
			continue;
		}
		value += char;
		index++;
	}
	return null;
}

function literalNames(script: string): Map<string, string | null> {
	const names = new Map<string, string | null>();
	const assignment = /(^|[;\n])[ \t]*([A-Za-z_]\w*)[ \t]*=(?!=)[ \t]*/gu;
	for (const match of script.matchAll(assignment)) {
		const name = match[2] ?? "";
		const literal = readLiteral(script, (match.index ?? 0) + match[0].length);
		names.set(name, literal ? literal.value : null);
	}
	return names;
}

function argument(
	script: string,
	at: number,
	names: Map<string, string | null>,
): { value: string; end: number } | null {
	const literal = readLiteral(script, at);
	if (literal) return literal;
	const name = /[A-Za-z_]\w*/uy;
	name.lastIndex = at;
	const match = name.exec(script);
	const value = match ? names.get(match[0]) : null;
	return match && typeof value === "string"
		? { end: at + match[0].length, value }
		: null;
}

const skipSpace = (script: string, at: number) => {
	let index = at;
	while (/\s/u.test(script[index] ?? "")) index++;
	return index;
};

export function findPythonEdits(script: string): PythonEdits | null {
	const names = literalNames(script);
	const files = new Set<string>();
	const opened = /\bopen\(\s*|\bPath\(\s*/gu;
	for (const match of script.matchAll(opened)) {
		const file = argument(script, (match.index ?? 0) + match[0].length, names);
		if (!file) return null;
		files.add(file.value);
	}
	const [file] = files;
	if (files.size !== 1 || !file) return null;
	if (
		!/\.read(?:_text)?\(/u.test(script) ||
		!/(['"])w\1|\.write_text\(/u.test(script)
	)
		return null;
	const edits: FileEdit[] = [];
	for (const match of script.matchAll(/\.replace\(\s*/gu)) {
		const start = (match.index ?? 0) + match[0].length;
		const before = argument(script, start, names);
		if (!before) return null;
		const comma = skipSpace(script, before.end);
		if (script[comma] !== ",") return null;
		const after = argument(script, skipSpace(script, comma + 1), names);
		if (!after) return null;
		edits.push({ after: after.value, before: before.value, file });
	}
	if (edits.length === 0) return null;
	return {
		checksFirst:
			/\bassert\s+\w+\s+in\s+\w+/u.test(script) ||
			/\bif\s+\w+\s+not\s+in\s+\w+/u.test(script),
		edits,
	};
}
