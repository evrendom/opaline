import { createHash } from "node:crypto";
import type {
	CheckAnnotation,
	CheckRun,
	CheckSuite,
	CommitStatus,
	CoverageReason,
	PageRequest,
	PullRequestFile,
	PullRequestReview,
	PullRequestSummary,
	RepositoryComment,
	RepositoryCommit,
	RepositoryCoordinates,
	RepositoryIntelligenceSource,
	SourceAvailability,
	SourcePage,
	WorkflowArtifact,
	WorkflowJob,
	WorkflowRun,
} from "@rudel/repo-intelligence-source-github";
import {
	FILTER_VERSION,
	filterKnownSecrets,
	getUtf8ByteLength,
	isHighRiskCredentialPath,
	type RedactionCounts,
} from "@rudel/secret-filter";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES_PER_DATASET = 1_000;
const MAX_METADATA_ITEM_BYTES = 1024 * 1024 - 4096;

export interface GitHubMetadataPage {
	readonly dataset: GitHubEvidenceDataset;
	readonly scope: string;
	readonly items: readonly unknown[];
}

interface CollectionBudget {
	remainingBytes: number;
	remainingMetadataBytes: number;
	remainingItems: number;
	remainingPages: number;
	exhausted: boolean;
	readonly onMetadataPage:
		| ((page: GitHubMetadataPage) => Promise<void>)
		| undefined;
}

const DEPENDENCY_DATASETS = new Set<GitHubEvidenceDataset>([
	"commit-pull-requests",
	"check-suites",
	"check-runs",
	"commit-statuses",
	"workflow-runs",
	"workflow-jobs",
]);

export type GitHubEvidenceSource = Pick<
	RepositoryIntelligenceSource,
	| "getCommit"
	| "getWorkflowJobLog"
	| "listCheckRuns"
	| "listCheckRunAnnotations"
	| "listCheckSuites"
	| "listCommitPullRequests"
	| "listCommitStatuses"
	| "listIssueComments"
	| "listPullRequestFiles"
	| "listPullRequestReviewComments"
	| "listPullRequestReviews"
	| "listWorkflowArtifacts"
	| "listWorkflowJobs"
	| "listWorkflowRuns"
>;

export type GitHubEvidenceDataset =
	| "commit"
	| "commit-pull-requests"
	| "pull-request-files"
	| "pull-request-reviews"
	| "pull-request-review-comments"
	| "pull-request-issue-comments"
	| "check-suites"
	| "check-runs"
	| "check-run-annotations"
	| "commit-statuses"
	| "workflow-runs"
	| "workflow-jobs"
	| "workflow-job-log"
	| "workflow-artifacts";

export interface GitHubEvidenceCoverageRecord {
	readonly availability: SourceAvailability;
	readonly cursor: string | null;
	readonly dataset: GitHubEvidenceDataset;
	readonly reasons: readonly CoverageReason[];
	readonly scope: string;
	readonly state: "complete" | "partial" | "unavailable";
}

export interface GitHubEvidencePageReceipt {
	readonly availability: SourceAvailability;
	readonly cursor: string | null;
	readonly dataset: GitHubEvidenceDataset;
	readonly identityRule: "github-normalized-item-identity/v1";
	readonly itemCount: number;
	readonly itemIdentitySha256: readonly (string | null)[];
	readonly itemSha256: readonly string[];
	readonly nextCursor: string | null;
	readonly pageOrdinal: number;
	readonly pageSize: number;
	readonly provenance: SourcePage<unknown>["provenance"];
	readonly remoteEnumerationConsistency: "conflicted" | "unknown";
	readonly representation: Readonly<{
		byteLength: number;
		digestDomain: "canonical-secret-filtered-page-json/v1";
		sha256: string;
		state: "digest_only";
		transform: string;
	}>;
	readonly schema: "github-evidence-page-receipt/v1";
	readonly scope: string;
}

export interface GitHubWorkflowJobLogEvidence {
	readonly content: string;
	readonly contentType: string | null;
	readonly jobId: string;
	readonly runId: string;
	readonly secretFiltered: true;
}

export interface GitHubWorkflowJobLogReceipt {
	readonly attempt: number | null;
	readonly coverage: "complete" | "partial" | "unavailable";
	readonly jobId: string;
	readonly originalByteLength: number | null;
	readonly outcome: string;
	readonly redactedBytes: number;
	readonly redactionCounts: RedactionCounts;
	readonly retainedByteLength: number;
	readonly runId: string;
	readonly storedByteLength: number;
	readonly truncated: boolean | null;
}

