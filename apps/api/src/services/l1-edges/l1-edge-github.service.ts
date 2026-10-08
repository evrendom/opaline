import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "../analysis/sql.js";
import { L1_EDGE_RESOLVER_VERSION } from "./l1-edge-derivation.js";
import { ciRunNodeId, commitNodeId, pullRequestNodeId } from "./l1-edge-ids.js";
import { L1_EDGES_TABLE } from "./l1-edge-tables.js";

/**
 * GitHub-side L1 edges of one repository (docs/l1-literal-schema.md,
 * "Edges"): commit_in_pr (PR commits, and a merged PR's merge commit),
 * ci_on_sha (a run's head SHA) and ci_for_pr (GitHub's run to PR links),
 * projected from the GitHub tables collected since the scope's watermark.
 * GitHub facts only accumulate, so these edges are never retracted.
 */

/** Collected facts can land after their `synced_at`; each pass re-reads this overlap. */
const WATERMARK_OVERLAP_MS = 15 * 60_000;
const PAGE_ROWS = 10_000;

const MembershipSchema = z.object({
	sha: z.string(),
	pr_number: z.coerce.number(),
	last_seen_head_sha: z.string(),
	synced_text: z.string(),
});
const MergeSchema = z.object({
	number: z.coerce.number(),
	merge_commit_sha: z.string(),
	merged_text: z.string(),
});
const RunSchema = z.object({
	run_kind: z.string(),
	run_id: z.string(),
	attempt: z.coerce.number(),
	head_sha: z.string(),
	created_text: z.string(),
});
const RunLinkSchema = z.object({
	pr_number: z.coerce.number(),
	run_kind: z.string(),
	run_id: z.string(),
	attempt: z.coerce.number(),
	basis: z.string(),
	run_created_text: z.string(),
});

export interface RepositoryEdgeBuild {
	edgeCount: number;
	watermark: Date;
}

/**
 * Writes the repository's GitHub-side edges collected after `watermark`
 * (minus an overlap) at `revision`; `beforeWrite` runs before each insert.
 */
