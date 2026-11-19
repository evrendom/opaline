export function mcpTool(
	toolName: string,
): { server: string; tool: string } | null {
	const match = /^mcp__(.+?)__(.+)$/u.exec(toolName);
	if (!match) return null;
	// Plugins and claude.ai connectors prefix their servers, a plugin's
	// often its name twice (`plugin_opaline_opaline`).
	const raw = (match[1] ?? "").replace(/^(?:plugin_|claude_ai_)/u, "");
	const halves = raw.split("_");
	const half = halves.length / 2;
	const server =
		halves.length % 2 === 0 &&
		halves.slice(0, half).join("_") === halves.slice(half).join("_")
			? halves.slice(0, half).join("_")
			: raw;
	return {
		server: server.replaceAll("_", " "),
		tool: (match[2] ?? "").replaceAll("_", " "),
	};
}

export function mcpResult(result: string | null): string | null {
	if (!result?.trimStart().startsWith("{")) return result;
	let parsed: unknown;
	try {
		parsed = JSON.parse(result);
	} catch {
		return result;
	}
	if (
		parsed === null ||
		typeof parsed !== "object" ||
		Array.isArray(parsed) ||
		!("toolIcon" in parsed)
	)
		return result;
	const { toolIcon: _, ...rest } = parsed as Record<string, unknown>;
	const keys = Object.keys(rest);
	const inner = keys.length === 1 && keys[0] === "value" ? rest.value : rest;
	return typeof inner === "string" ? inner : JSON.stringify(inner);
}
