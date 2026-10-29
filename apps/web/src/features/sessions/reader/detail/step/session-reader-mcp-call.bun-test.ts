import { describe, expect, test } from "bun:test";
import { mcpResult, mcpTool } from "../../model/session-reader-mcp-tool";

describe("mcpTool", () => {
	test("names the server and tool, a plugin's doubled name once", () => {
		expect(mcpTool("mcp__plugin_opaline_opaline__search_answers")).toEqual({
			server: "opaline",
			tool: "search answers",
		});
		expect(mcpTool("mcp__claude_ai_Gmail__search_threads")).toEqual({
			server: "Gmail",
			tool: "search threads",
		});
		expect(mcpTool("mcp__posthog__exec")).toEqual({
			server: "posthog",
			tool: "exec",
		});
	});

	test("a tool that isn't an MCP server's is null", () => {
		expect(mcpTool("Bash")).toBeNull();
		expect(mcpTool("exec_command")).toBeNull();
	});
});

test("a host's envelope comes off an MCP call's result", () => {
	expect(
		mcpResult(
			JSON.stringify({
				toolIcon: { _tag: "website", pageUrl: "http://localhost:4321" },
				value: { label: "Difference", size: [16, 16] },
			}),
		),
	).toBe(JSON.stringify({ label: "Difference", size: [16, 16] }));
	expect(mcpResult('{"rows":[1]}')).toBe('{"rows":[1]}');
	expect(mcpResult("plain text")).toBe("plain text");
});
