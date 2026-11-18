import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export interface Token {
	readonly text: string;
	readonly kind: "id" | "string" | "punct";
	readonly line: number;
}

export interface Attributes {
	[key: string]: string | boolean | Attributes;
}

export type RustType =
	| {
			readonly kind: "path";
			readonly segments: readonly string[];
			readonly args: readonly RustType[];
	  }
	| { readonly kind: "sequence"; readonly element: RustType }
	| { readonly kind: "tuple"; readonly elements: readonly RustType[] }
	| { readonly kind: "unknown"; readonly text: string };

export interface RustField {
	readonly name: string | undefined;
	readonly type: RustType;
	readonly attrs: Attributes;
	readonly line: number;
}

export interface RustShape {
	readonly shape: "named" | "tuple" | "unit";
	readonly fields: readonly RustField[];
}

export interface RustVariant extends RustShape {
	readonly name: string;
	readonly attrs: Attributes;
	readonly line: number;
}

export interface RustDefinition extends RustShape {
	readonly kind: "struct" | "enum" | "type";
	readonly name: string;
	readonly file: string;
	readonly crate: string;
	readonly line: number;
	readonly attrs: Attributes;
	readonly generics: readonly string[];
	readonly variants: readonly RustVariant[];
	readonly alias: RustType | undefined;
}

