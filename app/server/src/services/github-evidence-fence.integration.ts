import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { CostDashboardInputSchema } from "@rudel/api-routes";
import type {
	PageRequest,
	PullRequestSummary,
	SourceCoverage,
	SourcePage,
	SourceProvenance,
	SourceResult,
	WorkflowJob,
	WorkflowRun,
} from "@rudel/repo-intelligence-source-github";
import { FakeEvidenceR2 } from "../__tests__/helpers/fake-evidence-r2.js";
import { queryClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { drainMaintenancePasses } from "../lib/bounded-maintenance.js";
import { purgeRepositoryEvidenceObjects } from "./clickhouse-purge.service.js";
import type { GitHubEvidenceSource } from "./github-evidence-collector.service.js";
import { runGitHubEvidenceCollectionMaintenance } from "./github-evidence-maintenance.service.js";
import { sweepGitHubEvidenceObjects } from "./github-evidence-object-fence.service.js";
import {
	collectAndPersistGitHubCommitEvidence,
	enqueueGitHubEvidenceCollection,
	GitHubEvidenceCapacityError,
} from "./github-evidence-persistence.service.js";
import { getGitHubOutcomesDashboardMetrics } from "./github-outcomes-dashboard.service.js";
import { deleteUserPostgresData } from "./user-deletion.service.js";

setDefaultTimeout(60_000);

const RUN_ID = randomUUID().slice(0, 8);
const COMMIT_SHA = "b".repeat(40);
const CONFIG = {
	appId: "1",
	privateKeyPem: "unused",
	slug: "github-fence-integration",
};
const COMPLETE: SourceCoverage = { reasons: [], state: "complete" };
const PROVENANCE: SourceProvenance = {
	apiVersion: "2026-03-10",
	endpoint: "/fixture",
	provider: "github",
	repository: { name: "athena", owner: "opalinehq" },
	requestId: null,
	retrievedAt: "2026-09-30T10:00:00.000Z",
	schemaVersion: 1,
	sourceVersion: "fixture.v1",
	transfer: { conditional: "disabled", downloadedBytes: 1, etag: null },
};

interface Workspace {
	readonly organizationId: string;
	readonly repositoryId: string;
	readonly userId: string;
}

const ORGANIZATION_IDS: string[] = [];
const USER_IDS: string[] = [];

afterAll(async () => {
	await sqlClient.unsafe(
		"DELETE FROM github_evidence_object_intent WHERE organization_id = ANY($1::text[])",
		[ORGANIZATION_IDS],
	);
	await sqlClient.unsafe(
		"DELETE FROM clickhouse_purge_job WHERE target_id = ANY($1::text[])",
		[[...ORGANIZATION_IDS, ...USER_IDS]],
	);
	await sqlClient.unsafe(
		"DELETE FROM organization WHERE id = ANY($1::text[])",
		[ORGANIZATION_IDS],
	);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = ANY($1::text[])', [
		USER_IDS,
	]);
});

