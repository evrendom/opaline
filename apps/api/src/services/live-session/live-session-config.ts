import { listsWorkspace } from "../analysis-log/config.js";

/** How long a CLI pauses live updates after `LIVE_SESSIONS_DISABLED`. */
export const LIVE_SESSIONS_PAUSE_SECONDS = 3_600;

/**
 * The global kill switch: only the exact value `false` of
 * `LIVE_SESSIONS_ENABLED` turns live sessions off (the CLI capability is
 * withdrawn and `liveSession.*` answers `LIVE_SESSIONS_DISABLED`).
 */
export function isLiveSessionsEnabled(): boolean {
	return process.env.LIVE_SESSIONS_ENABLED !== "false";
}

/**
 * Whether live sessions are on for the workspace: every workspace when
 * `LIVE_SESSIONS_WORKSPACES` is unset or empty; otherwise only those it lists
 * (comma-separated ids, or `*`). An invalid list enables nobody.
 */
export function isLiveSessionsWorkspaceEnabled(
	organizationId: string,
): boolean {
	if (!process.env.LIVE_SESSIONS_WORKSPACES?.trim()) return true;
	return listsWorkspace("LIVE_SESSIONS_WORKSPACES", organizationId, false);
}
