/**
 * Gemini CLI and Antigravity name their tools differently from Claude Code.
 * Opaline reads every transcript through Claude Code's tool vocabulary (Codex
 * is translated the same way), so the common tools are renamed here and their
 * arguments reshaped to Claude Code's. A tool with no Claude Code counterpart
 * keeps its own name and arguments.
 */

export interface TranslatedToolCall {
	readonly name: string;
	readonly input: Record<string, unknown>;
}

type Args = Record<string, unknown>;

function text(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function count(value: unknown): number | undefined {
	const number =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim() !== ""
				? Number(value)
				: Number.NaN;
	return Number.isSafeInteger(number) ? number : undefined;
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(input).filter(([, value]) => value !== undefined),
	);
}

/** Claude Code's Read takes offset (1-based first line) and limit. */
function lineRange(
	start: number | undefined,
	end: number | undefined,
): { offset?: number; limit?: number } {
	if (start === undefined) return {};
	return {
		offset: start,
		limit: end !== undefined && end >= start ? end - start + 1 : undefined,
	};
}

const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/u;

const GEMINI_CLI_TODO_STATUS: Readonly<Record<string, string>> = {
	pending: "pending",
	in_progress: "in_progress",
	completed: "completed",
	cancelled: "completed",
};

function todos(value: unknown): unknown {
	if (!Array.isArray(value)) return value;
	return value.map((item) => {
		if (!item || typeof item !== "object") return item;
		const todo = item as Args;
		const content = text(todo.description) ?? text(todo.content) ?? "";
		return {
			content,
			status: GEMINI_CLI_TODO_STATUS[String(todo.status ?? "")] ?? "pending",
			activeForm: content,
		};
	});
}

/**
 * Gemini CLI and Antigravity name an MCP tool `mcp_<server>_<tool>`; Claude
 * Code's `mcp__<server>__<tool>` is what Opaline reads MCP use from. Server
 * names hold no underscores (they are dashed), so the first one ends it.
 */
export function mcpToolName(name: string): string {
	const match = /^mcp_([^_]+)_(.+)$/u.exec(name);
	return match ? `mcp__${match[1]}__${match[2]}` : name;
}

/** Gemini CLI (`~/.gemini/tmp/<project>/chats`). */
export function translateGeminiCliTool(
	name: string,
	args: Args,
): TranslatedToolCall {
	const path =
		text(args.file_path) ?? text(args.absolute_path) ?? text(args.path);
	switch (name) {
		case "run_shell_command":
			return {
				name: "Bash",
				input: compact({
					command: text(args.command) ?? "",
					description: text(args.description),
					run_in_background: args.is_background === true ? true : undefined,
				}),
			};
		case "read_file":
			return {
				name: "Read",
				input: compact({
					file_path: path ?? "",
					...lineRange(count(args.start_line), count(args.end_line)),
					...(args.start_line === undefined
						? { offset: count(args.offset), limit: count(args.limit) }
						: {}),
				}),
			};
		case "write_file":
			return {
				name: "Write",
				input: { file_path: path ?? "", content: text(args.content) ?? "" },
			};
		case "replace":
			return {
				name: "Edit",
				input: compact({
					file_path: path ?? "",
					old_string:
						typeof args.old_string === "string" ? args.old_string : "",
					new_string:
						typeof args.new_string === "string" ? args.new_string : "",
					replace_all:
						args.allow_multiple === true ||
						(count(args.expected_replacements) ?? 1) > 1
							? true
							: undefined,
				}),
			};
		case "glob":
			return {
				name: "Glob",
				input: compact({
					pattern: text(args.pattern) ?? "",
					path: text(args.dir_path) ?? text(args.path),
				}),
			};
		case "grep_search":
		case "search_file_content":
			return {
				name: "Grep",
				input: compact({
					pattern: text(args.pattern) ?? "",
					path: text(args.dir_path) ?? text(args.path),
					glob: text(args.include_pattern) ?? text(args.include),
				}),
			};
		case "list_directory":
			return {
				name: "LS",
				input: { path: text(args.dir_path) ?? text(args.path) ?? "" },
			};
		case "google_web_search":
			return { name: "WebSearch", input: { query: text(args.query) ?? "" } };
		case "web_fetch": {
			const prompt = text(args.prompt) ?? "";
			return {
				name: "WebFetch",
				input: compact({
					url: text(args.url) ?? URL_PATTERN.exec(prompt)?.[0] ?? "",
					prompt,
				}),
			};
		}
		case "write_todos":
			return { name: "TodoWrite", input: { todos: todos(args.todos) } };
		case "activate_skill":
			return { name: "Skill", input: { skill: text(args.name) ?? "" } };
		case "invoke_agent":
			return {
				name: "Task",
				input: {
					subagent_type: text(args.agent_name) ?? "",
					description: text(args.agent_name) ?? "",
					prompt: text(args.prompt) ?? "",
				},
			};
		case "enter_plan_mode":
			return {
				name: "EnterPlanMode",
				input: compact({ reason: text(args.reason) }),
			};
		case "exit_plan_mode":
			return {
				name: "ExitPlanMode",
				input: compact({ plan: text(args.plan_filename) }),
			};
		case "ask_user":
			return { name: "AskUserQuestion", input: { questions: args.questions } };
		default:
			return { name: mcpToolName(name), input: args };
	}
}

