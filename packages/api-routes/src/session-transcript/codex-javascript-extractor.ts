export type ExtractedCodexInvocation = {
	argumentSource: string;
	expansionIndex: number;
	expansionPath: readonly number[];
	input: Readonly<Record<string, unknown>>;
	name: string;
	resolvedInput: boolean;
	source: string;
	sourceOffset: number;
};

type ParsedExpression = {
	end: number;
	resolved: boolean;
	value: unknown;
};

type LiteralEnvironment = ReadonlyMap<string, unknown>;
type LiteralExpansionEnvironment = ReadonlyMap<string, readonly unknown[]>;

const DECLARATION_PATTERN = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/gu;
const MAP_PREFIX_PATTERN =
	/\b([A-Za-z_$][\w$]*)\.map\s*\(\s*(?:async\s*)?\(?\s*(\{[^{}]*\}|\[[^[\]]*\]|[A-Za-z_$][\w$]*)/gu;
const FOR_OF_PREFIX_PATTERN =
	/\bfor\s*\(\s*(?:const|let)\s+(\{[^{}]*\}|\[[^[\]]*\]|[A-Za-z_$][\w$]*)\s+of\s+([A-Za-z_$][\w$]*)(\.entries\(\))?\s*\)/gu;
const TOOL_CALL_PATTERN = /\btools\.([A-Za-z_$][\w$]*)\s*\(/gu;

export function extractCustomExecInvocations(
	source: string,
): readonly ExtractedCodexInvocation[] {
	const codeMask = maskJavaScriptNonCode(source);
	const bindings = collectLiteralBindings(source, codeMask);
	const expansionBindings = collectLiteralExpansionBindings(
		source,
		codeMask,
		bindings,
	);
	const invocations: ExtractedCodexInvocation[] = [];

	for (const match of codeMask.matchAll(TOOL_CALL_PATTERN)) {
		const name = match[1];
		const sourceOffset = match.index;
		if (!name || sourceOffset === undefined) {
			continue;
		}
		const openingParenthesis = codeMask.indexOf("(", sourceOffset);
		const closingParenthesis = findMatchingDelimiter(
			codeMask,
			openingParenthesis,
			"(",
			")",
		);
		if (openingParenthesis === -1 || closingParenthesis === undefined) {
			continue;
		}

		const expansions = findLiteralExpansions(
			sourceOffset,
			codeMask,
			expansionBindings,
		);
		const environments = expandLiteralEnvironments(bindings, expansions);

		for (
			let expansionIndex = 0;
			expansionIndex < environments.length;
			expansionIndex++
		) {
			const environment = environments[expansionIndex]?.environment ?? bindings;
			const argumentStart = openingParenthesis + 1;
			const parsed = parseExpression(source, argumentStart, environment);
			const rawArgument = source
				.slice(argumentStart, closingParenthesis)
				.trim();
			const parsedInput = toInvocationInput(parsed, rawArgument);
			invocations.push({
				argumentSource: rawArgument,
				expansionIndex,
				expansionPath: environments[expansionIndex]?.path ?? [],
				input: parsedInput.input,
				name,
				resolvedInput: parsedInput.resolved,
				source: source.slice(sourceOffset, closingParenthesis + 1),
				sourceOffset,
			});
		}
	}

	return invocations;
}

function collectLiteralExpansionBindings(
	source: string,
	codeMask: string,
	bindings: LiteralEnvironment,
) {
	const expansions = new Map<string, readonly unknown[]>();
	for (const [name, value] of bindings) {
		// An empty initializer can be populated before the loop. It is not proof
		// that the enclosed tool call has zero runtime instances.
		if (Array.isArray(value) && value.length > 0) expansions.set(name, value);
	}
	const pattern = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\[/gu;
	for (const match of codeMask.matchAll(pattern)) {
		const name = match[1];
		const offset = match.index;
		if (!name || offset === undefined) continue;
		const opening = codeMask.indexOf("[", offset);
		const closing = findMatchingDelimiter(codeMask, opening, "[", "]");
		if (opening === -1 || closing === undefined) continue;
		const values = splitTopLevelExpressions(
			source,
			codeMask,
			opening + 1,
			closing,
		).map(({ end, start }) => {
			const parsed = parseExpression(source, start, bindings);
			return parsed?.resolved === true
				? parsed.value
				: readPartialLiteralObject(source, codeMask, start, end, bindings);
		});
		if (values.length > 0) expansions.set(name, values);
	}
	return expansions;
}

function splitTopLevelExpressions(
	source: string,
	codeMask: string,
	start: number,
	end: number,
) {
	const ranges: Array<{ end: number; start: number }> = [];
	let itemStart = skipWhitespaceAndComments(source, start);
	let roundDepth = 0;
	let squareDepth = 0;
	let curlyDepth = 0;
	for (let index = itemStart; index < end; index += 1) {
		const character = codeMask[index];
		if (character === "(") roundDepth += 1;
		else if (character === ")") roundDepth -= 1;
		else if (character === "[") squareDepth += 1;
		else if (character === "]") squareDepth -= 1;
		else if (character === "{") curlyDepth += 1;
		else if (character === "}") curlyDepth -= 1;
		else if (
			character === "," &&
			roundDepth === 0 &&
			squareDepth === 0 &&
			curlyDepth === 0
		) {
			if (itemStart < index) ranges.push({ end: index, start: itemStart });
			itemStart = skipWhitespaceAndComments(source, index + 1);
		}
	}
	if (itemStart < end) ranges.push({ end, start: itemStart });
	return ranges;
}

function readPartialLiteralObject(
	source: string,
	codeMask: string,
	start: number,
	end: number,
	bindings: LiteralEnvironment,
) {
	if (codeMask[skipMaskedWhitespace(codeMask, start)] !== "{") {
		return undefined;
	}
	const record: Record<string, unknown> = {};
	const propertyNames = [
		"cell_id",
		"chars",
		"cmd",
		"code",
		"max_output_tokens",
		"message",
		"path",
		"prompt",
		"query",
		"session_id",
		"target",
		"workdir",
		"yield_time_ms",
	];
	const maskedSlice = codeMask.slice(start, end);
	for (const property of propertyNames) {
		const match = new RegExp(`\\b${property}\\s*:`, "u").exec(maskedSlice);
		if (match?.index === undefined) continue;
		const colon = codeMask.indexOf(":", start + match.index);
		const parsed = parseExpression(source, colon + 1, bindings);
		if (parsed?.resolved === true) record[property] = parsed.value;
	}
	return Object.keys(record).length > 0 ? record : undefined;
}

function collectLiteralBindings(source: string, codeMask: string) {
	const bindings = new Map<string, unknown>();
	for (const match of codeMask.matchAll(DECLARATION_PATTERN)) {
		const name = match[1];
		if (!name || match.index === undefined) {
			continue;
		}
		const equalsIndex = codeMask.indexOf("=", match.index);
		if (equalsIndex === -1) {
			continue;
		}
		const parsed = parseExpression(source, equalsIndex + 1, bindings);
		if (parsed?.resolved === true) {
			bindings.set(name, parsed.value);
		}
	}
	return bindings;
}

type LiteralExpansion = {
	bindings: readonly ExpansionBinding[];
	entries: boolean;
	iterable: string;
	offset: number;
	values: readonly unknown[] | undefined;
};

function findLiteralExpansions(
	toolOffset: number,
	codeMask: string,
	bindings: LiteralExpansionEnvironment,
): readonly LiteralExpansion[] {
	return [
		...findEnclosingMapExpansions(toolOffset, codeMask),
		...findEnclosingForExpansions(toolOffset, codeMask),
	]
		.map((expansion) => ({
			...expansion,
			values: bindings.get(expansion.iterable),
		}))
		.sort((left, right) => left.offset - right.offset);
}

function expandLiteralEnvironments(
	bindings: LiteralEnvironment,
	expansions: readonly LiteralExpansion[],
): readonly { environment: LiteralEnvironment; path: readonly number[] }[] {
	return expansions.reduce<
		readonly { environment: LiteralEnvironment; path: readonly number[] }[]
	>(
		(environments, expansion) =>
			environments.flatMap(({ environment, path }) => {
				const iterable =
					environment.get(expansion.iterable) ?? expansion.values;
				if (!Array.isArray(iterable) || iterable.length === 0) {
					return [{ environment, path }];
				}
				const values = expansion.entries
					? iterable.map((item, index) => [index, item])
					: iterable;
				return values.map((value, expansionIndex) => ({
					environment: new Map([
						...environment,
						...resolveExpansionBindings(expansion.bindings, value),
					]),
					path: [...path, expansionIndex],
				}));
			}),
		[{ environment: bindings, path: [] }],
	);
}

type ExpansionBinding = {
	name: string;
	selector: number | string | undefined;
};

function resolveExpansionBindings(
	bindings: readonly ExpansionBinding[],
	value: unknown,
): Array<[string, unknown]> {
	return bindings.map((binding) => {
		if (typeof binding.selector === "number") {
			return [
				binding.name,
				Array.isArray(value) ? value[binding.selector] : undefined,
			];
		}
		if (typeof binding.selector === "string") {
			return [binding.name, readRecord(value)?.[binding.selector]];
		}
		return [binding.name, value];
	});
}

function parseExpansionBindings(source: string): readonly ExpansionBinding[] {
	const trimmed = source.trim();
	if (/^[A-Za-z_$][\w$]*$/u.test(trimmed)) {
		return [{ name: trimmed, selector: undefined }];
	}
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		return trimmed
			.slice(1, -1)
			.split(",")
			.flatMap((part, index): ExpansionBinding[] => {
				const name = part.trim();
				return /^[A-Za-z_$][\w$]*$/u.test(name)
					? [{ name, selector: index }]
					: [];
			});
	}
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		return trimmed
			.slice(1, -1)
			.split(",")
			.flatMap((part): ExpansionBinding[] => {
				const [propertySource, aliasSource] = part.split(":");
				const property = propertySource?.trim() ?? "";
				const name = aliasSource?.trim() || property;
				return /^[A-Za-z_$][\w$]*$/u.test(property) &&
					/^[A-Za-z_$][\w$]*$/u.test(name)
					? [{ name, selector: property }]
					: [];
			});
	}
	return [];
}

function findEnclosingMapExpansions(toolOffset: number, codeMask: string) {
	const expansions: LiteralExpansion[] = [];
	for (const match of codeMask.matchAll(MAP_PREFIX_PATTERN)) {
		const iterable = match[1];
		const bindingSource = match[2];
		const offset = match.index;
		if (
			!iterable ||
			!bindingSource ||
			offset === undefined ||
			offset >= toolOffset
		) {
			continue;
		}
		const expansionBindings = parseExpansionBindings(bindingSource);
		if (expansionBindings.length === 0) continue;
		const openingParenthesis = codeMask.indexOf("(", offset);
		const closingParenthesis = findMatchingDelimiter(
			codeMask,
			openingParenthesis,
			"(",
			")",
		);
		if (
			openingParenthesis === -1 ||
			closingParenthesis === undefined ||
			toolOffset >= closingParenthesis
		) {
			continue;
		}
		expansions.push({
			bindings: expansionBindings,
			entries: false,
			iterable,
			offset,
			values: undefined,
		});
	}
	return expansions;
}

function findEnclosingForExpansions(toolOffset: number, codeMask: string) {
	const expansions: LiteralExpansion[] = [];
	for (const match of codeMask.matchAll(FOR_OF_PREFIX_PATTERN)) {
		const bindingSource = match[1];
		const iterable = match[2];
		const entries = match[3] !== undefined;
		const offset = match.index;
		if (
			!iterable ||
			!bindingSource ||
			offset === undefined ||
			offset >= toolOffset
		) {
			continue;
		}
		const expansionBindings = parseExpansionBindings(bindingSource);
		if (expansionBindings.length === 0) continue;
		const bodyStart = skipMaskedWhitespace(codeMask, offset + match[0].length);
		const bodyEnd =
			codeMask[bodyStart] === "{"
				? findMatchingDelimiter(codeMask, bodyStart, "{", "}")
				: codeMask.indexOf(";", bodyStart);
		if (bodyEnd === undefined || bodyEnd === -1 || toolOffset >= bodyEnd) {
			continue;
		}
		expansions.push({
			bindings: expansionBindings,
			entries,
			iterable,
			offset,
			values: undefined,
		});
	}
	return expansions;
}

function skipMaskedWhitespace(source: string, start: number) {
	let index = start;
	while (index < source.length && /\s/u.test(source[index] ?? "")) {
		index += 1;
	}
	return index;
}

function toInvocationInput(
	parsed: ParsedExpression | undefined,
	rawArgument: string,
): {
	input: Readonly<Record<string, unknown>>;
	resolved: boolean;
} {
	if (parsed?.resolved === true) {
		const record = readRecord(parsed.value);
		if (record) {
			return { input: record, resolved: true };
		}
		if (typeof parsed.value === "string") {
			return { input: { input: parsed.value }, resolved: true };
		}
	}
	return {
		input: rawArgument ? { unresolved_argument: rawArgument } : {},
		resolved: false,
	};
}

function parseExpression(
	source: string,
	start: number,
	environment: LiteralEnvironment,
): ParsedExpression | undefined {
	const index = skipWhitespaceAndComments(source, start);
	const character = source[index];
	if (character === "{" || character === "[") {
		return parseCollection(source, index, character, environment);
	}
	if (character === "`") {
		return parseTemplateString(source, index, environment);
	}
	if (character === '"' || character === "'") {
		return parseString(source, index, character);
	}

	const identifier = /^[A-Za-z_$][\w$]*/u.exec(source.slice(index))?.[0];
	if (identifier) {
		const primitive = readPrimitive(identifier);
		if (primitive.matched) {
			return {
				end: index + identifier.length,
				resolved: true,
				value: primitive.value,
			};
		}
		const parsedIdentifier =
			environment.get(identifier) !== undefined
				? {
						end: index + identifier.length,
						resolved: true,
						value: environment.get(identifier),
					}
				: {
						end: index + identifier.length,
						resolved: false,
						value: undefined,
					};
		return parseStringTransform(source, parsedIdentifier, environment);
	}

	const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?/u.exec(source.slice(index))?.[0];
	return number
		? { end: index + number.length, resolved: true, value: Number(number) }
		: undefined;
}

function parseTemplateString(
	source: string,
	start: number,
	environment: LiteralEnvironment,
): ParsedExpression | undefined {
	let value = "";
	for (let index = start + 1; index < source.length; index += 1) {
		const character = source[index] ?? "";
		if (character === "`") {
			return { end: index + 1, resolved: true, value };
		}
		if (character === "$" && source[index + 1] === "{") {
			const expression = parseExpression(source, index + 2, environment);
			if (!expression?.resolved || typeof expression.value !== "string") {
				return { end: index, resolved: false, value: undefined };
			}
			const closingBrace = skipWhitespaceAndComments(source, expression.end);
			if (source[closingBrace] !== "}") {
				return undefined;
			}
			value += expression.value;
			index = closingBrace;
			continue;
		}
		if (character !== "\\") {
			value += character;
			continue;
		}
		const escaped = source[index + 1];
		if (escaped === undefined) {
			return undefined;
		}
		value += decodeEscape(escaped);
		index += 1;
	}
	return undefined;
}

function parseStringTransform(
	source: string,
	base: ParsedExpression,
	environment: LiteralEnvironment,
): ParsedExpression {
	const transformStart = skipWhitespaceAndComments(source, base.end);
	const transform = /^\.replaceAll\s*\(/u.exec(source.slice(transformStart));
	if (!transform) {
		return base;
	}

	const firstArgument = parseExpression(
		source,
		transformStart + transform[0].length,
		environment,
	);
	if (!firstArgument) {
		return { end: base.end, resolved: false, value: undefined };
	}
	const comma = skipWhitespaceAndComments(source, firstArgument.end);
	if (source[comma] !== ",") {
		return { end: firstArgument.end, resolved: false, value: undefined };
	}
	const secondArgument = parseExpression(source, comma + 1, environment);
	if (!secondArgument) {
		return { end: comma + 1, resolved: false, value: undefined };
	}
	const closingParenthesis = skipWhitespaceAndComments(
		source,
		secondArgument.end,
	);
	const end =
		source[closingParenthesis] === ")"
			? closingParenthesis + 1
			: secondArgument.end;
	if (
		source[closingParenthesis] !== ")" ||
		!base.resolved ||
		typeof base.value !== "string" ||
		!firstArgument.resolved ||
		typeof firstArgument.value !== "string" ||
		!secondArgument.resolved ||
		typeof secondArgument.value !== "string"
	) {
		return { end, resolved: false, value: undefined };
	}
	return {
		end,
		resolved: true,
		value: base.value.replaceAll(firstArgument.value, secondArgument.value),
	};
}

function parseCollection(
	source: string,
	start: number,
	opener: "[" | "{",
	environment: LiteralEnvironment,
): ParsedExpression | undefined {
	const isArray = opener === "[";
	const closer = isArray ? "]" : "}";
	const arrayValues: unknown[] = [];
	const objectEntries: Array<[string, unknown]> = [];
	let resolved = true;
	let index = skipWhitespaceAndComments(source, start + 1);

	while (source[index] !== closer) {
		if (index >= source.length) {
			return undefined;
		}
		if (isArray) {
			const item = parseExpression(source, index, environment);
			if (!item) {
				return undefined;
			}
			arrayValues.push(item.value);
			resolved = resolved && item.resolved;
			index = skipWhitespaceAndComments(source, item.end);
		} else {
			const key = parseObjectKey(source, index);
			if (!key) {
				return undefined;
			}
			index = skipWhitespaceAndComments(source, key.end);
			let item: ParsedExpression | undefined;
			if (source[index] === ":") {
				item = parseExpression(source, index + 1, environment);
			} else if (source[index] === "," || source[index] === closer) {
				item =
					environment.get(key.value) !== undefined
						? {
								end: index,
								resolved: true,
								value: environment.get(key.value),
							}
						: { end: index, resolved: false, value: undefined };
			}
			if (!item) {
				return undefined;
			}
			objectEntries.push([key.value, item.value]);
			resolved = resolved && item.resolved;
			index = skipWhitespaceAndComments(source, item.end);
		}
		if (source[index] === ",") {
			index = skipWhitespaceAndComments(source, index + 1);
			if (source[index] === closer) {
				break;
			}
			continue;
		}
		if (source[index] !== closer) {
			return undefined;
		}
	}

	return {
		end: index + 1,
		resolved,
		value: isArray ? arrayValues : Object.fromEntries(objectEntries),
	};
}

function parseObjectKey(
	source: string,
	start: number,
): { end: number; value: string } | undefined {
	const index = skipWhitespaceAndComments(source, start);
	const character = source[index];
	if (character === '"' || character === "'") {
		const parsed = parseString(source, index, character);
		return parsed && typeof parsed.value === "string"
			? { end: parsed.end, value: parsed.value }
			: undefined;
	}
	const identifier = /^[A-Za-z_$][\w$]*/u.exec(source.slice(index))?.[0];
	return identifier
		? { end: index + identifier.length, value: identifier }
		: undefined;
}

function parseString(
	source: string,
	start: number,
	quote: '"' | "'" | "`",
): ParsedExpression | undefined {
	let value = "";
	for (let index = start + 1; index < source.length; index++) {
		const character = source[index] ?? "";
		if (character === quote) {
			return { end: index + 1, resolved: true, value };
		}
		if (quote === "`" && character === "$" && source[index + 1] === "{") {
			return { end: index, resolved: false, value: undefined };
		}
		if (character !== "\\") {
			value += character;
			continue;
		}
		const escaped = source[index + 1];
		if (escaped === undefined) {
			return undefined;
		}
		value += decodeEscape(escaped);
		index += 1;
	}
	return undefined;
}

function readPrimitive(identifier: string): {
	matched: boolean;
	value: unknown;
} {
	if (identifier === "true") {
		return { matched: true, value: true };
	}
	if (identifier === "false") {
		return { matched: true, value: false };
	}
	if (identifier === "null") {
		return { matched: true, value: null };
	}
	return { matched: false, value: undefined };
}

function decodeEscape(value: string) {
	const escapes: Readonly<Record<string, string>> = {
		"0": "\0",
		b: "\b",
		f: "\f",
		n: "\n",
		r: "\r",
		t: "\t",
		v: "\v",
	};
	return escapes[value] ?? value;
}

/**
 * Preserves executable-token offsets while masking comments, string/template
 * text, and regular-expression literals. Template interpolations remain code.
 */
export function maskJavaScriptNonCode(source: string) {
	// Source offsets are UTF-16 code-unit offsets. Splitting by code point shifts every
	// later index when a string contains an emoji and can hide a valid tool call.
	const characters = source.split("");
	scanJavaScriptSegment(characters, source, 0, false);
	return characters.join("");
}

function scanJavaScriptSegment(
	characters: string[],
	source: string,
	start: number,
	stopAtInterpolationEnd: boolean,
) {
	let interpolationDepth = stopAtInterpolationEnd ? 1 : 0;
	let index = start;
	while (index < source.length) {
		const character = source[index] ?? "";
		const next = source[index + 1] ?? "";
		if (character === "/" && next === "/") {
			index = maskLineComment(characters, source, index);
			continue;
		}
		if (character === "/" && next === "*") {
			index = maskBlockComment(characters, source, index);
			continue;
		}
		if (character === '"' || character === "'") {
			index = maskString(characters, source, index, character);
			continue;
		}
		if (character === "`") {
			index = maskTemplateLiteral(characters, source, index);
			continue;
		}
		if (
			character === "/" &&
			next !== "/" &&
			next !== "*" &&
			isRegexLiteralStart(characters, index)
		) {
			index = maskRegexLiteral(characters, source, index);
			continue;
		}
		if (stopAtInterpolationEnd && character === "{") {
			interpolationDepth += 1;
		} else if (stopAtInterpolationEnd && character === "}") {
			interpolationDepth -= 1;
			if (interpolationDepth === 0) {
				return index + 1;
			}
		}
		index += 1;
	}
	return index;
}

function maskLineComment(characters: string[], source: string, start: number) {
	let index = start;
	while (index < source.length && source[index] !== "\n") {
		characters[index] = " ";
		index += 1;
	}
	return index;
}

function maskBlockComment(characters: string[], source: string, start: number) {
	let index = start;
	while (index < source.length) {
		const isEnd = source[index] === "*" && source[index + 1] === "/";
		characters[index] = " ";
		if (isEnd) {
			characters[index + 1] = " ";
			return index + 2;
		}
		index += 1;
	}
	return index;
}

function maskString(
	characters: string[],
	source: string,
	start: number,
	quote: '"' | "'" | "`",
) {
	let escaped = false;
	for (let index = start; index < source.length; index++) {
		const character = source[index] ?? "";
		characters[index] =
			index === start || (!escaped && index > start && character === quote)
				? character
				: character === "\n"
					? "\n"
					: " ";
		if (index === start) {
			continue;
		}
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			continue;
		}
		if (character === quote) {
			return index + 1;
		}
	}
	return source.length;
}

function maskTemplateLiteral(
	characters: string[],
	source: string,
	start: number,
) {
	characters[start] = "`";
	let index = start + 1;
	while (index < source.length) {
		const character = source[index] ?? "";
		const next = source[index + 1] ?? "";
		if (character === "\\") {
			characters[index] = " ";
			if (index + 1 < source.length) {
				characters[index + 1] = next === "\n" ? "\n" : " ";
			}
			index += 2;
			continue;
		}
		if (character === "`") {
			characters[index] = "`";
			return index + 1;
		}
		if (character === "$" && next === "{") {
			characters[index] = " ";
			characters[index + 1] = "{";
			index = scanJavaScriptSegment(characters, source, index + 2, true);
			continue;
		}
		characters[index] = character === "\n" ? "\n" : " ";
		index += 1;
	}
	return source.length;
}

function isRegexLiteralStart(characters: readonly string[], offset: number) {
	const previous = readPreviousJavaScriptToken(characters, offset);
	if (!previous) {
		return true;
	}
	if (
		previous.kind === "punctuator" &&
		/[([{,:;=!?&|+\-*%^~<>]/u.test(previous.value)
	) {
		return true;
	}
	if (previous.value === ")") {
		const openingParenthesis = findOpeningDelimiter(
			characters,
			previous.start,
			"(",
			")",
		);
		const controlToken =
			openingParenthesis === undefined
				? undefined
				: readPreviousJavaScriptToken(characters, openingParenthesis);
		return (
			controlToken?.kind === "identifier" &&
			["catch", "for", "if", "switch", "while", "with"].includes(
				controlToken.value,
			)
		);
	}
	return (
		previous.kind === "identifier" &&
		[
			"await",
			"case",
			"delete",
			"do",
			"else",
			"return",
			"throw",
			"typeof",
			"void",
			"yield",
		].includes(previous.value)
	);
}

type JavaScriptToken = {
	kind: "identifier" | "punctuator";
	start: number;
	value: string;
};

function readPreviousJavaScriptToken(
	characters: readonly string[],
	offset: number,
): JavaScriptToken | undefined {
	let index = offset - 1;
	while (index >= 0 && /\s/u.test(characters[index] ?? "")) {
		index -= 1;
	}
	if (index < 0) {
		return undefined;
	}
	const value = characters[index] ?? "";
	if (!/[A-Za-z0-9_$]/u.test(value)) {
		return { kind: "punctuator", start: index, value };
	}
	const end = index + 1;
	while (index >= 0 && /[A-Za-z0-9_$]/u.test(characters[index] ?? "")) {
		index -= 1;
	}
	return {
		kind: "identifier",
		start: index + 1,
		value: characters.slice(index + 1, end).join(""),
	};
}

function findOpeningDelimiter(
	characters: readonly string[],
	start: number,
	opener: string,
	closer: string,
) {
	let depth = 0;
	for (let index = start; index >= 0; index -= 1) {
		if (characters[index] === closer) {
			depth += 1;
		} else if (characters[index] === opener) {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}
	return undefined;
}

function maskRegexLiteral(characters: string[], source: string, start: number) {
	let escaped = false;
	let characterClass = false;
	let index = start;
	while (index < source.length) {
		const character = source[index] ?? "";
		characters[index] = character === "\n" ? "\n" : " ";
		if (index === start) {
			index += 1;
			continue;
		}
		if (character === "\n" || character === "\r") {
			return index;
		}
		if (escaped) {
			escaped = false;
			index += 1;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			index += 1;
			continue;
		}
		if (character === "[") {
			characterClass = true;
		} else if (character === "]") {
			characterClass = false;
		} else if (character === "/" && !characterClass) {
			index += 1;
			while (/[A-Za-z]/u.test(source[index] ?? "")) {
				characters[index] = " ";
				index += 1;
			}
			return index;
		}
		index += 1;
	}
	return source.length;
}

function findMatchingDelimiter(
	codeMask: string,
	start: number,
	opener: string,
	closer: string,
) {
	if (start < 0 || codeMask[start] !== opener) {
		return undefined;
	}
	let depth = 0;
	for (let index = start; index < codeMask.length; index++) {
		const character = codeMask[index];
		if (character === opener) {
			depth += 1;
		} else if (character === closer) {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}
	return undefined;
}

function skipWhitespaceAndComments(source: string, start: number): number {
	let index = start;
	while (index < source.length) {
		if (/\s/u.test(source[index] ?? "")) {
			index += 1;
			continue;
		}
		if (source.startsWith("//", index)) {
			const newline = source.indexOf("\n", index + 2);
			index = newline === -1 ? source.length : newline + 1;
			continue;
		}
		if (source.startsWith("/*", index)) {
			const end = source.indexOf("*/", index + 2);
			index = end === -1 ? source.length : end + 2;
			continue;
		}
		break;
	}
	return index;
}

function readRecord(
	value: unknown,
): Readonly<Record<string, unknown>> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: undefined;
}
