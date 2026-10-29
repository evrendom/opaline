type Rewritten = { text: string; origin: number[] };

function rewriter() {
	let text = "";
	const origin: number[] = [];
	return {
		done: (): Rewritten => ({ origin, text }),
		emit(chars: string, from: number) {
			text += chars;
			for (let k = 0; k < chars.length; k++) origin.push(from);
		},
	};
}

export function backquotesAsSubstitutions(command: string): Rewritten {
	const out = rewriter();
	let quote: "'" | '"' | null = null;
	let open = false;
	for (let i = 0; i < command.length; i++) {
		const char = command[i] ?? "";
		if (quote === "'") {
			if (char === "'") quote = null;
			out.emit(char, i);
			continue;
		}
		if (char === "\\") {
			out.emit(char, i);
			if (i + 1 < command.length) out.emit(command[i + 1] ?? "", i + 1);
			i++;
			continue;
		}
		if (char === "'" && quote === null) quote = "'";
		else if (char === '"') quote = quote === '"' ? null : '"';
		if (char === "`") {
			out.emit(open ? ")" : "$(", i);
			open = !open;
			continue;
		}
		out.emit(char, i);
	}
	return out.done();
}

export function hereDocuments(command: string): string[] {
	const bodies: string[] = [];
	const pattern = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n\s*\2(?:\n|$)/gu;
	for (const match of command.matchAll(pattern)) bodies.push(match[3] ?? "");
	return bodies;
}

export function keepLiteralBackslashes(command: string): Rewritten {
	const out = rewriter();
	let quote: "'" | '"' | null = null;
	for (let i = 0; i < command.length; i++) {
		const char = command[i] ?? "";
		const next = command[i + 1] ?? "";
		if (quote === "'") {
			if (char === "'") quote = null;
			out.emit(char, i);
			continue;
		}
		if (char === "\\") {
			if (quote === '"' && !'$`"\\\n'.includes(next)) out.emit("\\\\", i);
			else {
				out.emit(char, i);
				if (i + 1 < command.length) out.emit(next, i + 1);
				i++;
			}
			continue;
		}
		if (char === "'" && quote === null) quote = "'";
		else if (char === '"') quote = quote === '"' ? null : (quote ?? '"');
		out.emit(char, i);
	}
	return out.done();
}

const placeholderOf = (kind: "SUB" | "MATH", index: number) =>
	`__${kind}${index}__`;
const SUB = /__SUB(\d+)__/gu;
const MATH = /__MATH(\d+)__/gu;
const ONLY_SUB = /^__SUB(\d+)__$/u;
const CAPTURED_SUB = /^([A-Za-z_][A-Za-z0-9_]*)=__SUB(\d+)__$/u;

export type Extracted = Rewritten & {
	subs: string[];
	math: string[];
	restore: (word: string) => string;
};

export function extractSubstitutions(command: string): Extracted {
	const subs: string[] = [];
	const math: string[] = [];
	const out = rewriter();
	const placeholder = (name: string, from: number, to: number) => {
		out.emit(name.slice(0, -1), from);
		out.emit(name.slice(-1), to);
	};
	let quote: "'" | '"' | null = null;
	for (let i = 0; i < command.length; i++) {
		const char = command[i] ?? "";
		if (quote === "'") {
			out.emit(char, i);
			if (char === "'") quote = null;
			continue;
		}
		if (char === "\\") {
			out.emit(char, i);
			if (i + 1 < command.length) out.emit(command[i + 1] ?? "", i + 1);
			i++;
			continue;
		}
		if (char === "'" && quote === null) {
			quote = "'";
			out.emit(char, i);
			continue;
		}
		if (char === '"') {
			quote = quote === '"' ? null : '"';
			out.emit(char, i);
			continue;
		}
		if (char === "$" && command[i + 1] === "(") {
			let depth = 0;
			let inner: string | null = null;
			let end = -1;
			for (let j = i + 1; j < command.length; j++) {
				const c = command[j] ?? "";
				if (inner) {
					if (c === "\\" && inner === '"') j++;
					else if (c === inner) inner = null;
					continue;
				}
				if (c === "'" || c === '"') inner = c;
				else if (c === "\\") j++;
				else if (c === "(") depth++;
				else if (c === ")" && --depth === 0) {
					end = j;
					break;
				}
			}
			if (end < 0) {
				out.emit(char, i);
				continue;
			}
			if (command[i + 2] === "(") {
				math.push(command.slice(i, end + 1));
				placeholder(placeholderOf("MATH", math.length - 1), i, end);
			} else {
				subs.push(command.slice(i + 2, end));
				placeholder(placeholderOf("SUB", subs.length - 1), i, end);
			}
			i = end;
			continue;
		}
		out.emit(char, i);
	}
	const restore = (word: string) =>
		word
			.replace(SUB, (_, index: string) => `$(${subs[Number(index)] ?? ""})`)
			.replace(MATH, (_, index: string) => math[Number(index)] ?? "");
	return { math, restore, subs, ...out.done() };
}

export function substitutionOf(word: string): number | null {
	const match = ONLY_SUB.exec(word);
	return match ? Number(match[1]) : null;
}

export function capturedSubstitution(
	text: string,
): { name: string; index: number } | null {
	const match = CAPTURED_SUB.exec(text);
	return match ? { index: Number(match[2]), name: match[1] ?? "" } : null;
}