export interface CollectedGitHubCommitEvidence {
	readonly repository: RepositoryCoordinates;
	readonly signal?: AbortSignal;
	readonly commitSha: string;
	readonly commit: RepositoryCommit | null;
	readonly pullRequests: readonly PullRequestSummary[];
	readonly pullRequestFiles: readonly {
		readonly pullNumber: number;
		readonly file: PullRequestFile;
	}[];
	readonly pullRequestReviews: readonly {
		readonly pullNumber: number;
		readonly review: PullRequestReview;
	}[];
	readonly pullRequestReviewComments: readonly {
		readonly pullNumber: number;
		readonly comment: RepositoryComment;
	}[];
	readonly issueComments: readonly {
		readonly pullNumber: number;
		readonly comment: RepositoryComment;
	}[];
	readonly checkSuites: readonly CheckSuite[];
	readonly checkRuns: readonly {
		readonly checkSuiteId: string;
		readonly checkRun: CheckRun;
	}[];
	readonly checkAnnotations: readonly (CheckAnnotation & {
		readonly checkRunId: string;
	})[];
	readonly commitStatuses: readonly CommitStatus[];
	readonly workflowRuns: readonly WorkflowRun[];
	readonly workflowJobs: readonly {
		readonly workflowRunId: string;
		readonly job: WorkflowJob;
	}[];
	readonly workflowArtifacts: readonly {
		readonly workflowRunId: string;
		readonly artifact: WorkflowArtifact;
	}[];
	readonly workflowJobLogs: readonly GitHubWorkflowJobLogEvidence[];
	readonly workflowJobLogReceipts: readonly GitHubWorkflowJobLogReceipt[];
	readonly coverage: readonly GitHubEvidenceCoverageRecord[];
	readonly overallCoverage: "complete" | "partial" | "unavailable";
	readonly pageReceipts: readonly GitHubEvidencePageReceipt[];
	readonly remoteEnumerationConsistency: "conflicted" | "unknown";
}

export interface GitHubEvidenceCoverageSummary {
	readonly ciCoverageComplete: boolean;
	readonly pullRequestCoverageComplete: boolean;
}

/**
 * A dataset only counts as complete when it produced at least one coverage
 * record and every record (every page) is complete. Workflow jobs are
 * enumerated once per workflow run, so each run must have its own complete
 * records. Remote enumeration conflicts make both answers false.
 */
export function summarizeGitHubEvidenceCoverage(
	evidence: Pick<
		CollectedGitHubCommitEvidence,
		"coverage" | "remoteEnumerationConsistency" | "workflowRuns"
	>,
): GitHubEvidenceCoverageSummary {
	if (evidence.remoteEnumerationConsistency === "conflicted") {
		return { ciCoverageComplete: false, pullRequestCoverageComplete: false };
	}
	const isComplete = (dataset: GitHubEvidenceDataset, scope?: string) => {
		const records = evidence.coverage.filter(
			(record) =>
				record.dataset === dataset &&
				(scope === undefined || record.scope === filterText(scope)),
		);
		return (
			records.length > 0 &&
			records.every((record) => record.state === "complete")
		);
	};
	return {
		ciCoverageComplete:
			isComplete("workflow-runs") &&
			evidence.workflowRuns.every((run) =>
				isComplete("workflow-jobs", `workflow-run:${run.id}`),
			),
		pullRequestCoverageComplete: isComplete("commit-pull-requests"),
	};
}

