import {
	BRANCH_RUN_WINDOW_MS,
	branchName,
	type GitHubFacts,
	key,
	type Resolved,
	seedBranch,
	seedFullSha,
	seedPrefix,
} from "../analysis/git-links.js";
import {
	ciRunNodeId,
	commitNodeId,
	evidenceIdOf,
	pullRequestNodeId,
	runNodeId,
	type SessionIdentity,
	sessionNodeId,
} from "./l1-edge-ids.js";

/**
 * Session-side L1 edges (docs/l1-literal-schema.md, "Edges"): from the
 * evidence of one session, with the GitHub facts its values resolved to, the
 * literal relationships each evidence row states, and per evidence row and
 * target whether it resolved and why not. Pure and deterministic.
 */

/** Version of these rules; a bump rebuilds every scope. */
/**
 * Version of the rules that derive edges and resolutions; the backfill
 * requeues every scope after a bump. 2: branch CI searches keep a
 * resolution (capped included), CI edges keep the run's creation time, and
 * session coverage includes every pull request's repository.
 */
export const L1_EDGE_RESOLVER_VERSION = 2;

export interface DerivedEdge {
	from_kind: "run" | "session";
	from_id: string;
	relation:
		| "commit_created"
		| "commit_pushed"
		| "commit_captured"
		| "sha_mentioned"
		| "pr_named"
		| "pr_branch_head"
		| "pr_listed"
		| "ci_named"
		| "ci_on_branch_window";
	to_kind: "commit" | "pull_request" | "ci_run";
	to_id: string;
	evidence_id: string;
	basis: "transcript" | "capture";
	agent_id: string;
	turn_idx: number;
	repository_id: string;
	evidence_revision: string;
	evidence_parser_version: number;
	transcript_parser_version: number;
	observed_at: string;
	matched_value: string;
	match_rule: string;
	candidate_count: number;
	details: string;
}

export interface DerivedResolution {
	evidence_id: string;
	/** What was resolved; one row per evidence row and target. */
	target:
		| "repository"
		| "commit"
		| "pull_request"
		| "branch_pull_request"
		| "ci_run"
		/** The runs of a CI check's branch in the day before it. */
		| "branch_ci_run";
	status:
		| "linked"
		| "unbound"
		| "not_github"
		| "no_repository"
		| "ambiguous"
		| "not_found"
		/** The search hit its row cap: more candidates may exist. */
		| "capped";
	candidate_count: number;
	repository_id: string;
	repository_basis: string;
	repository_value: string;
	matched_value: string;
	evidence_revision: string;
}

export interface SessionEdges {
	edges: DerivedEdge[];
	resolutions: DerivedResolution[];
	/** Repositories the edges resolved in, and owner/name values named while unbound. */
	repositoryKeys: string[];
}

/**
 * The edges and resolutions of a session's evidence. `runStarts` maps a
 * stream and run number (`agentId|turn`) to the raw record index of the
 * prompt that starts the run; evidence without a run is an edge from the
 * session stream, never assigned to a run by time.
 */
