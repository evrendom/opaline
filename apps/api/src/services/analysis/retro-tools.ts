import { getLogger } from "@logtape/logtape";
import { isSelfHosted } from "../../lib/self-hosted.js";
import { listsWorkspace } from "../analysis-log/config.js";

const logger = getLogger(["rudel", "api", "retro-tools"]);

/**
 * The retro tools (schema, sql, search, run, estimate_questions,
 * run_questions; docs/retro-architecture.md) are rolled out to a few
 * workspaces first; every other workspace keeps answering with find and
 * read. Saved answers, dashboards and workspace tools stay open to all.
 */

/** What a workspace without the retro tools is told: fatal, so agents do not retry. */
export const RETRO_TOOLS_OFF =
	"refused, do not retry: The retro tools are not enabled for this workspace yet; use find and read.";

export interface RetroWorkspace {
	readonly id: string;
	readonly createdAt: Date | string | null;
}

/**
 * Whether a workspace may call the retro tools: Opaline's own workspace
 * (`VITE_ADMIN_ORGANIZATION_ID`) always; every workspace created on or after
 * `RETRO_TOOLS_NEW_SINCE` (an ISO date or UTC time); and those
 * `RETRO_TOOLS_WORKSPACES` lists (comma-separated ids, or `*` for every
 * workspace). `*` mixed with ids, or an invalid date, is logged and adds
 * nobody.
 */
export function retroToolsEnabled(workspace: RetroWorkspace): boolean {
	if (workspace.id === "") return false;
	if (isSelfHosted()) return true;
	const team = process.env.VITE_ADMIN_ORGANIZATION_ID?.trim();
	if (team && workspace.id === team) return true;
	const since = retroToolsNewSince();
	if (since !== null && workspace.createdAt !== null)
		if (new Date(workspace.createdAt).getTime() >= since.getTime()) return true;
	if (!process.env.RETRO_TOOLS_WORKSPACES?.trim()) return false;
	return listsWorkspace("RETRO_TOOLS_WORKSPACES", workspace.id, false);
}

const ISO_DATE = /^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z)?$/u;
const parsedSince = new Map<string, Date | null>();

export function retroToolsNewSince(): Date | null {
	const raw = process.env.RETRO_TOOLS_NEW_SINCE?.trim() ?? "";
	if (raw === "") return null;
	const known = parsedSince.get(raw);
	if (known !== undefined) return known;
	const since = parseSince(raw);
	parsedSince.set(raw, since);
	if (since === null)
		logger.error(
			"RETRO_TOOLS_NEW_SINCE={value} is not an ISO date (2026-11-06) or UTC time (2026-11-06T00:00:00Z); no workspace gets the retro tools by creation date",
			{ value: raw },
		);
	return since;
}

function parseSince(raw: string): Date | null {
	const match = ISO_DATE.exec(raw);
	if (!match?.[1]) return null;
	const since = new Date(match[2] ? raw : `${raw}T00:00:00Z`);
	if (Number.isNaN(since.getTime())) return null;
	return since.toISOString().slice(0, 10) === match[1] ? since : null;
}
