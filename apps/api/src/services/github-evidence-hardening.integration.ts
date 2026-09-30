import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type {
	PullRequestFile,
	PullRequestSummary,
	SourceCoverage,
	SourcePage,
	SourceProvenance,
	SourceResult,
	WorkflowJob,
	WorkflowJobLog,
	WorkflowRun,
} from "@rudel/repo-intelligence-source-github";
import { FakeEvidenceR2 } from "../__tests__/helpers/fake-evidence-r2.js";
import { sqlClient } from "../db.js";
import type { GitHubEvidenceSource } from "./github-evidence-collector.service.js";
import { collectAndPersistGitHubCommitEvidence } from "./github-evidence-persistence.service.js";

const suffix = randomUUID();
const userId = `github-hardening-user-${suffix}`;
const organizationId = `github-hardening-org-${suffix}`;
const installationId = `github-hardening-installation-${suffix}`;
const repositoryId = `github-hardening-repository-${suffix}`;
const config = {
	appId: "1",
	privateKeyPem: "unused because the installation token is injected",
	slug: "github-hardening-integration",
};
const COMPLETE: SourceCoverage = { reasons: [], state: "complete" };
const PROVENANCE: SourceProvenance = {
	apiVersion: "2026-03-10",
	endpoint: "/fixture",
	provider: "github",
	repository: { name: "athena", owner: "opalinehq" },
	requestId: "request-1",
	retrievedAt: "2026-09-19T12:00:00.000Z",
	schemaVersion: 1,
	sourceVersion: "fixture.v1",
	transfer: { conditional: "disabled", downloadedBytes: 1, etag: null },
};
const CREDENTIAL_PATCH = "+DATABASE_PASSWORD=hunter2-hardening-canary";
const PEM_HEADER = "-----BEGIN RSA PRIVATE KEY-----";
const PEM_FOOTER = "-----END RSA PRIVATE KEY-----";
const PEM_BODY = [
	"MIIEowIBAAKCAQEA7VJTUt9Us8cKjMzEfYyjiWA4R4/M2bS1GB4t7NXp98C3SC6d",
	"VMvDuictGeurT8jNbvJZHtCSuYEvuNMoSfm76oqFvAp8Gy0iz5sxjZmSnXyCPykc",
].join("\n");