export async function collectGitHubCommitEvidence(input: {
	readonly commitSha: string;
	readonly maxCollectionBytes?: number;
	readonly maxMetadataBytes?: number;
	readonly maxCollectionItems?: number;
	readonly maxCollectionPages?: number;
	readonly onMetadataPage?: (page: GitHubMetadataPage) => Promise<void>;
	/**
	 * Aggregate stored-log budget across every job of the collection. Once it is
	 * spent the remaining job logs are not fetched and are recorded as partial
	 * coverage with a `local-byte-cap` reason.
	 */
	readonly maxCollectionLogBytes?: number;
	readonly maxJobLogBytes: number;
	/**
	 * Receives each filtered log as soon as it is collected. When provided the
	 * log is not retained in the returned evidence (only its receipt is), so
	 * memory stays bounded by one log at a time. Without it, logs are returned
	 * in `workflowJobLogs`.
	 */
	readonly onWorkflowJobLog?: (
		log: GitHubWorkflowJobLogEvidence,
	) => Promise<void>;
	readonly pageSize?: number;
	readonly repository: RepositoryCoordinates;
	readonly signal?: AbortSignal;
	readonly source: GitHubEvidenceSource;
	readonly workflowCreatedAfter?: string;
}): Promise<CollectedGitHubCommitEvidence> {
	input.signal?.throwIfAborted();
	const commitSha = requireNonEmpty(input.commitSha, "commit SHA");
	const limits = {
		bytes: input.maxCollectionBytes ?? 256 * 1024 * 1024,
		metadataBytes: input.maxMetadataBytes ?? 16 * 1024 * 1024,
		items: input.maxCollectionItems ?? 20_000,
		pages: input.maxCollectionPages ?? 1_000,
	};
	if (
		Object.values(limits).some(
			(limit) => !Number.isSafeInteger(limit) || limit < 0,
		)
	)
		throw new Error(
			"GitHub collection budgets must be nonnegative safe integers",
		);
	const budget: CollectionBudget = {
		remainingBytes: limits.bytes,
		remainingMetadataBytes: limits.metadataBytes,
		remainingItems: limits.items,
		remainingPages: limits.pages,
		exhausted: false,
		onMetadataPage: input.onMetadataPage,
	};
	const collectPages = <TItem>(
		pageInput: Omit<CollectPagesInput<TItem>, "budget">,
	) => collectEvidencePages({ ...pageInput, budget });
	if (
		!Number.isSafeInteger(input.maxJobLogBytes) ||
		input.maxJobLogBytes <= 0
	) {
		throw new Error("GitHub evidence job-log byte limit must be positive");
	}
	if (
		input.maxCollectionLogBytes !== undefined &&
		(!Number.isSafeInteger(input.maxCollectionLogBytes) ||
			input.maxCollectionLogBytes < 0)
	) {
		throw new Error(
			"GitHub evidence collection log byte budget must be a non-negative integer",
		);
	}
	const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
	if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
		throw new Error("GitHub evidence page size must be between 1 and 100");
	}

	const coverage: GitHubEvidenceCoverageRecord[] = [];
	const pageReceipts: GitHubEvidencePageReceipt[] = [];
	const commitResult = await input.source.getCommit(
		input.repository,
		commitSha,
	);
	recordResultCoverage(coverage, "commit", `commit:${commitSha}`, commitResult);
	let commit =
		commitResult.status === "available"
			? filterCommit(commitResult.data)
			: null;
	if (commit) {
		if (!consumeMetadataItem(budget, commit)) {
			commit = null;
			coverage.push(budgetCoverage("commit", `commit:${commitSha}`));
		} else {
			await budget.onMetadataPage?.({
				dataset: "commit",
				scope: `commit:${commitSha}`,
				items: [commit],
			});
		}
	}

	const pullRequests = (
		await collectPages({
			coverage,
			pageReceipts,
			dataset: "commit-pull-requests",
			pageSize,
			scope: `commit:${commitSha}`,
			read: (page) =>
				input.source.listCommitPullRequests(input.repository, commitSha, page),
		})
	).map(filterPullRequest);
	const pullRequestFiles: Array<{
		readonly pullNumber: number;
		readonly file: PullRequestFile;
	}> = [];
	const pullRequestReviews: Array<{
		readonly pullNumber: number;
		readonly review: PullRequestReview;
	}> = [];
	const pullRequestReviewComments: Array<{
		readonly pullNumber: number;
		readonly comment: RepositoryComment;
	}> = [];
	const issueComments: Array<{
		readonly pullNumber: number;
		readonly comment: RepositoryComment;
	}> = [];
	for (const pullRequest of pullRequests) {
		const scope = `pull-request:${pullRequest.number}`;
		const files = await collectPages({
			coverage,
			pageReceipts,
			dataset: "pull-request-files",
			pageSize,
			scope,
			screen: omitCredentialPathPatch,
			read: (page) =>
				input.source.listPullRequestFiles(
					input.repository,
					pullRequest.number,
					page,
				),
		});
		pullRequestFiles.push(
			...files.map((file) => ({
				file: filterPullRequestFile(file),
				pullNumber: pullRequest.number,
			})),
		);
		const reviews = await collectPages({
			coverage,
			pageReceipts,
			dataset: "pull-request-reviews",
			pageSize,
			scope,
			read: (page) =>
				input.source.listPullRequestReviews(
					input.repository,
					pullRequest.number,
					page,
				),
		});
		pullRequestReviews.push(
			...reviews.map((review) => ({
				pullNumber: pullRequest.number,
				review: filterPullRequestReview(review),
			})),
		);
		const reviewComments = await collectPages({
			coverage,
			pageReceipts,
			dataset: "pull-request-review-comments",
			pageSize,
			scope,
			read: (page) =>
				input.source.listPullRequestReviewComments(
					input.repository,
					pullRequest.number,
					page,
				),
		});
		pullRequestReviewComments.push(
			...reviewComments.map((comment) => ({
				comment: filterComment(comment),
				pullNumber: pullRequest.number,
			})),
		);
		const comments = await collectPages({
			coverage,
			pageReceipts,
			dataset: "pull-request-issue-comments",
			pageSize,
			scope,
			read: (page) =>
				input.source.listIssueComments(
					input.repository,
					pullRequest.number,
					page,
				),
		});
		issueComments.push(
			...comments.map((comment) => ({
				comment: filterComment(comment),
				pullNumber: pullRequest.number,
			})),
		);
	}

	const checkSuites = await collectPages({
		coverage,
		pageReceipts,
		dataset: "check-suites",
		pageSize,
		scope: `commit:${commitSha}`,
		read: (page) =>
			input.source.listCheckSuites(input.repository, commitSha, page),
	});
	const checkRunIdentityDigests = new Set<string>();
	const checkRuns: Array<{
		readonly checkSuiteId: string;
		readonly checkRun: CheckRun;
	}> = [];
	const checkAnnotations: Array<
		CheckAnnotation & { readonly checkRunId: string }
	> = [];
	for (const suite of checkSuites) {
		const runs = await collectPages({
			coverage,
			pageReceipts,
			dataset: "check-runs",
			pageSize,
			scope: `check-suite:${suite.id}`,
			sharedIdentityDigests: checkRunIdentityDigests,
			read: (page) =>
				input.source.listCheckRuns(input.repository, suite.id, page),
		});
		checkRuns.push(
			...runs.map((checkRun) => ({
				checkRun: filterCheckRun(checkRun),
				checkSuiteId: suite.id,
			})),
		);
		for (const checkRun of runs) {
			const annotations = await collectPages({
				coverage,
				pageReceipts,
				dataset: "check-run-annotations",
				pageSize,
				scope: `check-run:${checkRun.id}`,
				read: (page) =>
					input.source.listCheckRunAnnotations(
						input.repository,
						checkRun.id,
						page,
					),
			});
			checkAnnotations.push(
				...annotations.map((annotation) => ({
					...filterCheckAnnotation(annotation),
					checkRunId: checkRun.id,
				})),
			);
		}
	}
	const commitStatuses = (
		await collectPages({
			coverage,
			pageReceipts,
			dataset: "commit-statuses",
			pageSize,
			scope: `commit:${commitSha}`,
			read: (page) =>
				input.source.listCommitStatuses(input.repository, commitSha, page),
		})
	).map(filterCommitStatus);

	const workflowRuns = (
		await collectPages({
			coverage,
			pageReceipts,
			dataset: "workflow-runs",
			pageSize,
			scope: `commit:${commitSha}`,
			read: (page) =>
				input.source.listWorkflowRuns(
					input.repository,
					input.workflowCreatedAfter,
					page,
					commitSha,
				),
		})
	)
		.filter((run) => run.headSha === commitSha)
		.map(filterWorkflowRun);
	const workflowJobIdentityDigests = new Set<string>();
	const workflowJobs: Array<{
		readonly workflowRunId: string;
		readonly job: WorkflowJob;
	}> = [];
	const workflowArtifacts: Array<{
		readonly workflowRunId: string;
		readonly artifact: WorkflowArtifact;
	}> = [];
	const workflowJobLogs: GitHubWorkflowJobLogEvidence[] = [];
	const workflowJobLogReceipts: GitHubWorkflowJobLogReceipt[] = [];
	let remainingLogBytes = Math.min(
		input.maxCollectionLogBytes ?? Number.MAX_SAFE_INTEGER,
		budget.remainingBytes,
	);
	for (const workflowRun of workflowRuns) {
		const runScope = `workflow-run:${workflowRun.id}`;
		const jobs = (
			await collectPages({
				coverage,
				pageReceipts,
				dataset: "workflow-jobs",
				pageSize,
				scope: runScope,
				sharedIdentityDigests: workflowJobIdentityDigests,
				read: (page) =>
					input.source.listWorkflowJobs(input.repository, workflowRun.id, page),
			})
		).map(filterWorkflowJob);
		workflowJobs.push(
			...jobs.map((job) => ({ job, workflowRunId: workflowRun.id })),
		);
		for (const job of jobs) {
			input.signal?.throwIfAborted();
			remainingLogBytes = Math.min(remainingLogBytes, budget.remainingBytes);
			if (remainingLogBytes <= 0 || budget.remainingItems <= 0) {
				coverage.push({
					availability: { state: "available" },
					cursor: null,
					dataset: "workflow-job-log",
					reasons: [
						{
							code: "local-byte-cap",
							detail:
								"The collection log byte budget was exhausted before this job log was fetched.",
						},
					],
					scope: filterText(`workflow-job:${job.id}`),
					state: "partial",
				});
				workflowJobLogReceipts.push({
					attempt: job.runAttempt,
					coverage: "unavailable",
					jobId: job.id,
					originalByteLength: null,
					outcome: job.conclusion ?? job.status,
					redactedBytes: 0,
					redactionCounts: {},
					retainedByteLength: 0,
					runId: job.runId,
					storedByteLength: 0,
					truncated: null,
				});
				continue;
			}
			const result = await input.source.getWorkflowJobLog(
				input.repository,
				job.id,
				Math.min(input.maxJobLogBytes, remainingLogBytes),
			);
			recordResultCoverage(
				coverage,
				"workflow-job-log",
				`workflow-job:${job.id}`,
				result,
			);
			const outcome = job.conclusion ?? job.status;
			if (result.status === "unavailable") {
				workflowJobLogReceipts.push({
					attempt: job.runAttempt,
					coverage: "unavailable",
					jobId: job.id,
					originalByteLength: null,
					outcome,
					redactedBytes: 0,
					redactionCounts: {},
					retainedByteLength: 0,
					runId: job.runId,
					storedByteLength: 0,
					truncated: null,
				});
				continue;
			}
			const filtered = filterKnownSecrets(result.data.content);
			const storedByteLength = getUtf8ByteLength(filtered.text);
			remainingLogBytes -= storedByteLength;
			budget.remainingBytes -= storedByteLength;
			budget.remainingItems--;
			const logEvidence: GitHubWorkflowJobLogEvidence = {
				content: filtered.text,
				contentType: result.data.contentType,
				jobId: job.id,
				runId: job.runId,
				secretFiltered: true,
			};
			if (input.onWorkflowJobLog) await input.onWorkflowJobLog(logEvidence);
			else workflowJobLogs.push(logEvidence);
			workflowJobLogReceipts.push({
				attempt: job.runAttempt,
				coverage: result.coverage.state,
				jobId: job.id,
				originalByteLength: result.data.originalByteLength,
				outcome,
				redactedBytes: filtered.redactedBytes,
				redactionCounts: filtered.counts,
				retainedByteLength: result.data.contentBytes,
				runId: job.runId,
				storedByteLength,
				truncated: result.data.truncated,
			});
		}
		const artifacts = await collectPages({
			coverage,
			pageReceipts,
			dataset: "workflow-artifacts",
			pageSize,
			scope: runScope,
			read: (page) =>
				input.source.listWorkflowArtifacts(
					input.repository,
					workflowRun.id,
					page,
				),
		});
		workflowArtifacts.push(
			...artifacts.map((artifact) => ({
				artifact: filterWorkflowArtifact(artifact),
				workflowRunId: workflowRun.id,
			})),
		);
	}

	return {
		checkRuns,
		checkAnnotations,
		checkSuites,
		commit,
		commitSha,
		commitStatuses,
		coverage,
		issueComments,
		overallCoverage: worstCoverage(coverage),
		pageReceipts,
		pullRequestFiles,
		pullRequestReviewComments,
		pullRequestReviews,
		pullRequests,
		repository: input.repository,
		remoteEnumerationConsistency: pageReceipts.some(
			(receipt) => receipt.remoteEnumerationConsistency === "conflicted",
		)
			? "conflicted"
			: "unknown",
		workflowArtifacts,
		workflowJobLogReceipts,
		workflowJobLogs,
		workflowJobs,
		workflowRuns,
	};
}

