import {
	createGitHubAuthorization,
	createGitHubSweepSource,
	GitHubSourceError,
} from "@rudel/repo-intelligence-source-github";
import type postgres from "postgres";
import { z } from "zod";
import { getClickhouse } from "../clickhouse.js";
import {
	createGitHubInstallationAccessToken,
	type GitHubRepositoryAppConfig,
} from "./github-app.service.js";
import { latestGitHubEvidenceAttempt } from "./github-evidence-maintenance.service.js";
import {
	flushGitHubOutcomesBatch,
	type GitHubOutcomesBatch,
	type GitHubOutcomesScope,
	lockGitHubOutcomesBinding,
	persistGitHubChecks,
	persistGitHubCommits,
	persistGitHubJobs,
	persistGitHubPullRequests,
	persistGitHubRuns,
	persistGitHubStatuses,
} from "./github-outcomes-persistence.service.js";
import { refreshPrTotalsReadiness } from "./github-outcomes-readiness.service.js";
import { L1_EDGE_SESSION_DEBOUNCE_MS } from "./l1-edges/l1-edge-enqueue.js";
import { enqueueL1EdgeScope } from "./l1-edges/l1-edge-queue.service.js";
import {
	assertPostgresLeaseHeld,
	PostgresLeaseLostError,
	withPostgresLease,
} from "./postgres-lease.service.js";

const DAY_MS = 86_400_000;
// Longer than the 20-second sweep budget plus its final writes, and renewed
// while the sweep runs; a crashed worker frees the installation within it.
const SWEEP_LEASE_TTL_MS = 60_000;
// Attempts precede jobs so the jobs dataset also sees the earlier attempts a
// pass has just stored.
const DATASETS = [
	"actions",
	"attempts",
	"jobs",
	"pulls",
	"external",
	"commits",
];
/**
 * The next run attempt after the cursor whose jobs are still to collect,
 * whatever its conclusion. An attempt is left out only once an earlier pass
 * (synced before this window ended) stored its jobs after the run completed
 * and every job had completed: GitHub no longer changes them, so each pass
 * fetches only new or unsettled attempts. Jobs this pass stored do not count,
 * so an attempt whose jobs span several pages stays the candidate until its
 * last page. An attempt without any jobs (a workflow that failed to start) is
 * asked again each pass.
 */
const JOBS_CANDIDATE_QUERY = `SELECT r.run_id AS provider_id, r.attempt AS attempt, r.conclusion AS conclusion
   FROM (
     SELECT run_id, attempt, conclusion, status, completed_at FROM rudel.github_ci_runs FINAL
     WHERE workspace_id = {workspace:String} AND provider = 'github' AND repository_id = {repository:String} AND kind = 'actions_run'
     AND created_at BETWEEN parseDateTime64BestEffort({from:String}, 3, 'UTC') AND parseDateTime64BestEffort({to:String}, 3, 'UTC')
     AND (run_id > {after:String} OR (run_id = {after:String} AND attempt > {attempt:UInt32}))
   ) AS r
   LEFT ANY JOIN (
     SELECT run_id, attempt, 1 AS collected, countIf(status != 'completed') AS open, min(synced_at) AS first_synced, max(synced_at) AS last_synced
     FROM rudel.github_ci_jobs FINAL
     WHERE workspace_id = {workspace:String} AND provider = 'github' AND repository_id = {repository:String}
     GROUP BY run_id, attempt
   ) AS j ON r.run_id = j.run_id AND r.attempt = j.attempt
   WHERE NOT (ifNull(j.collected, 0) = 1 AND ifNull(j.open, 1) = 0 AND r.status = 'completed' AND r.completed_at IS NOT NULL
     AND ifNull(j.last_synced < parseDateTime64BestEffort({to:String}, 3, 'UTC') AND j.first_synced >= r.completed_at, 0))
   ORDER BY r.run_id, r.attempt LIMIT 1 SETTINGS max_execution_time = 10`;