export function tokenizeRust(source: string): Token[] {
	const tokens: Token[] = [];
	let offset = 0;
	let line = 1;
	while (offset < source.length) {
		const tail = source.slice(offset);
		const character = source[offset] ?? "";
		if (/\s/u.test(character)) {
			if (character === "\n") line++;
			offset++;
			continue;
		}
		if (tail.startsWith("//")) {
			const end = source.indexOf("\n", offset);
			offset = end < 0 ? source.length : end;
			continue;
		}
		if (tail.startsWith("/*")) {
			let depth = 1;
			offset += 2;
			while (offset < source.length && depth > 0) {
				if (source.startsWith("/*", offset)) {
					depth++;
					offset += 2;
				} else if (source.startsWith("*/", offset)) {
					depth--;
					offset += 2;
				} else {
					if (source[offset] === "\n") line++;
					offset++;
				}
			}
			if (depth > 0) throw new Error("Unclosed Rust block comment");
			continue;
		}
		const raw = /^(?:b)?r(#+|)"/u.exec(tail);
		if (raw !== null) {
			const ending = `"${raw[1] ?? ""}`;
			const end = source.indexOf(ending, offset + raw[0].length);
			if (end < 0) throw new Error("Unclosed Rust raw string");
			const text = source.slice(offset + raw[0].length, end);
			tokens.push({ kind: "string", text, line });
			line += (text.match(/\n/gu) ?? []).length;
			offset = end + ending.length;
			continue;
		}
		if (character === '"' || tail.startsWith('b"')) {
			let end = offset + (character === '"' ? 1 : 2);
			const start = end;
			while (end < source.length && source[end] !== '"') {
				if (source[end] === "\\") end += 2;
				else end++;
			}
			if (end >= source.length) throw new Error("Unclosed Rust string");
			const text = source.slice(start, end);
			tokens.push({ kind: "string", text, line });
			line += (text.match(/\n/gu) ?? []).length;
			offset = end + 1;
			continue;
		}
		const lifetime = /^'(?:\\.|[^'\\])'|^'[A-Za-z_][A-Za-z0-9_]*/u.exec(tail);
		const identifier = /^(?:r#)?[A-Za-z_][A-Za-z0-9_]*/u.exec(tail);
		const number = /^\d[\d_a-zA-Z]*/u.exec(tail);
		const word = lifetime ?? identifier ?? number;
		if (word !== null) {
			tokens.push({ kind: "id", text: word[0].replace(/^r#/u, ""), line });
			offset += word[0].length;
		} else {
			const text = tail.startsWith("::") ? "::" : character;
			tokens.push({ kind: "punct", text, line });
			offset += text.length;
		}
	}
	return tokens;
}

export function groupEnd(tokens: readonly Token[], start: number): number {
	const opening = tokens[start]?.text;
	const closing =
		opening === "("
			? ")"
			: opening === "["
				? "]"
				: opening === "{"
					? "}"
					: opening === "<"
						? ">"
						: undefined;
	if (closing === undefined) throw new Error(`Not a Rust group at ${start}`);
	let depth = 1;
	for (let position = start + 1; position < tokens.length; position++) {
		const token = tokens[position];
		if (token?.kind !== "punct") continue;
		if (token.text === opening) depth++;
		if (token.text === closing && --depth === 0) return position + 1;
	}
	throw new Error(
		`Unclosed Rust group ${opening} at line ${tokens[start]?.line}`,
	);
}

export function splitTokens(
	tokens: readonly Token[],
	separator = ",",
	angles = true,
): Token[][] {
	const parts: Token[][] = [];
	let current: Token[] = [];
	let depth = 0;
	let angle = 0;
	for (const [position, token] of tokens.entries()) {
		if (token.kind === "punct") {
			if (["(", "[", "{"].includes(token.text)) depth++;
			if ([")", "]", "}"].includes(token.text)) depth--;
			if (angles && depth === 0 && token.text === "<") angle++;
			if (
				angles &&
				depth === 0 &&
				token.text === ">" &&
				!["-", "="].includes(tokens[position - 1]?.text ?? "")
			)
				angle = Math.max(0, angle - 1);
		}
		if (
			depth === 0 &&
			angle === 0 &&
			token.kind === "punct" &&
			token.text === separator
		) {
			if (current.length > 0) parts.push(current);
			current = [];
		} else current.push(token);
	}
	if (current.length > 0) parts.push(current);
	return parts;
}

function meta(tokens: readonly Token[]): Attributes {
	const attrs: Attributes = {};
	for (const part of splitTokens(tokens)) {
		const name = part[0]?.text;
		if (name === undefined) continue;
		attrs[name] =
			part[1]?.text === "="
				? (part[2]?.text ?? true)
				: part[1]?.text === "("
					? meta(part.slice(2, -1))
					: true;
	}
	return attrs;
}

function attributes(
	tokens: readonly Token[],
	start = 0,
): { attrs: Attributes; end: number; test: boolean } {
	const attrs: Attributes = {};
	let position = start;
	let test = false;
	while (tokens[position]?.text === "#") {
		const inner = tokens[position + 1]?.text === "!";
		const opening = position + (inner ? 2 : 1);
		const end = groupEnd(tokens, opening);
		const body = tokens.slice(opening + 1, end - 1);
		if (!inner) {
			if (
				body[0]?.text === "cfg" &&
				body.some((token) => token.text === "test") &&
				!body.some((token) => token.text === "not")
			)
				test = true;
			for (let cursor = 0; cursor < body.length; cursor++) {
				if (body[cursor]?.text === "serde" && body[cursor + 1]?.text === "(") {
					const serdeEnd = groupEnd(body, cursor + 1);
					Object.assign(attrs, meta(body.slice(cursor + 2, serdeEnd - 1)));
					cursor = serdeEnd - 1;
				}
			}
		}
		position = end;
	}
	return { attrs, end: position, test };
}

export function parseRustType(tokens: readonly Token[]): RustType {
	const body = [...tokens];
	while (
		body[0]?.text === "&" ||
		body[0]?.text === "mut" ||
		body[0]?.text.startsWith("'")
	)
		body.shift();
	if (body[0]?.text === "[")
		return {
			kind: "sequence",
			element: parseRustType(splitTokens(body.slice(1, -1), ";")[0] ?? []),
		};
	if (body[0]?.text === "(")
		return {
			kind: "tuple",
			elements: splitTokens(body.slice(1, -1)).map(parseRustType),
		};
	const opening = body.findIndex((token) => token.text === "<");
	const head = opening < 0 ? body : body.slice(0, opening);
	const segments = head
		.filter((token) => token.kind === "id")
		.map((token) => token.text);
	if (
		segments.length === 0 ||
		head.some((token) => token.kind === "punct" && token.text !== "::")
	)
		return { kind: "unknown", text: body.map((token) => token.text).join(" ") };
	const args =
		opening < 0
			? []
			: splitTokens(body.slice(opening + 1, groupEnd(body, opening) - 1))
					.filter((part) => !part[0]?.text.startsWith("'"))
					.map(parseRustType);
	return { kind: "path", segments, args };
}

function parseFields(
	tokens: readonly Token[],
	shape: RustShape["shape"],
): RustField[] {
	return splitTokens(tokens).flatMap((part): RustField[] => {
		const attr = attributes(part);
		let position = attr.end;
		if (part[position]?.text === "pub") {
			position++;
			if (part[position]?.text === "(") position = groupEnd(part, position);
		}
		const first = part[position];
		if (first === undefined) return [];
		if (shape === "named" && part[position + 1]?.text !== ":")
			throw new Error(`Unsupported Rust field at line ${first.line}`);
		return [
			{
				name: shape === "named" ? first.text : undefined,
				type: parseRustType(part.slice(position + (shape === "named" ? 2 : 0))),
				attrs: attr.attrs,
				line: first.line,
			},
		];
	});
}

function shapeAt(
	tokens: readonly Token[],
	position: number,
): { shape: RustShape; end: number } {
	const opening = tokens[position]?.text;
	if (opening !== "{" && opening !== "(")
		return { shape: { shape: "unit", fields: [] }, end: position };
	const end = groupEnd(tokens, position);
	const shape = opening === "{" ? "named" : "tuple";
	return {
		shape: {
			shape,
			fields: parseFields(tokens.slice(position + 1, end - 1), shape),
		},
		end,
	};
}

function parseUses(
	tokens: readonly Token[],
	target: Map<string, readonly string[]>,
	prefix: readonly string[] = [],
): void {
	for (const part of splitTokens(tokens)) {
		const opening = part.findIndex((token) => token.text === "{");
		const names = (opening < 0 ? part : part.slice(0, opening))
			.filter((token) => token.kind === "id")
			.map((token) => token.text);
		if (opening >= 0)
			parseUses(part.slice(opening + 1, groupEnd(part, opening) - 1), target, [
				...prefix,
				...names,
			]);
		else {
			const alias = names.indexOf("as");
			const path = [...prefix, ...(alias < 0 ? names : names.slice(0, alias))];
			const name = alias < 0 ? path.at(-1) : names[alias + 1];
			if (name !== undefined) target.set(name, path);
		}
	}
}

export interface ParsedRust {
	readonly definitions: readonly RustDefinition[];
	readonly uses: ReadonlyMap<string, readonly string[]>;
	readonly serializers: ReadonlyMap<
		string,
		{ readonly line: number; readonly body: string }
	>;
}

export function parseRust(
	source: string,
	file = "snippet.rs",
	crate = "snippet",
): ParsedRust {
	const tokens = tokenizeRust(source);
	const definitions: RustDefinition[] = [];
	const uses = new Map<string, readonly string[]>();
	const serializers = new Map<string, { line: number; body: string }>();
	let position = 0;
	let attr = { attrs: {}, test: false };
	while (position < tokens.length) {
		const token = tokens[position];
		if (token === undefined) break;
		if (
			token.kind === "id" &&
			tokens[position + 1]?.text === "!" &&
			["(", "{", "["].includes(tokens[position + 2]?.text ?? "")
		) {
			position = groupEnd(tokens, position + 2);
			continue;
		}
		if (token.text === "#") {
			const next = attributes(tokens, position);
			attr = next;
			position = next.end;
			continue;
		}
		if (token.text === "pub") {
			position++;
			if (tokens[position]?.text === "(") position = groupEnd(tokens, position);
			continue;
		}
		if (token.text === "use") {
			let end = position + 1;
			while (end < tokens.length && tokens[end]?.text !== ";") end++;
			parseUses(tokens.slice(position + 1, end), uses);
			position = end + 1;
			attr = { attrs: {}, test: false };
			continue;
		}
		if (
			["struct", "enum", "type"].includes(token.text) &&
			tokens[position + 1]?.kind === "id"
		) {
			const name = tokens[position + 1]?.text ?? "";
			let cursor = position + 2;
			const generics: string[] = [];
			if (tokens[cursor]?.text === "<") {
				const end = groupEnd(tokens, cursor);
				for (const part of splitTokens(tokens.slice(cursor + 1, end - 1))) {
					const text = part[0]?.text;
					if (text !== undefined && !text.startsWith("'") && text !== "const")
						generics.push(text);
				}
				cursor = end;
			}
			if (tokens[cursor]?.text === "where")
				while (
					cursor < tokens.length &&
					!["{", "(", ";", "="].includes(tokens[cursor]?.text ?? "")
				)
					cursor++;
			let shape: RustShape = { shape: "unit", fields: [] };
			let variants: RustVariant[] = [];
			let alias: RustType | undefined;
			let kind: RustDefinition["kind"];
			if (token.text === "type") {
				kind = "type";
				const start = cursor + 1;
				while (cursor < tokens.length && tokens[cursor]?.text !== ";") {
					if (["[", "(", "{"].includes(tokens[cursor]?.text ?? ""))
						cursor = groupEnd(tokens, cursor);
					else cursor++;
				}
				alias = parseRustType(tokens.slice(start, cursor));
				cursor++;
			} else if (token.text === "enum") {
				kind = "enum";
				const end = groupEnd(tokens, cursor);
				variants = splitTokens(tokens.slice(cursor + 1, end - 1)).map(
					(part) => {
						const variantAttr = attributes(part);
						const nameToken = part[variantAttr.end];
						if (nameToken === undefined)
							throw new Error("Missing Rust variant");
						return {
							...shapeAt(part, variantAttr.end + 1).shape,
							name: nameToken.text,
							line: nameToken.line,
							attrs: variantAttr.attrs,
						};
					},
				);
				cursor = end;
			} else {
				kind = "struct";
				const parsed = shapeAt(tokens, cursor);
				shape = parsed.shape;
				cursor = parsed.end;
			}
			if (!attr.test)
				definitions.push({
					...shape,
					kind,
					name,
					file,
					crate,
					line: token.line,
					attrs: attr.attrs,
					generics,
					variants,
					alias,
				});
			position = Math.max(cursor, position + 2);
			attr = { attrs: {}, test: false };
			continue;
		}
		if (
			["fn", "impl", "trait", "const", "static", "mod", "macro_rules"].includes(
				token.text,
			)
		) {
			let cursor = position + 1;
			while (
				cursor < tokens.length &&
				!["{", ";"].includes(tokens[cursor]?.text ?? "")
			) {
				if (["(", "["].includes(tokens[cursor]?.text ?? ""))
					cursor = groupEnd(tokens, cursor);
				else cursor++;
			}
			if (tokens[cursor]?.text === "{") {
				const end = groupEnd(tokens, cursor);
				const header = tokens
					.slice(position, cursor)
					.map((part) => part.text)
					.join(" ");
				const manual = /\bSerialize\b(?:\s*<[^>]*>)?\s+for\s+(\w+)/u.exec(
					header,
				);
				if (manual?.[1] !== undefined)
					serializers.set(manual[1], {
						line: token.line,
						body: tokens
							.slice(cursor + 1, end - 1)
							.map((part) => part.text)
							.join(" "),
					});
				position = token.text === "mod" && !attr.test ? cursor + 1 : end;
			} else position = cursor + 1;
			attr = { attrs: {}, test: false };
			continue;
		}
		position++;
	}
	return { definitions, uses, serializers };
}

export class RustIndex {
	readonly definitions = new Map<string, RustDefinition[]>();
	readonly files = new Map<string, ParsedRust>();
	readonly crates = new Map<string, string>();

	add(source: string, file: string, crate: string): void {
		let parsed: ParsedRust;
		try {
			parsed = parseRust(source, file, crate);
		} catch (error) {
			throw new Error(`Cannot parse ${file}`, { cause: error });
		}
		this.files.set(file, parsed);
		for (const definition of parsed.definitions) {
			const list = this.definitions.get(definition.name) ?? [];
			list.push(definition);
			this.definitions.set(definition.name, list);
		}
	}

	load(root: string): void {
		const excluded = new Set([
			"target",
			"node_modules",
			".git",
			"tests",
			"testdata",
			"fixtures",
			"examples",
			"benches",
			"vendor",
		]);
		const walk = (directory: string, crate: string) => {
			const manifest = join(directory, "Cargo.toml");
			if (existsSync(manifest)) {
				const name = /^name\s*=\s*"([^"]+)"/mu.exec(
					readFileSync(manifest, "utf8"),
				)?.[1];
				if (name !== undefined) {
					crate = relative(root, directory);
					this.crates.set(name.replaceAll("-", "_"), crate);
				}
			}
			for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
				(left, right) => left.name.localeCompare(right.name),
			)) {
				const path = join(directory, entry.name);
				if (entry.isDirectory() && !excluded.has(entry.name)) walk(path, crate);
				else if (
					entry.isFile() &&
					entry.name.endsWith(".rs") &&
					!/(?:_tests|^tests|^test_).*\.rs$/u.test(entry.name)
				)
					this.add(readFileSync(path, "utf8"), relative(root, path), crate);
			}
		};
		walk(root, "");
	}

	resolve(type: RustType, file: string): RustDefinition | undefined {
		if (type.kind !== "path") return undefined;
		const name = type.segments.at(-1) ?? "";
		const imported = this.files.get(file)?.uses.get(name);
		let candidates = this.definitions.get(name) ?? [];
		if (
			candidates.length === 0 &&
			imported?.at(-1) !== undefined &&
			imported.at(-1) !== name
		)
			candidates = this.definitions.get(imported.at(-1) ?? "") ?? [];
		if (candidates.length <= 1) return candidates[0];
		const origin = [...(this.files.get(file)?.definitions ?? [])][0]?.crate;
		const segments = type.segments.length > 1 ? type.segments : imported;
		const first = segments?.[0];
		if (
			segments !== undefined &&
			segments.length > 2 &&
			first === "crate" &&
			origin !== undefined
		) {
			const module = segments.slice(1, -1).join("/");
			const matchingFile = candidates.filter(
				(definition) =>
					definition.file === `${origin}/src/${module}.rs` ||
					definition.file === `${origin}/src/${module}/mod.rs`,
			);
			if (matchingFile.length === 1) return matchingFile[0];
		}
		const hinted =
			first === undefined
				? undefined
				: ["crate", "super", "self"].includes(first)
					? origin
					: this.crates.get(first);
		if (hinted !== undefined) {
			const matches = candidates.filter(
				(definition) => definition.crate === hinted,
			);
			if (matches.length === 1) return matches[0];
			if (matches.length > 0) candidates = matches;
		}
		const sameFile = candidates.filter(
			(definition) => definition.file === file,
		);
		if (sameFile.length === 1) return sameFile[0];
		const sameCrate = candidates.filter(
			(definition) => definition.crate === origin,
		);
		if (sameCrate.length === 1) return sameCrate[0];
		return undefined;
	}
}
