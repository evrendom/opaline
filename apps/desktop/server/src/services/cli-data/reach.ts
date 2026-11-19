import { agentBatches, type CliDataContext } from "./statements.js";
import { inList } from "./visible.js";

export interface EdgeReach {
	readonly lines: string[];
	readonly prNodes: Set<string>;
	readonly commitNodes: Set<string>;
	readonly ciRuns: Set<string>;
}

export interface GitRow {
	readonly session_id: string;
	readonly kind: string;
	readonly branch: string;
	readonly push_to_sha: string;
	readonly short_sha: string;
	readonly pr_repo: string;
	readonly pr_number: number;
	readonly repository_url: string;
	readonly commit_hash: string;
}

const EDGE_HOPS = 4;

interface Edge {
	readonly from_id: string;
	readonly from_kind: string;
	readonly to_id: string;
	readonly to_kind: string;
	readonly relation: string;
	readonly evidence_id: string;
	readonly session_id: string;
	readonly agent_id: string;
}

export async function readEdges(
	context: CliDataContext,
	sessionIds: readonly string[],
): Promise<EdgeReach> {
	const reach: EdgeReach = {
		lines: [],
		prNodes: new Set(),
		commitNodes: new Set(),
		ciRuns: new Set(),
	};
	const seen = new Set<string>();
	const reached = new Set<string>();
	let frontier: string[] = [];
	const follow = (id: string) => {
		if (reached.has(id)) return;
		reached.add(id);
		frontier.push(id);
	};
	const take = (line: string) => {
		const edge = JSON.parse(line) as Edge;
		const key = [
			edge.from_id,
			edge.to_id,
			edge.relation,
			edge.evidence_id,
			edge.session_id,
			edge.agent_id,
		].join("\u0000");
		if (seen.has(key)) return;
		seen.add(key);
		reach.lines.push(line);
		if (edge.to_kind === "commit") reach.commitNodes.add(edge.to_id);
		if (edge.from_kind === "commit") reach.commitNodes.add(edge.from_id);
		if (edge.to_kind === "pull_request") reach.prNodes.add(edge.to_id);
		if (edge.to_kind === "ci_run") reach.ciRuns.add(edge.to_id);
		else if (edge.to_kind === "commit" || edge.to_kind === "pull_request")
			follow(edge.to_id);
		if (edge.from_kind === "commit") follow(edge.from_id);
	};
	for await (const line of agentBatches(
		context,
		sessionIds,
		50,
		(batch) =>
			`SELECT * FROM edges WHERE session_id IN ${inList(batch)} ORDER BY session_id, agent_id, turn_idx, relation`,
	))
		take(line);
	for (let hop = 0; hop < EDGE_HOPS && frontier.length > 0; hop++) {
		const next = frontier;
		frontier = [];
		for await (const line of agentBatches(
			context,
			next,
			300,
			(batch) =>
				`SELECT * FROM edges WHERE session_id = '' AND from_id IN ${inList(batch)} ORDER BY from_id, relation, to_id`,
		))
			take(line);
		const prs = next.filter((id) => reach.prNodes.has(id));
		for await (const line of agentBatches(
			context,
			prs,
			300,
			(batch) =>
				`SELECT * FROM edges WHERE session_id = '' AND to_kind = 'pull_request' AND relation = 'commit_in_pr' AND to_id IN ${inList(batch)} ORDER BY to_id, from_id`,
		))
			take(line);
	}
	return reach;
}

export async function readGitRows(
	context: CliDataContext,
	sessionIds: readonly string[],
): Promise<GitRow[]> {
	const rows: GitRow[] = [];
	for await (const line of agentBatches(
		context,
		sessionIds,
		50,
		(batch) =>
			`SELECT session_id, kind, branch, push_to_sha, short_sha, pr_repo, pr_number, repository_url, commit_hash
			FROM git_events WHERE session_id IN ${inList(batch)} ORDER BY session_id, agent_id, record_idx`,
	))
		rows.push(JSON.parse(line) as GitRow);
	return rows;
}