async function createWorkspace(name: string): Promise<Workspace> {
	const organizationId = `gh-fence-${name}-org-${RUN_ID}`;
	const userId = `gh-fence-${name}-user-${RUN_ID}`;
	const installationId = `gh-fence-${name}-installation-${RUN_ID}`;
	const repositoryId = `gh-fence-${name}-repository-${RUN_ID}`;
	ORGANIZATION_IDS.push(organizationId);
	USER_IDS.push(userId);
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email) VALUES ($1, 'Fence', $2)`,
		[userId, `${userId}@example.test`],
	);
	await sqlClient.unsafe(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'Fence', $1)",
		[organizationId],
	);
	await sqlClient.unsafe(
		`INSERT INTO github_app_installation
		 (installation_id, organization_id, account_id, account_login, account_type,
		  repository_selection, permissions, status, installed_by_user_id)
		 VALUES ($1, $2, '1', 'opalinehq', 'Organization', 'selected', '{}'::jsonb,
		         'active', $3)`,
		[installationId, organizationId, userId],
	);
	await sqlClient.unsafe(
		`INSERT INTO github_repository_binding
		 (organization_id, repository_id, installation_id, node_id, owner, name,
		  full_name, default_branch, is_private, status)
		 VALUES ($1, $2, $3, $4, 'opalinehq', 'athena', 'opalinehq/athena', 'main',
		         true, 'active')`,
		[organizationId, repositoryId, installationId, `node-${name}-${RUN_ID}`],
	);
	return { organizationId, repositoryId, userId };
}

function page<TItem>(items: readonly TItem[]): SourcePage<TItem> {
	return {
		availability: { state: "available" },
		coverage: COMPLETE,
		items,
		nextCursor: null,
		provenance: PROVENANCE,
		status: "available",
	};
}

function result<TData>(data: TData): SourceResult<TData> {
	return {
		availability: { state: "available" },
		coverage: COMPLETE,
		data,
		provenance: PROVENANCE,
		status: "available",
	};
}

function pullRequest(): PullRequestSummary {
	return {
		author: null,
		baseRef: "main",
		baseSha: "f".repeat(40),
		body: null,
		closedAt: null,
		createdAt: "2026-09-30T09:00:00.000Z",
		draft: false,
		headRef: "feature",
		headSha: COMMIT_SHA,
		htmlUrl: "https://github.example/pull/7",
		id: "7",
		mergedAt: "2026-09-30T09:30:00.000Z",
		nodeId: "PR_7",
		number: 7,
		state: "closed",
		title: "Fence fixture",
		updatedAt: "2026-09-30T09:30:00.000Z",
	};
}

function workflowRun(): WorkflowRun {
	return {
		conclusion: "failure",
		createdAt: "2026-09-30T09:00:00.000Z",
		displayTitle: "CI",
		event: "push",
		headBranch: "main",
		headSha: COMMIT_SHA,
		htmlUrl: "https://github.example/run/1",
		id: "run-1",
		name: "CI",
		nodeId: "RUN_1",
		runAttempt: 1,
		runNumber: 1,
		runStartedAt: "2026-09-30T09:00:00.000Z",
		status: "completed",
		updatedAt: "2026-09-30T09:05:00.000Z",
		workflowId: "workflow-1",
	};
}

function workflowJob(id: string): WorkflowJob {
	return {
		completedAt: "2026-09-30T09:05:00.000Z",
		conclusion: "failure",
		headSha: COMMIT_SHA,
		htmlUrl: `https://github.example/job/${id}`,
		id,
		labels: [],
		name: id,
		runAttempt: 1,
		runId: "run-1",
		startedAt: "2026-09-30T09:00:00.000Z",
		status: "completed",
		steps: [],
	};
}

function createSource(options: {
	readonly completeCommit?: boolean;
	readonly failCommit?: boolean;
	readonly logPrefix: string;
	readonly onCommit?: () => Promise<void>;
	readonly onJobLog?: (jobId: string) => void;
}): GitHubEvidenceSource {
	const empty = async (
		_repository: unknown,
		_id: unknown,
		_page: PageRequest,
	) => page<never>([]);
	return {
		async getCommit() {
			await options.onCommit?.();
			if (options.failCommit) throw new Error("GitHub is unavailable");
			if (options.completeCommit)
				return result({
					sha: COMMIT_SHA,
					message: "Fixture",
					parentShas: [],
					author: null,
					authorEmail: "author@example.test",
					authorName: "Author",
					authoredAt: PROVENANCE.retrievedAt,
					committer: null,
					committerEmail: "author@example.test",
					committerName: "Author",
					committedAt: PROVENANCE.retrievedAt,
					htmlUrl: `https://github.example/commit/${COMMIT_SHA}`,
				});
			return {
				availability: {
					state: "unavailable",
					message: "n/a",
					reason: "not-found",
				},
				coverage: { reasons: [], state: "unavailable" },
				provenance: PROVENANCE,
				status: "unavailable",
			} satisfies SourceResult<never>;
		},
		async getWorkflowJobLog(_repository, jobId) {
			options.onJobLog?.(jobId);
			const content = `${options.logPrefix} ${jobId}\n`;
			return result({
				content,
				contentBytes: content.length,
				contentType: "text/plain",
				jobId,
				originalByteLength: content.length,
				persistence: "secret-filter-required" as const,
				sensitivity: "secret-bearing" as const,
				truncated: false,
			});
		},
		listCheckRunAnnotations: empty,
		listCheckRuns: empty,
		listCheckSuites: empty,
		listCommitPullRequests: async () => page([pullRequest()]),
		listCommitStatuses: empty,
		listIssueComments: empty,
		listPullRequestFiles: empty,
		listPullRequestReviewComments: empty,
		listPullRequestReviews: empty,
		listWorkflowArtifacts: empty,
		listWorkflowJobs: async () =>
			page([workflowJob("job-a"), workflowJob("job-b")]),
		listWorkflowRuns: async () => page([workflowRun()]),
	};
}

