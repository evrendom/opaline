/**
 * Files an inline Python script (a `python3 - <<'EOF'` here-document or a
 * `python3 -c "…"` argument) reads and writes, read from its text without
 * running it. Only paths the script writes as string literals count: a
 * literal passed to `open`, `Path(…)` or `pathlib.Path(…)`, a name bound to
 * one (`p = 'x'`, `path = Path('x')`, `for p in ['a', 'b']:`), or a literal
 * argument of a function whose parameter the function opens. A name bound to
 * anything else (a join, a format, a glob) is unknown and never guessed.
 * String contents are data: an `open(` inside a string is not a call.
 */

export interface PythonFileAccess {
	/** Paths the script opens for writing (`'w'`, `'a'`, `'x'`, `'+'` modes, `write_text`, `write_bytes`). */
	readonly writes: readonly string[];
	/** The written paths the script also reads: it edits them rather than writing them whole. */
	readonly edits: readonly string[];
	/** Paths the script only reads (no mode, `'r'`, `read_text`, `read_bytes`). */
	readonly reads: readonly string[];
	/** True when the script changes its directory (`os.chdir`), so relative paths are relative to that. */
	readonly changesDirectory: boolean;
}

/** One logical line of code with its string literals replaced by `\u0000<n>\u0000`. */
interface CodeLine {
	readonly indent: number;
	readonly code: string;
}

const NAME = "[A-Za-z_][A-Za-z0-9_]*";
/** A masked string literal. */
const STRING = "\u0000(\\d+)\u0000";
/** `Path(…)`, `pathlib.Path(…)` or `PurePath(…)` of one simple argument. */
const PATH_CALL = "(?:pathlib\\.)?(?:Pure)?Path\\(\\s*([^()]*?)\\s*\\)";
/** The masked value of a string that is not a literal path (f-string, bytes, escapes). */
const NOT_LITERAL = "\u0001";
const MAX_SCRIPT_CHARS = 200_000;
const MAX_CALL_SCAN = 4_096;

type Binding =
	| { readonly kind: "paths"; readonly paths: readonly string[] }
	| { readonly kind: "param"; readonly index: number };

interface FunctionAccess {
	readonly params: readonly string[];
	readonly writes: ReadonlySet<number>;
	readonly reads: ReadonlySet<number>;
}

