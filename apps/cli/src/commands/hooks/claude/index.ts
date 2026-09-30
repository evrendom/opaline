import { buildRouteMap } from "@stricli/core";
import { sessionEndCommand } from "./session-end.js";
import { sessionStartCommand } from "./session-start.js";

export const claudeRouteMap = buildRouteMap({
	routes: {
		"session-end": sessionEndCommand,
		"session-start": sessionStartCommand,
	},
	docs: {
		brief: "Claude Code hook handlers",
	},
});
