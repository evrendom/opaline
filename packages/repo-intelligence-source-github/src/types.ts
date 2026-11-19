export const REPOSITORY_INTELLIGENCE_SCHEMA_VERSION = 1;
export const GITHUB_REST_API_VERSION = "2026-03-10";
export const GITHUB_SOURCE_VERSION = "github-rest-2026-03-10.v1";

export type RepositoryCoordinates = Readonly<{
	owner: string;
	name: string;
}>;

export type PageRequest = Readonly<{
	cursor: string | undefined;
	pageSize: number | undefined;
}>;

export type SourceAvailability =
	| Readonly<{ state: "available" }>
	| Readonly<{
			state: "unavailable";
			reason: "forbidden" | "not-found" | "unsupported";
			message: string;
	  }>;

export type CoverageReason = Readonly<{
	code:
		| "upstream-truncated"
		| "local-entry-cap"
		| "local-byte-cap"
		| "time-boundary"
		| "dependency-tree"
		| "high-risk-path"
		| "duplicate-items"
		| "not-relevant"
		| "permission-gated"
		| "not-found"
		| "unsupported";
	detail: string;
}>;

export type SourceCoverage = Readonly<{
	state: "complete" | "partial" | "unavailable";
	reasons: readonly CoverageReason[];
}>;

export type SourceProvenance = Readonly<{
	provider: "github";
	sourceVersion: string;
	schemaVersion: number;
	apiVersion: string;
	repository: RepositoryCoordinates;
	retrievedAt: string;
	endpoint: string;
	requestId: string | null;
	transfer: Readonly<{
		/**
		 * Bytes retained from the successful final response body. This is the full
		 * JSON body or the bounded Actions-log prefix. Headers, cached
		 * representations, failed attempts, discarded retry/error bodies, and log
		 * bytes beyond the caller's cap are excluded.
		 */
		downloadedBytes: number;
		etag: string | null;
		conditional: "disabled" | "miss" | "validated";
	}>;
}>;

export type SourceResult<TData> =
	| Readonly<{
			status: "available";
			data: TData;
			availability: Readonly<{ state: "available" }>;
			coverage: SourceCoverage;
			provenance: SourceProvenance;
	  }>
	| Readonly<{
			status: "unavailable";
			availability: Exclude<SourceAvailability, { state: "available" }>;
			coverage: SourceCoverage;
			provenance: SourceProvenance;
	  }>;

export type SourcePage<TItem> =
	| Readonly<{
			status: "available";
			items: readonly TItem[];
			nextCursor: string | null;
			availability: Readonly<{ state: "available" }>;
			coverage: SourceCoverage;
			provenance: SourceProvenance;
	  }>
	| Readonly<{
			status: "unavailable";
			items: readonly [];
			nextCursor: null;
			availability: Exclude<SourceAvailability, { state: "available" }>;
			coverage: SourceCoverage;
			provenance: SourceProvenance;
	  }>;

export type RepositoryActor = Readonly<{
	id: string;
	login: string;
	kind: string;
}>;

export type RepositoryCommit = Readonly<{
	sha: string;
	message: string;
	author: RepositoryActor | null;
	committer: RepositoryActor | null;
	authorName: string | null;
	authorEmail: string | null;
	authoredAt: string | null;
	committerName: string | null;
	committerEmail: string | null;
	committedAt: string | null;
	parentShas: readonly string[];
	htmlUrl: string;
}>;

export type PullRequestSummary = Readonly<{
	id: string;
	number: number;
	nodeId: string;
	title: string;
	body: string | null;
	state: string;
	draft: boolean;
	author: RepositoryActor | null;
	baseRef: string;
	baseSha: string;
	headRef: string;
	headSha: string;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	mergedAt: string | null;
	htmlUrl: string;
}>;

export type PullRequestFile = Readonly<{
	path: string;
	previousPath: string | null;
	status: string;
	additions: number;
	deletions: number;
	changes: number;
	sha: string;
	patch: string | null;
}>;

export type PullRequestReview = Readonly<{
	id: string;
	nodeId: string;
	author: RepositoryActor | null;
	body: string | null;
	state: string;
	commitSha: string | null;
	submittedAt: string | null;
	htmlUrl: string;
}>;

export type RepositoryComment = Readonly<{
	id: string;
	kind: "issue" | "review" | "commit";
	author: RepositoryActor | null;
	body: string | null;
	path: string | null;
	commitSha: string | null;
	createdAt: string;
	updatedAt: string;
	htmlUrl: string;
}>;

export type CheckSuite = Readonly<{
	id: string;
	nodeId: string;
	headSha: string;
	headBranch: string | null;
	status: string | null;
	conclusion: string | null;
	appSlug: string | null;
	createdAt: string | null;
	updatedAt: string | null;
}>;