interface ItemScreen<TItem> {
	readonly item: TItem;
	readonly omittedContentReason: string | null;
}

interface CollectPagesInput<TItem> {
	readonly budget: CollectionBudget;
	readonly coverage: GitHubEvidenceCoverageRecord[];
	readonly dataset: GitHubEvidenceDataset;
	readonly pageReceipts: GitHubEvidencePageReceipt[];
	readonly pageSize: number;
	readonly read: (page: PageRequest) => Promise<SourcePage<TItem>>;
	readonly scope: string;
	/**
	 * Runs before anything is hashed, persisted or returned. It may withhold
	 * sensitive content from an item and must say why when it does.
	 */
	readonly screen?: (item: TItem) => ItemScreen<TItem>;
	/**
	 * Identity digests shared across scopes of a dataset whose identities are
	 * globally unique (workflow jobs, check runs).
	 */
	readonly sharedIdentityDigests?: Set<string>;
}

async function collectEvidencePages<TItem>(
	input: CollectPagesInput<TItem>,
): Promise<readonly TItem[]> {
	const items: TItem[] = [];
	const seenItemIdentityDigests =
		input.sharedIdentityDigests ?? new Set<string>();
	const seenUnidentifiedItemDigests = new Set<string>();
	const seenCursors = new Set<string>();
	let cursor: string | undefined;
	for (
		let pageNumber = 0;
		pageNumber < MAX_PAGES_PER_DATASET;
		pageNumber += 1
	) {
		if (input.budget.exhausted || input.budget.remainingPages <= 0) {
			input.coverage.push(budgetCoverage(input.dataset, input.scope));
			return items;
		}
		input.budget.remainingPages--;
		const page = await input.read({ cursor, pageSize: input.pageSize });
		const screened = page.items.map((item) =>
			input.screen === undefined
				? { item, omittedContentReason: null }
				: input.screen(item),
		);
		const pageItems: TItem[] = [];
		let budgetExceeded = !consumeMetadataItem(input.budget, {
			availability: page.availability,
			provenance: page.provenance,
			coverage: page.coverage,
		});
		for (const entry of screened) {
			if (budgetExceeded) break;
			if (!consumeMetadataItem(input.budget, entry.item)) {
				budgetExceeded = true;
				break;
			}
			pageItems.push(entry.item);
		}
		const omittedContentReasons = screened.flatMap((entry) =>
			entry.omittedContentReason === null ? [] : [entry.omittedContentReason],
		);
		const itemSha256 = pageItems.map((item) =>
			sha256(secretFilteredCanonicalJson(item)),
		);
		const itemIdentitySha256 = pageItems.map((item) => {
			const identity = githubItemIdentity(input.dataset, item);
			return identity === null ? null : sha256(identity);
		});
		// Repeated stable identities are dropped after their first observation so
		// the uniquely keyed persistence tables never see them. The page receipt
		// still lists every observed item and is marked conflicted.
		const retainedItems: TItem[] = [];
		let hasRepeatedItem = false;
		for (const [index, item] of pageItems.entries()) {
			const identityDigest = itemIdentitySha256[index];
			if (identityDigest !== null && identityDigest !== undefined) {
				if (seenItemIdentityDigests.has(identityDigest)) {
					hasRepeatedItem = true;
					continue;
				}
				seenItemIdentityDigests.add(identityDigest);
				retainedItems.push(item);
				continue;
			}
			const payloadDigest = itemSha256[index];
			if (payloadDigest !== undefined) {
				if (seenUnidentifiedItemDigests.has(payloadDigest)) {
					hasRepeatedItem = true;
				}
				seenUnidentifiedItemDigests.add(payloadDigest);
			}
			retainedItems.push(item);
		}
		const availability = filterAvailability(page.availability);
		const pageReasons = filterCoverageReasons(page.coverage.reasons);
		const reasons = [
			...(budgetExceeded
				? filterCoverageReasons([
						{
							code: "local-byte-cap",
							detail:
								"Aggregate collection metadata byte/item budget exhausted; remaining items were not retained.",
						},
					])
				: []),
			...pageReasons,
			...filterCoverageReasons(
				omittedContentReasons.length === 0
					? []
					: [
							{
								code: "high-risk-path",
								detail: `${omittedContentReasons.length} item(s) had content withheld: ${omittedContentReasons[0]}`,
							},
						],
			),
			...filterCoverageReasons(
				hasRepeatedItem
					? [
							{
								code: "duplicate-items",
								detail:
									"The remote enumeration repeated items; only the first observation of each was retained",
							},
						]
					: [],
			),
		];
		const coverageState =
			budgetExceeded || (hasRepeatedItem && page.coverage.state === "complete")
				? "partial"
				: page.coverage.state;
		const provenance = filterProvenance(page.provenance);
		const retainedRepresentation = secretFilteredCanonicalJson({
			availability,
			coverage: { reasons: pageReasons, state: page.coverage.state },
			items: pageItems,
			nextCursor: page.nextCursor,
			provenance,
			status: page.status,
		});
		input.pageReceipts.push({
			availability,
			cursor: cursor === undefined ? null : filterText(cursor),
			dataset: input.dataset,
			identityRule: "github-normalized-item-identity/v1",
			itemCount: pageItems.length,
			itemIdentitySha256,
			itemSha256,
			nextCursor: page.nextCursor === null ? null : filterText(page.nextCursor),
			pageOrdinal: pageNumber,
			pageSize: input.pageSize,
			provenance,
			remoteEnumerationConsistency: hasRepeatedItem ? "conflicted" : "unknown",
			representation: {
				byteLength: getUtf8ByteLength(retainedRepresentation),
				digestDomain: "canonical-secret-filtered-page-json/v1",
				sha256: sha256(retainedRepresentation),
				state: "digest_only",
				transform: `canonical-json/v1+secret-filter/v${FILTER_VERSION}`,
			},
			schema: "github-evidence-page-receipt/v1",
			scope: filterText(input.scope),
		});
		input.coverage.push({
			availability,
			cursor: cursor === undefined ? null : filterText(cursor),
			dataset: input.dataset,
			reasons,
			scope: filterText(input.scope),
			state: coverageState,
		});
		if (page.status === "unavailable") return items;
		await input.budget.onMetadataPage?.({
			dataset: input.dataset,
			scope: filterText(input.scope),
			items: retainedItems,
		});
		if (!input.budget.onMetadataPage || DEPENDENCY_DATASETS.has(input.dataset))
			items.push(...retainedItems);
		if (budgetExceeded) return items;
		if (page.nextCursor === null) return items;
		if (seenCursors.has(page.nextCursor)) {
			throw new Error(
				`GitHub evidence ${input.dataset} pagination repeated a cursor`,
			);
		}
		seenCursors.add(page.nextCursor);
		cursor = page.nextCursor;
	}
	throw new Error(
		`GitHub evidence ${input.dataset} pagination exceeded ${MAX_PAGES_PER_DATASET} pages`,
	);
}