export function readPythonFileAccess(script: string): PythonFileAccess {
	const empty = { writes: [], edits: [], reads: [], changesDirectory: false };
	if (script.length > MAX_SCRIPT_CHARS) return empty;
	const lexed = lexPython(script);
	if (lexed === undefined) return empty;
	const { lines, strings } = lexed;
	const writes: string[] = [];
	const reads: string[] = [];
	const add = (list: string[], paths: readonly string[]) => {
		for (const path of paths) if (!list.includes(path)) list.push(path);
	};
	const functions = new Map<string, FunctionAccess>();
	const globals = new Map<string, Binding>();

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (line === undefined) continue;
		const header = new RegExp(`^def\\s+(${NAME})\\s*\\(([^)]*)\\)`, "u").exec(
			line.code,
		);
		if (header !== null) {
			// The body: the lines indented under the header.
			let end = index + 1;
			while (end < lines.length && (lines[end]?.indent ?? 0) > line.indent)
				end++;
			const params = (header[2] ?? "")
				.split(",")
				.map((param) => param.split(/[:=]/u)[0]?.trim() ?? "")
				.filter((param) => param !== "" && !param.startsWith("*"));
			const local = new Map<string, Binding>(globals);
			for (const [position, param] of params.entries())
				local.set(param, { kind: "param", index: position });
			const access = { writes: new Set<number>(), reads: new Set<number>() };
			for (const body of lines.slice(index + 1, end))
				for (const statement of statements(body.code))
					readStatement(statement, strings, local, (mode, binding) => {
						if (binding.kind === "param")
							(mode === "write" ? access.writes : access.reads).add(
								binding.index,
							);
						else add(mode === "write" ? writes : reads, binding.paths);
					});
			functions.set(header[1] ?? "", { params, ...access });
			index = end - 1;
			continue;
		}
		for (const statement of statements(line.code))
			readStatement(statement, strings, globals, (mode, binding) => {
				if (binding.kind === "paths")
					add(mode === "write" ? writes : reads, binding.paths);
			});
	}

	// Calls of functions that open a parameter: the literal argument at its place.
	for (const [name, access] of functions) {
		if (access.writes.size === 0 && access.reads.size === 0) continue;
		for (const line of lines) {
			if (/^def\s/u.test(line.code)) continue;
			const pattern = new RegExp(`(?<![\\w.])${name}\\(`, "gu");
			for (const match of line.code.matchAll(pattern)) {
				const start = match.index + match[0].length;
				const args = splitArguments(
					line.code.slice(start, start + MAX_CALL_SCAN),
				);
				if (args === undefined) continue;
				const positional: (string | undefined)[] = [];
				const named = new Map<string, string>();
				for (const arg of args) {
					const keyword = new RegExp(
						`^(${NAME})\\s*=(?!=)\\s*(.*)$`,
						"su",
					).exec(arg);
					if (keyword !== null) named.set(keyword[1] ?? "", keyword[2] ?? "");
					else positional.push(arg);
				}
				for (const [position, param] of access.params.entries()) {
					const arg = positional[position] ?? named.get(param);
					if (arg === undefined) continue;
					const paths = literalPaths(arg.trim(), strings, globals);
					if (paths === undefined) continue;
					if (access.writes.has(position)) add(writes, paths);
					if (access.reads.has(position)) add(reads, paths);
				}
			}
		}
	}
	return {
		writes,
		edits: writes.filter((path) => reads.includes(path)),
		reads: reads.filter((path) => !writes.includes(path)),
		changesDirectory: lines.some((line) =>
			/(?<![\w.])(?:os\.)?chdir\(/u.test(line.code),
		),
	};
}

/**
 * One statement: bind names to literal paths, unbind names given anything
 * else, and report each file the statement opens with how.
 */