export function deriveSessionEdges(input: {
	session: SessionIdentity;
	resolved: readonly Resolved[];
	facts: GitHubFacts;
	runStarts: ReadonlyMap<string, number>;
}): SessionEdges {
	const edges = new Map<string, DerivedEdge>();
	const resolutions = new Map<string, DerivedResolution>();
	const repositoryKeys = new Set<string>();
	for (const { seed, repository, github } of input.resolved) {
		const evidenceId = evidenceIdOf(seed);
		const revision = seed.generation?.revision ?? "0";
		const start =
			seed.turn !== null
				? input.runStarts.get(`${seed.agentId}|${seed.turn}`)
				: undefined;
		const from =
			start !== undefined
				? {
						from_kind: "run" as const,
						from_id: runNodeId(input.session, seed.agentId, start),
						turn_idx: seed.turn ?? 0,
					}
				: {
						from_kind: "session" as const,
						from_id: sessionNodeId(input.session, seed.agentId),
						turn_idx: 0,
					};
		const resolve = (
			target: DerivedResolution["target"],
			status: DerivedResolution["status"],
			candidates: number,
			matched: string,
		) => {
			resolutions.set(`${evidenceId}|${target}`, {
				evidence_id: evidenceId,
				target,
				status,
				candidate_count: candidates,
				repository_id: repository?.id ?? "",
				repository_basis: repository?.basis ?? "",
				repository_value: repository?.value ?? "",
				matched_value: matched,
				evidence_revision: revision,
			});
		};
		if (!repository) {
			const status =
				github.status === "unbound" ||
				github.status === "not_github" ||
				github.status === "no_repository"
					? github.status
					: "no_repository";
			resolve("repository", status, 0, seed.remote || seed.prRepo);
			// A named owner/name re-queues this session if it is bound later.
			const named = (seed.remote || seed.prRepo).match(
				/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/u,
			);
			if (status === "unbound" && named)
				repositoryKeys.add(`name:${named[1]}/${named[2]}`.toLowerCase());
			continue;
		}
		repositoryKeys.add(repository.id);
		resolve("repository", "linked", 1, repository.value);
		const base = {
			...from,
			evidence_id: evidenceId,
			basis: seed.kind.startsWith("evidence_")
				? ("capture" as const)
				: ("transcript" as const),
			agent_id: seed.agentId,
			repository_id: repository.id,
			evidence_revision: revision,
			evidence_parser_version: seed.generation?.parserVersion ?? 0,
			transcript_parser_version: seed.generation?.transcriptParserVersion ?? 0,
			observed_at: clickHouseTime(seed.atMs),
		};
		const add = (
			edge: Omit<DerivedEdge, keyof typeof base | "details">,
			details = {},
		) => {
			const row = { ...base, ...edge, details: JSON.stringify(details) };
			edges.set(
				[
					row.from_kind,
					row.from_id,
					row.relation,
					row.to_kind,
					row.to_id,
					row.evidence_id,
				].join("|"),
				row,
			);
		};
		const commitRelation = (): DerivedEdge["relation"] =>
			seed.kind === "commit_created"
				? "commit_created"
				: seed.kind === "push_range"
					? "commit_pushed"
					: seed.kind === "evidence_capture"
						? "commit_captured"
						: "sha_mentioned";

		const prefix = seedPrefix(seed);
		if (prefix) {
			const candidates =
				input.facts.shaCandidates.get(key(repository.id, prefix)) ?? [];
			const [only] = candidates;
			resolve(
				"commit",
				candidates.length === 1
					? "linked"
					: candidates.length === 0
						? "not_found"
						: "ambiguous",
				candidates.length,
				prefix,
			);
			if (candidates.length === 1 && only)
				add({
					relation: commitRelation(),
					to_kind: "commit",
					to_id: commitNodeId(repository.id, only),
					matched_value: prefix,
					match_rule: "unique_prefix",
					candidate_count: 1,
				});
		}
		const full = seedFullSha(seed);
		if (full && seed.kind !== "evidence_snapshot") {
			resolve("commit", "linked", 1, full);
			add(
				{
					relation: commitRelation(),
					to_kind: "commit",
					to_id: commitNodeId(repository.id, full),
					matched_value: full,
					match_rule: "full_sha",
					candidate_count: 1,
				},
				seed.kind === "evidence_capture" ? { role: "head" } : {},
			);
		}
		if (
			seed.kind === "evidence_capture" &&
			/^[a-f\d]{40}$/iu.test(seed.baseCommit)
		)
			add(
				{
					relation: "commit_captured",
					to_kind: "commit",
					to_id: commitNodeId(repository.id, seed.baseCommit),
					matched_value: seed.baseCommit.toLowerCase(),
					match_rule: "full_sha",
					candidate_count: 1,
				},
				{ role: "base" },
			);

		if (seed.prNumber > 0) {
			const pr = input.facts.pullRequests.get(
				key(repository.id, seed.prNumber),
			);
			resolve(
				"pull_request",
				pr ? "linked" : "not_found",
				pr ? 1 : 0,
				String(seed.prNumber),
			);
			if (pr)
				add({
					relation:
						seed.kind === "evidence_snapshot" ? "pr_listed" : "pr_named",
					to_kind: "pull_request",
					to_id: pullRequestNodeId(pr.repository_id, pr.number),
					matched_value: String(seed.prNumber),
					match_rule: "number",
					candidate_count: 1,
				});
		}

		const branch = seedBranch(seed);
		if (branch) {
			const name = branchName(branch);
			const prKeys =
				input.facts.branchPullRequests.get(key(repository.id, name)) ?? [];
			resolve(
				"branch_pull_request",
				prKeys.length > 0 ? "linked" : "not_found",
				prKeys.length,
				name,
			);
			for (const prKey of prKeys) {
				const pr = input.facts.pullRequests.get(prKey);
				if (pr)
					add({
						relation: "pr_branch_head",
						to_kind: "pull_request",
						to_id: pullRequestNodeId(pr.repository_id, pr.number),
						matched_value: name,
						match_rule: "branch_head",
						candidate_count: prKeys.length,
					});
			}
		}

		if (seed.kind === "ci_check" && seed.runId) {
			const attempts =
				input.facts.namedRuns.get(key(repository.id, seed.runId)) ?? [];
			resolve(
				"ci_run",
				attempts.length > 0 ? "linked" : "not_found",
				attempts.length,
				seed.runId,
			);
			for (const run of attempts)
				add(
					{
						relation: "ci_named",
						to_kind: "ci_run",
						to_id: ciRunNodeId(
							run.repository_id,
							run.kind,
							run.run_id,
							run.attempt,
						),
						matched_value: seed.runId,
						match_rule: "run_id",
						candidate_count: attempts.length,
					},
					{ runCreatedAt: run.created_at },
				);
		}
		if (seed.kind === "ci_check" && branch) {
			const name = branchName(branch);
			const windowFrom = seed.atMs - BRANCH_RUN_WINDOW_MS;
			const runs = (
				input.facts.branchRuns.get(key(repository.id, name)) ?? []
			).filter((run) => {
				const created = utcMs(run.created_at);
				return created >= windowFrom && created <= seed.atMs;
			});
			const cappedAt = input.facts.branchRunsCappedAt.get(
				key(repository.id, name),
			);
			const capped = cappedAt !== undefined && windowFrom <= cappedAt;
			// Kept even when nothing matched, so a capped empty search is not "none".
			resolve(
				"branch_ci_run",
				capped ? "capped" : runs.length > 0 ? "linked" : "not_found",
				runs.length,
				name,
			);
			for (const run of runs)
				add(
					{
						relation: "ci_on_branch_window",
						to_kind: "ci_run",
						to_id: ciRunNodeId(
							run.repository_id,
							run.kind,
							run.run_id,
							run.attempt,
						),
						matched_value: name,
						match_rule: "branch_window",
						candidate_count: runs.length,
					},
					{
						windowFrom: new Date(windowFrom).toISOString(),
						capped,
						runCreatedAt: run.created_at,
					},
				);
		}
	}
	return {
		edges: [...edges.values()],
		resolutions: [...resolutions.values()],
		repositoryKeys: [...repositoryKeys].sort(),
	};
}

function clickHouseTime(ms: number): string {
	return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

function utcMs(value: string): number {
	return Date.parse(
		value.includes("T") ? value : `${value.replace(" ", "T")}Z`,
	);
}
