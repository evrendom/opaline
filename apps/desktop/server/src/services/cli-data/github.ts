import {
	CI_RUN_COLUMNS,
	CiRunRowSchema,
	PULL_REQUEST_COLUMNS,
	PullRequestRowSchema,
} from "../analysis/git-links.js";
import {
	ciRunNodeId,
	commitNodeId,
	pullRequestNodeId,
	splitL1NodeId,
} from "../l1-edges/l1-edge-ids.js";
import type { EdgeReach, GitRow } from "./reach.js";
import { type CliDataContext, type Row, trustedRows } from "./statements.js";
import type { VisibleSession } from "./visible.js";

export interface GitHubReach {
	readonly repositories: Row[];
	readonly candidates: Row[];
	readonly prs: Row[];
	readonly prCommits: Row[];
	readonly links: Row[];
	readonly ciRuns: Row[];
	readonly jobRuns: string[];
}

const SCOPE =
	"workspace_id = {ws:String} AND provider = 'github' AND has({repos:Array(String)}, repository_id)";
const PR_COMMIT_COLUMNS =
	"repository_id, sha, pr_number, last_seen_head_sha, toString(synced_at) AS synced_at";

const pairKey = (left: string, right: string | number) => `${left}|${right}`;

function unpair(keys: Iterable<string>): [string[], string[]] {
	const left: string[] = [];
	const right: string[] = [];
	for (const key of keys) {
		const at = key.indexOf("|");
		left.push(key.slice(0, at));
		right.push(key.slice(at + 1));
	}
	return [left, right];
}

function pairs(tag: string, keys: Iterable<string>, numeric = false) {
	const [left, right] = unpair(keys);
	return {
		[`${tag}A`]: left,
		[`${tag}B`]: numeric ? right.map(Number) : right,
	};
}

const hasPair = (tag: string, tuple: string, numeric = false) =>
	`has(arrayZip({${tag}A:Array(String)}, {${tag}B:Array(${numeric ? "UInt32" : "String"})}), (${tuple}))`;

export function repositoryName(value: string): string {
	const text = (value ?? "").trim().toLowerCase();
	return (
		/github\.com[/:]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/u.exec(text)?.[1] ??
		(/^[^/\s:]+\/[^/\s:]+$/u.test(text) ? text.replace(/\.git$/u, "") : "")
	);
}

