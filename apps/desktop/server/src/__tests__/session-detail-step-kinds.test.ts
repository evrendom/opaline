import { describe, expect, test } from "bun:test";
import {
	SESSION_GIT_ACTIONS,
	SESSION_TURN_STEP_KINDS,
	type SessionTurn,
	type SessionTurnStepKind,
} from "@rudel/api-routes";
import {
	checkOfCommand,
	countGitActions,
	countTurnStepKinds,
	kindOfTool,
} from "../services/session-detail-step-kinds.js";

const call = (toolName: string, input: Record<string, unknown>) => ({
	id: `${toolName}-${JSON.stringify(input)}`,
	input,
	kind: "tool",
	timestamp: "2026-10-21T10:00:00.000Z",
	toolName,
});

const turnOf = (...events: ReturnType<typeof call>[]) =>
	({
		responseItems: [{ events, kind: "agent" }],
		userItems: [],
	}) as unknown as SessionTurn;

describe("countTurnStepKinds", () => {
	test("counts a turn's calls by what they did", () => {
		expect(
			countTurnStepKinds(
				turnOf(
					call("Bash", { command: "gh pr checks 12 --watch" }),
					call("Bash", { command: "gh pr view 12" }),
					call("Bash", { command: "git commit -m fix" }),
					call("Bash", { command: "bun test" }),
					call("Bash", { command: "rg needle src" }),
					call("Grep", { pattern: "needle" }),
					call("Bash", { command: "curl https://example.com" }),
					call("mcp__github__create_issue", {}),
					call("mcp__linear__list_issues", {}),
					call("exec_command", { cmd: "cargo build" }),
				),
			),
		).toEqual({
			commit: 1,
			git: 1,
			github: 3,
			mcp: 1,
			search: 2,
			shell: 1,
			verify: 2,
		});
	});

	test("counts each commit, pull request opened and merge, in calls that didn't fail", () => {
		const failed = {
			...call("Bash", { command: "git commit -m nothing" }),
			result: { content: "nothing to commit", isError: true },
		};
		expect(
			countTurnStepKinds(
				turnOf(
					call("Bash", {
						command: "git add . && git -C apps/web commit -m a && git push",
					}),
					call("Bash", { command: "git commit --amend --no-edit" }),
					call("Bash", { command: "gh pr create --fill" }),
					call("Bash", { command: "gh pr merge 12 --squash" }),
					call("mcp__github__create_pull_request", {}),
					call("mcp__github__merge_pull_request", {}),
					call("Bash", { command: "git log --oneline" }),
					failed,
				),
			),
		).toMatchObject({ commit: 2, merge: 2, pullRequest: 2 });
	});

	test("a subagent's own git actions, from its transcript's agent steps", () => {
		const items = turnOf(
			call("Bash", { command: "git commit -m sub" }),
			call("Bash", { command: "gh pr create --fill" }),
			call("Bash", { command: "rg needle" }),
		).responseItems;
		expect(countGitActions(items)).toEqual({ commit: 1, pullRequest: 1 });
		expect(
			countGitActions(
				turnOf(call("Bash", { command: "bun test" })).responseItems,
			),
		).toBeUndefined();
	});

	test("every kind the payload names is counted, and nothing else", () => {
		const oneOfEach = {
			git: call("Bash", { command: "git push" }),
			github: call("Bash", { command: "gh pr view 12" }),
			mcp: call("mcp__linear__list_issues", {}),
			search: call("Grep", { pattern: "needle" }),
			shell: call("Bash", { command: "curl https://example.com" }),
			verify: call("Bash", { command: "bun test" }),
		} satisfies Record<SessionTurnStepKind, ReturnType<typeof call>>;
		for (const [kind, step] of Object.entries(oneOfEach))
			expect(countTurnStepKinds(turnOf(step))).toEqual({ [kind]: 1 });
		const counts = countTurnStepKinds(
			turnOf(
				...Object.values(oneOfEach),
				call("Bash", { command: "git commit -m a" }),
				call("Bash", { command: "gh pr create --fill" }),
				call("Bash", { command: "gh pr merge 12" }),
			),
		);
		expect(Object.keys(counts ?? {}).sort()).toEqual(
			[...SESSION_TURN_STEP_KINDS, ...SESSION_GIT_ACTIONS].sort(),
		);
	});

	test("leaves out what the file events already say, and turns with none", () => {
		expect(
			countTurnStepKinds(
				turnOf(
					call("Read", { file_path: "a.ts" }),
					call("Edit", { file_path: "a.ts" }),
					call("Bash", { command: "cat a.ts" }),
					call("Bash", { command: "sleep 5" }),
				),
			),
		).toBeUndefined();
	});
});

describe("kindOfTool and checkOfCommand", () => {
	test("a shell command's kind, and its check where it is one", () => {
		const said = (command: string) => [
			kindOfTool("Bash", { command }),
			checkOfCommand(command),
		];
		expect(said("bun run build")).toEqual(["verify", "build"]);
		expect(said("biome check .")).toEqual(["verify", "lint"]);
		expect(said("bun test")).toEqual(["verify", "test"]);
		expect(said("tsc --noEmit")).toEqual(["verify", "typecheck"]);
		expect(said("git push")).toEqual(["git", null]);
		expect(said("gh pr create")).toEqual(["github", null]);
		expect(said("rg foo")).toEqual(["search", null]);
		expect(said("curl https://x")).toEqual(["shell", null]);
		expect(said("python3 x.py")).toEqual(["shell", null]);
		expect(said("rm -rf x")).toEqual([null, null]);
		expect(said("cat a.ts")).toEqual([null, null]);
		expect(said("sleep 2")).toEqual([null, null]);
		expect(said("cd x && echo hi")).toEqual([null, null]);
	});

	test("other tools by name: search, GitHub and other MCP, else none", () => {
		expect(kindOfTool("exec_command", { cmd: "bun test" })).toBe("verify");
		expect(kindOfTool("Grep", {})).toBe("search");
		expect(kindOfTool("mcp__github__create_pull_request", {})).toBe("github");
		expect(kindOfTool("mcp__linear__list", {})).toBe("mcp");
		expect(kindOfTool("Read", {})).toBeNull();
	});
});
