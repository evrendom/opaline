import { z } from "zod";
import {
	type githubActorSchema,
	type githubArtifactSchema,
	githubArtifactsResponseSchema,
	githubCheckAnnotationSchema,
	type githubCheckRunSchema,
	githubCheckRunsResponseSchema,
	type githubCheckSuiteSchema,
	githubCheckSuitesResponseSchema,
	githubCommitSchema,
	githubCommitStatusSchema,
	githubIssueCommentSchema,
	githubPullRequestFileSchema,
	githubPullRequestSchema,
	githubReviewCommentSchema,
	githubReviewSchema,
	type githubWorkflowJobSchema,
	githubWorkflowJobsResponseSchema,
	type githubWorkflowRunSchema,
	githubWorkflowRunsResponseSchema,
} from "./github-schemas.js";
import {
	createGitHubTransport,
	decodePageCursor,
	type GitHubAuthorization,
	type GitHubConditionalCache,
	type GitHubResponseMetadata,
	GitHubSourceError,
	type GitHubTransport,
	getNextPageCursor,
} from "./github-transport.js";
import {
	type CheckAnnotation,
	type CheckRun,
	type CheckSuite,
	type CommitStatus,
	type CoverageReason,
	GITHUB_REST_API_VERSION,
	GITHUB_SOURCE_VERSION,
	type PageRequest,
	type PullRequestFile,
	type PullRequestReview,
	type PullRequestSummary,
	REPOSITORY_INTELLIGENCE_SCHEMA_VERSION,
	type RepositoryActor,
	type RepositoryComment,
	type RepositoryCommit,
	type RepositoryCoordinates,
	type RepositoryIntelligenceSource,
	type SourceCoverage,
	type SourcePage,
	type SourceProvenance,
	type SourceResult,
	type WorkflowArtifact,
	type WorkflowJob,
	type WorkflowJobLog,
	type WorkflowRun,
} from "./types.js";

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
type GitHubActor = z.infer<typeof githubActorSchema>;
type GitHubCommit = z.infer<typeof githubCommitSchema>;
type GitHubPullRequest = z.infer<typeof githubPullRequestSchema>;

export type GitHubSourceOptions = Readonly<{
	authorization?: GitHubAuthorization;
	baseUrl?: string;
	conditionalCache?: GitHubConditionalCache;
	fetch?: typeof globalThis.fetch;
	maxResponseBytes?: number;
	maxRetries?: number;
	maxRetryDelayMs?: number;
	now?: () => number;
	sleep?: (milliseconds: number) => Promise<void>;
	userAgent?: string;
}>;