beforeAll(async () => {
	const connectionString = process.env.PG_CONNECTION_STRING;
	if (!connectionString) {
		throw new Error("PG_CONNECTION_STRING is required for integration tests");
	}
	if (
		!["127.0.0.1", "localhost", "::1"].includes(
			new URL(connectionString).hostname,
		)
	) {
		throw new Error(
			"GitHub hardening integration tests require loopback PostgreSQL",
		);
	}
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email) VALUES ($1, 'GitHub Hardening', $2)`,
		[userId, `${userId}@example.test`],
	);
	await sqlClient.unsafe(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'GitHub Hardening', $1)",
		[organizationId],
	);
	await sqlClient.unsafe(
		"INSERT INTO member (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'owner')",
		[randomUUID(), organizationId, userId],
	);
	await sqlClient.unsafe(
		`INSERT INTO github_app_installation
		 (installation_id, organization_id, account_id, account_login, account_type,
		  repository_selection, permissions, status, installed_by_user_id)
		 VALUES ($1, $2, '1', 'github-hardening', 'Organization', 'selected', '{}'::jsonb,
		         'active', $3)`,
		[installationId, organizationId, userId],
	);
	await sqlClient.unsafe(
		`INSERT INTO github_repository_binding
		 (organization_id, repository_id, installation_id, node_id, owner, name,
		  full_name, default_branch, is_private, status)
		 VALUES ($1, $2, $3, $4, 'opalinehq', 'athena', 'opalinehq/athena', 'main',
		         true, 'active')`,
		[organizationId, repositoryId, installationId, `node-${suffix}`],
	);
});

afterAll(async () => {
	await sqlClient.unsafe("DELETE FROM organization WHERE id = $1", [
		organizationId,
	]);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = $1', [userId]);
});

describe("GitHub pull request file credential paths", () => {
	test("persists metadata in bounded chunks before reading subsequent pages", async () => {
		const commitSha = "8".repeat(40);
		const r2 = new FakeEvidenceR2();
		let chunksBeforeSecondPage = 0;
		const result = await collectAndPersistGitHubCommitEvidence({
			commitSha,
			config,
			contextId: null,
			createInstallationToken: async () => "token",
			database: sqlClient,
			initiatedByUserId: userId,
			organizationId,
			r2,
			repositoryId,
			sessionId: null,
			sourceFactory: () =>
				createSource(commitSha, {
					listCommitPullRequests: async () =>
						availablePage([pullRequestFixture("pr-metadata", 8)], null),
					listPullRequestFiles: async (_repository, _pullNumber, request) => {
						if (request.cursor)
							chunksBeforeSecondPage = r2.putKeys.filter((key) =>
								key.includes("/ci-metadata/"),
							).length;
						const files = Array.from({ length: 3 }, (_, index) =>
							fileFixture(
								`src/${request.cursor ?? "first"}-${index}.ts`,
								`+${"padding ".repeat(50_000)}`,
								null,
							),
						);
						return availablePage(files, request.cursor ? null : "second");
					},
				}),
		});
		expect(chunksBeforeSecondPage).toBeGreaterThanOrEqual(4);
		const [row] = await sqlClient.unsafe<
			Array<{
				metadata_chunks: readonly { objectKey: string; byteLength: number }[];
			}>
		>("SELECT metadata_chunks FROM github_evidence_collection WHERE id = $1", [
			result.collectionId,
		]);
		if (!row) throw new Error("Expected metadata chunk receipts");
		expect(row.metadata_chunks.length).toBeGreaterThan(4);
		for (const chunk of row.metadata_chunks)
			expect((await r2.getObject(chunk.objectKey)).length).toBeLessThanOrEqual(
				1024 * 1024,
			);
		expect(
			(await readMetadata(r2, result.collectionId)).pullRequestFiles,
		).toHaveLength(6);
	});

	test("records explicit partial coverage when one metadata item exceeds the collection limit", async () => {
		const commitSha = "9".repeat(40);
		const r2 = new FakeEvidenceR2();
		const result = await collectAndPersistGitHubCommitEvidence({
			commitSha,
			config,
			contextId: null,
			createInstallationToken: async () => "token",
			database: sqlClient,
			initiatedByUserId: userId,
			organizationId,
			r2,
			repositoryId,
			sessionId: null,
			sourceFactory: () =>
				createSource(commitSha, {
					listCommitPullRequests: async () =>
						availablePage([pullRequestFixture("pr-large-metadata", 9)], null),
					listPullRequestFiles: async () =>
						availablePage(
							[
								fileFixture(
									"src/large.ts",
									`+${"padding ".repeat(150_000)}`,
									null,
								),
							],
							null,
						),
				}),
		});
		expect(result.status).toBe("partial");
		const metadata = await readMetadata(r2, result.collectionId);
		expect(metadata.pullRequestFiles).toEqual([]);
		expect(
			metadata.coverage.some(
				(record) =>
					record.dataset === "pull-request-files" &&
					record.reasons.some((reason) => reason.code === "local-byte-cap"),
			),
		).toBe(true);
	});
	test("never persists patches of credential paths while ordinary and template files keep theirs", async () => {
		const commitSha = "1".repeat(40);
		const r2 = new FakeEvidenceR2();
		const credentialFile = (
			path: string,
			previousPath: string | null = null,
		): PullRequestFile => fileFixture(path, CREDENTIAL_PATCH, previousPath);

		const result = await persist({
			commitSha,
			r2,
			source: createSource(commitSha, {
				async listCommitPullRequests() {
					return availablePage([pullRequestFixture("pr-1", 1)], null);
				},
				async listPullRequestFiles() {
					return availablePage(
						[
							credentialFile(".env"),
							credentialFile("config/.env.production"),
							credentialFile("home/.ssh/id_rsa"),
							credentialFile("certs/Server.PEM"),
							credentialFile("config/settings.txt", "config/.env"),
							fileFixture(".env.example", "+EXAMPLE_PLACEHOLDER=1", null),
							fileFixture("src/app.ts", "+export const ok = true;", null),
						],
						null,
					);
				},
			}),
		});

		const metadata = await readMetadata(r2, result.collectionId);
		const serialized = JSON.stringify(metadata);
		expect(serialized).not.toContain("hunter2-hardening-canary");
		for (const object of r2.objects.values()) {
			expect(new TextDecoder().decode(object.bytes)).not.toContain(
				"hunter2-hardening-canary",
			);
		}
		const patchesByPath = new Map(
			metadata.pullRequestFiles.map(({ file }) => [file.path, file.patch]),
		);
		expect(Object.fromEntries(patchesByPath)).toEqual({
			".env": null,
			".env.example": "+EXAMPLE_PLACEHOLDER=1",
			"certs/Server.PEM": null,
			"config/.env.production": null,
			"config/settings.txt": null,
			"home/.ssh/id_rsa": null,
			"src/app.ts": "+export const ok = true;",
		});
		const renamed = metadata.pullRequestFiles.find(
			({ file }) => file.path === "config/settings.txt",
		);
		expect(renamed?.file).toMatchObject({
			additions: 1,
			previousPath: "config/.env",
			status: "renamed",
		});
		expect(
			metadata.coverage.find(
				(record) => record.dataset === "pull-request-files",
			)?.reasons,
		).toEqual([expect.objectContaining({ code: "high-risk-path" })]);
	});
});

describe("GitHub job-log private keys at the byte cap", () => {
	test("persists no key body when the footer falls past the cap, and still redacts complete blocks", async () => {
		const commitSha = "2".repeat(40);
		const r2 = new FakeEvidenceR2();
		const logs = new Map<string, string>([
			["job-cut", `build ok\n${PEM_HEADER}\n${PEM_BODY}\n-----END RSA PRIV`],
			["job-complete", `${PEM_HEADER}\n${PEM_BODY}\n${PEM_FOOTER}\ntrailer\n`],
		]);

		const result = await persist({
			commitSha,
			r2,
			source: createSource(commitSha, {
				async listWorkflowRuns() {
					return availablePage([workflowRunFixture("run-1", commitSha)], null);
				},
				async listWorkflowJobs(_repository, runId) {
					return availablePage(
						[
							workflowJobFixture(runId, "job-cut", commitSha),
							workflowJobFixture(runId, "job-complete", commitSha),
						],
						null,
					);
				},
				async getWorkflowJobLog(_repository, jobId) {
					return logResult(jobId, logs.get(jobId) ?? "", jobId === "job-cut");
				},
			}),
		});

		const receipts = await sqlClient.unsafe<
			Array<{ job_id: string; object_key: string }>
		>(
			"SELECT job_id, object_key FROM github_ci_log_receipt WHERE collection_id = $1 ORDER BY job_id",
			[result.collectionId],
		);
		expect(receipts.map((receipt) => receipt.job_id)).toEqual([
			"job-complete",
			"job-cut",
		]);
		const stored = new Map<string, string>();
		for (const receipt of receipts) {
			stored.set(
				receipt.job_id,
				new TextDecoder().decode(await r2.getObject(receipt.object_key)),
			);
		}
		expect(stored.get("job-cut")).toBe("build ok\n[REDACTED:private-key]");
		expect(stored.get("job-complete")).toBe(
			"[REDACTED:private-key]\ntrailer\n",
		);
		for (const object of r2.objects.values()) {
			const text = new TextDecoder().decode(object.bytes);
			expect(text).not.toContain(PEM_BODY.slice(0, 40));
			expect(text).not.toContain(PEM_BODY.slice(-40));
		}
	});
});

describe("GitHub evidence coverage completeness", () => {
	test("records CI coverage as incomplete when a later workflow-jobs page is unavailable", async () => {
		const commitSha = "3".repeat(40);
		const sessionId = `coverage-session-${suffix}`;

		const result = await persist({
			commitSha,
			r2: new FakeEvidenceR2(),
			sessionId,
			source: createSource(commitSha, {
				async listCommitPullRequests() {
					return availablePage([pullRequestFixture("pr-1", 1)], null);
				},
				async listWorkflowRuns() {
					return availablePage([workflowRunFixture("run-1", commitSha)], null);
				},
				async listWorkflowJobs(_repository, runId, page) {
					return page.cursor === undefined
						? availablePage(
								[workflowJobFixture(runId, "job-1", commitSha)],
								"page-2",
							)
						: unavailablePage();
				},
			}),
		});

		expect(result.status).toBe("partial");
		const snapshots = await snapshotRows(result.collectionId);
		expect(snapshots).toEqual([
			{
				ci_coverage_complete: false,
				coverage_complete: true,
				provider_pull_request_id: "pr-1",
			},
		]);
	});

	test("records CI coverage as complete when every page of every dataset is complete", async () => {
		const commitSha = "4".repeat(40);

		const result = await persist({
			commitSha,
			r2: new FakeEvidenceR2(),
			sessionId: `complete-session-${suffix}`,
			source: createSource(commitSha, {
				async listCommitPullRequests() {
					return availablePage([pullRequestFixture("pr-1", 1)], null);
				},
				async listWorkflowRuns() {
					return availablePage([workflowRunFixture("run-1", commitSha)], null);
				},
				async listWorkflowJobs(_repository, runId, page) {
					return page.cursor === undefined
						? availablePage(
								[workflowJobFixture(runId, "job-1", commitSha)],
								"page-2",
							)
						: availablePage(
								[workflowJobFixture(runId, "job-2", commitSha)],
								null,
							);
				},
			}),
		});

		expect(result.status).toBe("complete");
		expect(await snapshotRows(result.collectionId)).toEqual([
			{
				ci_coverage_complete: true,
				coverage_complete: true,
				provider_pull_request_id: "pr-1",
			},
		]);
	});
});

describe("GitHub enumeration duplicates", () => {
	test("persists one row per repeated pull request and job with partial coverage", async () => {
		const commitSha = "5".repeat(40);
		const pullRequest = pullRequestFixture("pr-1", 1);
		const job = (runId: string) =>
			workflowJobFixture(runId, "job-1", commitSha);

		const result = await persist({
			commitSha,
			r2: new FakeEvidenceR2(),
			sessionId: `duplicate-session-${suffix}`,
			source: createSource(commitSha, {
				async listCommitPullRequests(_repository, _commitSha, page) {
					return page.cursor === undefined
						? availablePage([pullRequest], "page-2")
						: availablePage([{ ...pullRequest, title: "changed" }], null);
				},
				async listWorkflowRuns() {
					return availablePage(
						[
							workflowRunFixture("run-1", commitSha),
							workflowRunFixture("run-2", commitSha),
						],
						null,
					);
				},
				async listWorkflowJobs(_repository, runId, page) {
					return page.cursor === undefined
						? availablePage([job(runId)], "page-2")
						: availablePage([job("run-1")], null);
				},
			}),
		});

		expect(result.status).toBe("partial");
		expect(await snapshotRows(result.collectionId)).toEqual([
			{
				ci_coverage_complete: false,
				coverage_complete: false,
				provider_pull_request_id: "pr-1",
			},
		]);
		const receipts = await sqlClient.unsafe<Array<{ job_id: string }>>(
			"SELECT job_id FROM github_ci_log_receipt WHERE collection_id = $1",
			[result.collectionId],
		);
		expect(receipts.map((receipt) => receipt.job_id)).toEqual(["job-1"]);
	});
});

async function persist(input: {
	readonly commitSha: string;
	readonly r2: FakeEvidenceR2;
	readonly sessionId?: string;
	readonly source: GitHubEvidenceSource;
}) {
	return collectAndPersistGitHubCommitEvidence({
		commitSha: input.commitSha,
		config,
		contextId: randomUUID(),
		createInstallationToken: async () => "installation-token",
		database: sqlClient,
		initiatedByUserId: userId,
		organizationId,
		r2: input.r2,
		refresh: true,
		repositoryId,
		sessionId: input.sessionId ?? `session-${randomUUID()}`,
		sourceFactory: () => input.source,
	});
}

interface PersistedMetadata {
	readonly coverage: readonly {
		readonly dataset: string;
		readonly reasons: readonly { readonly code: string }[];
	}[];
	readonly pullRequestFiles: readonly {
		readonly file: { readonly path: string; readonly patch: string | null };
	}[];
}

async function readMetadata(
	r2: FakeEvidenceR2,
	collectionId: string,
): Promise<PersistedMetadata> {
	const rows = await sqlClient.unsafe<Array<{ metadata_object_key: string }>>(
		"SELECT metadata_object_key FROM github_evidence_collection WHERE id = $1",
		[collectionId],
	);
	const objectKey = rows[0]?.metadata_object_key ?? "";
	const bytes = await r2.getObject(objectKey);
	const metadata: PersistedMetadata & {
		metadataChunks: readonly { dataset: string; objectKey: string }[];
	} = JSON.parse(new TextDecoder().decode(bytes));
	const pullRequestFiles: PersistedMetadata["pullRequestFiles"][number][] = [];
	for (const chunk of metadata.metadataChunks) {
		if (chunk.dataset !== "pull-request-files") continue;
		const page: {
			items: readonly PersistedMetadata["pullRequestFiles"][number]["file"][];
		} = JSON.parse(
			new TextDecoder().decode(await r2.getObject(chunk.objectKey)),
		);
		pullRequestFiles.push(...page.items.map((file) => ({ file })));
	}
	return { ...metadata, pullRequestFiles };
}

async function snapshotRows(collectionId: string) {
	const rows = await sqlClient.unsafe<
		Array<{
			ci_coverage_complete: boolean;
			coverage_complete: boolean;
			provider_pull_request_id: string;
		}>
	>(
		"SELECT provider_pull_request_id, coverage_complete, ci_coverage_complete FROM github_pull_request_snapshot WHERE collection_id = $1 ORDER BY provider_pull_request_id",
		[collectionId],
	);
	return rows.map((row) => ({ ...row }));
}

function createSource(
	commitSha: string,
	overrides: Partial<GitHubEvidenceSource>,
): GitHubEvidenceSource {
	return {
		async getCommit() {
			return availableResult({
				author: null,
				authorEmail: "author@example.com",
				authorName: "Author",
				authoredAt: "2026-09-19T11:00:00.000Z",
				committedAt: "2026-09-19T11:00:00.000Z",
				committer: null,
				committerEmail: "author@example.com",
				committerName: "Author",
				htmlUrl: `https://github.example/acme/widget/commit/${commitSha}`,
				message: "Commit fixture",
				parentShas: [],
				sha: commitSha,
			});
		},
		async getWorkflowJobLog(_repository, jobId) {
			return logResult(jobId, "ok\n", false);
		},
		listCheckRunAnnotations: emptyPage,
		listCheckRuns: emptyPage,
		listCheckSuites: emptyPage,
		listCommitPullRequests: emptyPage,
		listCommitStatuses: emptyPage,
		listIssueComments: emptyPage,
		listPullRequestFiles: emptyPage,
		listPullRequestReviewComments: emptyPage,
		listPullRequestReviews: emptyPage,
		listWorkflowArtifacts: emptyPage,
		listWorkflowJobs: emptyPage,
		listWorkflowRuns: emptyPage,
		...overrides,
	};
}

