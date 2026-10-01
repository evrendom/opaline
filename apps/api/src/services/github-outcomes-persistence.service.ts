import type {
	SweepCheck,
	SweepJob,
	SweepPullRequest,
	SweepRun,
	SweepStatus,
} from "@rudel/repo-intelligence-source-github";
import { filterKnownSecrets } from "@rudel/secret-filter";
import type postgres from "postgres";
import { getClickhouse } from "../clickhouse.js";
import { assertNoClickHousePurgeTombstone } from "./clickhouse-purge-tombstone.service.js";

export interface GitHubOutcomesScope {
	readonly organizationId: string;
	readonly repositoryId: string;
}
type Row = Record<string, string | number | null | string[]>;
type Writer = postgres.Sql | postgres.TransactionSql;
type Origin = "sweep" | "webhook";
export type GitHubOutcomesBatch = Map<string, Row[]>;

export async function lockGitHubOutcomesBinding(
	scope: GitHubOutcomesScope,
	database: postgres.TransactionSql,
): Promise<boolean> {
	const rows = await database.unsafe(
		`SELECT binding.repository_id FROM github_repository_binding binding
 INNER JOIN github_app_installation installation ON installation.installation_id = binding.installation_id AND installation.organization_id = binding.organization_id
 WHERE binding.organization_id = $1 AND binding.repository_id = $2 AND binding.status = 'active' AND installation.status = 'active' FOR SHARE OF binding, installation`,
		[scope.organizationId, scope.repositoryId],
	);
	return rows.length > 0;
}

export async function flushGitHubOutcomesBatch(
	scope: GitHubOutcomesScope,
	batch: GitHubOutcomesBatch,
	database: Writer,
): Promise<void> {
	for (const [table, rows] of batch) await insert(scope, table, rows, database);
}

export async function persistGitHubPullRequests(
	scope: GitHubOutcomesScope,
	items: readonly SweepPullRequest[],
	origin: Origin,
	now: Date,
	database: Writer,
	batch?: GitHubOutcomesBatch,
): Promise<void> {
	await write(
		scope,
		"github_pull_requests",
		items.map((item) => ({
			...tenant(scope, now),
			number: item.number,
			provider_pull_request_id: item.id,
			state: clean(item.state),
			draft: Number(item.draft),
			created_at: time(item.created_at),
			updated_at: time(item.updated_at),
			closed_at: time(item.closed_at),
			merged_at: time(item.merged_at),
			head_sha: item.head.sha,
			head_ref: clean(item.head.ref),
			base_ref: clean(item.base.ref),
			head_repository_id: item.head.repo?.id ?? "",
			merge_commit_sha: item.merge_commit_sha ?? "",
			author_id: item.user?.id ?? "",
			author_login: clean(item.user?.login),
			title: clean(item.title),
			labels: item.labels.slice(0, 100).map(({ name }) => clean(name)),
			version: Date.parse(item.updated_at),
		})),
		origin,
		database,
		batch,
	);
	await write(
		scope,
		"github_pull_request_details",
		items
			.filter(
				(item) =>
					item.additions !== undefined ||
					item.deletions !== undefined ||
					item.changed_files !== undefined ||
					item.commits !== undefined ||
					item.merged_by !== undefined,
			)
			.map((item) => ({
				...tenant(scope, now),
				number: item.number,
				additions: item.additions ?? null,
				deletions: item.deletions ?? null,
				changed_files: item.changed_files ?? null,
				commits: item.commits ?? null,
				merged_by: clean(item.merged_by?.login),
				version: Date.parse(item.updated_at),
			})),
		origin,
		database,
		batch,
	);
	if (items.length === 0) return;
	const runs = await getClickhouse().query<{
		run_id: string;
		attempt: number;
		created_at: string;
		kind: string;
		head_sha: string;
	}>({
		query: `SELECT run_id, attempt, created_at, kind, head_sha FROM rudel.github_ci_runs FINAL WHERE workspace_id = {workspace:String} AND provider = 'github' AND repository_id = {repository:String} AND head_sha IN {heads:Array(String)} SETTINGS max_execution_time = 10`,
		query_params: {
			workspace: scope.organizationId,
			repository: scope.repositoryId,
			heads: items.map((item) => item.head.sha),
		},
	});
	const links = items.flatMap((pr) =>
		runs
			.filter((run) => run.head_sha === pr.head.sha)
			.map((run) =>
				link(
					scope,
					now,
					pr.number,
					run.created_at,
					run.kind,
					run.run_id,
					run.attempt,
					"head-sha",
				),
			),
	);
	await write(
		scope,
		"github_ci_run_pull_requests",
		links,
		origin,
		database,
		batch,
	);
}