/**
 * Antigravity steps quote string arguments as JSON ("\"ls -la\""). Objects
 * and arrays may arrive as JSON text too.
 */
export function unquoteAntigravityArgs(args: unknown): Args {
	if (!args || typeof args !== "object" || Array.isArray(args)) return {};
	const out: Args = {};
	for (const [key, value] of Object.entries(args as Args)) {
		out[key] = unquote(value);
	}
	return out;
}

function unquote(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	const quoted =
		trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
	const structured =
		(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
		(trimmed.startsWith("[") && trimmed.endsWith("]"));
	if (!quoted && !structured) return value;
	try {
		return JSON.parse(trimmed);
	} catch {
		return quoted ? trimmed.slice(1, -1) : value;
	}
}

function chunks(value: unknown): { old_string: string; new_string: string }[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (!item || typeof item !== "object") return [];
		const chunk = item as Args;
		const oldString = text(chunk.TargetContent) ?? text(chunk.old_string);
		if (oldString === undefined) return [];
		return [
			{
				old_string: oldString,
				new_string:
					typeof chunk.ReplacementContent === "string"
						? chunk.ReplacementContent
						: typeof chunk.new_string === "string"
							? chunk.new_string
							: "",
			},
		];
	});
}

/** Antigravity (`<appData>/brain/<conversation>/.system_generated/logs`). */
export function translateAntigravityTool(
	name: string,
	rawArgs: unknown,
): TranslatedToolCall {
	const args = unquoteAntigravityArgs(rawArgs);
	const path =
		text(args.AbsolutePath) ??
		text(args.TargetFile) ??
		text(args.Path) ??
		text(args.FilePath) ??
		text(args.file_path);
	switch (name) {
		case "run_command":
			return {
				name: "Bash",
				input: compact({
					command: text(args.CommandLine) ?? text(args.command) ?? "",
					description: text(args.toolSummary) ?? text(args.toolAction),
					run_in_background: args.Blocking === false ? true : undefined,
				}),
			};
		case "view_file":
		case "read_file":
			return {
				name: "Read",
				input: compact({
					file_path: path ?? "",
					...lineRange(count(args.StartLine), count(args.EndLine)),
				}),
			};
		case "write_to_file":
		case "write_file":
			return {
				name: "Write",
				input: {
					file_path: path ?? "",
					content: text(args.CodeContent) ?? text(args.Content) ?? "",
				},
			};
		case "replace_file_content":
		case "multi_replace_file_content":
		case "edit_file": {
			const edits = chunks(args.ReplacementChunks);
			const single = text(args.TargetContent) ?? text(args.Target);
			if (single !== undefined)
				edits.unshift({
					old_string: single,
					new_string:
						typeof args.ReplacementContent === "string"
							? args.ReplacementContent
							: typeof args.Replacement === "string"
								? args.Replacement
								: "",
				});
			if (edits.length === 1 && edits[0])
				return {
					name: "Edit",
					input: { file_path: path ?? "", ...edits[0] },
				};
			return { name: "MultiEdit", input: { file_path: path ?? "", edits } };
		}
		case "grep_search":
			return {
				name: "Grep",
				input: compact({
					pattern: text(args.Query) ?? text(args.Pattern) ?? "",
					path: text(args.SearchPath) ?? text(args.SearchDirectory),
					glob: Array.isArray(args.Includes)
						? args.Includes.filter((item) => typeof item === "string").join(
								",",
							) || undefined
						: text(args.Includes),
				}),
			};
		case "find_by_name":
			return {
				name: "Glob",
				input: compact({
					pattern: text(args.Pattern) ?? "",
					path: text(args.SearchDirectory) ?? text(args.SearchPath),
				}),
			};
		case "list_dir":
			return {
				name: "LS",
				input: { path: text(args.DirectoryPath) ?? path ?? "" },
			};
		case "read_url_content":
			return { name: "WebFetch", input: { url: text(args.Url) ?? "" } };
		case "search_web":
			return {
				name: "WebSearch",
				input: { query: text(args.query) ?? text(args.Query) ?? "" },
			};
		case "invoke_subagent":
			return {
				name: "Task",
				input: {
					subagent_type:
						text(args.TypeName) ??
						text(args.AgentName) ??
						text(args.agent_name) ??
						"",
					description:
						text(args.Role) ??
						text(args.toolSummary) ??
						text(args.Description) ??
						"",
					prompt: text(args.Prompt) ?? text(args.prompt) ?? "",
				},
			};
		case "ask_question":
			return { name: "AskUserQuestion", input: { questions: args.questions } };
		default:
			return { name: mcpToolName(name), input: args };
	}
}
