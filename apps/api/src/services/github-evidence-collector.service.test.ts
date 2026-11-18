import { describe, expect, test } from "bun:test";
import type {
	CheckAnnotation,
	CheckRun,
	CheckSuite,
	CommitStatus,
	PageRequest,
	PullRequestFile,
	PullRequestReview,
	PullRequestSummary,
	RepositoryComment,
	RepositoryCommit,
	RepositoryCoordinates,
	SourceCoverage,
	SourcePage,
	SourceProvenance,
	SourceResult,
	WorkflowArtifact,
	WorkflowJob,
	WorkflowJobLog,
	WorkflowRun,
} from "@rudel/repo-intelligence-source-github";
import {
	collectGitHubCommitEvidence,
	type GitHubEvidenceCoverageRecord,
	type GitHubEvidenceSource,
	summarizeGitHubEvidenceCoverage,
} from "./github-evidence-collector.service.js";

const REPOSITORY: RepositoryCoordinates = { name: "widget", owner: "acme" };
const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const SECRET = `ghp_${"CANARY".padEnd(36, "A")}`;
const COMPLETE: SourceCoverage = { reasons: [], state: "complete" };
const PROVENANCE: SourceProvenance = {
	apiVersion: "2026-03-10",
	endpoint: "/fixture",
	provider: "github",
	repository: REPOSITORY,
	requestId: "request-1",
	retrievedAt: "2026-09-19T12:00:00.000Z",
	schemaVersion: 1,
	sourceVersion: "fixture.v1",
	transfer: {
		conditional: "disabled",
		downloadedBytes: 1,
		etag: null,
	},
};