const cursorSchema = z.object({
	page: z.number().int().positive().default(1),
	after: z.string().default(""),
	attempt: z.number().int().positive().default(1),
	operation: z
		.enum(["checks", "statuses", "attempt", "jobs"])
		.default("checks"),
	offset: z.number().int().nonnegative().default(0),
	headSha: z.string().nullable().default(null),
	oldestRun: z.string().nullable().default(null),
	updatedSince: z.string().nullable().default(null),
});
type Cursor = z.infer<typeof cursorSchema>;
interface Sweep extends GitHubOutcomesScope {
	dataset: string;
	window_start: Date;
	window_end: Date;
	retention_boundary: Date | null;
	cursor: unknown;
}
interface Binding extends GitHubOutcomesScope {
	installation_id: string;
	owner: string;
	name: string;
}
interface RunCandidate {
	provider_id: string;
	attempt: number;
	conclusion: string | null;
}
interface PullCandidate {
	provider_pull_request_id: string;
	number: number;
	head_sha: string;
}
interface Step {
	write: (database: postgres.Sql | postgres.TransactionSql) => Promise<void>;
	cursor: Cursor;
	complete: boolean;
	split?: boolean;
}

export function isGitHubSweepEnabled(
	environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	return environment.GITHUB_SWEEP_ENABLED !== "false";
}

export async function enqueueGitHubRepositorySweep(
	scope: GitHubOutcomesScope,
	now: Date,
	database: postgres.Sql | postgres.TransactionSql,
	restart = false,
): Promise<void> {
	if (restart)
		await database.unsafe(
			`UPDATE github_repository_sweep SET status = 'pending', error = NULL, completed_at = NULL
		 WHERE organization_id = $1 AND repository_id = $2 AND status = 'unavailable' AND error <> 'provider-retention'`,
			[scope.organizationId, scope.repositoryId],
		);
	const [previous] = await database.unsafe<
		Array<{
			end: Date | string | null;
			pending: boolean;
			boundary: Date | string | null;
		}>
	>(
		`SELECT max(window_end) AS end, bool_or(status = 'pending') AS pending, min(retention_boundary) AS boundary
		 FROM github_repository_sweep WHERE organization_id = $1 AND repository_id = $2`,
		[scope.organizationId, scope.repositoryId],
	);
	if (
		previous?.pending ||
		(previous?.end &&
			now.getTime() - databaseDate(previous.end).getTime() < DAY_MS)
	)
		return;
	const horizon = new Date(now);
	horizon.setUTCFullYear(horizon.getUTCFullYear() - 2);
	const from = horizon;
	const to = new Date(Math.floor(now.getTime() / 1000) * 1000);
	const start = new Date(Math.floor(from.getTime() / 1000) * 1000);
	const ciStart = previous?.boundary
		? Math.max(start.getTime(), databaseDate(previous.boundary).getTime())
		: start.getTime();
	const [previousPullPass] = await database.unsafe<
		Array<{ started_at: Date | string | null }>
	>(
		`SELECT max(window_end) AS started_at FROM github_repository_sweep WHERE organization_id = $1 AND repository_id = $2 AND dataset = 'pulls' AND status = 'complete'`,
		[scope.organizationId, scope.repositoryId],
	);
	const updatedSince = previousPullPass?.started_at
		? new Date(
				databaseDate(previousPullPass.started_at).getTime() - 3_600_000,
			).toISOString()
		: null;
	for (
		let windowStart = ciStart;
		windowStart <= to.getTime();
		windowStart += 7 * DAY_MS
	) {
		await insertSweep(
			scope,
			"actions",
			new Date(windowStart),
			new Date(Math.min(to.getTime(), windowStart + 7 * DAY_MS - 1000)),
			previous?.boundary ? databaseDate(previous.boundary) : null,
			database,
		);
	}
	for (const dataset of DATASETS.slice(1))
		await insertSweep(
			scope,
			dataset,
			start,
			to,
			previous?.boundary ? databaseDate(previous.boundary) : null,
			database,
			dataset === "pulls" || dataset === "commits" ? updatedSince : null,
		);
}