export async function buildRepositoryEdges(input: {
	executor: ClickHouseExecutor;
	organizationId: string;
	repositoryId: string;
	revision: number;
	watermark: Date | null;
	beforeWrite: () => Promise<void>;
	now?: Date;
}): Promise<RepositoryEdgeBuild> {
	const now = input.now ?? new Date();
	const from = input.watermark
		? new Date(input.watermark.getTime() - WATERMARK_OVERLAP_MS)
		: new Date(0);
	const params = {
		workspaceId: input.organizationId,
		repositoryId: input.repositoryId,
		from: clickHouseTime(from.getTime()),
		through: clickHouseTime(now.getTime()),
	};
	const window =
		"workspace_id = {workspaceId:String} AND provider = 'github' AND repository_id = {repositoryId:String} AND synced_at > toDateTime64({from:String}, 3, 'UTC') AND synced_at <= toDateTime64({through:String}, 3, 'UTC')";
	const writtenAt = clickHouseTime(now.getTime());
	const base = {
		organization_id: input.organizationId,
		basis: "github",
		user_id: "",
		source: "",
		session_id: "",
		agent_id: "",
		turn_idx: 0,
		repository_id: input.repositoryId,
		evidence_revision: "0",
		evidence_parser_version: 0,
		transcript_parser_version: 0,
		candidate_count: 1,
		resolver_version: L1_EDGE_RESOLVER_VERSION,
		revision: String(input.revision),
		is_active: 1,
		written_at: writtenAt,
	};
	const repository = input.repositoryId;
	let edgeCount = 0;
	const write = async (rows: object[]) => {
		if (rows.length === 0) return;
		await input.beforeWrite();
		await input.executor.insert({
			table: L1_EDGES_TABLE,
			values: rows,
			asyncInsert: false,
		});
		edgeCount += rows.length;
	};

	await pages(input.executor, MembershipSchema, {
		query: `SELECT sha, pr_number, last_seen_head_sha, toString(synced_at) AS synced_text
			FROM ${getSafeClickHouseTable("rudel.github_pull_request_commits")} FINAL
			WHERE ${window} ORDER BY sha, pr_number`,
		params,
		onPage: (rows) =>
			write(
				rows.map((row) => ({
					...base,
					from_kind: "commit",
					from_id: commitNodeId(repository, row.sha),
					relation: "commit_in_pr",
					to_kind: "pull_request",
					to_id: pullRequestNodeId(repository, row.pr_number),
					evidence_id: `gh_pr_commit:${row.sha}:${row.pr_number}`,
					observed_at: row.synced_text,
					matched_value: row.sha,
					match_rule: "membership",
					details: JSON.stringify({ lastSeenHeadSha: row.last_seen_head_sha }),
				})),
			),
	});
	// Only a merged PR's merge commit: an open PR's is a test merge that moves.
	await pages(input.executor, MergeSchema, {
		query: `SELECT number, merge_commit_sha, toString(merged_at) AS merged_text
			FROM ${getSafeClickHouseTable("rudel.github_pull_requests")} FINAL
			WHERE ${window} AND merged_at IS NOT NULL AND merge_commit_sha != '' ORDER BY number`,
		params,
		onPage: (rows) =>
			write(
				rows.map((row) => ({
					...base,
					from_kind: "commit",
					from_id: commitNodeId(repository, row.merge_commit_sha),
					relation: "commit_in_pr",
					to_kind: "pull_request",
					to_id: pullRequestNodeId(repository, row.number),
					evidence_id: `gh_pr_merge:${row.number}`,
					observed_at: row.merged_text,
					matched_value: row.merge_commit_sha,
					match_rule: "merge_commit",
					details: "{}",
				})),
			),
	});
	await pages(input.executor, RunSchema, {
		query: `SELECT toString(kind) AS run_kind, run_id, attempt, head_sha, toString(created_at) AS created_text
			FROM ${getSafeClickHouseTable("rudel.github_ci_runs")} FINAL
			WHERE ${window} AND kind != 'check_suite' AND head_sha != '' ORDER BY run_kind, run_id, attempt`,
		params,
		onPage: (rows) =>
			write(
				rows.map((row) => ({
					...base,
					from_kind: "commit",
					from_id: commitNodeId(repository, row.head_sha),
					relation: "ci_on_sha",
					to_kind: "ci_run",
					to_id: ciRunNodeId(repository, row.run_kind, row.run_id, row.attempt),
					evidence_id: `gh_run:${row.run_kind}:${row.run_id}:${row.attempt}`,
					observed_at: row.created_text,
					matched_value: row.head_sha,
					match_rule: "head_sha",
					details: "{}",
				})),
			),
	});
	await pages(input.executor, RunLinkSchema, {
		query: `SELECT pr_number, toString(kind) AS run_kind, run_id, attempt, toString(basis) AS basis,
				toString(run_created_at) AS run_created_text
			FROM ${getSafeClickHouseTable("rudel.github_ci_run_pull_requests")} FINAL
			WHERE ${window} AND kind != 'check_suite' ORDER BY pr_number, run_kind, run_id, attempt`,
		params,
		onPage: (rows) =>
			write(
				rows.map((row) => ({
					...base,
					from_kind: "pull_request",
					from_id: pullRequestNodeId(repository, row.pr_number),
					relation: "ci_for_pr",
					to_kind: "ci_run",
					to_id: ciRunNodeId(repository, row.run_kind, row.run_id, row.attempt),
					evidence_id: `gh_run_pr:${row.pr_number}:${row.run_kind}:${row.run_id}:${row.attempt}`,
					observed_at: row.run_created_text,
					matched_value: String(row.pr_number),
					match_rule: row.basis,
					details: "{}",
				})),
			),
	});
	return { edgeCount, watermark: now };
}

async function pages<T>(
	executor: ClickHouseExecutor,
	schema: z.ZodType<T>,
	statement: {
		query: string;
		params: Record<string, unknown>;
		onPage: (rows: T[]) => Promise<void>;
	},
): Promise<void> {
	for (let offset = 0; ; offset += PAGE_ROWS) {
		const rows = await query(executor, schema, {
			query: `${statement.query} LIMIT {limit:UInt32} OFFSET {offset:UInt64}`,
			query_params: { ...statement.params, limit: PAGE_ROWS, offset },
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		});
		await statement.onPage(rows);
		if (rows.length < PAGE_ROWS) return;
	}
}

function clickHouseTime(ms: number): string {
	return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}