async function emptyPage(..._arguments: readonly unknown[]) {
	return availablePage([], null);
}

function availablePage<TItem>(
	items: readonly TItem[],
	nextCursor: string | null,
): SourcePage<TItem> {
	return {
		availability: { state: "available" },
		coverage: COMPLETE,
		items,
		nextCursor,
		provenance: PROVENANCE,
		status: "available",
	};
}

function unavailablePage<TItem>(): SourcePage<TItem> {
	return {
		availability: {
			message: "page denied",
			reason: "forbidden",
			state: "unavailable",
		},
		coverage: {
			reasons: [{ code: "permission-gated", detail: "page denied" }],
			state: "unavailable",
		},
		items: [],
		nextCursor: null,
		provenance: PROVENANCE,
		status: "unavailable",
	};
}

function availableResult<TData>(data: TData): SourceResult<TData> {
	return {
		availability: { state: "available" },
		coverage: COMPLETE,
		data,
		provenance: PROVENANCE,
		status: "available",
	};
}

function logResult(
	jobId: string,
	content: string,
	truncated: boolean,
): SourceResult<WorkflowJobLog> {
	const byteLength = new TextEncoder().encode(content).byteLength;
	return {
		availability: { state: "available" },
		coverage: truncated
			? {
					reasons: [{ code: "local-byte-cap", detail: "fixture byte cap" }],
					state: "partial",
				}
			: COMPLETE,
		data: {
			content,
			contentBytes: byteLength,
			contentType: "text/plain",
			jobId,
			originalByteLength: truncated ? byteLength + 500 : byteLength,
			persistence: "secret-filter-required",
			sensitivity: "secret-bearing",
			truncated,
		},
		provenance: PROVENANCE,
		status: "available",
	};
}