describe("GitHub commit evidence collection", () => {
	test("paginates every linked dataset and filters every attempt log before returning it", async () => {
		const calls: string[] = [];
		const headShaFilters: Array<string | undefined> = [];
		const source = createFixtureSource({ calls, headShaFilters });

		const evidence = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8_192,
			repository: REPOSITORY,
			source,
		});

		expect(evidence.commit?.sha).toBe(COMMIT_SHA);
		expect(evidence.pullRequests).toHaveLength(2);
		expect(evidence.pullRequestFiles).toHaveLength(4);
		expect(evidence.pullRequestReviews).toHaveLength(4);
		expect(evidence.pullRequestReviewComments).toHaveLength(4);
		expect(evidence.issueComments).toHaveLength(4);
		expect(evidence.checkSuites).toHaveLength(2);
		expect(evidence.checkRuns).toHaveLength(4);
		expect(evidence.checkAnnotations).toHaveLength(8);
		expect(evidence.checkAnnotations[0]).toMatchObject({
			annotationLevel: "failure",
			checkRunId: "suite-1-1",
			message: "exact annotation",
			path: "src/index.ts",
			startLine: 17,
		});
		expect(evidence.commitStatuses).toHaveLength(2);
		expect(evidence.workflowRuns).toHaveLength(2);
		expect(evidence.workflowJobs).toHaveLength(4);
		expect(evidence.workflowArtifacts).toHaveLength(4);
		expect(evidence.workflowJobLogs).toHaveLength(4);
		expect(evidence.workflowJobLogReceipts).toHaveLength(4);
		expect(evidence.pageReceipts.length).toBeGreaterThan(0);
		expect(evidence.remoteEnumerationConsistency).toBe("unknown");
		expect(evidence.pageReceipts[0]).toMatchObject({
			cursor: null,
			identityRule: "github-normalized-item-identity/v1",
			pageOrdinal: 0,
			pageSize: 100,
			remoteEnumerationConsistency: "unknown",
			representation: {
				digestDomain: "canonical-secret-filtered-page-json/v1",
				state: "digest_only",
				transform: "canonical-json/v1+secret-filter/v7",
			},
			schema: "github-evidence-page-receipt/v1",
		});
		expect(
			evidence.pageReceipts.every(
				(receipt) =>
					/^[a-f0-9]{64}$/u.test(receipt.representation.sha256) &&
					receipt.itemSha256.every((digest) => /^[a-f0-9]{64}$/u.test(digest)),
			),
		).toBe(true);
		expect(headShaFilters).toEqual([COMMIT_SHA, COMMIT_SHA]);
		expect(calls).toEqual(
			expect.arrayContaining([
				"pulls:page-2",
				"files:1:page-2",
				"reviews:1:page-2",
				"review-comments:1:page-2",
				"issue-comments:1:page-2",
				"check-suites:page-2",
				"check-runs:suite-1:page-2",
				"statuses:page-2",
				"workflow-runs:page-2",
				"workflow-jobs:run-1:page-2",
				"artifacts:run-1:page-2",
			]),
		);
		expect(JSON.stringify(evidence)).not.toContain(SECRET);
		expect(evidence.workflowJobLogs.every((log) => log.secretFiltered)).toBe(
			true,
		);

		const failedAttempt = evidence.workflowJobLogReceipts.find(
			(receipt) => receipt.jobId === "run-1-job-1",
		);
		expect(failedAttempt).toMatchObject({
			attempt: 1,
			coverage: "partial",
			jobId: "run-1-job-1",
			outcome: "failure",
			originalByteLength: 164,
			retainedByteLength: 64,
			runId: "run-1",
			truncated: true,
		});
		expect(failedAttempt?.storedByteLength).toBeGreaterThan(0);
		expect(failedAttempt?.storedByteLength).not.toBe(
			failedAttempt?.retainedByteLength,
		);

		const successfulAttempt = evidence.workflowJobLogReceipts.find(
			(receipt) => receipt.jobId === "run-1-job-2",
		);
		expect(successfulAttempt).toMatchObject({
			attempt: 2,
			coverage: "complete",
			jobId: "run-1-job-2",
			outcome: "success",
			runId: "run-1",
			truncated: false,
		});
	});

	test("marks repeated normalized items across mutable pages as conflicted", async () => {
		const calls: string[] = [];
		const base = createFixtureSource({ calls, headShaFilters: [] });
		const repeated = pullRequestFixture(1);
		const evidence = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8_192,
			repository: REPOSITORY,
			source: {
				...base,
				async listCommitPullRequests(_repository, _commitSha, page) {
					recordPage(calls, "pulls", page);
					return twoPage(page, repeated, repeated);
				},
			},
		});

		expect(evidence.remoteEnumerationConsistency).toBe("conflicted");
		expect(evidence.pageReceipts).toContainEqual(
			expect.objectContaining({
				dataset: "commit-pull-requests",
				pageOrdinal: 1,
				remoteEnumerationConsistency: "conflicted",
			}),
		);
		expect(evidence.overallCoverage).toBe("partial");
	});

	test("detects repeated stable identities within a page and after payload changes", async () => {
		const repeated = pullRequestFixture(1);
		const changed = { ...repeated, title: "changed after page one" };
		const base = createFixtureSource({ calls: [], headShaFilters: [] });
		const acrossPages = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8_192,
			repository: REPOSITORY,
			source: {
				...base,
				async listCommitPullRequests(_repository, _commitSha, page) {
					return twoPage(page, repeated, changed);
				},
			},
		});
		const withinPage = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8_192,
			repository: REPOSITORY,
			source: {
				...base,
				async listCommitPullRequests() {
					return availablePage([repeated, changed], null);
				},
			},
		});

		expect(acrossPages.remoteEnumerationConsistency).toBe("conflicted");
		expect(withinPage.remoteEnumerationConsistency).toBe("conflicted");
	});

	test("detects exact repeated annotation payloads without claiming a provider identity", async () => {
		const repeated = checkAnnotationFixture("same annotation");
		const base = createFixtureSource({ calls: [], headShaFilters: [] });
		const evidence = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8_192,
			repository: REPOSITORY,
			source: {
				...base,
				async listCheckRunAnnotations(_repository, _checkRunId, page) {
					return twoPage(page, repeated, repeated);
				},
			},
		});

		expect(evidence.remoteEnumerationConsistency).toBe("conflicted");
		expect(evidence.pageReceipts).toContainEqual(
			expect.objectContaining({
				dataset: "check-run-annotations",
				itemIdentitySha256: [null],
				remoteEnumerationConsistency: "conflicted",
			}),
		);
	});

	test("filters page availability, coverage, and provenance before returning receipts", async () => {
		const base = createFixtureSource({ calls: [], headShaFilters: [] });
		const evidence = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8_192,
			repository: REPOSITORY,
			source: {
				...base,
				async listCommitPullRequests() {
					return {
						availability: {
							message: `forbidden ${SECRET}`,
							reason: "forbidden" as const,
							state: "unavailable" as const,
						},
						coverage: {
							reasons: [
								{
									code: "permission-gated" as const,
									detail: `coverage ${SECRET}`,
								},
							],
							state: "unavailable" as const,
						},
						items: [],
						nextCursor: null,
						provenance: {
							...PROVENANCE,
							endpoint: `/fixture/${SECRET}`,
							requestId: SECRET,
							transfer: { ...PROVENANCE.transfer, etag: SECRET },
						},
						status: "unavailable" as const,
					};
				},
			},
		});

		expect(JSON.stringify(evidence)).not.toContain(SECRET);
		expect(evidence.pageReceipts).toContainEqual(
			expect.objectContaining({
				dataset: "commit-pull-requests",
				remoteEnumerationConsistency: "unknown",
			}),
		);
	});

	test("retains partial and unavailable coverage for evidence that could not be collected", async () => {
		const source = createFixtureSource({
			calls: [],
			headShaFilters: [],
			partialReviews: true,
			unavailableArtifacts: true,
			unavailableJobId: "run-1-job-2",
		});

		const evidence = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8_192,
			repository: REPOSITORY,
			source,
		});

		expect(evidence.coverage).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					dataset: "pull-request-reviews",
					scope: "pull-request:1",
					state: "partial",
				}),
				expect.objectContaining({
					dataset: "workflow-artifacts",
					scope: "workflow-run:run-1",
					state: "unavailable",
				}),
				expect.objectContaining({
					dataset: "workflow-job-log",
					scope: "workflow-job:run-1-job-2",
					state: "unavailable",
				}),
			]),
		);
		expect(evidence.overallCoverage).toBe("unavailable");
		expect(evidence.workflowJobLogReceipts).toContainEqual(
			expect.objectContaining({
				attempt: 2,
				coverage: "unavailable",
				jobId: "run-1-job-2",
				originalByteLength: null,
				outcome: "success",
				retainedByteLength: 0,
				storedByteLength: 0,
				truncated: null,
			}),
		);
	});

	test("withholds patches of credential paths, including rename sources, and keeps file metadata", async () => {
		const credentialPatch = "+DATABASE_PASSWORD=hunter2-canary-value";
		const safePatch = "+harmless change";
		const withPatch = (
			path: string,
			previousPath: string | null = null,
			patch: string = credentialPatch,
		): PullRequestFile => ({
			...pullRequestFileFixture(path),
			patch,
			previousPath,
			status: previousPath === null ? "modified" : "renamed",
		});
		const base = createFixtureSource({ calls: [], headShaFilters: [] });
		const evidence = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8_192,
			repository: REPOSITORY,
			source: {
				...base,
				async listCommitPullRequests() {
					return availablePage([pullRequestFixture(1)], null);
				},
				async listPullRequestFiles() {
					return availablePage(
						[
							withPatch(".env"),
							withPatch("config/.env.production"),
							withPatch("deploy/ID_RSA"),
							withPatch("certs/server.PEM"),
							withPatch("config/settings.txt", "config/.env"),
							withPatch("keys/old.txt", "keys/signing.key"),
							withPatch(".env.example", null, safePatch),
							withPatch("src/app.ts", null, safePatch),
						],
						null,
					);
				},
			},
		});

		const byPath = new Map(
			evidence.pullRequestFiles.map(({ file }) => [file.path, file] as const),
		);
		for (const path of [
			".env",
			"config/.env.production",
			"deploy/ID_RSA",
			"certs/server.PEM",
			"config/settings.txt",
			"keys/old.txt",
		]) {
			expect(byPath.get(path)).toMatchObject({
				additions: 1,
				deletions: 0,
				patch: null,
				status: expect.any(String),
			});
		}
		expect(byPath.get("config/settings.txt")).toMatchObject({
			previousPath: "config/.env",
			status: "renamed",
		});
		expect(byPath.get(".env.example")?.patch).toBe(safePatch);
		expect(byPath.get("src/app.ts")?.patch).toBe(safePatch);
		expect(evidence.pullRequestFiles).toHaveLength(8);
		expect(JSON.stringify(evidence)).not.toContain("hunter2-canary-value");
		const filesCoverage = evidence.coverage.find(
			(record) => record.dataset === "pull-request-files",
		);
		expect(filesCoverage).toMatchObject({
			reasons: [expect.objectContaining({ code: "high-risk-path" })],
			state: "complete",
		});
	});

	test("does not report credential-path omissions for ordinary files", async () => {
		const evidence = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8_192,
			repository: REPOSITORY,
			source: createFixtureSource({ calls: [], headShaFilters: [] }),
		});

		expect(
			evidence.coverage
				.filter((record) => record.dataset === "pull-request-files")
				.flatMap((record) => record.reasons),
		).toEqual([]);
	});

	test("redacts a job log whose private key footer was cut off by the byte cap", async () => {
		const header = "-----BEGIN OPENSSH PRIVATE KEY-----";
		const body = [
			"b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW",
			"QyNTUxOQAAACBq2qj0mQ5dUj5pXo0a0T4m1tYkRrW2dN7fE2nq4cQv3wAAAJgE9aQpBPWk",
		].join("\n");
		const base = createFixtureSource({ calls: [], headShaFilters: [] });
		const evidence = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8_192,
			repository: REPOSITORY,
			source: {
				...base,
				async getWorkflowJobLog(_repository, jobId) {
					const content = `deploy start\n${header}\n${body}\n-----END OPENSSH PRIV`;
					return availableResult<WorkflowJobLog>(
						{
							content,
							contentBytes: content.length,
							contentType: "text/plain",
							jobId,
							originalByteLength: content.length + 200,
							persistence: "secret-filter-required",
							sensitivity: "secret-bearing",
							truncated: true,
						},
						{
							reasons: [{ code: "local-byte-cap", detail: "fixture byte cap" }],
							state: "partial",
						},
					);
				},
			},
		});

		expect(evidence.workflowJobLogs.length).toBeGreaterThan(0);
		for (const log of evidence.workflowJobLogs) {
			expect(log.content).toBe("deploy start\n[REDACTED:private-key]");
			expect(log.content).not.toContain(body);
		}
		expect(JSON.stringify(evidence)).not.toContain(body.slice(0, 40));
		expect(evidence.workflowJobLogReceipts[0]?.redactionCounts).toEqual({
			"private-key": 1,
		});
	});

	test("drops repeated stable identities while keeping the conflict in receipts and coverage", async () => {
		const repeatedPullRequest = pullRequestFixture(1);
		const repeatedJob = workflowJobFixture("run-1", 1, "failure");
		const base = createFixtureSource({ calls: [], headShaFilters: [] });
		const evidence = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8_192,
			repository: REPOSITORY,
			source: {
				...base,
				async listCommitPullRequests(_repository, _commitSha, page) {
					return twoPage(page, repeatedPullRequest, {
						...repeatedPullRequest,
						title: "changed after page one",
					});
				},
				async listPullRequestFiles(_repository, _pullNumber, page) {
					return twoPage(
						page,
						pullRequestFileFixture("same.ts"),
						pullRequestFileFixture("same.ts"),
					);
				},
				async listWorkflowRuns() {
					return availablePage(
						[workflowRunFixture("run-1"), workflowRunFixture("run-2")],
						null,
					);
				},
				async listWorkflowJobs(_repository, runId, page) {
					return twoPage(
						page,
						repeatedJob,
						runId === "run-1"
							? workflowJobFixture("run-1", 2, "success")
							: repeatedJob,
					);
				},
			},
		});

		expect(evidence.pullRequests.map((pullRequest) => pullRequest.id)).toEqual([
			"1",
		]);
		expect(evidence.pullRequests[0]?.title).toBe("Pull request 1");
		expect(evidence.pullRequestFiles.map(({ file }) => file.path)).toEqual([
			"same.ts",
		]);
		const jobIds = evidence.workflowJobs.map(({ job }) => job.id);
		expect(jobIds).toEqual(["run-1-job-1", "run-1-job-2"]);
		const receiptJobIds = evidence.workflowJobLogReceipts.map(
			(receipt) => receipt.jobId,
		);
		expect(receiptJobIds).toEqual(jobIds);
		expect(evidence.workflowJobLogs.map((log) => log.jobId)).toEqual(jobIds);
		expect(evidence.remoteEnumerationConsistency).toBe("conflicted");
		expect(evidence.pageReceipts).toContainEqual(
			expect.objectContaining({
				dataset: "commit-pull-requests",
				itemCount: 1,
				pageOrdinal: 1,
				remoteEnumerationConsistency: "conflicted",
			}),
		);
		expect(evidence.coverage).toContainEqual(
			expect.objectContaining({
				dataset: "commit-pull-requests",
				reasons: [expect.objectContaining({ code: "duplicate-items" })],
				state: "partial",
			}),
		);
		expect(evidence.coverage).toContainEqual(
			expect.objectContaining({
				dataset: "workflow-jobs",
				reasons: [expect.objectContaining({ code: "duplicate-items" })],
				scope: "workflow-run:run-2",
				state: "partial",
			}),
		);
		expect(summarizeGitHubEvidenceCoverage(evidence)).toEqual({
			ciCoverageComplete: false,
			pullRequestCoverageComplete: false,
		});
	});
});