function consumeMetadataItem(budget: CollectionBudget, item: unknown): boolean {
	const bytes = getUtf8ByteLength(secretFilteredCanonicalJson(item)) + 4096;
	if (
		bytes > MAX_METADATA_ITEM_BYTES ||
		bytes > budget.remainingBytes ||
		bytes > budget.remainingMetadataBytes ||
		budget.remainingItems <= 0
	) {
		budget.exhausted = true;
		return false;
	}
	budget.remainingBytes -= bytes;
	budget.remainingMetadataBytes -= bytes;
	budget.remainingItems--;
	return true;
}

function budgetCoverage(
	dataset: GitHubEvidenceDataset,
	scope: string,
): GitHubEvidenceCoverageRecord {
	return {
		availability: { state: "available" },
		cursor: null,
		dataset,
		scope: filterText(scope),
		state: "partial",
		reasons: [
			{
				code: "local-byte-cap",
				detail:
					"Aggregate collection byte/item/page budget exhausted; this dataset was not fully collected.",
			},
		],
	};
}

function recordResultCoverage(
	records: GitHubEvidenceCoverageRecord[],
	dataset: GitHubEvidenceDataset,
	scope: string,
	result: {
		readonly availability: SourceAvailability;
		readonly coverage: {
			readonly reasons: readonly CoverageReason[];
			readonly state: "complete" | "partial" | "unavailable";
		};
	},
): void {
	records.push({
		availability: filterAvailability(result.availability),
		cursor: null,
		dataset,
		reasons: filterCoverageReasons(result.coverage.reasons),
		scope: filterText(scope),
		state: result.coverage.state,
	});
}

