import type { RepositoryMcpTool, RepositorySetupFile } from "@rudel/api-routes";
import { setupName } from "@/features/sessions/reader/setup/session-setup-files";

export type RepoSetupSection = "instructions" | "skills" | "mcp";

export const CALLED_SCOPE = "called";

export function sectionOf(file: RepositorySetupFile): RepoSetupSection {
	if (file.kind === "skill_body") return "skills";
	if (file.kind === "mcp_instructions") return "mcp";
	return "instructions";
}

export function toolsOf(
	owner: string,
	tools: readonly RepositoryMcpTool[],
): { name: string; calls: number }[] {
	const key = owner.replace(/[^A-Za-z0-9_-]/gu, "_");
	const calls = new Map<string, number>();
	for (const tool of tools) {
		if (tool.server !== key && !tool.server.endsWith(`_${key}`)) continue;
		const name = tool.tool.split("__").at(-1) ?? tool.tool;
		calls.set(name, (calls.get(name) ?? 0) + tool.calls);
	}
	return [...calls]
		.map(([name, count]) => ({ name, calls: count }))
		.sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}

export function calledOnly(
	tools: readonly RepositoryMcpTool[],
	connected: readonly RepositorySetupFile[],
): RepositorySetupFile[] {
	const servers = new Map<string, { calls: number; sessions: number }>();
	for (const tool of tools) {
		if (connected.some((file) => toolsOf(file.owner, [tool]).length > 0))
			continue;
		const seen = servers.get(tool.server) ?? { calls: 0, sessions: 0 };
		servers.set(tool.server, {
			calls: seen.calls + tool.calls,
			sessions: Math.max(seen.sessions, tool.sessions),
		});
	}
	return [...servers]
		.sort(([a, x], [b, y]) => y.calls - x.calls || a.localeCompare(b))
		.map(([server, { sessions }]) => ({
			chars: 0,
			firstAt: "",
			kind: "mcp_instructions",
			lastAt: "",
			owner: server,
			path: "",
			runs: 0,
			scope: "mcp",
			sessions,
			setupFile: `${CALLED_SCOPE}:${server}`,
			subagents: false,
			versions: 1,
		}));
}

export type McpServer = {
	calls: number;
	connected: boolean;
	file: RepositorySetupFile;
	name: string;
	sessions: number;
	tools: { name: string; calls: number }[];
};

export function mcpServers(
	files: readonly RepositorySetupFile[],
	tools: readonly RepositoryMcpTool[],
): McpServer[] {
	const connected = files.filter((file) => sectionOf(file) === "mcp");
	return [
		...connected.map((file) => ({ connected: true, file })),
		...calledOnly(tools, connected).map((file) => ({
			connected: false,
			file,
		})),
	].map(({ connected: sent, file }) => {
		const used = toolsOf(file.owner, tools);
		return {
			calls: used.reduce((sum, tool) => sum + tool.calls, 0),
			connected: sent,
			file,
			name: setupName(file),
			sessions: file.sessions,
			tools: used,
		};
	});
}