function readStatement(
	statement: string,
	strings: readonly string[],
	bindings: Map<string, Binding>,
	open: (mode: "read" | "write", binding: Binding) => void,
): void {
	const report = (mode: "read" | "write", target: string) => {
		const binding = resolveTarget(target.trim(), strings, bindings);
		if (binding !== undefined) open(mode, binding);
	};
	const opens = /(?<![\w.])open\(/gu;
	for (const match of statement.matchAll(opens)) {
		const args = splitArguments(statement.slice(match.index + match[0].length));
		const target = args?.[0];
		if (args === undefined || target === undefined) continue;
		const mode = openMode(args.slice(1), strings);
		if (mode !== undefined) report(mode, target);
	}
	const methods = new RegExp(
		`(?<![\\w.])(${PATH_CALL}|${NAME})\\.(write_text|write_bytes|read_text|read_bytes|open)\\(`,
		"gu",
	);
	for (const match of statement.matchAll(methods)) {
		const method = match[3] ?? "";
		if (method === "open") {
			const args = splitArguments(
				statement.slice(match.index + match[0].length),
			);
			const mode = args === undefined ? undefined : openMode(args, strings);
			if (mode !== undefined) report(mode, match[1] ?? "");
		} else
			report(method.startsWith("write") ? "write" : "read", match[1] ?? "");
	}

	const loop = new RegExp(
		`^for\\s+(${NAME})\\s+in\\s+[[(](.*)[\\])]\\s*:`,
		"u",
	).exec(statement);
	if (loop !== null) {
		const items = splitArguments(`${loop[2] ?? ""})`);
		// Every item a literal path, else the name is unknown.
		const lists = items?.map((item) =>
			literalPaths(item.trim(), strings, bindings),
		);
		const paths =
			lists === undefined || lists.some((list) => list === undefined)
				? []
				: lists.flatMap((list) => list ?? []);
		if (paths.length > 0) bindings.set(loop[1] ?? "", { kind: "paths", paths });
		else bindings.delete(loop[1] ?? "");
		return;
	}
	const otherLoop = /^for\s+(.+?)\s+in\s/u.exec(statement);
	if (otherLoop !== null) {
		for (const name of (otherLoop[1] ?? "").matchAll(new RegExp(NAME, "gu")))
			bindings.delete(name[0]);
		return;
	}
	const assignment = new RegExp(
		`^((?:${NAME}\\s*,\\s*)*${NAME})\\s*(?::[^=]+)?=(?!=)\\s*(.+)$`,
		"su",
	).exec(statement);
	const withTarget = new RegExp(`\\bas\\s+(${NAME})\\s*:?\\s*$`, "u").exec(
		statement,
	);
	if (withTarget !== null) bindings.delete(withTarget[1] ?? "");
	if (assignment === null) return;
	const names = (assignment[1] ?? "").split(",").map((name) => name.trim());
	const value = assignment[2] ?? "";
	const paths =
		names.length === 1
			? literalPaths(value.trim(), strings, bindings)
			: undefined;
	for (const name of names) bindings.delete(name);
	if (paths !== undefined && names[0] !== undefined)
		bindings.set(names[0], { kind: "paths", paths });
}

/** The mode an `open` call's remaining arguments name; undefined when it is not a literal. */
function openMode(
	args: readonly string[],
	strings: readonly string[],
): "read" | "write" | undefined {
	let mode: string | undefined;
	let positional = 0;
	for (const arg of args) {
		const keyword = new RegExp(`^(${NAME})\\s*=(?!=)\\s*(.*)$`, "su").exec(
			arg.trim(),
		);
		if (keyword !== null) {
			if (keyword[1] === "mode") mode = keyword[2]?.trim();
			continue;
		}
		if (positional++ === 0) mode = arg.trim();
	}
	if (mode === undefined) return "read";
	const literal = new RegExp(`^${STRING}$`, "u").exec(mode);
	const text = literal === null ? undefined : strings[Number(literal[1])];
	if (text === undefined) return undefined;
	return /[wax+]/u.test(text) ? "write" : "read";
}

/** What an `open` target or path receiver names: literal paths, a parameter, or nothing known. */
function resolveTarget(
	target: string,
	strings: readonly string[],
	bindings: ReadonlyMap<string, Binding>,
): Binding | undefined {
	const inner = unwrapPath(target);
	if (new RegExp(`^${NAME}$`, "u").test(inner)) return bindings.get(inner);
	const paths = literalPaths(inner, strings, bindings);
	return paths === undefined ? undefined : { kind: "paths", paths };
}

/** The literal paths an expression is: a string, `Path(string)`, or a name bound to them. */
function literalPaths(
	expression: string,
	strings: readonly string[],
	bindings: ReadonlyMap<string, Binding>,
): readonly string[] | undefined {
	const inner = unwrapPath(expression);
	const literal = new RegExp(`^${STRING}$`, "u").exec(inner);
	if (literal !== null) {
		const value = strings[Number(literal[1])];
		return value === undefined || value === NOT_LITERAL || value === ""
			? undefined
			: [value];
	}
	if (new RegExp(`^${NAME}$`, "u").test(inner)) {
		const bound = bindings.get(inner);
		return bound?.kind === "paths" ? bound.paths : undefined;
	}
	return undefined;
}

/** The argument of a `Path(…)` call, else the expression itself. */
function unwrapPath(expression: string): string {
	const call = new RegExp(`^${PATH_CALL}$`, "u").exec(expression.trim());
	return (call?.[1] ?? expression).trim();
}

/** The top-level arguments up to the call's closing parenthesis; undefined when it does not close. */
function splitArguments(source: string): string[] | undefined {
	const args: string[] = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < source.length; index++) {
		const character = source[index];
		if (character === "(" || character === "[" || character === "{") depth++;
		else if (character === ")" || character === "]" || character === "}") {
			if (depth === 0) {
				const last = source.slice(start, index).trim();
				if (last !== "" || args.length > 0) args.push(last);
				return args.filter((arg) => arg !== "");
			}
			depth--;
		} else if (character === "," && depth === 0) {
			args.push(source.slice(start, index).trim());
			start = index + 1;
		}
	}
	return undefined;
}