describe("GitHub evidence log memory bounds", () => {
	test("hands each filtered log to the callback and retains only receipts", async () => {
		const base = createFixtureSource({ calls: [], headShaFilters: [] });
		const delivered: string[] = [];

		const evidence = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8_192,
			onWorkflowJobLog: async (log) => {
				delivered.push(log.jobId);
				expect(log.content).not.toContain(SECRET);
			},
			repository: REPOSITORY,
			source: base,
		});

		expect(delivered).toHaveLength(4);
		expect(evidence.workflowJobLogs).toEqual([]);
		expect(evidence.workflowJobLogReceipts).toHaveLength(4);
		expect(JSON.stringify(evidence)).not.toContain("job=run-1-job-1");
	});

	test("stops fetching logs once the aggregate byte budget is spent and records partial coverage", async () => {
		const base = createFixtureSource({ calls: [], headShaFilters: [] });
		const requested: Array<{ jobId: string; maxBytes: number }> = [];

		const evidence = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxCollectionLogBytes: 100,
			maxJobLogBytes: 8_192,
			repository: REPOSITORY,
			source: {
				...base,
				async getWorkflowJobLog(repository, jobId, maxBytes) {
					requested.push({ jobId, maxBytes });
					return base.getWorkflowJobLog(repository, jobId, maxBytes);
				},
			},
		});

		expect(requested.length).toBeLessThan(4);
		expect(requested[0]?.maxBytes).toBe(100);
		expect(requested[1]?.maxBytes).toBeLessThan(100);
		expect(evidence.workflowJobLogReceipts).toHaveLength(4);
		const skipped = evidence.workflowJobLogReceipts.filter(
			(receipt) => receipt.coverage === "unavailable",
		);
		expect(skipped).toHaveLength(4 - requested.length);
		expect(
			evidence.coverage.filter(
				(record) =>
					record.dataset === "workflow-job-log" &&
					record.state === "partial" &&
					record.reasons.some(
						(reason) =>
							reason.code === "local-byte-cap" &&
							reason.detail.includes("budget"),
					),
			),
		).toHaveLength(4 - requested.length);
		expect(evidence.overallCoverage).not.toBe("complete");
	});
});