export type CheckRun = Readonly<{
	id: string;
	nodeId: string;
	name: string;
	headSha: string;
	status: string;
	conclusion: string | null;
	startedAt: string | null;
	completedAt: string | null;
	appSlug: string | null;
	detailsUrl: string | null;
}>;

export type CheckAnnotation = Readonly<{
	annotationLevel: string;
	blobHref: string | null;
	endColumn: number | null;
	endLine: number;
	message: string;
	path: string;
	rawDetails: string | null;
	startColumn: number | null;
	startLine: number;
	title: string | null;
}>;

export type CommitStatus = Readonly<{
	id: string;
	nodeId: string;
	state: string;
	context: string;
	description: string | null;
	targetUrl: string | null;
	creator: RepositoryActor | null;
	createdAt: string;
	updatedAt: string;
}>;

export type WorkflowRun = Readonly<{
	id: string;
	nodeId: string;
	name: string | null;
	displayTitle: string;
	workflowId: string;
	runNumber: number;
	runAttempt: number;
	event: string;
	status: string | null;
	conclusion: string | null;
	headBranch: string | null;
	headSha: string;
	createdAt: string;
	updatedAt: string;
	runStartedAt: string | null;
	htmlUrl: string;
}>;

export type WorkflowJobStep = Readonly<{
	number: number;
	name: string;
	status: string;
	conclusion: string | null;
	startedAt: string | null;
	completedAt: string | null;
}>;

export type WorkflowJob = Readonly<{
	id: string;
	runId: string;
	runAttempt: number | null;
	name: string;
	status: string;
	conclusion: string | null;
	headSha: string;
	startedAt: string;
	completedAt: string | null;
	htmlUrl: string | null;
	labels: readonly string[];
	steps: readonly WorkflowJobStep[];
}>;

/**
 * Actions logs can contain credentials and other sensitive runtime values.
 * Callers must apply Opaline's secret filter before persisting `content`.
 */
export type WorkflowJobLog = Readonly<{
	jobId: string;
	content: string;
	contentBytes: number;
	originalByteLength: number | null;
	contentType: string | null;
	truncated: boolean;
	sensitivity: "secret-bearing";
	persistence: "secret-filter-required";
}>;

export type WorkflowArtifact = Readonly<{
	id: string;
	nodeId: string;
	name: string;
	sizeInBytes: number;
	expired: boolean;
	digest: string | null;
	createdAt: string;
	updatedAt: string;
	expiresAt: string | null;
	workflowRunId: string | null;
}>;

export interface RepositoryIntelligenceSource {
	getCommit(
		repository: RepositoryCoordinates,
		ref: string,
	): Promise<SourceResult<RepositoryCommit>>;
	listCommitPullRequests(
		repository: RepositoryCoordinates,
		commitSha: string,
		page: PageRequest,
	): Promise<SourcePage<PullRequestSummary>>;
	listPullRequestFiles(
		repository: RepositoryCoordinates,
		pullNumber: number,
		page: PageRequest,
	): Promise<SourcePage<PullRequestFile>>;
	listPullRequestReviews(
		repository: RepositoryCoordinates,
		pullNumber: number,
		page: PageRequest,
	): Promise<SourcePage<PullRequestReview>>;
	listPullRequestReviewComments(
		repository: RepositoryCoordinates,
		pullNumber: number,
		page: PageRequest,
	): Promise<SourcePage<RepositoryComment>>;
	listIssueComments(
		repository: RepositoryCoordinates,
		issueNumber: number,
		page: PageRequest,
	): Promise<SourcePage<RepositoryComment>>;
	listCheckSuites(
		repository: RepositoryCoordinates,
		ref: string,
		page: PageRequest,
	): Promise<SourcePage<CheckSuite>>;
	listCheckRuns(
		repository: RepositoryCoordinates,
		checkSuiteId: string,
		page: PageRequest,
	): Promise<SourcePage<CheckRun>>;
	listCheckRunAnnotations(
		repository: RepositoryCoordinates,
		checkRunId: string,
		page: PageRequest,
	): Promise<SourcePage<CheckAnnotation>>;
	listCommitStatuses(
		repository: RepositoryCoordinates,
		ref: string,
		page: PageRequest,
	): Promise<SourcePage<CommitStatus>>;
	listWorkflowRuns(
		repository: RepositoryCoordinates,
		createdAfter: string | undefined,
		page: PageRequest,
		headSha?: string,
	): Promise<SourcePage<WorkflowRun>>;
	listWorkflowJobs(
		repository: RepositoryCoordinates,
		runId: string,
		page: PageRequest,
	): Promise<SourcePage<WorkflowJob>>;
	getWorkflowJobLog(
		repository: RepositoryCoordinates,
		jobId: string,
		maxBytes: number,
	): Promise<SourceResult<WorkflowJobLog>>;
	listWorkflowArtifacts(
		repository: RepositoryCoordinates,
		runId: string,
		page: PageRequest,
	): Promise<SourcePage<WorkflowArtifact>>;
}
