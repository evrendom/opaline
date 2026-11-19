/**
 * Phases (CONTEXT.md, "Phase"): stretches of consecutive requests of a run
 * doing the same kind of work. A pure function of the run's requests and a
 * versioned rule, so a new rule re-cuts every run at once with no data
 * change; phase ids are valid within the rule version that cut them.
 */

export type PhaseKind =
	| "exploring"
	| "editing"
	| "running checks"
	| "git and CI"
	| "talking to the user";

/** A call as the cutter sees it: its tool, tool group and the parser's command class. */
export interface PhaseCall {
	readonly tool: string;
	readonly group: string;
	readonly commandClass: string;
	readonly failed: boolean;
}

export interface PhaseRequest {
	readonly calls: readonly PhaseCall[];
}

/**
 * A versioned rule: the kind of work each call does (null: it does not
 * decide the phase), and which kind wins when one request does several.
 */
export interface PhaseRule {
	readonly version: number;
	kindOf(call: PhaseCall): PhaseKind | null;
	/** Kinds a request's calls can have, the winner first. */
	readonly precedence: readonly PhaseKind[];
}

export interface Phase<TRequest extends PhaseRequest> {
	/** `p1`, `p2`, …: valid within the rule version that cut them. */
	readonly id: string;
	readonly kind: PhaseKind;
	readonly requests: readonly TRequest[];
}

export interface PhaseCut<TRequest extends PhaseRequest> {
	readonly ruleVersion: number;
	readonly phases: readonly Phase<TRequest>[];
}

const EXPLORING_GROUPS = new Set(["read", "search", "web", "browser"]);

/**
 * Rule 1, from the tool groups (`tool-groups.ts`) and the command class the
 * parser gives shell calls: reads, searches, web and browser calls explore;
 * native edits edit; git and gh commands are git and CI; every other shell
 * command runs checks. MCP, subagent and other calls (todo lists, skills)
 * do not decide a phase, so a request with only those stays in the phase
 * around it. A request without calls talks to the user.
 */
const RULE_1: PhaseRule = {
	version: 1,
	kindOf(call) {
		if (call.group === "edit") return "editing";
		if (EXPLORING_GROUPS.has(call.group)) return "exploring";
		if (call.group === "shell")
			return call.commandClass === "git" ? "git and CI" : "running checks";
		return null;
	},
	precedence: ["git and CI", "editing", "running checks", "exploring"],
};

export const CURRENT_PHASE_RULE: PhaseRule = RULE_1;

export function cutPhases<TRequest extends PhaseRequest>(
	requests: readonly TRequest[],
	rule: PhaseRule,
): PhaseCut<TRequest> {
	const own = requests.map((request) => requestKind(request, rule));
	// A request no call decides joins the phase before it; leading ones join
	// the first phase after them.
	const first = own.find((kind) => kind !== null) ?? "exploring";
	const phases: { kind: PhaseKind; requests: TRequest[] }[] = [];
	requests.forEach((request, index) => {
		const last = phases.at(-1);
		const kind = own[index] ?? last?.kind ?? first;
		if (last?.kind === kind) last.requests.push(request);
		else phases.push({ kind, requests: [request] });
	});
	return {
		ruleVersion: rule.version,
		phases: phases.map((phase, index) => ({ id: `p${index + 1}`, ...phase })),
	};
}

function requestKind(request: PhaseRequest, rule: PhaseRule): PhaseKind | null {
	if (request.calls.length === 0) return "talking to the user";
	const kinds = new Set(request.calls.map((call) => rule.kindOf(call)));
	return rule.precedence.find((kind) => kinds.has(kind)) ?? null;
}
