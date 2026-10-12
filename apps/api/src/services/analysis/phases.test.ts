import { expect, test } from "bun:test";
import { CURRENT_PHASE_RULE, cutPhases, type PhaseRequest } from "./phases.js";

interface Request extends PhaseRequest {
	readonly id: number;
}

/** A request by its calls: [tool, group, command class, failed]. */
function request(
	id: number,
	...calls: [string, string, string?, boolean?][]
): Request {
	return {
		id,
		calls: calls.map(([tool, group, commandClass = "", failed = false]) => ({
			tool,
			group,
			commandClass,
			failed,
		})),
	};
}

const shape = (requests: readonly Request[]) =>
	cutPhases(requests, CURRENT_PHASE_RULE).phases.map((phase) => ({
		id: phase.id,
		kind: phase.kind,
		requests: phase.requests.map((item) => item.id),
	}));

test("consecutive requests doing the same kind of work are one phase, and a new phase starts when the kind changes", () => {
	expect(
		shape([
			request(1, ["Read", "read"]),
			request(2, ["Edit", "edit"]),
			request(3, ["Grep", "search"]),
			request(4, ["Edit", "edit"]),
			request(5, ["WebFetch", "web"]),
			request(6, ["Bash", "shell", "test", true]),
			request(7, ["Bash", "shell", "lint"]),
			request(8),
		]),
	).toEqual([
		{ id: "p1", kind: "exploring", requests: [1] },
		{ id: "p2", kind: "editing", requests: [2] },
		{ id: "p3", kind: "exploring", requests: [3] },
		{ id: "p4", kind: "editing", requests: [4] },
		{ id: "p5", kind: "exploring", requests: [5] },
		{ id: "p6", kind: "running checks", requests: [6, 7] },
		{ id: "p7", kind: "talking to the user", requests: [8] },
	]);
});

test("calls that do not decide a phase (todo lists, subagents, MCP) keep their request in the phase around it", () => {
	expect(
		shape([
			request(1, ["TodoWrite", "other"]),
			request(2, ["Edit", "edit"]),
			request(3, ["Task", "subagent"]),
			request(4, ["Edit", "edit"], ["mcp__linear__get_issue", "mcp"]),
			request(5, ["Bash", "shell", "git"]),
		]),
	).toEqual([
		{ id: "p1", kind: "editing", requests: [1, 2, 3, 4] },
		{ id: "p2", kind: "git and CI", requests: [5] },
	]);
});