function collect(
	workspace: Workspace,
	r2: FakeEvidenceR2,
	source: GitHubEvidenceSource,
	refresh = false,
) {
	return collectAndPersistGitHubCommitEvidence({
		refresh,
		commitSha: COMMIT_SHA,
		config: CONFIG,
		contextId: null,
		createInstallationToken: async () => "token",
		database: sqlClient,
		initiatedByUserId: workspace.userId,
		organizationId: workspace.organizationId,
		r2,
		repositoryId: workspace.repositoryId,
		sessionId: null,
		sourceFactory: () => source,
	});
}

async function countRows(sql: string, parameters: string[]): Promise<number> {
	const [row] = await sqlClient.unsafe<Array<{ count: number }>>(
		sql,
		parameters,
	);
	return row?.count ?? 0;
}

describe("GitHub evidence queue and attribution", () => {
	test("drains more than one daily batch and resumes durable work after the budget expires", async () => {
		const workspace = await createWorkspace("daily-drain");
		const r2 = new FakeEvidenceR2();
		for (let index = 0; index < 7; index++)
			await enqueueGitHubEvidenceCollection({
				commitSha: COMMIT_SHA,
				contextId: randomUUID(),
				database: sqlClient,
				initiatedByUserId: workspace.userId,
				organizationId: workspace.organizationId,
				repositoryId: workspace.repositoryId,
				sessionId: `drain-${index}`,
				sessionSource: "codex",
				sessionUserId: workspace.userId,
			});
		let clock = 0;
		const runPass = () =>
			runGitHubEvidenceCollectionMaintenance({
				config: CONFIG,
				createInstallationToken: async () => "token",
				database: sqlClient,
				limit: 5,
				r2,
				sourceFactory: () =>
					createSource({ completeCommit: true, logPrefix: "daily" }),
			});
		const first = await drainMaintenancePasses({
			deadline: { deadlineAt: 1, now: () => clock },
			maxIterations: 100,
			runPass: async () => {
				const result = await runPass();
				clock = 1;
				return result;
			},
		});
		expect(first).toMatchObject({
			hasMore: true,
			iterations: 1,
			stopReason: "deadline",
		});
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM github_evidence_collection WHERE organization_id = $1 AND status = 'queued'",
				[workspace.organizationId],
			),
		).toBe(2);
		const resumed = await drainMaintenancePasses({
			deadline: { deadlineAt: Date.now() + 60_000, now: Date.now },
			maxIterations: 100,
			runPass,
		});
		expect(resumed.hasMore).toBe(false);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM github_evidence_collection WHERE organization_id = $1 AND status = 'complete'",
				[workspace.organizationId],
			),
		).toBe(7);
	});

	test("the dashboard does not treat a complete empty first page and unavailable second page as zero", async () => {
		const workspace = await createWorkspace("dashboard-zero");
		const r2 = new FakeEvidenceR2();
		const base = createSource({ completeCommit: true, logPrefix: "dashboard" });
		const run = (source: GitHubEvidenceSource, refresh: boolean) =>
			collectAndPersistGitHubCommitEvidence({
				commitSha: COMMIT_SHA,
				config: CONFIG,
				contextId: null,
				createInstallationToken: async () => "token",
				database: sqlClient,
				initiatedByUserId: workspace.userId,
				now: () => new Date("2026-09-30T10:00:00Z"),
				organizationId: workspace.organizationId,
				refresh,
				r2,
				repositoryId: workspace.repositoryId,
				sessionId: null,
				sourceFactory: () => source,
			});
		await run(
			{
				...base,
				listCommitPullRequests: async (
					_repository,
					_sha,
					request,
				): Promise<SourcePage<PullRequestSummary>> =>
					request.cursor
						? {
								items: [],
								nextCursor: null,
								availability: {
									state: "unavailable",
									reason: "forbidden",
									message: "denied",
								},
								coverage: { state: "unavailable", reasons: [] },
								status: "unavailable",
								provenance: PROVENANCE,
							}
						: {
								items: [],
								nextCursor: "second",
								availability: { state: "available" },
								coverage: COMPLETE,
								status: "available",
								provenance: PROVENANCE,
							},
			},
			false,
		);
		const input = CostDashboardInputSchema.parse({
			startDate: "2026-09-30",
			endDate: "2026-09-30",
			splitBy: "none",
		});
		expect(
			(
				await getGitHubOutcomesDashboardMetrics(
					workspace.organizationId,
					input,
					null,
					false,
					{
						database: sqlClient,
						queryClickhouse,
					},
				)
			).mergedPullRequests,
		).toEqual(expect.objectContaining({ total: 0 }));
		await run(
			{ ...base, listCommitPullRequests: async () => page<never>([]) },
			true,
		);
		expect(
			(
				await getGitHubOutcomesDashboardMetrics(
					workspace.organizationId,
					input,
					null,
					false,
					{
						database: sqlClient,
						queryClickhouse,
					},
				)
			).mergedPullRequests?.total,
		).toBe(0);
	});

	test.each([
		"open",
		"no-pr",
		"ci-running",
	])("refreshes %s session-linked outcomes until terminal", async (state) => {
		const workspace = await createWorkspace(`observation-${state}`);
		const r2 = new FakeEvidenceR2();
		const initialAt = new Date("2026-09-01T10:00:00Z");
		const base = createSource({ completeCommit: true, logPrefix: "observe" });
		const source: GitHubEvidenceSource = {
			...base,
			listCommitPullRequests: async () =>
				state === "no-pr"
					? page<never>([])
					: page([
							{
								...pullRequest(),
								state: state === "open" ? "open" : "closed",
								mergedAt: state === "open" ? null : "2026-09-01T09:30:00Z",
							},
						]),
			listWorkflowRuns: async () =>
				page([
					{
						...workflowRun(),
						status: state === "ci-running" ? "in_progress" : "completed",
					},
				]),
		};
		await collectAndPersistGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			config: CONFIG,
			contextId: randomUUID(),
			createInstallationToken: async () => "token",
			database: sqlClient,
			initiatedByUserId: workspace.userId,
			now: () => initialAt,
			organizationId: workspace.organizationId,
			r2,
			repositoryId: workspace.repositoryId,
			sessionId: `observation-${state}`,
			sessionSource: "codex",
			sessionUserId: workspace.userId,
			sourceFactory: () => source,
		});
		const [first] = await sqlClient.unsafe<Array<{ refresh_due_at: string }>>(
			"SELECT refresh_due_at::text AS refresh_due_at FROM github_evidence_collection WHERE organization_id = $1",
			[workspace.organizationId],
		);
		if (!first) throw new Error("Expected a refresh deadline");
		expect(new Date(first.refresh_due_at).toISOString()).toBe(
			"2026-09-02T10:00:00.000Z",
		);
		const result = await runGitHubEvidenceCollectionMaintenance({
			config: CONFIG,
			createInstallationToken: async () => "token",
			database: sqlClient,
			now: () => new Date("2026-09-02T10:01:00Z"),
			r2,
			sourceFactory: () => base,
		});
		expect(result.succeeded).toBeGreaterThan(0);
		const [latest] = await sqlClient.unsafe<
			Array<{
				attempt_number: number;
				observation_started_at: string;
				refresh_due_at: Date | null;
			}>
		>(
			"SELECT attempt_number, observation_started_at::text AS observation_started_at, refresh_due_at FROM github_evidence_collection WHERE organization_id = $1 ORDER BY attempt_number DESC LIMIT 1",
			[workspace.organizationId],
		);
		expect(latest?.attempt_number).toBe(2);
		if (!latest) throw new Error("Expected a refreshed collection");
		expect(new Date(latest.observation_started_at).toISOString()).toBe(
			initialAt.toISOString(),
		);
		expect(latest?.refresh_due_at).toBeNull();
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM github_pull_request_snapshot WHERE organization_id = $1 AND merged_at IS NOT NULL",
				[workspace.organizationId],
			),
		).toBeGreaterThan(0);
	});

	test("stops unresolved refreshes at the 14-day observation horizon", async () => {
		const workspace = await createWorkspace("observation-horizon");
		const r2 = new FakeEvidenceR2();
		const base = createSource({ completeCommit: true, logPrefix: "horizon" });
		await collectAndPersistGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			config: CONFIG,
			contextId: null,
			createInstallationToken: async () => "token",
			database: sqlClient,
			initiatedByUserId: workspace.userId,
			now: () => new Date("2026-09-01T10:00:00Z"),
			organizationId: workspace.organizationId,
			r2,
			repositoryId: workspace.repositoryId,
			sessionId: "horizon",
			sessionSource: "codex",
			sessionUserId: workspace.userId,
			sourceFactory: () => ({
				...base,
				listCommitPullRequests: async () => page<never>([]),
			}),
		});
		await runGitHubEvidenceCollectionMaintenance({
			config: CONFIG,
			createInstallationToken: async () => "token",
			database: sqlClient,
			now: () => new Date("2026-09-15T10:00:00Z"),
			r2,
			sourceFactory: () => base,
		});
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM github_evidence_collection WHERE organization_id = $1",
				[workspace.organizationId],
			),
		).toBe(1);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM github_evidence_collection WHERE organization_id = $1 AND refresh_due_at IS NOT NULL",
				[workspace.organizationId],
			),
		).toBe(0);
	});

	test("account deletion anonymizes snapshots, cancels queued and active collections, and keeps workspace facts", async () => {
		const workspace = await createWorkspace("account-delete");
		const survivorId = randomUUID();
		USER_IDS.push(survivorId);
		await sqlClient.unsafe(
			"INSERT INTO \"user\" (id, name, email) VALUES ($1, 'Survivor', $2)",
			[survivorId, `${survivorId}@example.test`],
		);
		await sqlClient.unsafe(
			"INSERT INTO member (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'member'), ($4, $2, $5, 'owner')",
			[
				randomUUID(),
				workspace.organizationId,
				workspace.userId,
				randomUUID(),
				survivorId,
			],
		);
		const r2 = new FakeEvidenceR2();
		const identity = {
			commitSha: COMMIT_SHA,
			config: CONFIG,
			contextId: null,
			createInstallationToken: async () => "token",
			database: sqlClient,
			initiatedByUserId: workspace.userId,
			organizationId: workspace.organizationId,
			r2,
			repositoryId: workspace.repositoryId,
			sessionSource: "codex" as const,
			sessionUserId: workspace.userId,
		};
		await collectAndPersistGitHubCommitEvidence({
			...identity,
			sessionId: "accepted",
			sourceFactory: () =>
				createSource({ completeCommit: true, logPrefix: "retained" }),
		});
		const retainedKeys = [...r2.putKeys];
		await enqueueGitHubEvidenceCollection({ ...identity, sessionId: "queued" });
		await expect(
			collectAndPersistGitHubCommitEvidence({
				...identity,
				sessionId: "active",
				sourceFactory: () =>
					createSource({
						completeCommit: true,
						logPrefix: "cancelled",
						onCommit: async () => {
							await deleteUserPostgresData(workspace.userId, { sqlClient });
						},
					}),
			}),
		).rejects.toThrow();
		expect(r2.putKeys).toEqual(retainedKeys);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM github_evidence_collection WHERE organization_id = $1 AND status = 'cancelled'",
				[workspace.organizationId],
			),
		).toBe(2);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM github_evidence_collection WHERE session_user_id = $1",
				[workspace.userId],
			),
		).toBe(0);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM github_pull_request_snapshot WHERE organization_id = $1 AND session_user_id = '' AND session_id = ''",
				[workspace.organizationId],
			),
		).toBe(1);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM github_ci_log_receipt WHERE organization_id = $1",
				[workspace.organizationId],
			),
		).toBe(2);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM github_app_installation WHERE organization_id = $1",
				[workspace.organizationId],
			),
		).toBe(1);
	});

	test("acknowledges by durably queueing without contacting GitHub and is idempotent", async () => {
		const workspace = await createWorkspace("queue");
		const input = {
			commitSha: COMMIT_SHA,
			contextId: randomUUID(),
			database: sqlClient,
			initiatedByUserId: workspace.userId,
			organizationId: workspace.organizationId,
			repositoryId: workspace.repositoryId,
			sessionId: `session-${RUN_ID}`,
			sessionSource: "codex",
			sessionUserId: workspace.userId,
		};

		const first = await enqueueGitHubEvidenceCollection(input);
		const second = await enqueueGitHubEvidenceCollection(input);
		const missingBinding = await enqueueGitHubEvidenceCollection({
			...input,
			repositoryId: "not-bound",
		});

		expect(first.status).toBe("queued");
		expect(second).toEqual({
			collectionId: first.collectionId,
			status: "existing",
		});
		expect(missingBinding).toEqual({ collectionId: null, status: "skipped" });
		const [row] = await sqlClient.unsafe<
			Array<{ sessionSource: string; sessionUserId: string; status: string }>
		>(
			`SELECT status, session_source AS "sessionSource", session_user_id AS "sessionUserId"
			 FROM github_evidence_collection WHERE id = $1`,
			[first.collectionId],
		);
		expect(row).toEqual({
			sessionSource: "codex",
			sessionUserId: workspace.userId,
			status: "queued",
		});
	});

	test("keeps source and owner attribution when the first attempt fails before any snapshot and a retry succeeds", async () => {
		const workspace = await createWorkspace("attribution");
		const r2 = new FakeEvidenceR2();
		const queued = await enqueueGitHubEvidenceCollection({
			commitSha: COMMIT_SHA,
			contextId: randomUUID(),
			database: sqlClient,
			initiatedByUserId: workspace.userId,
			organizationId: workspace.organizationId,
			repositoryId: workspace.repositoryId,
			sessionId: `session-${RUN_ID}`,
			sessionSource: "claude_code",
			sessionUserId: workspace.userId,
		});
		const maintenance = (source: GitHubEvidenceSource) =>
			runGitHubEvidenceCollectionMaintenance({
				config: CONFIG,
				createInstallationToken: async () => "token",
				database: sqlClient,
				limit: 25,
				r2,
				sourceFactory: () => source,
			});

		const failed = await maintenance(
			createSource({ failCommit: true, logPrefix: "first" }),
		);
		await sqlClient.unsafe(
			"UPDATE github_evidence_collection SET retry_after = NOW() - INTERVAL '1 minute' WHERE organization_id = $1 AND status = 'failed'",
			[workspace.organizationId],
		);
		const retried = await maintenance(createSource({ logPrefix: "second" }));

		expect(queued.status).toBe("queued");
		expect(failed.failed).toBeGreaterThanOrEqual(1);
		expect(retried.succeeded).toBeGreaterThanOrEqual(1);
		const snapshots = await sqlClient.unsafe<
			Array<{ sessionSource: string; sessionUserId: string }>
		>(
			`SELECT session_source AS "sessionSource", session_user_id AS "sessionUserId"
			 FROM github_pull_request_snapshot WHERE organization_id = $1`,
			[workspace.organizationId],
		);
		expect([...snapshots]).toEqual([
			{ sessionSource: "claude_code", sessionUserId: workspace.userId },
		]);
	});

	test("an explicit refresh keeps attribution from the original collection", async () => {
		const workspace = await createWorkspace("refresh");
		const r2 = new FakeEvidenceR2();
		const identity = {
			commitSha: COMMIT_SHA,
			contextId: randomUUID(),
			initiatedByUserId: workspace.userId,
			sessionId: `session-${RUN_ID}`,
		};
		await collectAndPersistGitHubCommitEvidence({
			...identity,
			config: CONFIG,
			createInstallationToken: async () => "token",
			database: sqlClient,
			organizationId: workspace.organizationId,
			r2,
			repositoryId: workspace.repositoryId,
			sessionSource: "codex",
			sessionUserId: workspace.userId,
			sourceFactory: () => createSource({ logPrefix: "one" }),
		});

		await collectAndPersistGitHubCommitEvidence({
			...identity,
			config: CONFIG,
			createInstallationToken: async () => "token",
			database: sqlClient,
			organizationId: workspace.organizationId,
			r2,
			refresh: true,
			repositoryId: workspace.repositoryId,
			sourceFactory: () => createSource({ logPrefix: "two" }),
		});

		const attributions = await sqlClient.unsafe<
			Array<{ sessionSource: string; sessionUserId: string }>
		>(
			`SELECT DISTINCT session_source AS "sessionSource", session_user_id AS "sessionUserId"
			 FROM github_pull_request_snapshot WHERE organization_id = $1`,
			[workspace.organizationId],
		);
		expect([...attributions]).toEqual([
			{ sessionSource: "codex", sessionUserId: workspace.userId },
		]);
	});
});