export async function runGitHubRepositorySweep(input: {
	readonly database: postgres.Sql;
	readonly config: GitHubRepositoryAppConfig;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly fetch?: typeof globalThis.fetch;
	readonly createToken?: typeof createGitHubInstallationAccessToken;
	readonly now?: () => Date;
	readonly signal?: AbortSignal;
	readonly maxRequests?: number;
	readonly budgetMs?: number;
	readonly organizationId?: string;
}): Promise<{ enabled: boolean; requests: number; hasMore: boolean }> {
	if (!isGitHubSweepEnabled(input.environment))
		return { enabled: false, requests: 0, hasMore: false };
	const now = input.now ?? (() => new Date());
	const deadline = Date.now() + (input.budgetMs ?? 20_000);
	const maxRequests = input.maxRequests ?? 100;
	const bindings = await input.database.unsafe<Binding[]>(
		`SELECT binding.organization_id AS "organizationId", binding.repository_id AS "repositoryId", binding.installation_id, binding.owner, binding.name
		 FROM github_repository_binding binding INNER JOIN github_app_installation installation
		 ON installation.installation_id = binding.installation_id AND installation.organization_id = binding.organization_id
		 WHERE binding.status = 'active' AND installation.status = 'active' AND ($1::text IS NULL OR binding.organization_id = $1)
		 ORDER BY (SELECT min(window_start) FROM github_repository_sweep sweep WHERE sweep.organization_id = binding.organization_id AND sweep.repository_id = binding.repository_id AND sweep.status = 'pending') NULLS FIRST`,
		[input.organizationId ?? null],
	);
	let requests = 0;
	let deferred = false;
	for (const binding of bindings) {
		if (
			Date.now() >= deadline ||
			input.signal?.aborted ||
			requests >= maxRequests
		) {
			deferred = true;
			break;
		}
		const outcome = await withPostgresLease(
			`github-sweep-installation:${binding.installation_id}`,
			async (lease) => {
				const signal = input.signal
					? AbortSignal.any([input.signal, lease.signal])
					: lease.signal;
				await input.database.begin(async (transaction) => {
					if (await lockGitHubOutcomesBinding(binding, transaction))
						await enqueueGitHubRepositorySweep(binding, now(), transaction);
				});
				let source: ReturnType<typeof createGitHubSweepSource> | undefined;
				while (
					Date.now() < deadline &&
					!signal.aborted &&
					requests < maxRequests &&
					isGitHubSweepEnabled(input.environment)
				) {
					const sweep = await nextSweep(binding, input.database);
					if (!sweep) break;
					if (await liveLanePending(binding.installation_id, input.database)) {
						deferred = true;
						break;
					}
					try {
						if (!source) {
							const [budget] = await input.database.unsafe<
								Array<{ available: boolean }>
							>(
								`SELECT sweep_rate_remaining IS NULL OR sweep_rate_remaining > 0 OR sweep_rate_reset_at <= $2 AS available FROM github_app_installation WHERE installation_id = $1`,
								[binding.installation_id, now().toISOString()],
							);
							if (!budget?.available) {
								deferred = true;
								break;
							}
							const requestFetch = input.fetch ?? globalThis.fetch;
							const tokenFetch: typeof globalThis.fetch = Object.assign(
								async (url: string | URL | Request, init?: RequestInit) => {
									const response = await requestFetch(url, {
										...init,
										signal: AbortSignal.any([
											AbortSignal.timeout(Math.max(1, deadline - Date.now())),
											signal,
										]),
									});
									if (response.status === 403 || response.status === 404) {
										await response.body?.cancel();
										throw new GitHubSourceError({
											kind: response.status === 403 ? "forbidden" : "not-found",
											status: response.status,
											message: "GitHub installation token is unavailable",
											endpoint: "/app/installations/access_tokens",
											requestId: response.headers.get("x-github-request-id"),
											retryAfterMs: null,
										});
									}
									return response;
								},
								{ preconnect: requestFetch.preconnect },
							);
							const token = await (
								input.createToken ?? createGitHubInstallationAccessToken
							)({
								config: input.config,
								installationId: binding.installation_id,
								fetch: tokenFetch,
								now: now(),
							});
							const boundedFetch: typeof globalThis.fetch = Object.assign(
								async (url: string | URL | Request, init?: RequestInit) => {
									if (
										Date.now() >= deadline ||
										signal.aborted ||
										requests >= maxRequests ||
										!isGitHubSweepEnabled(input.environment) ||
										(await liveLanePending(
											binding.installation_id,
											input.database,
										))
									)
										throw new Error("sweep-yield");
									if (
										!(await reserveRateBudget(
											binding.installation_id,
											now(),
											input.database,
										))
									)
										throw new Error("sweep-yield");
									requests += 1;
									const response = await requestFetch(url, {
										...init,
										signal: AbortSignal.any([
											AbortSignal.timeout(Math.max(1, deadline - Date.now())),
											signal,
										]),
									});
									await recordRateBudget(
										binding.installation_id,
										response.headers,
										now(),
										input.database,
									);
									return response;
								},
								{ preconnect: requestFetch.preconnect },
							);
							source = createGitHubSweepSource({
								authorization: createGitHubAuthorization(token),
								fetch: boundedFetch,
							});
						}
						const batch: GitHubOutcomesBatch = new Map();
						const step = await collectStep(
							sweep,
							binding,
							source,
							now(),
							batch,
						);
						await input.database.begin(async (transaction) => {
							if (!(await lockGitHubOutcomesBinding(binding, transaction)))
								return;
							await step.write(transaction);
							await flushGitHubOutcomesBatch(
								binding,
								batch,
								lease.signal,
								transaction,
							);
							// New GitHub facts: project the repository's L1 edges.
							await enqueueL1EdgeScope(
								transaction,
								{
									kind: "repository",
									organizationId: binding.organizationId,
									repositoryId: binding.repositoryId,
								},
								{ debounceMs: L1_EDGE_SESSION_DEBOUNCE_MS },
							);
							// A worker that took over an expired lease owns the cursor now; a
							// stalled worker must not move it back.
							await assertPostgresLeaseHeld(lease, transaction);
							if (step.split) await splitWindow(sweep, transaction);
							else
								await updateSweep(
									sweep,
									step.cursor,
									step.complete ? "complete" : "pending",
									now(),
									transaction,
								);
							if (sweep.dataset === "actions" && step.complete)
								await finalizeRetention(binding, transaction);
						});
					} catch (error) {
						if (
							error instanceof GitHubSourceError &&
							(error.status === 403 || error.status === 404) &&
							error.kind !== "rate-limit"
						) {
							await input.database.unsafe(
								`UPDATE github_repository_sweep SET status = 'unavailable', error = $3, updated_at = $4 WHERE organization_id = $1 AND repository_id = $2 AND status = 'pending'`,
								[
									binding.organizationId,
									binding.repositoryId,
									`github-${error.status}`,
									now().toISOString(),
								],
							);
						} else if (
							error instanceof GitHubSourceError &&
							error.kind === "rate-limit"
						) {
							await input.database.unsafe(
								`UPDATE github_app_installation SET sweep_rate_remaining = 0, sweep_rate_reset_at = GREATEST(sweep_rate_reset_at, $2::timestamptz) WHERE installation_id = $1`,
								[
									binding.installation_id,
									new Date(
										now().getTime() + Math.max(60_000, error.retryAfterMs ?? 0),
									).toISOString(),
								],
							);
							deferred = true;
						} else if (
							error instanceof GitHubSourceError &&
							error.kind === "network"
						)
							deferred = true;
						else if (
							error instanceof PostgresLeaseLostError ||
							signal.aborted ||
							Date.now() >= deadline
						)
							deferred = true;
						else throw error;
						break;
					}
				}
			},
			{ database: input.database, ttlMs: SWEEP_LEASE_TTL_MS },
		);
		if (outcome.status === "busy") deferred = true;
	}
	for (const organizationId of new Set(
		bindings.map((binding) => binding.organizationId),
	))
		await refreshPrTotalsReadiness(input.database, organizationId, now());
	const [pending] = await input.database.unsafe<Array<{ exists: boolean }>>(
		`SELECT EXISTS(SELECT 1 FROM github_repository_sweep sweep INNER JOIN github_repository_binding binding USING (organization_id, repository_id) INNER JOIN github_app_installation installation ON installation.installation_id = binding.installation_id WHERE sweep.status = 'pending' AND binding.status = 'active' AND installation.status = 'active' AND ($1::text IS NULL OR sweep.organization_id = $1))`,
		[input.organizationId ?? null],
	);
	return {
		enabled: true,
		requests,
		hasMore: deferred || (pending?.exists ?? false),
	};
}