/** The statements of a code line: split on top-level `;`, and the body after a `:` of a one-line block. */
function statements(code: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < code.length; index++) {
		const character = code[index];
		if (character === "(" || character === "[" || character === "{") depth++;
		else if (character === ")" || character === "]" || character === "}")
			depth = Math.max(0, depth - 1);
		else if (character === ";" && depth === 0) {
			parts.push(code.slice(start, index).trim());
			start = index + 1;
		}
	}
	parts.push(code.slice(start).trim());
	return parts.flatMap((part) => {
		// `if old in s: s = s.replace(…)` / `with open(p) as f: s = f.read()`.
		const block =
			/^(?:if|elif|else|while|with|try|except|finally)\b[^:]*:\s*(\S.*)$/u.exec(
				part,
			);
		return part === ""
			? []
			: block?.[1] === undefined
				? [part]
				: [part, block[1]];
	});
}

/**
 * Lines of a Python script with comments removed and string literals masked;
 * a continued line (open brackets, a trailing backslash) joins the next.
 * Undefined when a string never closes.
 */
function lexPython(
	script: string,
): { lines: CodeLine[]; strings: string[] } | undefined {
	const strings: string[] = [];
	const lines: CodeLine[] = [];
	let code = "";
	let depth = 0;
	let indent = 0;
	let atLineStart = true;
	let index = 0;
	const endLine = () => {
		if (code.trim() !== "") lines.push({ indent, code: code.trim() });
		code = "";
		atLineStart = true;
	};
	while (index < script.length) {
		const character = script[index] ?? "";
		if (atLineStart) {
			let column = 0;
			while (script[index] === " " || script[index] === "\t") {
				column += script[index] === "\t" ? 8 : 1;
				index++;
			}
			indent = column;
			atLineStart = false;
			continue;
		}
		if (character === "#") {
			while (index < script.length && script[index] !== "\n") index++;
			continue;
		}
		if (character === "\\" && script[index + 1] === "\n") {
			index += 2;
			continue;
		}
		if (character === "\n") {
			index++;
			if (depth > 0) {
				code += " ";
				continue;
			}
			endLine();
			continue;
		}
		const prefix = /^([rRbBuUfF]{0,2})(?:'''|"""|'|")/u.exec(
			script.slice(index, index + 5),
		);
		if (prefix !== null && !/[\w]$/u.test(code)) {
			const flags = (prefix[1] ?? "").toLowerCase();
			const start = index + (prefix[1]?.length ?? 0);
			const triple = script.startsWith(script[start]?.repeat(3) ?? "", start)
				? (script[start] ?? "").repeat(3)
				: undefined;
			const quote = triple ?? script[start] ?? "";
			const bodyStart = start + quote.length;
			let end = bodyStart;
			let closed = false;
			while (end < script.length) {
				if (script[end] === "\\" && !flags.includes("r")) {
					end += 2;
					continue;
				}
				if (script.startsWith(quote, end)) {
					closed = true;
					break;
				}
				if (triple === undefined && script[end] === "\n") break;
				end++;
			}
			if (!closed) return undefined;
			const body = script.slice(bodyStart, end);
			// An f-string, bytes or an escape is not a literal path.
			const literal =
				flags.includes("f") || flags.includes("b") || /\\/u.test(body)
					? NOT_LITERAL
					: body;
			code += `\u0000${strings.length}\u0000`;
			strings.push(literal);
			index = end + quote.length;
			continue;
		}
		if (character === "(" || character === "[" || character === "{") depth++;
		if (character === ")" || character === "]" || character === "}")
			depth = Math.max(0, depth - 1);
		code += character;
		index++;
	}
	endLine();
	return { lines, strings };
}