describe("GitHub evidence object fence", () => {
	test("refuses to write objects once an organization deletion tombstone exists", async () => {
		const workspace = await createWorkspace("tombstone");
		const r2 = new FakeEvidenceR2();
		const deletion = collect(
			workspace,
			r2,
			createSource({
				logPrefix: "late",
				onCommit: async () => {
					await sqlClient.unsafe(
						`INSERT INTO clickhouse_purge_job (id, target_type, target_id, max_attempts)
						 VALUES ($1, 'organization', $2, 5)`,
						[randomUUID(), workspace.organizationId],
					);
				},
			}),
		).catch((error: unknown) => error);

		const error = await deletion;

		expect(error).toBeInstanceOf(Error);
		expect(r2.putKeys).toEqual([]);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM github_evidence_object_intent WHERE organization_id = $1",
				[workspace.organizationId],
			),
		).toBe(0);
	});

	test("reclaims objects from an interrupted collection without touching referenced or live content", async () => {
		const workspace = await createWorkspace("orphans");
		const r2 = new FakeEvidenceR2();
		await collect(workspace, r2, createSource({ logPrefix: "committed" }));
		const committedKeys = [...r2.putKeys];
		expect(committedKeys.length).toBeGreaterThan(0);
		await sqlClient.unsafe(
			"UPDATE github_evidence_collection SET retry_after = NULL WHERE organization_id = $1",
			[workspace.organizationId],
		);
		const originalPut = r2.putObject.bind(r2);
		let interrupted = false;
		r2.putObject = async (input) => {
			if (input.metadata.kind === "ci-metadata") {
				interrupted = true;
				throw new Error("process died before the metadata write");
			}
			await originalPut(input);
		};
		const before = new Set(r2.objects.keys());

		const failure = await collect(
			workspace,
			r2,
			createSource({ logPrefix: "interrupted" }),
			true,
		).catch((error: unknown) => error);

		expect(interrupted).toBe(true);
		expect(failure).toBeInstanceOf(Error);
		const orphanKeys = [...r2.objects.keys()].filter((key) => !before.has(key));
		expect(orphanKeys.length).toBeGreaterThan(0);
		const liveKey = orphanKeys[0] ?? "";
		await sqlClient.unsafe(
			`INSERT INTO github_evidence_object_intent (id, organization_id, collection_id, object_key, due_at)
			 VALUES ($1, $2, $3, $4, NOW() + INTERVAL '2 hours')`,
			[randomUUID(), workspace.organizationId, randomUUID(), liveKey],
		);

		const swept = await sweepGitHubEvidenceObjects({
			database: sqlClient,
			now: new Date(Date.now() + 60 * 60_000),
			r2,
		});

		expect(swept.completed).toBeGreaterThan(0);
		for (const key of committedKeys) expect(r2.objects.has(key)).toBe(true);
		expect(r2.objects.has(liveKey)).toBe(true);
		for (const key of orphanKeys.filter((candidate) => candidate !== liveKey)) {
			expect(r2.objects.has(key)).toBe(false);
		}
	});

	test("the second purge pass deletes objects written after the first pass", async () => {
		const workspace = await createWorkspace("purge");
		const r2 = new FakeEvidenceR2();
		await sqlClient.unsafe(
			`INSERT INTO clickhouse_purge_job (id, target_type, target_id, max_attempts)
			 VALUES ($1, 'organization', $2, 5)`,
			[randomUUID(), workspace.organizationId],
		);
		const target = {
			targetId: workspace.organizationId,
			targetType: "organization" as const,
		};
		const firstPass = {
			finalPass: false,
			purgeJobId: randomUUID(),
		};
		await purgeRepositoryEvidenceObjects(target, firstPass, sqlClient, r2);
		const lateKey = `repository-evidence/v1/${RUN_ID}/late-object`;
		await sqlClient.unsafe(
			`INSERT INTO github_evidence_object_intent (id, organization_id, collection_id, object_key, due_at)
			 VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour')`,
			[randomUUID(), workspace.organizationId, randomUUID(), lateKey],
		);
		await r2.putObject({
			body: new Uint8Array([1]),
			contentType: "text/plain",
			metadata: {},
			objectKey: lateKey,
		});

		await purgeRepositoryEvidenceObjects(
			target,
			{ ...firstPass, finalPass: true },
			sqlClient,
			r2,
		);

		expect(r2.objects.has(lateKey)).toBe(false);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM github_evidence_object_intent WHERE organization_id = $1",
				[workspace.organizationId],
			),
		).toBe(0);
	});
});