async function collectStep(
	sweep: Sweep,
	binding: Binding,
	source: ReturnType<typeof createGitHubSweepSource>,
	now: Date,
	batch: GitHubOutcomesBatch,
): Promise<Step> {
	const cursor = cursorSchema.parse(sweep.cursor);
	const root = `/repos/${encodeURIComponent(binding.owner)}/${encodeURIComponent(binding.name)}`;
	const empty = async () => {};
	if (sweep.dataset === "actions") {
		const result = await source.runs(
			root,
			sweep.window_start.toISOString(),
			sweep.window_end.toISOString(),
			cursor.page,
		);
		if (result.data.total_count >= 1000)
			return { write: empty, cursor, complete: false, split: true };
		const oldest = result.data.workflow_runs.reduce<string | null>(
			(value, run) =>
				!value || run.created_at < value ? run.created_at : value,
			cursor.oldestRun,
		);
		return {
			write: (writer) =>
				persistGitHubRuns(
					binding,
					result.data.workflow_runs,
					"sweep",
					now,
					writer,
					batch,
				),
			cursor: { ...cursor, page: cursor.page + 1, oldestRun: oldest },
			complete: !result.hasNext,
		};
	}
	if (sweep.dataset === "pulls") {
		const result = await source.pulls(root, cursor.page);
		const cutoff = Math.max(
			sweep.window_start.getTime(),
			Date.parse(cursor.updatedSince ?? sweep.window_start.toISOString()),
		);
		const stoppingPoint = result.data.findIndex(
			(pr) => Date.parse(pr.updated_at) < cutoff,
		);
		const items =
			stoppingPoint < 0 ? result.data : result.data.slice(0, stoppingPoint);
		return {
			write: (writer) =>
				persistGitHubPullRequests(binding, items, "sweep", now, writer, batch),
			cursor: { ...cursor, page: cursor.page + 1 },
			complete: !result.hasNext || items.length < result.data.length,
		};
	}
	const params = {
		workspace: binding.organizationId,
		repository: binding.repositoryId,
		from: sweep.window_start.toISOString(),
		to: sweep.window_end.toISOString(),
		after: cursor.after,
		attempt: cursor.attempt,
		updatedSince: cursor.updatedSince ?? sweep.window_start.toISOString(),
	};
	if (sweep.dataset === "jobs") {
		const [run] = await getClickhouse().query<RunCandidate>({
			query: JOBS_CANDIDATE_QUERY,
			query_params: params,
		});
		if (!run) return { write: empty, cursor, complete: true };
		const result = await source.jobs(
			root,
			run.provider_id,
			run.attempt,
			cursor.page,
		);
		return {
			write: (writer) =>
				persistGitHubJobs(binding, result.data.jobs, now, writer, batch),
			cursor: result.hasNext
				? { ...cursor, page: cursor.page + 1 }
				: { ...cursor, after: run.provider_id, attempt: run.attempt, page: 1 },
			complete: false,
		};
	}
	if (sweep.dataset === "attempts") {
		const [run] = await getClickhouse().query<RunCandidate>({
			query: `SELECT run_id AS provider_id, attempt, conclusion FROM rudel.github_ci_runs FINAL
   WHERE workspace_id = {workspace:String} AND provider = 'github' AND repository_id = {repository:String} AND kind = 'actions_run'
   AND created_at BETWEEN parseDateTime64BestEffort({from:String}, 3, 'UTC') AND parseDateTime64BestEffort({to:String}, 3, 'UTC')
   AND run_id > {after:String} AND attempt > 1
   ORDER BY run_id, attempt DESC LIMIT 1 SETTINGS max_execution_time = 10`,
			query_params: params,
		});
		if (!run) return { write: empty, cursor, complete: true };
		if (cursor.attempt >= run.attempt)
			return {
				write: empty,
				cursor: {
					...cursor,
					after: run.provider_id,
					attempt: 1,
					operation: "attempt",
				},
				complete: false,
			};
		// The attempt's jobs follow in the jobs dataset, which runs after this one.
		const result = await source.attempt(root, run.provider_id, cursor.attempt);
		return {
			write: (writer) =>
				persistGitHubRuns(binding, [result], "sweep", now, writer, batch),
			cursor: { ...cursor, operation: "attempt", attempt: cursor.attempt + 1 },
			complete: false,
		};
	}
	const [pr] = await getClickhouse().query<PullCandidate>({
		query: `SELECT provider_pull_request_id, number, head_sha FROM rudel.github_pull_requests FINAL WHERE workspace_id = {workspace:String} AND provider = 'github' AND repository_id = {repository:String}
  AND updated_at >= parseDateTime64BestEffort({from:String}, 3, 'UTC') AND provider_pull_request_id > {after:String}
  ${sweep.dataset === "external" ? "AND updated_at >= parseDateTime64BestEffort({boundary:String}, 3, 'UTC')" : ""}
  ${sweep.dataset === "commits" && cursor.updatedSince ? "AND updated_at >= parseDateTime64BestEffort({updatedSince:String}, 3, 'UTC') AND synced_at >= parseDateTime64BestEffort({to:String}, 3, 'UTC')" : ""}
  ORDER BY provider_pull_request_id LIMIT 1 SETTINGS max_execution_time = 10`,
		query_params: {
			...params,
			boundary:
				sweep.retention_boundary?.toISOString() ??
				sweep.window_start.toISOString(),
		},
	});
	if (!pr) return { write: empty, cursor, complete: true };
	if (
		sweep.dataset === "commits" &&
		cursor.headSha &&
		cursor.headSha !== pr.head_sha
	)
		return {
			write: empty,
			cursor: { ...cursor, headSha: pr.head_sha, page: 1, offset: 0 },
			complete: false,
		};
	if (sweep.dataset === "external") {
		if (cursor.operation === "statuses") {
			const result = await source.statuses(root, pr.head_sha, cursor.page);
			return {
				write: (writer) =>
					persistGitHubStatuses(
						binding,
						result.data.statuses,
						pr.head_sha,
						"sweep",
						now,
						writer,
						batch,
					),
				cursor: result.hasNext
					? { ...cursor, page: cursor.page + 1 }
					: {
							...cursor,
							after: pr.provider_pull_request_id,
							page: 1,
							operation: "checks",
						},
				complete: false,
			};
		}
		const result = await source.checks(root, pr.head_sha, cursor.page);
		return {
			write: (writer) =>
				persistGitHubChecks(
					binding,
					result.data.check_runs,
					"check_run",
					"sweep",
					now,
					writer,
					batch,
				),
			cursor: result.hasNext
				? { ...cursor, page: cursor.page + 1 }
				: { ...cursor, page: 1, operation: "statuses" },
			complete: false,
		};
	}
	const result = await source.commits(root, pr.number, cursor.page);
	const items = result.data.slice(0, 250 - cursor.offset);
	const offset = cursor.offset + items.length;
	const done = !result.hasNext || offset >= 250;
	return {
		write: (writer) =>
			persistGitHubCommits(
				binding,
				items,
				pr.number,
				pr.head_sha,
				now,
				writer,
				batch,
			),
		cursor: done
			? {
					...cursor,
					after: pr.provider_pull_request_id,
					page: 1,
					offset: 0,
					headSha: null,
				}
			: { ...cursor, page: cursor.page + 1, offset, headSha: pr.head_sha },
		complete: false,
	};
}

