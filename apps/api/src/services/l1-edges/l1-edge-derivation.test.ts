import { describe, expect, test } from "bun:test";
import {
	type CiRunRow,
	emptyGitHubFacts,
	evidenceSeeds,
	type GitHubAccess,
	type PullRequestRow,
	resolveRepository,
	type Seed,
} from "../analysis/git-links.js";
import { deriveSessionEdges, evidenceIdOf } from "./l1-edge-derivation.js";

const session = { userId: "u1", source: "claude_code", sessionId: "s1" };
const access: GitHubAccess = {
	visibility: "visible",
	bindings: [
		{ repositoryId: "101", fullName: "opalinehq/athena" },
		{ repositoryId: "202", fullName: "contributor/athena" },
	],
	repositories: new Map(),
};
const sha = "d4e5f6a000000000000000000000000000000001";
const athena = "github.com:opalinehq/athena.git";

function derive(
	seeds: Seed[],
	facts = emptyGitHubFacts(),
	runStarts = new Map([["|3", 40]]),
) {
	return deriveSessionEdges({
		session,
		resolved: seeds.map((seed) => ({
			seed,
			...resolveRepository(seed, "github.com/opalinehq/athena", access),
		})),
		facts,
		runStarts,
	});
}

describe("session edges", () => {
	test("a push in a run links its unique SHA and the PRs headed by its branch, from the run", () => {
		const facts = emptyGitHubFacts();
		facts.shaCandidates.set("101|d4e5f6a", [sha]);
		facts.pullRequests.set("101|133", pullRequest(133));
		facts.branchPullRequests.set("101|feat/links", ["101|133"]);
		const push = seed({
			kind: "push_range",
			pushTo: "d4e5f6a",
			branch: "feat/links",
			remote: athena,
			turn: 3,
		});
		const { edges, resolutions, repositoryKeys } = derive([push], facts);
		expect(
			edges.map((edge) => [
				edge.from_kind,
				edge.from_id,
				edge.relation,
				edge.to_id,
				edge.match_rule,
				edge.turn_idx,
			]),
		).toEqual([
			[
				"run",
				"u1/claude_code/s1//40",
				"commit_pushed",
				`101/${sha}`,
				"unique_prefix",
				3,
			],
			[
				"run",
				"u1/claude_code/s1//40",
				"pr_branch_head",
				"101/133",
				"branch_head",
				3,
			],
		]);
		expect(edges[0]?.evidence_id).toBe(evidenceIdOf(push));
		expect(resolutions.map((row) => [row.target, row.status])).toEqual([
			["repository", "linked"],
			["commit", "linked"],
			["branch_pull_request", "linked"],
		]);
		expect(repositoryKeys).toEqual(["101"]);
	});

	test("an ambiguous or unknown prefix writes no edge but keeps why, with its candidate count", () => {
		const facts = emptyGitHubFacts();
		facts.shaCandidates.set("101|abc1234", ["abc1234a", "abc1234b"]);
		const commit = seed({
			kind: "commit_created",
			shortSha: "abc1234",
			turn: 3,
		});
		const missing = seed({
			kind: "commit_created",
			shortSha: "fff0000",
			record: 9,
		});
		const { edges, resolutions } = derive([commit, missing], facts);
		expect(edges).toEqual([]);
		expect(
			resolutions
				.filter((row) => row.target === "commit")
				.map((row) => [row.matched_value, row.status, row.candidate_count]),
		).toEqual([
			["abc1234", "ambiguous", 2],
			["fff0000", "not_found", 0],
		]);
	});

	test("evidence outside a run is an edge from the session stream, never assigned to a run", () => {
		const facts = emptyGitHubFacts();
		facts.pullRequests.set("101|140", pullRequest(140));
		const [capture, snapshot] = evidenceSeeds(
			[
				{
					originId: "c1:pr-140",
					sessionId: "s1",
					repositoryId: "101",
					pullNumber: 140,
					commitSha: sha,
					observedAt: "2026-10-07T12:10:00.000Z",
					coverageComplete: true,
					ciCoverageComplete: true,
				},
			],
			[
				{
					originId: "context-1",
					sessionId: "s1",
					agentId: "",
					repositoryId: "101",
					remote: "opalinehq/athena",
					lifecycle: "end",
					baseCommit: "a".repeat(40),
					headCommit: sha,
					capturedAt: "2026-10-07T12:09:00.000Z",
				},
			],
		);
		if (!capture || !snapshot) throw new Error("expected evidence seeds");
		const { edges } = derive([capture, snapshot], facts);
		expect(
			edges.map((edge) => [
				edge.from_kind,
				edge.relation,
				edge.to_id,
				edge.basis,
				edge.evidence_id,
				edge.details,
			]),
		).toEqual([
			[
				"session",
				"commit_captured",
				`101/${sha}`,
				"capture",
				"capture:context-1",
				'{"role":"head"}',
			],
			[
				"session",
				"commit_captured",
				`101/${"a".repeat(40)}`,
				"capture",
				"capture:context-1",
				'{"role":"base"}',
			],
			[
				"session",
				"pr_listed",
				"101/140",
				"capture",
				"snapshot:c1:pr-140",
				"{}",
			],
		]);
		expect(edges.every((edge) => edge.from_id === "u1/claude_code/s1/")).toBe(
			true,
		);
	});

	test("a CI check links every attempt of the run it names and the branch runs of the day before it", () => {
		const facts = emptyGitHubFacts();
		facts.namedRuns.set("101|7001", [
			ciRun({ run_id: "7001", attempt: 1 }),
			ciRun({ run_id: "7001", attempt: 2 }),
		]);
		facts.branchRuns.set("101|main", [
			ciRun({ run_id: "after", created_at: "2026-10-07 12:00:01" }),
			ciRun({ run_id: "in", created_at: "2026-10-07 09:00:00" }),
			ciRun({ run_id: "old", created_at: "2026-10-06 11:59:59" }),
		]);
		const check = seed({
			kind: "ci_check",
			prRepo: "opalinehq/athena",
			runId: "7001",
			branch: "main",
			turn: 3,
		});
		const { edges } = derive([check], facts);
		expect(
			edges.map((edge) => [edge.relation, edge.to_id, edge.candidate_count]),
		).toEqual([
			["ci_named", "101/actions_run/7001/1", 2],
			["ci_named", "101/actions_run/7001/2", 2],
			["ci_on_branch_window", "101/actions_run/in/1", 1],
		]);
	});

	test("a repository named but not bound has no edge; its owner/name is a dependency so binding it re-queues the session", () => {
		const push = seed({
			kind: "push_range",
			pushTo: "d4e5f6a",
			remote: "github.com:someone/else.git",
		});
		const { edges, resolutions, repositoryKeys } = derive([push]);
		expect(edges).toEqual([]);
		expect(resolutions.map((row) => [row.target, row.status])).toEqual([
			["repository", "unbound"],
		]);
		expect(repositoryKeys).toEqual(["name:someone/else"]);
	});

	test("the same evidence derives the same edges in the same order", () => {
		const facts = emptyGitHubFacts();
		facts.shaCandidates.set("101|d4e5f6a", [sha]);
		const push = seed({
			kind: "push_range",
			pushTo: "d4e5f6a",
			remote: athena,
			turn: 3,
		});
		expect(derive([push], facts)).toEqual(derive([push], facts));
	});
});

