import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { mcpTool } from "../model/session-reader-mcp-tool";
import { getReaderWaterfall } from "../model/session-reader-run-steps";
import type { SessionReaderBodyState } from "./use-session-reader-bodies";

export const USE_PARAM = "use";

export type UseHint =
	| { kind: "skill"; name: string }
	| { kind: "mcp"; name: string; at: number | null };

export function writeUseHint(hint: UseHint): string {
	if (hint.kind === "skill") return `skill:${hint.name}`;
	return hint.at === null ? `mcp:${hint.name}` : `mcp:${hint.name}@${hint.at}`;
}

export function readUseHint(value: string | null): UseHint | null {
	const colon = value?.indexOf(":") ?? -1;
	if (!value || colon < 0) return null;
	const kind = value.slice(0, colon);
	const rest = value.slice(colon + 1);
	if (!rest) return null;
	if (kind === "skill") return { kind, name: rest };
	if (kind !== "mcp") return null;
	const at = rest.lastIndexOf("@");
	const time = at < 0 ? Number.NaN : Number(rest.slice(at + 1));
	return Number.isFinite(time)
		? { kind, name: rest.slice(0, at), at: time }
		: { kind, name: rest, at: null };
}

export function mcpServerLabel(server: string): string {
	return mcpTool(`mcp__${server}__call`)?.server ?? server;
}

function sameSkill(left: string, right: string): boolean {
	return (
		left === right || left.endsWith(`:${right}`) || right.endsWith(`:${left}`)
	);
}

export function turnOfHint(
	hint: UseHint,
	turns: readonly SessionDetailTurnSummary[],
): string | undefined {
	if (hint.kind === "skill")
		return turns.find(
			(turn) =>
				turn.skills.some((skill) => sameSkill(skill, hint.name)) ||
				turn.skillEvents.some((event) => sameSkill(event.skill, hint.name)),
		)?.turnId;
	if (hint.at === null) return undefined;
	let found: string | undefined;
	for (const turn of turns) {
		const started = turn.startedAt ? Date.parse(turn.startedAt) : Number.NaN;
		if (started <= hint.at) found = turn.turnId;
	}
	return found ?? turns[0]?.turnId;
}

export function stepOfHint(
	hint: UseHint,
	state: SessionReaderBodyState | undefined,
	turn: SessionDetailTurnSummary | undefined,
): string | null | undefined {
	if (!state || state.status === "loading") return undefined;
	if (state.status !== "ready" || !turn) return null;
	const waterfall = getReaderWaterfall(state.body, turn, null);
	const server = hint.kind === "mcp" ? mcpServerLabel(hint.name) : null;
	const step = waterfall?.allSteps.find((each) =>
		hint.kind === "skill"
			? each.skill !== undefined && sameSkill(each.skill, hint.name)
			: each.toolEvent !== null &&
				mcpTool(each.toolEvent.toolName)?.server === server,
	);
	return step?.id ?? null;
}