async function nextSweep(
	scope: GitHubOutcomesScope,
	database: postgres.Sql,
): Promise<Sweep | undefined> {
	const [sweep] = await database.unsafe<Sweep[]>(
		`SELECT organization_id AS "organizationId", repository_id AS "repositoryId", dataset, window_start, window_end, retention_boundary, cursor
		 FROM github_repository_sweep WHERE organization_id = $1 AND repository_id = $2 AND status = 'pending'
		 ORDER BY array_position(ARRAY['actions','attempts','jobs','pulls','external','commits'], dataset), window_start LIMIT 1`,
		[scope.organizationId, scope.repositoryId],
	);
	return sweep
		? {
				...sweep,
				window_start: databaseDate(sweep.window_start),
				window_end: databaseDate(sweep.window_end),
				retention_boundary: sweep.retention_boundary
					? databaseDate(sweep.retention_boundary)
					: null,
			}
		: undefined;
}

async function insertSweep(
	scope: GitHubOutcomesScope,
	dataset: string,
	from: Date,
	to: Date,
	boundary: Date | null,
	database: postgres.Sql | postgres.TransactionSql,
	updatedSince: string | null = null,
): Promise<void> {
	await database.unsafe(
		`INSERT INTO github_repository_sweep (organization_id, repository_id, dataset, window_start, window_end, retention_boundary, cursor) VALUES ($1, $2, $3, $4, $5, $6, $7::text::jsonb) ON CONFLICT DO NOTHING`,
		[
			scope.organizationId,
			scope.repositoryId,
			dataset,
			from.toISOString(),
			to.toISOString(),
			boundary?.toISOString() ?? null,
			JSON.stringify(updatedSince ? { updatedSince } : {}),
		],
	);
}

