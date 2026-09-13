import type { LineageProvider } from "./types.js";

export type ShellLaunchClassification =
	| {
			disposition: "launch";
			model: string | undefined;
			prompt: string;
			targetProvider: LineageProvider;
	  }
	| {
			disposition: "probe" | "resume" | "unresolved";
			targetProvider: LineageProvider | undefined;
	  };

const CLAUDE_VALUE_OPTIONS = new Set([
	"--add-dir",
	"--agents",
	"--allowedTools",
	"--append-system-prompt",
	"--betas",
	"--debug-file",
	"--disallowedTools",
	"--effort",
	"--fallback-model",
	"--json-schema",
	"--max-budget-usd",
	"--mcp-config",
	"--model",
	"--output-format",
	"--permission-mode",
	"--plugin-dir",
	"--setting-sources",
	"--settings",
	"--system-prompt",
	"--tools",
]);

const CODEX_VALUE_OPTIONS = new Set([
	"--cd",
	"--color",
	"--config",
	"--model",
	"--output-schema",
	"--profile",
	"--sandbox",
	"-C",
	"-c",
	"-m",
	"-p",
	"-s",
]);

const COMMAND_WRAPPERS = new Set(["command", "nohup", "time"]);

export function classifyShellLaunch(
	command: string,
): ShellLaunchClassification {
	for (const segment of tokenizeShellSegments(command)) {
		const executableIndex = findExecutableIndex(segment);
		const executable = segment[executableIndex];
		if (executable === "codex") {
			return classifyCodex(segment.slice(executableIndex));
		}
		if (executable === "claude") {
			return classifyClaude(segment.slice(executableIndex));
		}
	}
	return { disposition: "unresolved", targetProvider: undefined };
}

function classifyCodex(tokens: readonly string[]): ShellLaunchClassification {
	if (tokens.includes("--help") || tokens.includes("--version")) {
		return { disposition: "probe", targetProvider: "openai" };
	}
	const subcommandIndex = tokens.findIndex(
		(token, index) => index > 0 && (token === "exec" || token === "e"),
	);
	if (subcommandIndex === -1) {
		return { disposition: "probe", targetProvider: "openai" };
	}
	if (tokens[subcommandIndex + 1] === "resume") {
		return { disposition: "resume", targetProvider: "openai" };
	}
	const model = readOptionValue(tokens, "--model", "-m");
	const prompt = readFinalPositional(
		tokens,
		subcommandIndex + 1,
		CODEX_VALUE_OPTIONS,
	);
	return prompt
		? { disposition: "launch", model, prompt, targetProvider: "openai" }
		: { disposition: "unresolved", targetProvider: "openai" };
}

function classifyClaude(tokens: readonly string[]): ShellLaunchClassification {
	if (tokens.includes("--help") || tokens.includes("--version")) {
		return { disposition: "probe", targetProvider: "claude" };
	}
	if (
		tokens.includes("--resume") ||
		tokens.includes("-r") ||
		tokens.includes("--continue") ||
		tokens.includes("-c")
	) {
		return { disposition: "resume", targetProvider: "claude" };
	}
	if (!tokens.includes("--print") && !tokens.includes("-p")) {
		return { disposition: "probe", targetProvider: "claude" };
	}
	const model = readOptionValue(tokens, "--model");
	const prompt = readFinalPositional(tokens, 1, CLAUDE_VALUE_OPTIONS);
	return prompt
		? { disposition: "launch", model, prompt, targetProvider: "claude" }
		: { disposition: "unresolved", targetProvider: "claude" };
}

function readOptionValue(
	tokens: readonly string[],
	...optionNames: readonly string[]
): string | undefined {
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index] ?? "";
		for (const optionName of optionNames) {
			if (token === optionName) return tokens[index + 1];
			if (token.startsWith(`${optionName}=`)) {
				return token.slice(optionName.length + 1);
			}
		}
	}
	return undefined;
}

function readFinalPositional(
	tokens: readonly string[],
	start: number,
	valueOptions: ReadonlySet<string>,
): string | undefined {
	const positionals: string[] = [];
	let consumeAsValue = false;
	let afterDoubleDash = false;
	for (let index = start; index < tokens.length; index += 1) {
		const token = tokens[index] ?? "";
		if (consumeAsValue) {
			consumeAsValue = false;
			continue;
		}
		if (token === "--") {
			afterDoubleDash = true;
			continue;
		}
		if (!afterDoubleDash && valueOptions.has(token)) {
			consumeAsValue = true;
			continue;
		}
		if (!afterDoubleDash && token.startsWith("-")) continue;
		if (token !== "exec" && token !== "e") positionals.push(token);
	}
	return positionals.at(-1);
}

function findExecutableIndex(tokens: readonly string[]): number {
	let index = 0;
	if (tokens[index] === "env") {
		index += 1;
		while (index < tokens.length) {
			const token = tokens[index] ?? "";
			if (token === "-u" || token === "--unset") {
				index += 2;
				continue;
			}
			if (token.startsWith("--unset=")) {
				index += 1;
				continue;
			}
			if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(token) || token === "-i") {
				index += 1;
				continue;
			}
			break;
		}
	}
	while (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(tokens[index] ?? "")) index += 1;
	while (COMMAND_WRAPPERS.has(tokens[index] ?? "")) index += 1;
	return index;
}

function tokenizeShellSegments(
	command: string,
): readonly (readonly string[])[] {
	const segments: string[][] = [[]];
	let token = "";
	let quote: "double" | "single" | undefined;
	let escaped = false;
	const pushToken = () => {
		if (token.length === 0) return;
		segments.at(-1)?.push(token);
		token = "";
	};
	const pushSegment = () => {
		pushToken();
		if ((segments.at(-1)?.length ?? 0) > 0) segments.push([]);
	};

	for (let index = 0; index < command.length; index += 1) {
		const character = command[index] ?? "";
		if (escaped) {
			token += character;
			escaped = false;
			continue;
		}
		if (quote === "single") {
			if (character === "'") quote = undefined;
			else token += character;
			continue;
		}
		if (quote === "double") {
			if (character === '"') quote = undefined;
			else if (character === "\\") escaped = true;
			else token += character;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			continue;
		}
		if (character === "'") {
			quote = "single";
			continue;
		}
		if (character === '"') {
			quote = "double";
			continue;
		}
		if (/\s/u.test(character)) {
			pushToken();
			if (character === "\n") pushSegment();
			continue;
		}
		if (character === ">" || character === "<") {
			if (/^\d+$/u.test(token)) token = "";
			pushSegment();
			while ([">", "<", "&"].includes(command[index + 1] ?? "")) {
				index += 1;
			}
			continue;
		}
		if (character === ";" || character === "|" || character === "&") {
			pushSegment();
			while (command[index + 1] === character) index += 1;
			continue;
		}
		token += character;
	}
	pushToken();
	return segments.filter((segment) => segment.length > 0);
}