function githubItemIdentity(
	dataset: GitHubEvidenceDataset,
	item: unknown,
): string | null {
	const field = (name: string): string | null => readIdentityField(item, name);
	switch (dataset) {
		case "commit-pull-requests":
		case "pull-request-reviews":
		case "pull-request-review-comments":
		case "pull-request-issue-comments":
		case "check-suites":
		case "check-runs":
		case "commit-statuses":
		case "workflow-runs":
		case "workflow-jobs":
		case "workflow-artifacts":
			return field("id");
		case "pull-request-files":
			return field("path");
		case "check-run-annotations":
			return null;
		case "commit":
		case "workflow-job-log":
			return null;
	}
}

function readIdentityField(value: unknown, name: string): string | null {
	if (value === null || typeof value !== "object") return null;
	const candidate = Reflect.get(value, name);
	return typeof candidate === "string" || typeof candidate === "number"
		? String(candidate)
		: null;
}

function filterAvailability(value: SourceAvailability): SourceAvailability {
	if (value.state === "available") return value;
	return { ...value, message: filterText(value.message) };
}

function filterCoverageReasons(
	values: readonly CoverageReason[],
): readonly CoverageReason[] {
	return values.map((value) => ({
		...value,
		detail: filterText(value.detail),
	}));
}

function filterProvenance(
	value: SourcePage<unknown>["provenance"],
): SourcePage<unknown>["provenance"] {
	return {
		...value,
		apiVersion: filterText(value.apiVersion),
		endpoint: filterText(value.endpoint),
		repository: {
			name: filterText(value.repository.name),
			owner: filterText(value.repository.owner),
		},
		requestId: filterNullableText(value.requestId),
		retrievedAt: filterText(value.retrievedAt),
		sourceVersion: filterText(value.sourceVersion),
		transfer: {
			...value.transfer,
			etag: filterNullableText(value.transfer.etag),
		},
	};
}

