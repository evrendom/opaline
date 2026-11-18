import { getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import { refreshPrTotalsReadiness } from "../../services/github-outcomes-readiness.service.js";

export async function seedGitHubRepository(
	organizationId: string,
	repositoryId: string,
	fullName: string,
	options: {
		ciFrom?: string | null;
		status?: "complete" | "pending" | "unavailable";
		error?: string;
		now?: Date;
	} = {},
) {
	const now = options.now ?? new Date();
	const horizon = new Date(now);
	horizon.setUTCFullYear(horizon.getUTCFullYear() - 2);
	const ciFrom =
		options.ciFrom === undefined ? horizon.toISOString() : options.ciFrom;
	const installationId = `${repositoryId}-${organizationId}`;
	const [owner, name] = fullName.split("/");
	await sqlClient.unsafe(
		`INSERT INTO github_app_installation (installation_id, organization_id, account_id, account_login, account_type, repository_selection, permissions, status, installed_by_user_id) VALUES ($1, $2, '1', $3, 'Organization', 'selected', '{}'::jsonb, 'active', $2) ON CONFLICT DO NOTHING`,
		[installationId, organizationId, owner ?? "opalinehq"],
	);
	await sqlClient.unsafe(
		`INSERT INTO github_repository_binding (organization_id, repository_id, installation_id, node_id, owner, name, full_name, default_branch, is_private) VALUES ($1, $2, $3, $2, $4, $5, $6, 'main', true) ON CONFLICT DO NOTHING`,
		[
			organizationId,
			repositoryId,
			installationId,
			owner ?? "opalinehq",
			name ?? "athena",
			fullName,
		],
	);
	for (const dataset of ["pulls", "actions", "attempts", "external"])
		await sqlClient.unsafe(
			`INSERT INTO github_repository_sweep (organization_id, repository_id, dataset, window_start, window_end, status, retention_boundary, completed_at, error) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
			[
				organizationId,
				repositoryId,
				dataset,
				dataset === "actions" && ciFrom ? ciFrom : horizon.toISOString(),
				new Date(now.getTime() - 1000).toISOString(),
				options.status ?? "complete",
				dataset === "actions" ? ciFrom : null,
				now.toISOString(),
				options.error ?? null,
			],
		);
	await refreshPrTotalsReadiness(sqlClient, organizationId, now);
}

export async function seedGitHubPull(
	organizationId: string,
	repositoryId: string,
	number: number,
	createdAt: string,
	mergedAt: string | null,
	authorLogin = "octocat",
	authorId = "1",
	state: "open" | "closed" = mergedAt ? "closed" : "open",
) {
	await getClickhouse().insert({
		table: "rudel.github_pull_requests",
		values: [
			{
				workspace_id: organizationId,
				provider: "github",
				repository_id: repositoryId,
				number,
				provider_pull_request_id: String(number),
				state,
				created_at: chDate(createdAt),
				updated_at: chDate(mergedAt ?? createdAt),
				merged_at: mergedAt ? chDate(mergedAt) : null,
				author_login: authorLogin,
				author_id: authorId,
				head_sha: "b".repeat(40),
				version: Date.parse(mergedAt ?? createdAt),
				synced_at: chDate(new Date().toISOString()),
			},
		],
	});
}

export async function seedGitHubRun(
	organizationId: string,
	repositoryId: string,
	id: string,
	createdAt: string,
	options: {
		attempt?: number;
		kind?: "actions_run" | "check_run" | "check_suite" | "status";
		conclusion?: string | null;
		seconds?: number | null;
		pullNumber?: number;
		basis?: "provider" | "head-sha";
		event?: string;
		workflowId?: string;
		workflowName?: string;
	} = {},
) {
	const attempt = options.attempt ?? 1;
	const kind = options.kind ?? "actions_run";
	await getClickhouse().insert({
		table: "rudel.github_ci_runs",
		values: [
			{
				workspace_id: organizationId,
				provider: "github",
				repository_id: repositoryId,
				run_id: id,
				attempt,
				kind,
				created_at: chDate(createdAt),
				conclusion:
					options.conclusion === undefined ? "success" : options.conclusion,
				status: options.conclusion === null ? "in_progress" : "completed",
				run_started_at: chDate(createdAt),
				completed_at:
					options.seconds === null
						? null
						: chDate(
								new Date(
									Date.parse(createdAt) + (options.seconds ?? 60) * 1000,
								).toISOString(),
							),
				event: options.event ?? "pull_request",
				workflow_id: options.workflowId ?? "1",
				workflow_name: options.workflowName ?? "CI",
				version: Date.now(),
				synced_at: chDate(new Date().toISOString()),
			},
		],
	});
	if (options.pullNumber !== undefined)
		await getClickhouse().insert({
			table: "rudel.github_ci_run_pull_requests",
			values: [
				{
					workspace_id: organizationId,
					provider: "github",
					repository_id: repositoryId,
					pr_number: options.pullNumber,
					run_created_at: chDate(createdAt),
					kind,
					run_id: id,
					attempt,
					basis: options.basis ?? "provider",
					version: Date.now(),
					synced_at: chDate(new Date().toISOString()),
				},
			],
		});
}

function chDate(value: string) {
	return new Date(value).toISOString().replace("T", " ").replace("Z", "");
}
