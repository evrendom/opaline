import { getLogger } from "@logtape/logtape";
import { hasDesktopApp } from "../selfhost/desktop-app.js";
import {
	RETIRED_CLI_MCP_INSTRUCTION,
	type RetiredCli,
	retiredCli,
} from "../selfhost/retired-cli.js";

const logger = getLogger(["opaline", "api", "mcp"]);

export const SERVER_INSTRUCTIONS =
	"Opaline helps a team find where their coding agents get stuck or waste time, so they can fix their setup (instructions, docs, scripts, CI). No tool changes or deletes sessions. find and read record their calls in a private draft of the current analysis; save_answer publishes that draft once (saving is append-only) and share_answer shares a saved answer. Dates are UTC.";

/**
 * Sent on `initialize`. The Mac app's server adds one line while the retired
 * CLI is still installed, so the user's agent can offer to remove it.
 */
export function mcpInstructions(
	env: Readonly<Record<string, string | undefined>> = process.env,
	cli: Pick<RetiredCli, "present"> = retiredCli,
): string {
	if (!hasDesktopApp(env)) return SERVER_INSTRUCTIONS;
	let present = false;
	try {
		present = cli.present();
	} catch (error) {
		logger.warn("Could not look for the retired CLI: {error}", { error });
	}
	return present
		? `${SERVER_INSTRUCTIONS}\n${RETIRED_CLI_MCP_INSTRUCTION}`
		: SERVER_INSTRUCTIONS;
}