function seed(fields: Partial<Seed>): Seed {
	return {
		sessionId: "s1",
		agentId: "",
		record: 41,
		block: 0,
		call: "call",
		atMs: Date.parse("2026-10-07T12:00:00.000Z"),
		kind: "push_range",
		label: "observed",
		branch: "",
		sourceBranch: "",
		shortSha: "",
		pushFrom: "",
		pushTo: "",
		remote: "",
		prRepo: "",
		prNumber: 0,
		commitHash: "",
		baseCommit: "",
		runId: "",
		generation: {
			revision: "1",
			parserVersion: 773,
			transcriptParserVersion: 5,
			current: true,
		},
		turn: null,
		repositoryId: null,
		...fields,
	};
}

function pullRequest(number: number): PullRequestRow {
	return {
		repository_id: "101",
		number,
		head_repository_id: "101",
		title: `PR ${number}`,
		state: "open",
		draft: false,
		created_at: "2026-10-07 11:00:00",
		merged_at: null,
		closed_at: null,
		head_ref: "feat/links",
		head_sha: "f".repeat(40),
		merge_commit_sha: "",
	};
}

function ciRun(fields: Partial<CiRunRow>): CiRunRow {
	return {
		repository_id: "101",
		kind: "actions_run",
		run_id: "1",
		attempt: 1,
		workflow_name: "CI",
		event: "push",
		head_branch: "main",
		head_sha: sha,
		status: "completed",
		conclusion: "success",
		created_at: "2026-10-07 11:30:00",
		started_at: null,
		completed_at: null,
		pr_number: 0,
		link_basis: "",
		...fields,
	};
}