describe("GitHub evidence coverage summary", () => {
	test.each([
		{ maxMetadataBytes: 10_000, maxCollectionItems: 20_000 },
		{ maxMetadataBytes: 16 * 1024 * 1024, maxCollectionItems: 5 },
	])("bounds metadata across all datasets and records partial coverage ($maxMetadataBytes bytes, $maxCollectionItems items)", async (limits) => {
		const pages: { dataset: string; items: readonly unknown[] }[] = [];
		const evidence = await collectGitHubCommitEvidence({
			...limits,
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8192,
			onMetadataPage: async (page) => {
				pages.push(page);
			},
			repository: REPOSITORY,
			source: createFixtureSource({ calls: [], headShaFilters: [] }),
		});
		expect(evidence.overallCoverage).toBe("partial");
		expect(
			evidence.coverage.some((record) =>
				record.reasons.some((reason) => reason.code === "local-byte-cap"),
			),
		).toBe(true);
		expect(
			pages.reduce((sum, page) => sum + page.items.length, 0),
		).toBeLessThanOrEqual(limits.maxCollectionItems);
		expect(
			pages.reduce(
				(sum, page) => sum + Buffer.byteLength(JSON.stringify(page)),
				0,
			),
		).toBeLessThanOrEqual(limits.maxMetadataBytes);
	});
	test("is complete when every page of every required dataset is complete", async () => {
		const evidence = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8_192,
			repository: REPOSITORY,
			source: createFixtureSource({ calls: [], headShaFilters: [] }),
		});

		expect(summarizeGitHubEvidenceCoverage(evidence)).toEqual({
			ciCoverageComplete: true,
			pullRequestCoverageComplete: true,
		});
	});

	test("is not complete when a later workflow-jobs page is unavailable", async () => {
		const base = createFixtureSource({ calls: [], headShaFilters: [] });
		const evidence = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8_192,
			repository: REPOSITORY,
			source: {
				...base,
				async listWorkflowJobs(_repository, runId, page) {
					return page.cursor === undefined
						? availablePage([workflowJobFixture(runId, 1, "failure")], "page-2")
						: unavailablePage("permission-gated", "jobs page 2 denied");
				},
			},
		});

		expect(
			evidence.coverage
				.filter((record) => record.dataset === "workflow-jobs")
				.map((record) => record.state),
		).toEqual(["complete", "unavailable", "complete", "unavailable"]);
		expect(summarizeGitHubEvidenceCoverage(evidence)).toEqual({
			ciCoverageComplete: false,
			pullRequestCoverageComplete: true,
		});
	});

	test("is not complete when a later workflow-runs or pull-request page is unavailable", async () => {
		const base = createFixtureSource({ calls: [], headShaFilters: [] });
		const evidence = await collectGitHubCommitEvidence({
			commitSha: COMMIT_SHA,
			maxJobLogBytes: 8_192,
			repository: REPOSITORY,
			source: {
				...base,
				async listCommitPullRequests(_repository, _commitSha, page) {
					return page.cursor === undefined
						? availablePage([pullRequestFixture(1)], "page-2")
						: unavailablePage("permission-gated", "pulls page 2 denied");
				},
				async listWorkflowRuns(_repository, _createdAfter, page) {
					return page.cursor === undefined
						? availablePage([workflowRunFixture("run-1")], "page-2")
						: unavailablePage("permission-gated", "runs page 2 denied");
				},
			},
		});

		expect(summarizeGitHubEvidenceCoverage(evidence)).toEqual({
			ciCoverageComplete: false,
			pullRequestCoverageComplete: false,
		});
	});

	test("is not complete for a workflow run without workflow-jobs coverage records", () => {
		const record = (
			dataset: GitHubEvidenceCoverageRecord["dataset"],
			scope: string,
		): GitHubEvidenceCoverageRecord => ({
			availability: { state: "available" },
			cursor: null,
			dataset,
			reasons: [],
			scope,
			state: "complete",
		});
		const coverage = [
			record("commit-pull-requests", `commit:${COMMIT_SHA}`),
			record("workflow-runs", `commit:${COMMIT_SHA}`),
			record("workflow-jobs", "workflow-run:run-1"),
		];

		expect(
			summarizeGitHubEvidenceCoverage({
				coverage,
				remoteEnumerationConsistency: "unknown",
				workflowRuns: [
					workflowRunFixture("run-1"),
					workflowRunFixture("run-2"),
				],
			}),
		).toEqual({ ciCoverageComplete: false, pullRequestCoverageComplete: true });
		expect(
			summarizeGitHubEvidenceCoverage({
				coverage: [],
				remoteEnumerationConsistency: "unknown",
				workflowRuns: [],
			}),
		).toEqual({
			ciCoverageComplete: false,
			pullRequestCoverageComplete: false,
		});
	});
});