export function createGitHubRepositorySource(
	options: GitHubSourceOptions = {},
): RepositoryIntelligenceSource {
	const transport = createGitHubTransport({
		authorization: options.authorization,
		baseUrl: options.baseUrl,
		conditionalCache: options.conditionalCache,
		fetch: options.fetch,
		maxResponseBytes: options.maxResponseBytes,
		maxRetries: options.maxRetries,
		maxRetryDelayMs: options.maxRetryDelayMs,
		now: options.now,
		sleep: options.sleep,
		userAgent: options.userAgent,
	});
	const source: RepositoryIntelligenceSource = {
		getCommit: (repository, ref) =>
			getMappedResult(
				repository,
				`/commits/${encodeURIComponent(ref)}`,
				githubCommitSchema,
				mapCommit,
				transport,
			),
		listCommitPullRequests: (repository, commitSha, page) =>
			listDirect(
				repository,
				`/commits/${encodeURIComponent(commitSha)}/pulls`,
				{},
				page,
				githubPullRequestSchema,
				mapPullRequest,
				transport,
			),
		listPullRequestFiles: (repository, pullNumber, page) =>
			listDirect(
				repository,
				`/pulls/${pullNumber}/files`,
				{},
				page,
				githubPullRequestFileSchema,
				(item): PullRequestFile => ({
					path: item.filename,
					previousPath: item.previous_filename,
					status: item.status,
					additions: item.additions,
					deletions: item.deletions,
					changes: item.changes,
					sha: item.sha,
					patch: item.patch,
				}),
				transport,
			),
		listPullRequestReviews: (repository, pullNumber, page) =>
			listDirect(
				repository,
				`/pulls/${pullNumber}/reviews`,
				{},
				page,
				githubReviewSchema,
				(item): PullRequestReview => ({
					id: String(item.id),
					nodeId: item.node_id,
					author: mapNullableActor(item.user),
					body: item.body,
					state: item.state,
					commitSha: item.commit_id,
					submittedAt: item.submitted_at,
					htmlUrl: item.html_url,
				}),
				transport,
			),
		listPullRequestReviewComments: (repository, pullNumber, page) =>
			listDirect(
				repository,
				`/pulls/${pullNumber}/comments`,
				{},
				page,
				githubReviewCommentSchema,
				(item): RepositoryComment => ({
					id: String(item.id),
					kind: "review",
					author: mapNullableActor(item.user),
					body: item.body,
					path: item.path,
					commitSha: item.commit_id,
					createdAt: item.created_at,
					updatedAt: item.updated_at,
					htmlUrl: item.html_url,
				}),
				transport,
			),
		listIssueComments: (repository, issueNumber, page) =>
			listDirect(
				repository,
				`/issues/${issueNumber}/comments`,
				{},
				page,
				githubIssueCommentSchema,
				(item): RepositoryComment => ({
					id: String(item.id),
					kind: "issue",
					author: mapNullableActor(item.user),
					body: item.body,
					path: null,
					commitSha: null,
					createdAt: item.created_at,
					updatedAt: item.updated_at,
					htmlUrl: item.html_url,
				}),
				transport,
			),
		listCheckSuites: (repository, ref, page) =>
			listWrapped(
				repository,
				`/commits/${encodeURIComponent(ref)}/check-suites`,
				{},
				page,
				githubCheckSuitesResponseSchema,
				(response) => response.check_suites,
				mapCheckSuite,
				transport,
			),
		listCheckRuns: (repository, checkSuiteId, page) =>
			listWrapped(
				repository,
				`/check-suites/${encodeURIComponent(checkSuiteId)}/check-runs`,
				{},
				page,
				githubCheckRunsResponseSchema,
				(response) => response.check_runs,
				mapCheckRun,
				transport,
			),
		listCheckRunAnnotations: (repository, checkRunId, page) =>
			listDirect(
				repository,
				`/check-runs/${encodeURIComponent(checkRunId)}/annotations`,
				{},
				page,
				githubCheckAnnotationSchema,
				mapCheckAnnotation,
				transport,
			),
		listCommitStatuses: (repository, ref, page) =>
			listDirect(
				repository,
				`/commits/${encodeURIComponent(ref)}/statuses`,
				{},
				page,
				githubCommitStatusSchema,
				mapCommitStatus,
				transport,
			),
		listWorkflowRuns: (repository, createdAfter, page, headSha) =>
			listWrapped(
				repository,
				"/actions/runs",
				{
					created: createdAfter ? `>=${createdAfter}` : undefined,
					head_sha: headSha
						? requireValue(headSha, "workflow head SHA")
						: undefined,
				},
				page,
				githubWorkflowRunsResponseSchema,
				(response) => response.workflow_runs,
				mapWorkflowRun,
				transport,
			),
		listWorkflowJobs: (repository, runId, page) =>
			listWrapped(
				repository,
				`/actions/runs/${encodeURIComponent(runId)}/jobs`,
				{ filter: "all" },
				page,
				githubWorkflowJobsResponseSchema,
				(response) => response.jobs,
				mapWorkflowJob,
				transport,
			),
		getWorkflowJobLog: (repository, jobId, maxBytes) =>
			getWorkflowJobLog(repository, jobId, maxBytes, transport),
		listWorkflowArtifacts: (repository, runId, page) =>
			listWrapped(
				repository,
				`/actions/runs/${encodeURIComponent(runId)}/artifacts`,
				{},
				page,
				githubArtifactsResponseSchema,
				(response) => response.artifacts,
				mapWorkflowArtifact,
				transport,
			),
	};
	return Object.freeze(source);
}

