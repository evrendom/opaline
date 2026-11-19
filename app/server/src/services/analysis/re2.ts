const RE2_SPACE = "\\t\\n\\f\\r ";
const FLAGS = /^\(\?([imsU]+)\)/u;

const compiled = new Map<string, RegExp>();

export function re2(pattern: string, global = false): RegExp {
	const key = `${global ? "g" : ""}${pattern}`;
	const cached = compiled.get(key);
	if (cached) return cached;
	let source = pattern;
	let flags = global ? "gu" : "u";
	const inline = FLAGS.exec(source);
	if (inline) {
		source = source.slice(inline[0].length);
		for (const flag of inline[1] ?? "") if (flag !== "U") flags += flag;
	}
	const regex = new RegExp(translate(source), flags);
	compiled.set(key, regex);
	return regex;
}

function translate(source: string): string {
	let out = "";
	let inClass = false;
	for (let index = 0; index < source.length; index++) {
		const char = source[index] as string;
		const next = source[index + 1] ?? "";
		if (char === "\\") {
			if (next === "s") out += inClass ? RE2_SPACE : `[${RE2_SPACE}]`;
			else if (next === "S") {
				if (inClass) throw new Error(`\\S inside a character class: ${source}`);
				out += `[^${RE2_SPACE}]`;
			} else if (next === "x" && source[index + 2] === "{") {
				const end = source.indexOf("}", index);
				out += `\\u{${source.slice(index + 3, end)}}`;
				index = end;
				continue;
			} else out += `\\${next}`;
			index++;
			continue;
		}
		if (!inClass && char === "[") {
			const posix = /^\[\[:(alnum|alpha|digit|space|upper|lower):\]/u.exec(
				source.slice(index),
			);
			inClass = true;
			if (posix) {
				out += `[${POSIX[posix[1] as keyof typeof POSIX]}`;
				index += posix[0].length - 1;
				continue;
			}
			out += char;
			if (next === "^") {
				out += next;
				index++;
			}
			if (source[index + 1] === "]") {
				out += "\\]";
				index++;
			}
			continue;
		}
		if (inClass && char === "[" && next === ":") {
			const end = source.indexOf(":]", index);
			const name = source.slice(index + 2, end) as keyof typeof POSIX;
			out += POSIX[name];
			index = end + 1;
			continue;
		}
		if (inClass && char === "]") inClass = false;
		out += char;
	}
	return out;
}

const POSIX = {
	alnum: "A-Za-z0-9",
	alpha: "A-Za-z",
	digit: "0-9",
	space: RE2_SPACE,
	upper: "A-Z",
	lower: "a-z",
} as const;

function substitute(replacement: string, groups: readonly unknown[]): string {
	let out = "";
	for (let index = 0; index < replacement.length; index++) {
		const char = replacement[index] as string;
		const next = replacement[index + 1];
		if (char === "\\" && next !== undefined && /[0-9]/u.test(next)) {
			const value = groups[Number(next)];
			out += typeof value === "string" ? value : "";
			index++;
		} else if (char === "\\" && next === "\\") {
			out += "\\";
			index++;
		} else out += char;
	}
	return out;
}

export function replaceRegexpAll(
	text: string,
	pattern: string,
	replacement: string,
): string {
	return text.replace(re2(pattern, true), (...match) =>
		substitute(replacement, match),
	);
}

export function replaceRegexpOne(
	text: string,
	pattern: string,
	replacement: string,
): string {
	return text.replace(re2(pattern), (...match) =>
		substitute(replacement, match),
	);
}

export function extract(text: string, pattern: string): string {
	const match = re2(pattern).exec(text);
	if (!match) return "";
	const value = match.length > 1 ? match[1] : match[0];
	return value ?? "";
}

export function countMatches(text: string, pattern: string): number {
	let count = 0;
	for (const match of text.matchAll(re2(pattern, true)))
		if (match[0] !== "") count++;
	return count;
}

export function splitByRegexp(pattern: string, text: string): string[] {
	return text.split(re2(pattern, true));
}

export function trimSpaces(text: string): string {
	return text.replace(/^ +| +$/gu, "");
}

export function trimLeftSpaces(text: string): string {
	return text.replace(/^ +/u, "");
}