async function updateSweep(
	sweep: Sweep,
	cursor: Cursor,
	status: string,
	now: Date,
	database: postgres.TransactionSql,
): Promise<void> {
	await database.unsafe(
		`UPDATE github_repository_sweep SET cursor = $6::text::jsonb, status = $7, updated_at = $8, completed_at = CASE WHEN $7 = 'complete' THEN $8::timestamptz ELSE NULL END WHERE organization_id = $1 AND repository_id = $2 AND dataset = $3 AND window_start = $4 AND window_end = $5`,
		[
			sweep.organizationId,
			sweep.repositoryId,
			sweep.dataset,
			sweep.window_start.toISOString(),
			sweep.window_end.toISOString(),
			JSON.stringify(cursor),
			status,
			now.toISOString(),
		],
	);
}

async function splitWindow(
	sweep: Sweep,
	database: postgres.TransactionSql,
): Promise<void> {
	const seconds =
		(sweep.window_end.getTime() - sweep.window_start.getTime()) / 1000;
	const midpoint = new Date(
		sweep.window_start.getTime() + Math.floor(seconds / 2) * 1000,
	);
	await database.unsafe(
		`UPDATE github_repository_sweep SET status = $6, error = $7 WHERE organization_id = $1 AND repository_id = $2 AND dataset = $3 AND window_start = $4 AND window_end = $5`,
		[
			sweep.organizationId,
			sweep.repositoryId,
			sweep.dataset,
			sweep.window_start.toISOString(),
			sweep.window_end.toISOString(),
			seconds < 1 ? "unavailable" : "split",
			seconds < 1 ? "provider-result-cap" : null,
		],
	);
	if (seconds < 1) return;
	await insertSweep(
		sweep,
		"actions",
		sweep.window_start,
		midpoint,
		sweep.retention_boundary,
		database,
	);
	await insertSweep(
		sweep,
		"actions",
		new Date(midpoint.getTime() + 1000),
		sweep.window_end,
		sweep.retention_boundary,
		database,
	);
}