async function getWorkflowJobLog(
	repository: RepositoryCoordinates,
	jobId: string,
	maxBytes: number,
	transport: GitHubTransport,
): Promise<SourceResult<WorkflowJobLog>> {
	const normalizedJobId = requireValue(jobId, "workflow job ID");
	const path = `${repositoryPath(repository)}/actions/jobs/${encodeURIComponent(normalizedJobId)}/logs`;
	try {
		const response = await transport.requestText(path, {}, maxBytes);
		const coverage = response.data.truncated
			? partialCoverage({
					code: "local-byte-cap",
					detail: `Workflow job log exceeded the ${maxBytes} byte limit; the bounded prefix is included`,
				})
			: completeCoverage();
		return availableResult(
			repository,
			response.metadata,
			{
				jobId: normalizedJobId,
				content: response.data.text,
				contentBytes: response.data.byteLength,
				originalByteLength: response.data.originalByteLength,
				contentType: response.data.contentType,
				truncated: response.data.truncated,
				sensitivity: "secret-bearing",
				persistence: "secret-filter-required",
			},
			coverage,
		);
	} catch (error) {
		return unavailableResultOrThrow(repository, path, error);
	}
}

async function getMappedResult<TSchema extends z.ZodTypeAny, TData>(
	repository: RepositoryCoordinates,
	pathSuffix: string,
	schema: TSchema,
	map: (raw: z.output<TSchema>) => TData,
	transport: GitHubTransport,
): Promise<SourceResult<TData>> {
	const path = `${repositoryPath(repository)}${pathSuffix}`;
	try {
		const response = await transport.requestJson(path, {}, schema);
		return availableResult(
			repository,
			response.metadata,
			map(response.data),
			completeCoverage(),
		);
	} catch (error) {
		return unavailableResultOrThrow(repository, path, error);
	}
}

async function listDirect<TSchema extends z.ZodTypeAny, TItem>(
	repository: RepositoryCoordinates,
	pathSuffix: string,
	query: Readonly<Record<string, string | number | boolean | undefined>>,
	page: PageRequest,
	itemSchema: TSchema,
	map: (raw: z.output<TSchema>, index: number) => TItem,
	transport: GitHubTransport,
): Promise<SourcePage<TItem>> {
	const path = `${repositoryPath(repository)}${pathSuffix}`;
	const pageNumber = decodePageCursor(page.cursor);
	const pageSize = normalizePageSize(
		page.pageSize,
		DEFAULT_PAGE_SIZE,
		MAX_PAGE_SIZE,
	);
	try {
		const response = await transport.requestJson(
			path,
			{ ...query, page: pageNumber, per_page: pageSize },
			z.array(itemSchema),
		);
		return availablePage(
			repository,
			response.metadata,
			response.data.map(map),
			getNextPageCursor(response.metadata.link),
			completeCoverage(),
		);
	} catch (error) {
		return unavailablePageOrThrow(repository, path, error);
	}
}

async function listWrapped<TSchema extends z.ZodTypeAny, TRawItem, TItem>(
	repository: RepositoryCoordinates,
	pathSuffix: string,
	query: Readonly<Record<string, string | number | boolean | undefined>>,
	page: PageRequest,
	responseSchema: TSchema,
	select: (response: z.output<TSchema>) => readonly TRawItem[],
	map: (raw: TRawItem, index: number) => TItem,
	transport: GitHubTransport,
): Promise<SourcePage<TItem>> {
	const path = `${repositoryPath(repository)}${pathSuffix}`;
	const pageNumber = decodePageCursor(page.cursor);
	const pageSize = normalizePageSize(
		page.pageSize,
		DEFAULT_PAGE_SIZE,
		MAX_PAGE_SIZE,
	);
	try {
		const response = await transport.requestJson(
			path,
			{ ...query, page: pageNumber, per_page: pageSize },
			responseSchema,
		);
		return availablePage(
			repository,
			response.metadata,
			select(response.data).map(map),
			getNextPageCursor(response.metadata.link),
			completeCoverage(),
		);
	} catch (error) {
		return unavailablePageOrThrow(repository, path, error);
	}
}

function mapActor(actor: GitHubActor): RepositoryActor {
	return { id: String(actor.id), login: actor.login, kind: actor.type };
}

function mapNullableActor(actor: GitHubActor | null): RepositoryActor | null {
	return actor ? mapActor(actor) : null;
}

function mapCommit(item: GitHubCommit): RepositoryCommit {
	return {
		sha: item.sha,
		message: item.commit.message,
		author: mapNullableActor(item.author),
		committer: mapNullableActor(item.committer),
		authorName: item.commit.author?.name ?? null,
		authorEmail: item.commit.author?.email ?? null,
		authoredAt: item.commit.author?.date ?? null,
		committerName: item.commit.committer?.name ?? null,
		committerEmail: item.commit.committer?.email ?? null,
		committedAt: item.commit.committer?.date ?? null,
		parentShas: item.parents.map((parent) => parent.sha),
		htmlUrl: item.html_url,
	};
}

