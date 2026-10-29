export type SessionReaderTab = "summary" | "detail" | "files" | "setup" | "ci";

export const SESSION_TAB_PARAM = "sessionTab";
export const SETUP_PARAM = "setup";
export const PR_PARAM = "pr";
export const CI_PARAM = "ci";
export const FILE_PARAM = "file";
export const READ_PARAM = "read";

export const CALL_PARAM = "call";

const VIEW_PARAMS: Record<SessionReaderTab, readonly string[]> = {
	ci: [PR_PARAM, CI_PARAM],
	detail: [CALL_PARAM],
	files: [FILE_PARAM, READ_PARAM],
	setup: [SETUP_PARAM],
	summary: [],
};

export function writeView(params: URLSearchParams, view: SessionReaderTab) {
	if (view === "detail") params.delete(SESSION_TAB_PARAM);
	else params.set(SESSION_TAB_PARAM, view);
	for (const [other, owned] of Object.entries(VIEW_PARAMS))
		if (other !== view) for (const key of owned) params.delete(key);
}

export const RUN_PARAM = "run";
export const SUBAGENT_PARAM = "subagent";
export const AGENT_PARAM = "agent";
export const TURN_PARAM = "turn";

export function writeAgent(params: URLSearchParams, subagent: string | null) {
	for (const key of [AGENT_PARAM, SUBAGENT_PARAM]) {
		if (subagent) params.set(key, subagent);
		else params.delete(key);
	}
}

export type RailPick =
	| { kind: "session" }
	| { kind: "run"; run: string }
	| { kind: "subagent"; run: string; subagent: string };

export type AddressPick = RailPick | { kind: "unplaced"; subagent: string };

export const SESSION_PICK: RailPick = { kind: "session" };

export function pickOf(run: string | null, subagent: string | null): RailPick {
	if (!run) return SESSION_PICK;
	return subagent ? { kind: "subagent", run, subagent } : { kind: "run", run };
}

export const pickedRunOf = (pick: AddressPick): string | null =>
	pick.kind === "run" || pick.kind === "subagent" ? pick.run : null;

export const pickedAgentOf = (pick: AddressPick): string | null =>
	pick.kind === "subagent" ? pick.subagent : null;

export function readPick(params: URLSearchParams): AddressPick {
	const run = params.get(RUN_PARAM);
	const subagent = params.get(SUBAGENT_PARAM);
	if (!run && subagent) return { kind: "unplaced", subagent };
	return pickOf(run, subagent);
}

export function placePick(
	pick: AddressPick,
	launches: ReadonlyMap<string, string>,
): AddressPick {
	if (pick.kind !== "unplaced") return pick;
	const run = launches.get(pick.subagent);
	return run ? { kind: "subagent", run, subagent: pick.subagent } : pick;
}

export function writePick(params: URLSearchParams, pick: RailPick) {
	const run = pickedRunOf(pick);
	const subagent = pickedAgentOf(pick);
	for (const [key, value] of [
		[RUN_PARAM, run],
		[SUBAGENT_PARAM, subagent],
		[TURN_PARAM, run],
		[AGENT_PARAM, subagent],
	] as const) {
		if (value) params.set(key, value);
		else params.delete(key);
	}
}

export function syncPick(params: URLSearchParams) {
	writePick(params, pickOf(params.get(RUN_PARAM), params.get(SUBAGENT_PARAM)));
}

export const NO_PICK = {
	[AGENT_PARAM]: undefined,
	[RUN_PARAM]: undefined,
	[SUBAGENT_PARAM]: undefined,
	[TURN_PARAM]: undefined,
};
