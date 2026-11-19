import type {
	RunCiLink,
	RunCiRun,
	SessionPullRequest,
	SessionRunCiRun,
} from "@rudel/api-routes";

export type DemoRunCiSession = {
	readonly runs: readonly SessionRunCiRun[];
	readonly pullRequests: readonly SessionPullRequest[];
};

export type Repository = { readonly id: string; readonly name: string };

type JobSpec = readonly [
	jobId: string,
	name: string,
	conclusion: string,
	seconds: readonly [created: number, started: number, completed: number],
	runner: number | null,
];

type CiSpec = {
	readonly repository: Repository;
	readonly runId: string;
	readonly attempt?: number;
	readonly workflow: string;
	readonly event: string;
	readonly branch: string;
	readonly sha: string;
	readonly conclusion: string;
	readonly createdAt: string;
	readonly jobs: readonly JobSpec[];
};

type Ci = Omit<RunCiRun, "link" | "relations" | "pullRequests">;

export const LOOMRAIL: Repository = { id: "812734519", name: "acme/loomrail" };
export const LOOMRAIL_UI: Repository = {
	id: "846120387",
	name: "acme/loomrail-ui",
};

const later = (iso: string, seconds: number) =>
	new Date(Date.parse(iso) + seconds * 1000).toISOString();

export function ci(spec: CiSpec): Ci {
	const attempt = spec.attempt ?? 1;
	return {
		ciRunId: `${spec.repository.id}/actions_run/${spec.runId}/${attempt}`,
		githubRunId: spec.runId,
		attempt,
		repository: spec.repository.name,
		workflowName: spec.workflow,
		event: spec.event,
		headBranch: spec.branch,
		headSha: spec.sha,
		conclusion: spec.conclusion,
		createdAt: later(spec.createdAt, 0),
		jobs: spec.jobs.map(
			([jobId, name, conclusion, [created, started, completed], runner]) => ({
				jobId,
				name,
				status: "completed",
				conclusion,
				createdAt: later(spec.createdAt, created),
				startedAt: later(spec.createdAt, started),
				completedAt: later(spec.createdAt, completed),
				runnerName: runner === null ? "" : `GitHub Actions ${runner}`,
			}),
		),
	};
}

export function pullCi(
	repository: Repository,
	runId: string,
	branch: string,
	sha: string,
	createdAt: string,
	check: readonly [jobId: string, conclusion: string, seconds: number],
	runner: number,
): Ci {
	const [jobId, conclusion, seconds] = check;
	return ci({
		repository,
		runId,
		workflow: "ci",
		event: "pull_request",
		branch,
		sha,
		conclusion,
		createdAt,
		jobs: [[jobId, "check", conclusion, [0, 4, 4 + seconds], runner]],
	});
}

export function preview(
	repository: Repository,
	runId: string,
	branch: string,
	sha: string,
	createdAt: string,
	job: readonly [jobId: string, seconds: number | null],
	runner: number | null,
): Ci {
	const [jobId, seconds] = job;
	const conclusion = seconds === null ? "skipped" : "success";
	return ci({
		repository,
		runId,
		workflow: "deploy-preview",
		event: "pull_request",
		branch,
		sha,
		conclusion,
		createdAt,
		jobs: [
			[
				jobId,
				"preview",
				conclusion,
				seconds === null ? [0, 0, -1] : [0, 1, 1 + seconds],
				runner,
			],
		],
	});
}

export function linked(
	run: Ci,
	link: RunCiLink,
	relations: readonly string[],
	pullRequests: readonly number[],
): RunCiRun {
	return {
		...run,
		link,
		relations: [...relations].sort(),
		pullRequests: [...pullRequests],
	};
}

export function sessionRun(
	turn: number,
	startedAt: string,
	ci: readonly RunCiRun[],
): SessionRunCiRun {
	return {
		agentId: "",
		turn,
		startedAt,
		ci: [...ci].sort(
			(a, b) =>
				Number(b.link === "exact") - Number(a.link === "exact") ||
				a.createdAt.localeCompare(b.createdAt) ||
				a.ciRunId.localeCompare(b.ciRunId),
		),
	};
}

export const BOTH = ["pr_branch_head", "pr_named"] as const;

export function merged(
	repository: Repository,
	number: number,
	title: string,
	headRef: string,
	authorLogin: string,
	mergedAt: string,
): SessionPullRequest {
	return {
		repository: repository.name,
		number,
		relations: [...BOTH],
		title,
		state: "closed",
		draft: false,
		mergedAt: later(mergedAt, 0),
		headRef,
		authorLogin,
	};
}