function worstCoverage(
	records: readonly GitHubEvidenceCoverageRecord[],
): "complete" | "partial" | "unavailable" {
	if (records.some((record) => record.state === "unavailable")) {
		return "unavailable";
	}
	return records.some((record) => record.state === "partial")
		? "partial"
		: "complete";
}

function secretFilteredCanonicalJson(value: unknown): string {
	return filterKnownSecrets(JSON.stringify(canonicalize(value))).text;
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, canonicalize(child)]),
		);
	}
	return value;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function filterCommit(value: RepositoryCommit): RepositoryCommit {
	return { ...value, message: filterText(value.message) };
}

function filterPullRequest(value: PullRequestSummary): PullRequestSummary {
	return {
		...value,
		body: filterNullableText(value.body),
		title: filterText(value.title),
	};
}

// Patches of credential-bearing files (current or pre-rename path) follow the
// same high-risk path policy as local capture: metadata stays, content goes.
function omitCredentialPathPatch(
	value: PullRequestFile,
): ItemScreen<PullRequestFile> {
	const credentialPath = [value.path, value.previousPath].some(
		(path) => path !== null && isHighRiskCredentialPath(path),
	);
	if (!credentialPath) return { item: value, omittedContentReason: null };
	return {
		item: { ...value, patch: null },
		omittedContentReason:
			"pull request file patch omitted by the high-risk credential path policy",
	};
}