function mapPullRequest(item: GitHubPullRequest): PullRequestSummary {
	return {
		id: String(item.id),
		number: item.number,
		nodeId: item.node_id,
		title: item.title,
		body: item.body,
		state: item.state,
		draft: item.draft,
		author: mapNullableActor(item.user),
		baseRef: item.base.ref,
		baseSha: item.base.sha,
		headRef: item.head.ref,
		headSha: item.head.sha,
		createdAt: item.created_at,
		updatedAt: item.updated_at,
		closedAt: item.closed_at,
		mergedAt: item.merged_at,
		htmlUrl: item.html_url,
	};
}

function mapCheckSuite(
	item: z.infer<typeof githubCheckSuiteSchema>,
): CheckSuite {
	return {
		id: String(item.id),
		nodeId: item.node_id,
		headSha: item.head_sha,
		headBranch: item.head_branch,
		status: item.status,
		conclusion: item.conclusion,
		appSlug: item.app?.slug ?? null,
		createdAt: item.created_at,
		updatedAt: item.updated_at,
	};
}

function mapCheckRun(item: z.infer<typeof githubCheckRunSchema>): CheckRun {
	return {
		id: String(item.id),
		nodeId: item.node_id,
		name: item.name,
		headSha: item.head_sha,
		status: item.status,
		conclusion: item.conclusion,
		startedAt: item.started_at,
		completedAt: item.completed_at,
		appSlug: item.app?.slug ?? null,
		detailsUrl: item.details_url,
	};
}

function mapCheckAnnotation(
	item: z.infer<typeof githubCheckAnnotationSchema>,
): CheckAnnotation {
	return {
		annotationLevel: item.annotation_level,
		blobHref: item.blob_href,
		endColumn: item.end_column,
		endLine: item.end_line,
		message: item.message,
		path: item.path,
		rawDetails: item.raw_details,
		startColumn: item.start_column,
		startLine: item.start_line,
		title: item.title,
	};
}

function mapCommitStatus(
	item: z.infer<typeof githubCommitStatusSchema>,
): CommitStatus {
	return {
		id: String(item.id),
		nodeId: item.node_id,
		state: item.state,
		context: item.context,
		description: item.description,
		targetUrl: item.target_url,
		creator: mapNullableActor(item.creator),
		createdAt: item.created_at,
		updatedAt: item.updated_at,
	};
}

function mapWorkflowRun(
	item: z.infer<typeof githubWorkflowRunSchema>,
): WorkflowRun {
	return {
		id: String(item.id),
		nodeId: item.node_id,
		name: item.name,
		displayTitle: item.display_title,
		workflowId: String(item.workflow_id),
		runNumber: item.run_number,
		runAttempt: item.run_attempt,
		event: item.event,
		status: item.status,
		conclusion: item.conclusion,
		headBranch: item.head_branch,
		headSha: item.head_sha,
		createdAt: item.created_at,
		updatedAt: item.updated_at,
		runStartedAt: item.run_started_at,
		htmlUrl: item.html_url,
	};
}

function mapWorkflowJob(
	item: z.infer<typeof githubWorkflowJobSchema>,
): WorkflowJob {
	return {
		id: String(item.id),
		runId: String(item.run_id),
		runAttempt: item.run_attempt,
		name: item.name,
		status: item.status,
		conclusion: item.conclusion,
		headSha: item.head_sha,
		startedAt: item.started_at,
		completedAt: item.completed_at,
		htmlUrl: item.html_url,
		labels: item.labels,
		steps: item.steps.map((step) => ({
			number: step.number,
			name: step.name,
			status: step.status,
			conclusion: step.conclusion,
			startedAt: step.started_at,
			completedAt: step.completed_at,
		})),
	};
}

function mapWorkflowArtifact(
	item: z.infer<typeof githubArtifactSchema>,
): WorkflowArtifact {
	return {
		id: String(item.id),
		nodeId: item.node_id,
		name: item.name,
		sizeInBytes: item.size_in_bytes,
		expired: item.expired,
		digest: item.digest,
		createdAt: item.created_at,
		updatedAt: item.updated_at,
		expiresAt: item.expires_at,
		workflowRunId: item.workflow_run ? String(item.workflow_run.id) : null,
	};
}