export async function persistGitHubRuns(
	scope: GitHubOutcomesScope,
	items: readonly SweepRun[],
	origin: Origin,
	now: Date,
	database: Writer,
	batch?: GitHubOutcomesBatch,
): Promise<void> {
	await persistCi(
		scope,
		items.map((item) => ({
			...ci(
				scope,
				now,
				"actions_run",
				item.id,
				item.run_attempt,
				item.created_at,
				item.updated_at,
				item.head_sha,
			),
			workflow_id: item.workflow_id ?? "",
			workflow_name: clean(item.name),
			workflow_path: clean(item.path),
			event: clean(item.event),
			head_branch: clean(item.head_branch),
			status: clean(item.status),
			conclusion: nullableClean(item.conclusion),
			run_started_at: time(item.run_started_at),
			completed_at: item.status === "completed" ? time(item.updated_at) : null,
			actor: clean(item.actor?.login),
			triggering_actor: clean(item.triggering_actor?.login),
			display_title: clean(item.display_title),
		})),
		items.map((item) => item.pull_requests),
		origin,
		now,
		database,
		batch,
	);
}

export async function persistGitHubChecks(
	scope: GitHubOutcomesScope,
	items: readonly SweepCheck[],
	kind: "check_suite" | "check_run",
	origin: Origin,
	now: Date,
	database: Writer,
	batch?: GitHubOutcomesBatch,
): Promise<void> {
	const checks = items.filter(
		(item) =>
			kind !== "check_run" ||
			(item.app?.slug !== "github-actions" && item.started_at != null),
	);
	await persistCi(
		scope,
		checks.map((item) => ({
			...ci(
				scope,
				now,
				kind,
				item.id,
				1,
				kind === "check_run"
					? (item.started_at ?? "")
					: (item.created_at ??
							item.started_at ??
							item.completed_at ??
							now.toISOString()),
				item.updated_at ?? null,
				item.head_sha,
			),
			workflow_name: clean(item.name),
			head_branch: clean(item.head_branch),
			status: clean(item.status),
			conclusion: nullableClean(item.conclusion),
			run_started_at: time(item.started_at),
			completed_at: time(item.completed_at),
			app_slug: clean(item.app?.slug),
		})),
		checks.map((item) => item.pull_requests),
		origin,
		now,
		database,
		batch,
	);
}

export async function persistGitHubStatuses(
	scope: GitHubOutcomesScope,
	items: readonly SweepStatus[],
	headSha: string,
	origin: Origin,
	now: Date,
	database: Writer,
	batch?: GitHubOutcomesBatch,
): Promise<void> {
	await persistCi(
		scope,
		items.map((item) => ({
			...ci(
				scope,
				now,
				"status",
				item.id,
				1,
				item.created_at,
				item.updated_at,
				item.sha ?? headSha,
			),
			workflow_name: clean(item.context),
			display_title: clean(item.description),
			status: item.state === "pending" ? "pending" : "completed",
			conclusion: item.state === "pending" ? null : clean(item.state),
			actor: clean(item.creator?.login),
		})),
		items.map(() => []),
		origin,
		now,
		database,
		batch,
	);
}

export async function persistGitHubJobs(
	scope: GitHubOutcomesScope,
	items: readonly SweepJob[],
	now: Date,
	database: Writer,
	batch?: GitHubOutcomesBatch,
): Promise<void> {
	await write(
		scope,
		"github_ci_jobs",
		items.map((item) => ({
			...tenant(scope, now),
			run_id: item.run_id,
			attempt: item.run_attempt,
			job_id: item.id,
			name: clean(item.name),
			status: clean(item.status),
			conclusion: nullableClean(item.conclusion),
			created_at: time(item.created_at),
			started_at: time(item.started_at),
			completed_at: time(item.completed_at),
			runner_name: clean(item.runner_name),
			labels: item.labels.slice(0, 100).map(clean),
			version: Date.parse(
				item.completed_at ??
					item.started_at ??
					item.created_at ??
					now.toISOString(),
			),
		})),
		"sweep",
		database,
		batch,
	);
}

export async function persistGitHubCommits(
	scope: GitHubOutcomesScope,
	items: readonly { sha: string }[],
	prNumber: number,
	headSha: string,
	now: Date,
	database: Writer,
	batch?: GitHubOutcomesBatch,
): Promise<void> {
	await write(
		scope,
		"github_pull_request_commits",
		items.map((item) => ({
			...tenant(scope, now),
			sha: item.sha,
			pr_number: prNumber,
			last_seen_head_sha: headSha,
			version: now.getTime(),
		})),
		"sweep",
		database,
		batch,
	);
}

