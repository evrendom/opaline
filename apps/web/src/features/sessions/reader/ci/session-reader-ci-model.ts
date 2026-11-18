import type { RunCiJob, RunCiRun, SessionPullRequest } from "@rudel/api-routes";
import { pullRequestKey } from "../session-places";
import type { SummaryCiRun } from "../summary/session-summary-model";

const NO_PR_KEY = "none";

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

const TITLE_WORKFLOWS = new Set(["pr title"]);

export const isFailed = (conclusion: string | null) =>
	conclusion !== null && FAILED.has(conclusion);

export function isTitleCheck(run: RunCiRun): boolean {
	return TITLE_WORKFLOWS.has(run.workflowName.trim().toLowerCase());
}

export type CiPull = {
	key: string;
	pull: SessionPullRequest | null;
	runs: SummaryCiRun[];
};

function unsyncedPull(repository: string, number: number): SessionPullRequest {
	return {
		authorLogin: null,
		draft: null,
		headRef: null,
		mergedAt: null,
		number,
		relations: [],
		repository,
		state: null,
		title: null,
	};
}

export function pullKeysOf(run: RunCiRun): string[] {
	return run.pullRequests.map((number) =>
		pullRequestKey(run.repository, number),
	);
}

export function getCiPulls(
	pullRequests: readonly SessionPullRequest[],
	ci: readonly SummaryCiRun[],
): CiPull[] {
	const byKey = new Map<string, CiPull>();
	for (const pull of pullRequests) {
		const key = pullRequestKey(pull.repository, pull.number);
		byKey.set(key, { key, pull, runs: [] });
	}
	const loose: SummaryCiRun[] = [];
	for (const run of ci) {
		if (run.pullRequests.length === 0) loose.push(run);
		for (const number of run.pullRequests) {
			const key = pullRequestKey(run.repository, number);
			const entry = byKey.get(key) ?? {
				key,
				pull: unsyncedPull(run.repository, number),
				runs: [],
			};
			byKey.set(key, entry);
			entry.runs.push(run);
		}
	}
	const pulls = [...byKey.values()];
	if (loose.length > 0) pulls.push({ key: NO_PR_KEY, pull: null, runs: loose });
	return pulls;
}

export function shownRuns(
	runs: readonly SummaryCiRun[],
	allWorkflows: boolean,
): SummaryCiRun[] {
	return allWorkflows ? [...runs] : runs.filter((run) => !isTitleCheck(run));
}

export type CiVerdict = {
	cancelled: number;
	failed: number;
	passed: number;
	running: number;
	other: number;
};

export function ciVerdict(runs: readonly RunCiRun[]): CiVerdict {
	const verdict: CiVerdict = {
		cancelled: 0,
		failed: 0,
		other: 0,
		passed: 0,
		running: 0,
	};
	for (const run of runs) {
		if (run.conclusion === null) verdict.running += 1;
		else if (run.conclusion === "success") verdict.passed += 1;
		else if (isFailed(run.conclusion)) verdict.failed += 1;
		else if (run.conclusion === "cancelled") verdict.cancelled += 1;
		else verdict.other += 1;
	}
	return verdict;
}

type CiWorkflow = {
	name: string;
	runs: SummaryCiRun[];
	verdict: CiVerdict;
};

const failedFirst = (a: RunCiRun, b: RunCiRun) =>
	Number(isFailed(b.conclusion)) - Number(isFailed(a.conclusion)) ||
	b.createdAt.localeCompare(a.createdAt);

export function groupByWorkflow(runs: readonly SummaryCiRun[]): CiWorkflow[] {
	const byName = new Map<string, SummaryCiRun[]>();
	for (const run of runs) {
		const name = run.workflowName || "Workflow";
		byName.set(name, [...(byName.get(name) ?? []), run]);
	}
	return [...byName.entries()]
		.map(([name, group]) => ({
			name,
			runs: group.sort(failedFirst),
			verdict: ciVerdict(group),
		}))
		.sort(
			(a, b) =>
				Number(b.verdict.failed > 0) - Number(a.verdict.failed > 0) ||
				b.runs.length - a.runs.length ||
				a.name.localeCompare(b.name),
		);
}

export function defaultPull(pulls: readonly CiPull[]): CiPull | undefined {
	return (
		pulls.find((each) =>
			each.runs.some((run) => !isTitleCheck(run) && isFailed(run.conclusion)),
		) ?? pulls[0]
	);
}

export function jobsFailedFirst(jobs: readonly RunCiJob[]): RunCiJob[] {
	return [...jobs].sort(
		(a, b) => Number(isFailed(b.conclusion)) - Number(isFailed(a.conclusion)),
	);
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);

export function runDurationMs(run: RunCiRun): number | null {
	const created = run.jobs
		.map((job) => ms(job.createdAt))
		.filter(Number.isFinite);
	const start = created.length > 0 ? Math.min(...created) : ms(run.createdAt);
	if (!Number.isFinite(start) || run.conclusion === null) return null;
	const ends = run.jobs
		.map((job) => ms(job.completedAt))
		.filter(Number.isFinite);
	return ends.length > 0 ? Math.max(0, Math.max(...ends) - start) : null;
}

export function jobDurationMs(job: RunCiJob): number | null {
	const span = ms(job.completedAt) - ms(job.startedAt);
	return Number.isFinite(span) ? Math.max(0, span) : null;
}

export function pullRelationWords(pull: SessionPullRequest): string | null {
	const named = pull.relations.includes("pr_named");
	const pushed = pull.relations.includes("pr_branch_head");
	if (named && pushed) return "The session named it and pushed its branch.";
	if (pushed) return "The session pushed its branch.";
	if (named) return "The session named it.";
	return null;
}