function createFixtureSource(options: {
	readonly calls: string[];
	readonly headShaFilters: Array<string | undefined>;
	readonly partialReviews?: boolean;
	readonly unavailableArtifacts?: boolean;
	readonly unavailableJobId?: string;
}): GitHubEvidenceSource {
	return {
		async getCommit() {
			return availableResult(commitFixture());
		},
		async listCommitPullRequests(_repository, _commitSha, page) {
			recordPage(options.calls, "pulls", page);
			return twoPage(page, pullRequestFixture(1), pullRequestFixture(2));
		},
		async listPullRequestFiles(_repository, pullNumber, page) {
			recordPage(options.calls, `files:${pullNumber}`, page);
			return twoPage(
				page,
				pullRequestFileFixture(`${pullNumber}-a.ts`),
				pullRequestFileFixture(`${pullNumber}-b.ts`),
			);
		},
		async listPullRequestReviews(_repository, pullNumber, page) {
			recordPage(options.calls, `reviews:${pullNumber}`, page);
			return twoPage(
				page,
				pullRequestReviewFixture(`${pullNumber}1`),
				pullRequestReviewFixture(`${pullNumber}2`),
				options.partialReviews && pullNumber === 1
					? {
							reasons: [
								{
									code: "local-entry-cap",
									detail: "review fixture is partial",
								},
							],
							state: "partial",
						}
					: COMPLETE,
			);
		},
		async listPullRequestReviewComments(_repository, pullNumber, page) {
			recordPage(options.calls, `review-comments:${pullNumber}`, page);
			return twoPage(
				page,
				commentFixture(`${pullNumber}1`, "review"),
				commentFixture(`${pullNumber}2`, "review"),
			);
		},
		async listIssueComments(_repository, issueNumber, page) {
			recordPage(options.calls, `issue-comments:${issueNumber}`, page);
			return twoPage(
				page,
				commentFixture(`${issueNumber}1`, "issue"),
				commentFixture(`${issueNumber}2`, "issue"),
			);
		},
		async listCheckSuites(_repository, _commitSha, page) {
			recordPage(options.calls, "check-suites", page);
			return twoPage(
				page,
				checkSuiteFixture("suite-1"),
				checkSuiteFixture("suite-2"),
			);
		},
		async listCheckRuns(_repository, suiteId, page) {
			recordPage(options.calls, `check-runs:${suiteId}`, page);
			return twoPage(
				page,
				checkRunFixture(`${suiteId}-1`),
				checkRunFixture(`${suiteId}-2`),
			);
		},
		async listCheckRunAnnotations(_repository, checkRunId, page) {
			recordPage(options.calls, `check-annotations:${checkRunId}`, page);
			return twoPage(
				page,
				checkAnnotationFixture("exact annotation"),
				checkAnnotationFixture("second annotation"),
			);
		},
		async listCommitStatuses(_repository, _commitSha, page) {
			recordPage(options.calls, "statuses", page);
			return twoPage(
				page,
				commitStatusFixture("status-1"),
				commitStatusFixture("status-2"),
			);
		},
		async listWorkflowRuns(_repository, _createdAfter, page, headSha) {
			recordPage(options.calls, "workflow-runs", page);
			options.headShaFilters.push(headSha);
			return twoPage(
				page,
				workflowRunFixture("run-1"),
				workflowRunFixture("run-2"),
			);
		},
		async listWorkflowJobs(_repository, runId, page) {
			recordPage(options.calls, `workflow-jobs:${runId}`, page);
			return twoPage(
				page,
				workflowJobFixture(runId, 1, "failure"),
				workflowJobFixture(runId, 2, "success"),
			);
		},
		async getWorkflowJobLog(_repository, jobId) {
			if (jobId === options.unavailableJobId) {
				return unavailableResult("permission-gated", "job log access denied");
			}
			const truncated = jobId.endsWith("-1");
			const content = `job=${jobId}\ntoken=${SECRET}\n`;
			return availableResult<WorkflowJobLog>(
				{
					content,
					contentBytes: 64,
					contentType: "text/plain",
					jobId,
					originalByteLength: truncated ? 164 : 64,
					persistence: "secret-filter-required",
					sensitivity: "secret-bearing",
					truncated,
				},
				truncated
					? {
							reasons: [{ code: "local-byte-cap", detail: "fixture byte cap" }],
							state: "partial",
						}
					: COMPLETE,
			);
		},
		async listWorkflowArtifacts(_repository, runId, page) {
			recordPage(options.calls, `artifacts:${runId}`, page);
			if (options.unavailableArtifacts && runId === "run-1") {
				return unavailablePage("permission-gated", "artifact access denied");
			}
			return twoPage(
				page,
				workflowArtifactFixture(`${runId}-artifact-1`, runId),
				workflowArtifactFixture(`${runId}-artifact-2`, runId),
			);
		},
	};
}