async function persistCi(
	scope: GitHubOutcomesScope,
	rows: Row[],
	memberships: readonly (readonly { number: number }[])[],
	origin: Origin,
	now: Date,
	database: Writer,
	batch?: GitHubOutcomesBatch,
): Promise<void> {
	await write(scope, "github_ci_runs", rows, origin, database, batch);
	if (rows.length === 0) return;
	const pulls = await getClickhouse().query<{
		number: number;
		head_sha: string;
	}>({
		query: `SELECT number, head_sha FROM rudel.github_pull_requests FINAL WHERE workspace_id = {workspace:String} AND provider = 'github' AND repository_id = {repository:String} AND head_sha IN {heads:Array(String)} SETTINGS max_execution_time = 10`,
		query_params: {
			workspace: scope.organizationId,
			repository: scope.repositoryId,
			heads: rows.map((row) => row.head_sha),
		},
	});
	const links = rows.flatMap((row, index) => {
		const numbers = memberships[index] ?? [];
		const make = (number: number, basis: string) =>
			link(
				scope,
				now,
				number,
				String(row.created_at),
				String(row.kind),
				String(row.run_id),
				Number(row.attempt),
				basis,
			);
		return [
			...numbers.map(({ number }) => make(number, "provider")),
			...pulls
				.filter(
					(pr) =>
						pr.head_sha === row.head_sha &&
						!numbers.some(({ number }) => number === pr.number),
				)
				.map((pr) => make(pr.number, "head-sha")),
		];
	});
	await write(
		scope,
		"github_ci_run_pull_requests",
		links,
		origin,
		database,
		batch,
	);
}

async function write(
	scope: GitHubOutcomesScope,
	table: string,
	rows: Row[],
	_origin: Origin,
	database: Writer,
	batch: GitHubOutcomesBatch | undefined,
): Promise<void> {
	if (rows.length === 0) return;
	if (batch) batch.set(table, [...(batch.get(table) ?? []), ...rows]);
	else await insert(scope, table, rows, database);
}

async function insert(
	scope: GitHubOutcomesScope,
	table: string,
	rows: Row[],
	database: Writer,
): Promise<void> {
	if (rows.length === 0) return;
	await assertNoClickHousePurgeTombstone(scope, { database });
	const active = await database.unsafe(
		`SELECT 1 FROM github_repository_binding binding INNER JOIN github_app_installation installation ON installation.installation_id = binding.installation_id AND installation.organization_id = binding.organization_id WHERE binding.organization_id = $1 AND binding.repository_id = $2 AND binding.status = 'active' AND installation.status = 'active'`,
		[scope.organizationId, scope.repositoryId],
	);
	if (active.length === 0) throw new Error("github-outcomes-binding-inactive");
	await getClickhouse().insert({
		table: `rudel.${table}`,
		values: rows,
		asyncInsert: true,
	});
}

function ci(
	scope: GitHubOutcomesScope,
	now: Date,
	kind: string,
	runId: string,
	attempt: number,
	createdAt: string,
	updatedAt: string | null,
	headSha: string,
): Row {
	return {
		...tenant(scope, now),
		kind,
		run_id: runId,
		attempt,
		created_at: time(createdAt),
		updated_at: time(updatedAt),
		version: Date.parse(updatedAt ?? now.toISOString()),
		head_sha: headSha,
		workflow_id: "",
		workflow_name: "",
		workflow_path: "",
		app_slug: "",
		event: "",
		head_branch: "",
		status: "",
		conclusion: null,
		run_started_at: null,
		completed_at: null,
		actor: "",
		triggering_actor: "",
		display_title: "",
	};
}
function link(
	scope: GitHubOutcomesScope,
	now: Date,
	number: number,
	createdAt: string,
	kind: string,
	runId: string,
	attempt: number,
	basis: string,
): Row {
	return {
		...tenant(scope, now),
		pr_number: number,
		run_created_at: time(createdAt),
		kind,
		run_id: runId,
		attempt,
		basis,
		version: now.getTime(),
	};
}
function tenant(scope: GitHubOutcomesScope, now: Date) {
	return {
		workspace_id: scope.organizationId,
		provider: "github",
		repository_id: scope.repositoryId,
		synced_at: time(now.toISOString()),
	};
}
function time(value: string | null | undefined): string | null {
	return value == null
		? null
		: new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`)
				.toISOString()
				.replace("T", " ")
				.replace("Z", "");
}
function nullableClean(value: string | null | undefined): string | null {
	return value == null ? null : clean(value);
}
function clean(value: string | null | undefined): string {
	if (value == null) return "";
	const normalized = value
		.replace(/\p{Cc}/gu, "")
		.replace(/[\uD800-\uDFFF]/gu, "\uFFFD");
	return Array.from(filterKnownSecrets(normalized).text).slice(0, 512).join("");
}
