import { redactReturnedValue } from "@rudel/secret-filter";
import type { McpTool } from "./mcp-tools.js";

/**
 * A tool whose every returned string (model text, structured content and the
 * app's data) has known secret formats and credential-like values replaced
 * by `[redacted]`. Every MCP tool is served through this, so session text
 * and stored answer evidence never leave with a credential in them, whatever
 * was stored before.
 */
export function withRedactedOutput(tool: McpTool): McpTool {
	return {
		...tool,
		run: async (client, args, context) =>
			redactReturnedValue(await tool.run(client, args, context)),
	};
}