function checkAnnotationFixture(message: string): CheckAnnotation {
	return {
		annotationLevel: "failure",
		blobHref: null,
		endColumn: 9,
		endLine: 17,
		message,
		path: "src/index.ts",
		rawDetails: null,
		startColumn: 2,
		startLine: 17,
		title: "Type error",
	};
}

function twoPage<TItem>(
	page: PageRequest,
	first: TItem,
	second: TItem,
	coverage: SourceCoverage = COMPLETE,
): SourcePage<TItem> {
	return availablePage(
		page.cursor === undefined ? [first] : [second],
		page.cursor === undefined ? "page-2" : null,
		coverage,
	);
}

function availablePage<TItem>(
	items: readonly TItem[],
	nextCursor: string | null,
	coverage: SourceCoverage = COMPLETE,
): SourcePage<TItem> {
	return {
		availability: { state: "available" },
		coverage,
		items,
		nextCursor,
		provenance: PROVENANCE,
		status: "available",
	};
}

function unavailablePage<TItem>(
	code: "permission-gated",
	detail: string,
): SourcePage<TItem> {
	return {
		availability: {
			message: detail,
			reason: "forbidden",
			state: "unavailable",
		},
		coverage: { reasons: [{ code, detail }], state: "unavailable" },
		items: [],
		nextCursor: null,
		provenance: PROVENANCE,
		status: "unavailable",
	};
}