async function finalizeRetention(
	scope: GitHubOutcomesScope,
	database: postgres.TransactionSql,
): Promise<void> {
	const [state] = await database.unsafe<
		Array<{ pending: boolean; boundary: Date | null; end: Date }>
	>(
		`SELECT bool_or(status = 'pending') AS pending, min((cursor->>'oldestRun')::timestamptz) AS boundary, max(window_end) AS end FROM github_repository_sweep WHERE organization_id = $1 AND repository_id = $2 AND dataset = 'actions'`,
		[scope.organizationId, scope.repositoryId],
	);
	if (!state || state.pending) return;
	if (!state.boundary) return;
	const boundary = databaseDate(state.boundary);
	const [cliff] = await database.unsafe<Array<{ observed: boolean }>>(
		`SELECT EXISTS(SELECT 1 FROM github_repository_sweep WHERE organization_id = $1 AND repository_id = $2 AND dataset = 'actions' AND completed_at IS NOT NULL AND cursor->>'oldestRun' IS NULL AND window_end < $3) AS observed`,
		[scope.organizationId, scope.repositoryId, boundary.toISOString()],
	);
	if (!cliff?.observed) return;
	await database.unsafe(
		`UPDATE github_repository_sweep SET retention_boundary = LEAST(retention_boundary, $3::timestamptz), status = CASE WHEN dataset = 'actions' AND status = 'complete' AND window_start < $3 AND cursor->>'oldestRun' IS NULL THEN 'unavailable' ELSE status END, error = CASE WHEN dataset = 'actions' AND status = 'complete' AND window_start < $3 AND cursor->>'oldestRun' IS NULL THEN 'provider-retention' ELSE error END WHERE organization_id = $1 AND repository_id = $2`,
		[scope.organizationId, scope.repositoryId, boundary.toISOString()],
	);
}