describe("GitHub evidence memory bounds", () => {
	test("persists each job log before the next one is fetched", async () => {
		const workspace = await createWorkspace("incremental");
		const r2 = new FakeEvidenceR2();
		const putsAtFetch: Record<string, number> = {};

		await collect(
			workspace,
			r2,
			createSource({
				logPrefix: "stream",
				onJobLog: (jobId) => {
					putsAtFetch[jobId] = r2.putKeys.filter((key) =>
						key.includes("/ci-log/"),
					).length;
				},
			}),
		);

		expect(putsAtFetch["job-a"]).toBe(0);
		expect(putsAtFetch["job-b"]).toBe(1);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM github_ci_log_receipt WHERE organization_id = $1 AND object_key IS NOT NULL",
				[workspace.organizationId],
			),
		).toBe(2);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM github_evidence_object_intent WHERE organization_id = $1",
				[workspace.organizationId],
			),
		).toBe(0);
	});

	test("rejects collections beyond the active budget without reserving an attempt", async () => {
		const gate = Promise.withResolvers<void>();
		const entered: Array<Promise<void>> = [];
		const workspaces = await Promise.all([
			createWorkspace("capacity-a"),
			createWorkspace("capacity-b"),
			createWorkspace("capacity-c"),
		]);
		const blocking = (workspace: Workspace) => {
			const started = Promise.withResolvers<void>();
			entered.push(started.promise);
			return collect(
				workspace,
				new FakeEvidenceR2(),
				createSource({
					logPrefix: "capacity",
					onCommit: async () => {
						started.resolve();
						await gate.promise;
					},
				}),
			);
		};
		const first = blocking(workspaces[0] as Workspace);
		const second = blocking(workspaces[1] as Workspace);
		await Promise.all(entered);

		const rejected = await collect(
			workspaces[2] as Workspace,
			new FakeEvidenceR2(),
			createSource({ logPrefix: "capacity" }),
		).catch((error: unknown) => error);
		gate.resolve();
		await Promise.all([first, second]);
		const afterRelease = await collect(
			workspaces[2] as Workspace,
			new FakeEvidenceR2(),
			createSource({ logPrefix: "capacity" }),
		);

		expect(rejected).toBeInstanceOf(GitHubEvidenceCapacityError);
		expect(afterRelease.status).toBeDefined();
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM github_evidence_collection WHERE organization_id = $1",
				[(workspaces[2] as Workspace).organizationId],
			),
		).toBe(1);
	});
});
