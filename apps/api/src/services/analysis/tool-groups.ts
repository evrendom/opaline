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

function sqlList(values: readonly string[]): string {
	return values.map((value) => `'${value}'`).join(", ");
}

function sqlRegex(pattern: string): string {
	return pattern.replaceAll("\\", "\\\\");
}