function databaseDate(value: Date | string): Date {
	return typeof value === "string" ? new Date(value) : value;
}

async function liveLanePending(
	installationId: string,
	database: postgres.Sql,
): Promise<boolean> {
	const [result] = await database.unsafe<Array<{ pending: boolean }>>(
		`SELECT EXISTS(SELECT 1 FROM github_evidence_collection candidate WHERE installation_id = $1 AND (status = 'collecting' AND lease_expires_at > NOW() OR status = 'queued' AND retry_after <= NOW() OR refresh_due_at <= NOW()) AND ${latestGitHubEvidenceAttempt("candidate")}) AS pending`,
		[installationId],
	);
	return result?.pending ?? false;
}

async function reserveRateBudget(
	installationId: string,
	now: Date,
	database: postgres.Sql,
): Promise<boolean> {
	const result = await database.unsafe(
		`UPDATE github_app_installation SET sweep_rate_remaining = CASE WHEN sweep_rate_reset_at <= $2 OR sweep_rate_remaining IS NULL THEN -1 ELSE sweep_rate_remaining - 1 END, sweep_rate_reset_at = CASE WHEN sweep_rate_reset_at <= $2 OR sweep_rate_reset_at IS NULL THEN $2::timestamptz + INTERVAL '1 hour' ELSE sweep_rate_reset_at END WHERE installation_id = $1 AND status = 'active' AND (sweep_rate_remaining IS NULL OR sweep_rate_remaining > 0 OR sweep_rate_reset_at <= $2) RETURNING installation_id`,
		[installationId, now.toISOString()],
	);
	return result.length > 0;
}

async function recordRateBudget(
	installationId: string,
	headers: Headers,
	now: Date,
	database: postgres.Sql,
): Promise<void> {
	const remaining = Number(headers.get("x-ratelimit-remaining"));
	const reset = Number(headers.get("x-ratelimit-reset"));
	if (
		!headers.has("x-ratelimit-remaining") ||
		!Number.isFinite(remaining) ||
		!Number.isFinite(reset) ||
		reset * 1000 <= now.getTime()
	)
		return;
	await database.unsafe(
		`UPDATE github_app_installation SET sweep_rate_remaining = CASE WHEN sweep_rate_remaining = -1 THEN $4 ELSE LEAST(sweep_rate_remaining, $2) END, sweep_rate_reset_at = $3 WHERE installation_id = $1`,
		[
			installationId,
			Math.floor(remaining / 2),
			new Date(reset * 1000).toISOString(),
			Math.max(0, Math.floor((remaining - 1) / 2)),
		],
	);
}
