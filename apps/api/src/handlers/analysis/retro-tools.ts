import { ORPCError } from "@orpc/server";
import {
	RETRO_TOOLS_OFF,
	retroToolsEnabled,
} from "../../services/analysis/retro-tools.js";

/**
 * Refuses a retro tool where the workspace does not have them yet
 * (`retroToolsEnabled`), before it takes a query slot. The workspace is the
 * caller's active one, as every analysis procedure decides it; the MCP tools
 * call these procedures, so the refusal covers both entry points.
 */
export function requireRetroTools(context: { organizationId: string }): void {
	if (!retroToolsEnabled(context.organizationId))
		throw new ORPCError("FORBIDDEN", {
			message: RETRO_TOOLS_OFF,
			data: { kind: "fatal" },
		});
}