function availableResult<TData>(
	data: TData,
	coverage: SourceCoverage = COMPLETE,
): SourceResult<TData> {
	return {
		availability: { state: "available" },
		coverage,
		data,
		provenance: PROVENANCE,
		status: "available",
	};
}

function unavailableResult<TData>(
	code: "permission-gated",
	detail: string,
): SourceResult<TData> {
	return {
		availability: {
			message: detail,
			reason: "forbidden",
			state: "unavailable",
		},
		coverage: { reasons: [{ code, detail }], state: "unavailable" },
		provenance: PROVENANCE,
		status: "unavailable",
	};
}

function recordPage(calls: string[], name: string, page: PageRequest): void {
	calls.push(`${name}:${page.cursor ?? "start"}`);
}

function commitFixture(): RepositoryCommit {
	return {
		author: null,
		authorEmail: "author@example.com",
		authorName: "Author",
		authoredAt: "2026-09-19T11:00:00.000Z",
		committedAt: "2026-09-19T11:00:00.000Z",
		committer: null,
		committerEmail: "author@example.com",
		committerName: "Author",
		htmlUrl: `https://github.example/acme/widget/commit/${COMMIT_SHA}`,
		message: "Commit fixture",
		parentShas: [],
		sha: COMMIT_SHA,
	};
}

