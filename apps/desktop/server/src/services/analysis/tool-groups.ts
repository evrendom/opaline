/**
 * Tool groups normalize Claude and Codex tool names so both agents mean the
 * same thing by "read" or "search". Shell calls are split by the command's
 * first word (Codex code-mode `exec` counts as shell). This table is the
 * only definition; SQL is generated from it.
 */
export const TOOL_GROUPS = [
	"shell",
	"edit",
	"read",
	"search",
	"browser",
	"web",
	"mcp",
	"subagent",
	"other",
] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

const SHELL_TOOLS = [
	"bash",
	"exec",
	"exec_command",
	"shell",
	"local_shell",
	"write_stdin",
];
const SHELL_READ = "^(cat|head|tail|less)(\\s|$)|^sed\\s+-n(\\s|$)";
const SHELL_SEARCH = "^(rg|grep|find|fd|ls)(\\s|$)";
const BROWSER = "playwright|chrome|browser";
const NAMED: readonly (readonly [ToolGroup, readonly string[]])[] = [
	["edit", ["edit", "write", "multiedit", "notebookedit", "apply_patch"]],
	["read", ["read"]],
	["search", ["grep", "glob", "ls"]],
	["web", ["webfetch", "websearch", "web_search"]],
	["subagent", ["task", "agent", "spawn_agent"]],
];

/** SQL expression for the tool group of a tool name and its command text. */
export function toolGroupSql(toolExpr: string, commandExpr: string): string {
	const name = `replaceRegexpOne(lower(${toolExpr}), '^functions\\\\.', '')`;
	const command = `trimBoth(${commandExpr})`;
	const named = NAMED.map(
		([group, tools]) => `${name} IN (${sqlList(tools)}), '${group}'`,
	).join(", ");
	return `multiIf(
		match(${name}, '${BROWSER}'), 'browser',
		${name} IN (${sqlList(SHELL_TOOLS)}), multiIf(
			match(${command}, '${sqlRegex(SHELL_READ)}'), 'read',
			match(${command}, '${sqlRegex(SHELL_SEARCH)}'), 'search',
			'shell'),
		${named},
		startsWith(${name}, 'mcp__'), 'mcp',
		'other')`;
}

/**
 * True for a native edit tool by name (Claude Edit, Write, MultiEdit,
 * NotebookEdit; Codex apply_patch): the tools whose own request is evidence of
 * the edit when the call succeeds. Shell tools are never in this set.
 */
export function nativeEditToolSql(toolExpr: string): string {
	const tools = NAMED.find(([group]) => group === "edit")?.[1] ?? [];
	return `replaceRegexpOne(lower(${toolExpr}), '^functions\\\\.', '') IN (${sqlList(tools)})`;
}

export const SHELL_EDIT_ROUTES: readonly (readonly [string, string])[] = [
	["apply_patch (shell)", String.raw`\bapply_patch\b`],
	["cat/tee > file", String.raw`\bcat\s*>{1,2}|\btee\b`],
	["sed/perl -i", String.raw`\b(sed|perl)\s+(-[a-zA-Z]*i|--in-place)`],
	[
		"interpreter command",
		String.raw`(^|[;&|(]\s*|\s)(python3?|node|bun|deno|ruby|tsx)\b`,
	],
	["echo/printf > file", String.raw`\b(echo|printf)\b[^|;&]*>`],
];

export const SCRIPT_EDIT_ROUTE = "python inline script";

export const OTHER_SHELL_EDIT_ROUTE = "other shell (rm, mv, cp, git, …)";

export function editRouteSql(call: {
	tool: string;
	from: string;
	head: string;
	files: string;
	basis: string;
}): string {
	const shell = SHELL_EDIT_ROUTES.map(
		([name, pattern]) =>
			`match(${call.head}, ${sqlQuote(pattern)}), ${sqlQuote(name)}`,
	).join(",\n\t\t\t");
	return `multiIf(empty(${call.files}), '',
			${nativeEditToolSql(call.tool)}, concat('edit tool ', ${call.tool}),
			${call.from} = 'script', 'code-mode script',
			has(${call.basis}, 'script'), ${sqlQuote(SCRIPT_EDIT_ROUTE)},
			${call.head} IS NULL, concat('other tool ', ${call.tool}),
			${shell},
			${sqlQuote(OTHER_SHELL_EDIT_ROUTE)})`;
}

/** True for a tool that starts a subagent (the `subagent` group: Claude Task and Agent, Codex spawn_agent). */
export function isSubagentTool(tool: string): boolean {
	const tools = NAMED.find(([group]) => group === "subagent")?.[1] ?? [];
	return tools.includes(tool.toLowerCase().replace(/^functions\./u, ""));
}

export function toolActivitySql(
	group: "read" | "search",
	fallback: string,
): string {
	return `if(parser_version >= 9 AND c.has_parsed_cmd, has(c.parsed_types, '${group}'), ${fallback} = '${group}')`;
}

function sqlList(values: readonly string[]): string {
	return values.map((value) => `'${value}'`).join(", ");
}

function sqlQuote(value: string): string {
	return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function sqlRegex(pattern: string): string {
	return pattern.replaceAll("\\", "\\\\");
}
