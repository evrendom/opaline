import { isSelfHosted } from "../lib/self-hosted.js";

export function mcpOpenToEveryone(
	env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	return env.MCP_PLUGIN_PUBLIC === "true" || isSelfHosted(env);
}