function repositoryPath(repository: RepositoryCoordinates): string {
	const owner = requireValue(repository.owner, "repository owner");
	const name = requireValue(repository.name, "repository name");
	return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function availableResult<TData>(
	repository: RepositoryCoordinates,
	metadata: GitHubResponseMetadata,
	data: TData,
	coverage: SourceCoverage,
): SourceResult<TData> {
	return {
		status: "available",
		data,
		availability: { state: "available" },
		coverage,
		provenance: provenance(repository, metadata),
	};
}

function availablePage<TItem>(
	repository: RepositoryCoordinates,
	metadata: GitHubResponseMetadata,
	items: readonly TItem[],
	nextCursor: string | null,
	coverage: SourceCoverage,
): SourcePage<TItem> {
	return {
		status: "available",
		items,
		nextCursor,
		availability: { state: "available" },
		coverage,
		provenance: provenance(repository, metadata),
	};
}

function unavailableResultOrThrow<TData>(
	repository: RepositoryCoordinates,
	path: string,
	error: unknown,
): SourceResult<TData> {
	if (!(error instanceof GitHubSourceError)) {
		throw error;
	}
	if (error.kind !== "forbidden" && error.kind !== "not-found") {
		throw error;
	}
	return {
		status: "unavailable",
		availability: {
			state: "unavailable",
			reason: error.kind,
			message: error.message,
		},
		coverage: unavailableCoverage(error.kind, error.message),
		provenance: unavailableProvenance(repository, path, error.requestId),
	};
}

function unavailablePageOrThrow<TItem>(
	repository: RepositoryCoordinates,
	path: string,
	error: unknown,
): SourcePage<TItem> {
	const result = unavailableResultOrThrow<TItem>(repository, path, error);
	if (result.status === "available") {
		throw new Error("Unexpected available result");
	}
	return {
		status: "unavailable",
		items: [],
		nextCursor: null,
		availability: result.availability,
		coverage: result.coverage,
		provenance: result.provenance,
	};
}

function provenance(
	repository: RepositoryCoordinates,
	metadata: GitHubResponseMetadata,
): SourceProvenance {
	return {
		provider: "github",
		sourceVersion: GITHUB_SOURCE_VERSION,
		schemaVersion: REPOSITORY_INTELLIGENCE_SCHEMA_VERSION,
		apiVersion: GITHUB_REST_API_VERSION,
		repository,
		retrievedAt: new Date().toISOString(),
		endpoint: metadata.endpoint,
		requestId: metadata.requestId,
		transfer: {
			downloadedBytes: metadata.downloadedBytes,
			etag: metadata.etag,
			conditional: metadata.conditional,
		},
	};
}

function unavailableProvenance(
	repository: RepositoryCoordinates,
	endpoint: string,
	requestId: string | null,
): SourceProvenance {
	return {
		provider: "github",
		sourceVersion: GITHUB_SOURCE_VERSION,
		schemaVersion: REPOSITORY_INTELLIGENCE_SCHEMA_VERSION,
		apiVersion: GITHUB_REST_API_VERSION,
		repository,
		retrievedAt: new Date().toISOString(),
		endpoint,
		requestId,
		transfer: {
			downloadedBytes: 0,
			etag: null,
			conditional: "disabled",
		},
	};
}

function completeCoverage(): SourceCoverage {
	return { state: "complete", reasons: [] };
}

function partialCoverage(reason: CoverageReason): SourceCoverage {
	return { state: "partial", reasons: [reason] };
}

function unavailableCoverage(
	kind: "forbidden" | "not-found",
	detail: string,
): SourceCoverage {
	return {
		state: "unavailable",
		reasons: [
			{ code: kind === "forbidden" ? "permission-gated" : "not-found", detail },
		],
	};
}

function normalizePageSize(
	pageSize: number | undefined,
	fallback: number,
	maximum: number,
): number {
	const value = pageSize ?? fallback;
	validatePositiveInteger(value, "pageSize");
	return Math.min(value, maximum);
}

function requireValue(value: string | undefined, name: string): string {
	if (value === undefined || value.trim().length === 0) {
		throw new Error(`${name} is required`);
	}
	return value;
}

function validatePositiveInteger(value: number, name: string): void {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
}