export async function reachGitHub(
	context: CliDataContext,
	sessions: readonly VisibleSession[],
	edges: EdgeReach,
	gitRows: readonly GitRow[],
): Promise<GitHubReach> {
	const workspaceId = context.caller.workspaceId;
	const bindings = await context.env.githubBindings(workspaceId);
	const repositories = bindings.map((binding) => ({
		repository_id: binding.repositoryId,
		full_name: binding.fullName,
	}));
	const empty: GitHubReach = {
		repositories,
		candidates: [],
		prs: [],
		prCommits: [],
		links: [],
		ciRuns: [],
		jobRuns: [...edges.ciRuns].sort(),
	};
	if (bindings.length === 0) return empty;
	const repoIds = bindings.map((binding) => binding.repositoryId);
	const byName = new Map(
		bindings.map((binding) => [
			binding.fullName.toLowerCase(),
			binding.repositoryId,
		]),
	);
	const sessionRepo = new Map(
		sessions.map((session) => [session.sessionId, session.repository]),
	);
	const repoOf = (row: GitRow) =>
		byName.get(repositoryName(row.pr_repo)) ??
		byName.get(repositoryName(row.repository_url)) ??
		byName.get(repositoryName(sessionRepo.get(row.session_id) ?? ""));
	const bound = (id: string | undefined): id is string =>
		!!id && repoIds.includes(id);
	const prKeys = new Set<string>();
	const branches = new Set<string>();
	const prefixes = new Set<string>();
	const fullShas = new Set<string>();
	for (const node of edges.prNodes) {
		const [repo, number] = splitL1NodeId(node);
		if (bound(repo)) prKeys.add(pairKey(repo, Number(number)));
	}
	for (const node of edges.commitNodes) {
		const [repo, sha] = splitL1NodeId(node);
		if (bound(repo) && sha) fullShas.add(pairKey(repo, sha));
	}
	for (const row of gitRows) {
		const repo = repoOf(row);
		if (!bound(repo)) continue;
		if (Number(row.pr_number) > 0) prKeys.add(pairKey(repo, row.pr_number));
		if ((row.kind === "push_range" || row.kind === "ci_check") && row.branch)
			branches.add(pairKey(repo, row.branch.replace(/^refs\/heads\//u, "")));
		const prefix =
			row.kind === "push_range"
				? row.push_to_sha
				: row.kind === "commit_created"
					? row.short_sha
					: row.kind === "ci_check" && /^[a-f\d]{7,39}$/u.test(row.commit_hash)
						? row.commit_hash
						: "";
		if (prefix) for (const id of repoIds) prefixes.add(pairKey(id, prefix));
		if (/^[a-f\d]{40}$/iu.test(row.commit_hash))
			fullShas.add(pairKey(repo, row.commit_hash.toLowerCase()));
	}
	const read = (query: string, params: Record<string, unknown>) =>
		trustedRows(context, {
			query,
			query_params: { ws: workspaceId, repos: repoIds, ...params },
		});

	const byLength = new Map<number, string[]>();
	for (const key of prefixes) {
		const length = key.length - key.indexOf("|") - 1;
		byLength.set(length, [...(byLength.get(length) ?? []), key]);
	}
	const prefixParams: Record<string, unknown> = {};
	const prefixConditions = [...byLength].map(([length, keys], index) => {
		Object.assign(prefixParams, pairs(`px${index}`, keys));
		return `has(arrayZip({px${index}A:Array(String)}, {px${index}B:Array(String)}), (repository_id, substring(sha, 1, ${length})))`;
	});
	const shaRows = prefixConditions.length
		? await read(
				`SELECT DISTINCT repository_id, sha FROM (
					SELECT repository_id, sha FROM rudel.github_pull_request_commits FINAL WHERE ${SCOPE}
					UNION ALL SELECT repository_id, head_sha AS sha FROM rudel.github_pull_requests FINAL WHERE ${SCOPE}
					UNION ALL SELECT repository_id, head_sha AS sha FROM rudel.github_ci_runs FINAL WHERE ${SCOPE}
				) WHERE sha != '' AND (${prefixConditions.join(" OR ")}) ORDER BY repository_id, sha`,
				prefixParams,
			)
		: [];
	const candidates: Row[] = [];
	for (const key of [...prefixes].sort()) {
		const at = key.indexOf("|");
		const repo = key.slice(0, at);
		const prefix = key.slice(at + 1);
		const shas = shaRows
			.filter(
				(row) =>
					row.repository_id === repo && String(row.sha).startsWith(prefix),
			)
			.map((row) => String(row.sha));
		candidates.push({ repository_id: repo, prefix, shas });
		if (shas.length === 1) fullShas.add(pairKey(repo, shas[0] as string));
	}

	const prCommitRows = new Map<string, Row>();
	const takePrCommit = (row: Row) => {
		prCommitRows.set(`${row.repository_id}|${row.sha}|${row.pr_number}`, row);
		prKeys.add(pairKey(String(row.repository_id), Number(row.pr_number)));
	};
	if (fullShas.size)
		for (const row of await read(
			`SELECT ${PR_COMMIT_COLUMNS} FROM rudel.github_pull_request_commits FINAL WHERE ${SCOPE} AND ${hasPair("fs", "repository_id, sha")}`,
			pairs("fs", fullShas),
		))
			takePrCommit(row);
	const prRows = new Map<string, Row>();
	for (const raw of await read(
		`SELECT ${PULL_REQUEST_COLUMNS}, toString(synced_at) AS synced_text FROM rudel.github_pull_requests FINAL
			WHERE ${SCOPE} AND (${hasPair("pn", "repository_id, number", true)} OR ${hasPair("br", "if(head_repository_id = '', repository_id, head_repository_id), head_ref")})
			ORDER BY repository_id, number`,
		{ ...pairs("pn", prKeys, true), ...pairs("br", branches) },
	)) {
		const row = PullRequestRowSchema.parse(raw);
		prRows.set(pairKey(row.repository_id, row.number), {
			node_id: pullRequestNodeId(row.repository_id, row.number),
			...row,
			synced_at: raw.synced_text,
		});
		prKeys.add(pairKey(row.repository_id, row.number));
	}
	for (const row of await read(
		`SELECT ${PR_COMMIT_COLUMNS} FROM rudel.github_pull_request_commits FINAL WHERE ${SCOPE} AND ${hasPair("pc", "repository_id, pr_number", true)}`,
		pairs("pc", prKeys, true),
	))
		takePrCommit(row);
	const prs = [...prRows.keys()].sort().map((key) => prRows.get(key) as Row);
	const prCommits = [...prCommitRows.keys()].sort().map((key) => {
		const row = prCommitRows.get(key) as Row;
		const repo = String(row.repository_id);
		return {
			commit_id: commitNodeId(repo, String(row.sha)),
			pr_node_id: pullRequestNodeId(repo, Number(row.pr_number)),
			...row,
			pr_number: Number(row.pr_number),
		};
	});

	const linkRows = await read(
		`SELECT repository_id, pr_number, toString(kind) AS run_kind, run_id, attempt, toString(basis) AS link_basis,
				toString(run_created_at) AS run_created_at, toString(synced_at) AS synced_at
			FROM rudel.github_ci_run_pull_requests FINAL
			WHERE ${SCOPE} AND kind != 'check_suite' AND ${hasPair("lk", "repository_id, pr_number", true)}
			ORDER BY repository_id, pr_number, run_kind, run_id, attempt`,
		pairs("lk", prKeys, true),
	);
	const links: Row[] = linkRows.map((row) => {
		const repo = String(row.repository_id);
		return {
			ci_run_id: ciRunNodeId(
				repo,
				String(row.run_kind),
				String(row.run_id),
				Number(row.attempt),
			),
			pr_node_id: pullRequestNodeId(repo, Number(row.pr_number)),
			...row,
			pr_number: Number(row.pr_number),
			attempt: Number(row.attempt),
		};
	});
	const runKeys = new Map<string, [string, string, string, number]>();
	for (const row of links)
		runKeys.set(String(row.ci_run_id), [
			String(row.repository_id),
			String(row.run_kind),
			String(row.run_id),
			Number(row.attempt),
		]);
	for (const node of edges.ciRuns) {
		const [repo, kind, runId, attempt] = splitL1NodeId(node);
		if (bound(repo) && kind && runId)
			runKeys.set(node, [repo, kind, runId, Number(attempt)]);
	}
	const runShas = new Set(fullShas);
	for (const row of prCommitRows.values())
		runShas.add(pairKey(String(row.repository_id), String(row.sha)));
	for (const row of prRows.values())
		if (row.merge_commit_sha)
			runShas.add(
				pairKey(String(row.repository_id), String(row.merge_commit_sha)),
			);
	const keys = [...runKeys.values()];
	const ciRuns = new Map<string, Row>();
	for (const raw of await read(
		`SELECT ${CI_RUN_COLUMNS}, toUInt32(0) AS pr_number, '' AS link_basis, toString(synced_at) AS synced_text
			FROM rudel.github_ci_runs FINAL
			WHERE ${SCOPE} AND kind != 'check_suite'
				AND (has(arrayZip({rkR:Array(String)}, {rkK:Array(String)}, {rkI:Array(String)}, {rkA:Array(UInt32)}), (repository_id, toString(kind), run_id, attempt))
					OR ${hasPair("rs", "repository_id, head_sha")})
			ORDER BY repository_id, created_at, run_id, attempt`,
		{
			rkR: keys.map((key) => key[0]),
			rkK: keys.map((key) => key[1]),
			rkI: keys.map((key) => key[2]),
			rkA: keys.map((key) => key[3]),
			...pairs("rs", runShas),
		},
	)) {
		const {
			pr_number: _number,
			link_basis: _basis,
			...row
		} = CiRunRowSchema.parse(raw);
		const id = ciRunNodeId(
			row.repository_id,
			row.kind,
			row.run_id,
			row.attempt,
		);
		ciRuns.set(id, { ci_run_id: id, ...row, synced_at: raw.synced_text });
	}
	const jobRuns = new Set(edges.ciRuns);
	for (const row of ciRuns.values())
		if (row.kind === "actions_run") jobRuns.add(String(row.ci_run_id));
	return {
		repositories,
		candidates,
		prs,
		prCommits,
		links,
		ciRuns: [...ciRuns.values()],
		jobRuns: [...jobRuns].sort(),
	};
}