function pullRequestFixture(id: string, number: number): PullRequestSummary {
	return {
		author: null,
		baseRef: "main",
		baseSha: "f".repeat(40),
		body: "Pull request body",
		closedAt: "2026-09-19T11:30:00.000Z",
		createdAt: "2026-09-19T11:00:00.000Z",
		draft: false,
		headRef: `feature-${number}`,
		headSha: "a".repeat(40),
		htmlUrl: `https://github.example/acme/widget/pull/${number}`,
		id,
		mergedAt: "2026-09-19T11:30:00.000Z",
		nodeId: `PR_${id}`,
		number,
		state: "closed",
		title: `Pull request ${number}`,
		updatedAt: "2026-09-19T11:30:00.000Z",
	};
}

function fileFixture(
	path: string,
	patch: string,
	previousPath: string | null,
): PullRequestFile {
	return {
		additions: 1,
		changes: 1,
		deletions: 0,
		patch,
		path,
		previousPath,
		sha: "b".repeat(40),
		status: previousPath === null ? "modified" : "renamed",
	};
}

function workflowRunFixture(id: string, headSha: string): WorkflowRun {
	return {
		conclusion: "failure",
		createdAt: "2026-09-19T11:00:00.000Z",
		displayTitle: "CI",
		event: "push",
		headBranch: "main",
		headSha,
		htmlUrl: `https://github.example/run/${id}`,
		id,
		name: "CI",
		nodeId: `RUN_${id}`,
		runAttempt: 1,
		runNumber: 1,
		runStartedAt: "2026-09-19T11:00:00.000Z",
		status: "completed",
		updatedAt: "2026-09-19T11:01:00.000Z",
		workflowId: "workflow-1",
	};
}

function workflowJobFixture(
	runId: string,
	id: string,
	headSha: string,
): WorkflowJob {
	return {
		completedAt: "2026-09-19T11:01:00.000Z",
		conclusion: "failure",
		headSha,
		htmlUrl: `https://github.example/job/${id}`,
		id,
		labels: ["ubuntu-latest"],
		name: "test",
		runAttempt: 1,
		runId,
		startedAt: "2026-09-19T11:00:00.000Z",
		status: "completed",
		steps: [],
	};
}