function filterPullRequestFile(value: PullRequestFile): PullRequestFile {
	return { ...value, patch: filterNullableText(value.patch) };
}

function filterPullRequestReview(value: PullRequestReview): PullRequestReview {
	return { ...value, body: filterNullableText(value.body) };
}

function filterComment(value: RepositoryComment): RepositoryComment {
	return { ...value, body: filterNullableText(value.body) };
}

function filterCheckRun(value: CheckRun): CheckRun {
	return { ...value, name: filterText(value.name) };
}

function filterCheckAnnotation(value: CheckAnnotation): CheckAnnotation {
	return {
		...value,
		message: filterText(value.message),
		path: filterText(value.path),
		rawDetails: filterNullableText(value.rawDetails),
		title: filterNullableText(value.title),
	};
}

function filterCommitStatus(value: CommitStatus): CommitStatus {
	return {
		...value,
		description: filterNullableText(value.description),
	};
}

function filterWorkflowRun(value: WorkflowRun): WorkflowRun {
	return {
		...value,
		displayTitle: filterText(value.displayTitle),
		name: filterNullableText(value.name),
	};
}

function filterWorkflowJob(value: WorkflowJob): WorkflowJob {
	return {
		...value,
		name: filterText(value.name),
		steps: value.steps.map((step) => ({
			...step,
			name: filterText(step.name),
		})),
	};
}

function filterWorkflowArtifact(value: WorkflowArtifact): WorkflowArtifact {
	return { ...value, name: filterText(value.name) };
}

function filterText(value: string): string {
	return filterKnownSecrets(value).text;
}

function filterNullableText(value: string | null): string | null {
	return value === null ? null : filterText(value);
}

function requireNonEmpty(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`GitHub evidence ${label} cannot be empty`);
	return normalized;
}
