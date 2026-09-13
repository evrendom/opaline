/** Recover literal commands around opaque pipelines and control-flow blocks, without evaluation. */
export function splitShellCommands(
	input: string,
): readonly string[] | undefined {
	const source = stripShellComments(input);
	const commands: string[] = [];
	let start = 0;
	let quote: string | undefined;
	let escaped = false;
	let parentheses = 0;
	for (let index = 0; index < source.length; index++) {
		const character = source[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (quote === "'") {
			if (character === quote) quote = undefined;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			continue;
		}
		if (character === "'" || character === '"' || character === "`") {
			quote = character;
			continue;
		}
		// A here-document can contain apparent commands that are only data.
		if (character === "<" && source[index + 1] === "<") return undefined;
		if (character === "(" || character === "{") parentheses++;
		if (character === ")" || character === "}") parentheses--;
		if (parentheses < 0) return undefined;
		const doubled =
			(character === "&" || character === "|") &&
			source[index + 1] === character;
		if (
			parentheses === 0 &&
			(character === ";" || character === "\n" || doubled)
		) {
			const command = source.slice(start, index).trim();
			if (command) commands.push(command);
			if (doubled) index++;
			start = index + 1;
		}
	}
	if (quote || escaped || parentheses) return undefined;
	const last = source.slice(start).trim();
	if (last) commands.push(last);
	return groupControlFlow(commands);
}

function groupControlFlow(
	commands: readonly string[],
): readonly string[] | undefined {
	const grouped: string[] = [];
	let depth = 0;
	let block: string[] = [];
	for (const command of commands) {
		if (/^(?:if|for|while|until|case|select)\b/u.test(command)) depth++;
		if (/^(?:fi|done|esac)\b/u.test(command)) depth--;
		if (depth < 0) return undefined;
		if (depth > 0 || block.length > 0) {
			block.push(command);
			if (depth === 0) {
				grouped.push(block.join("; "));
				block = [];
			}
		} else grouped.push(command);
	}
	return depth === 0 ? grouped : undefined;
}

function stripShellComments(source: string): string {
	let quote: string | undefined;
	let escaped = false;
	let comment = false;
	let result = "";
	for (let index = 0; index < source.length; index++) {
		const character = source[index] ?? "";
		if (comment && character !== "\n") {
			result += " ";
			continue;
		}
		if (character === "\n") comment = false;
		if (escaped) {
			result += character;
			escaped = false;
			continue;
		}
		if (quote === "'") {
			if (character === quote) quote = undefined;
			result += character;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			result += character;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			result += character;
			continue;
		}
		if (character === "'" || character === '"' || character === "`")
			quote = character;
		if (
			character === "#" &&
			(index === 0 || /[\s;&|()]/u.test(source[index - 1] ?? ""))
		) {
			comment = true;
			result += " ";
			continue;
		}
		result += character;
	}
	return result;
}