function pullRequestFixture(number: number): PullRequestSummary {
	return {
		author: null,
		baseRef: "main",
		baseSha: "f".repeat(40),
		body: "Pull request body",
		closedAt: null,
		createdAt: "2026-09-19T11:00:00.000Z",
		draft: false,
		headRef: `feature-${number}`,
		headSha: COMMIT_SHA,
		htmlUrl: `https://github.example/acme/widget/pull/${number}`,
		id: String(number),
		mergedAt: null,
		nodeId: `PR_${number}`,
		number,
		state: "open",
		title: `Pull request ${number}`,
		updatedAt: "2026-09-19T11:00:00.000Z",
	};
}

function pullRequestFileFixture(path: string): PullRequestFile {
	return {
		additions: 1,
		changes: 1,
		deletions: 0,
		patch: "+fixture",
		path,
		previousPath: null,
		sha: COMMIT_SHA,
		status: "modified",
	};
}

function pullRequestReviewFixture(id: string): PullRequestReview {
	return {
		author: null,
		body: "Review body",
		commitSha: COMMIT_SHA,
		htmlUrl: `https://github.example/review/${id}`,
		id,
		nodeId: `REVIEW_${id}`,
		state: "approved",
		submittedAt: "2026-09-19T11:00:00.000Z",
	};
}

function commentFixture(
	id: string,
	kind: RepositoryComment["kind"],
): RepositoryComment {
	return {
		author: null,
		body: "Comment body",
		commitSha: kind === "review" ? COMMIT_SHA : null,
		createdAt: "2026-09-19T11:00:00.000Z",
		htmlUrl: `https://github.example/comment/${id}`,
		id,
		kind,
		path: kind === "review" ? "src/app.ts" : null,
		updatedAt: "2026-09-19T11:00:00.000Z",
	};
}

function checkSuiteFixture(id: string): CheckSuite {
	return {
		appSlug: "ci",
		conclusion: "success",
		createdAt: "2026-09-19T11:00:00.000Z",
		headBranch: "main",
		headSha: COMMIT_SHA,
		id,
		nodeId: `SUITE_${id}`,
		status: "completed",
		updatedAt: "2026-09-19T11:00:00.000Z",
	};
}

function checkRunFixture(id: string): CheckRun {
	return {
		appSlug: "ci",
		completedAt: "2026-09-19T11:01:00.000Z",
		conclusion: "success",
		detailsUrl: `https://github.example/check/${id}`,
		headSha: COMMIT_SHA,
		id,
		name: "test",
		nodeId: `CHECK_${id}`,
		startedAt: "2026-09-19T11:00:00.000Z",
		status: "completed",
	};
}

function commitStatusFixture(id: string): CommitStatus {
	return {
		context: "ci/test",
		createdAt: "2026-09-19T11:00:00.000Z",
		creator: null,
		description: "Passed",
		id,
		nodeId: `STATUS_${id}`,
		state: "success",
		targetUrl: `https://github.example/status/${id}`,
		updatedAt: "2026-09-19T11:00:00.000Z",
	};
}

function workflowRunFixture(id: string): WorkflowRun {
	return {
		conclusion: "success",
		createdAt: "2026-09-19T11:00:00.000Z",
		displayTitle: "CI",
		event: "push",
		headBranch: "main",
		headSha: COMMIT_SHA,
		htmlUrl: `https://github.example/run/${id}`,
		id,
		name: "CI",
		nodeId: `RUN_${id}`,
		runAttempt: 2,
		runNumber: 1,
		runStartedAt: "2026-09-19T11:00:00.000Z",
		status: "completed",
		updatedAt: "2026-09-19T11:01:00.000Z",
		workflowId: "workflow-1",
	};
}

function workflowJobFixture(
	runId: string,
	attempt: number,
	conclusion: "failure" | "success",
): WorkflowJob {
	return {
		completedAt: "2026-09-19T11:01:00.000Z",
		conclusion,
		headSha: COMMIT_SHA,
		htmlUrl: `https://github.example/job/${runId}-${attempt}`,
		id: `${runId}-job-${attempt}`,
		labels: ["ubuntu-latest"],
		name: "test",
		runAttempt: attempt,
		runId,
		startedAt: "2026-09-19T11:00:00.000Z",
		status: "completed",
		steps: [],
	};
}

function workflowArtifactFixture(id: string, runId: string): WorkflowArtifact {
	return {
		createdAt: "2026-09-19T11:00:00.000Z",
		digest: null,
		expired: false,
		expiresAt: null,
		id,
		name: "test-results",
		nodeId: `ARTIFACT_${id}`,
		sizeInBytes: 10,
		updatedAt: "2026-09-19T11:00:00.000Z",
		workflowRunId: runId,
	};
}
