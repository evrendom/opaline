import type { RunCiJob, RunCiRun } from "@rudel/api-routes";
import {
	flattenSteps,
	type SessionReaderStep,
	type SessionReaderWaterfall,
} from "../model/session-reader-run-steps";

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

export const CI_WINDOW_GROUP_ID = "ci:pr-window";

const ms = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);
const finite = (value: number) => Number.isFinite(value);

function ciRunName(run: RunCiRun): string {
	const workflow = run.workflowName || "CI";
	const pr = run.pullRequests[0];
	if (pr !== undefined) return `${workflow} · #${pr}`;
	return run.headBranch ? `${workflow} · ${run.headBranch}` : workflow;
}

function jobStep(
	run: RunCiRun,
	job: RunCiJob,
	dimmed: boolean,
	nowMs: number,
): SessionReaderStep {
	const created = ms(job.createdAt);
	const started = ms(job.startedAt);
	const completed = ms(job.completedAt);
	const startMs = [created, started, ms(run.createdAt)].find(finite) ?? nowMs;
	const endMs = finite(completed)
		? completed
		: job.status === "completed"
			? finite(started)
				? started
				: startMs
			: nowMs;
	return {
		children: [],
		ci: {
			dimmed,
			job,
			kind: "job",
			run,
			startedMs: finite(started) ? Math.max(started, startMs) : null,
		},
		detail: job.runnerName || null,
		// GitHub reports a skipped job as completing a moment before it starts.
		endMs: Math.max(endMs, startMs),
		icon: null,
		id: `ci:${run.ciRunId}:${job.jobId}`,
		isError: job.conclusion !== null && FAILED.has(job.conclusion),
		kind: "ci",
		name: job.name,
		nativeId: job.jobId,
		result: job.conclusion ?? job.status,
		startMs,
		text: null,
		toolEvent: null,
	};
}

function runStep(
	run: RunCiRun,
	dimmed: boolean,
	nowMs: number,
): SessionReaderStep {
	const jobs = run.jobs.map((job) => jobStep(run, job, dimmed, nowMs));
	const starts = [ms(run.createdAt), ...jobs.map((job) => job.startMs)].filter(
		finite,
	);
	const startMs = starts.length > 0 ? Math.min(...starts) : nowMs;
	return {
		children: jobs,
		ci: { dimmed, kind: "run", run },
		detail: run.headSha
			? `${run.headBranch} @ ${run.headSha.slice(0, 7)}`
			: null,
		endMs: Math.max(startMs, ...jobs.map((job) => job.endMs)),
		icon: null,
		id: `ci:${run.ciRunId}`,
		isError: run.conclusion !== null && FAILED.has(run.conclusion),
		kind: "ci",
		name: ciRunName(run),
		nativeId: run.githubRunId,
		result: run.conclusion,
		startMs,
		text: null,
		toolEvent: null,
	};
}

function windowGroup(runs: SessionReaderStep[]): SessionReaderStep {
	return {
		children: runs,
		ci: { dimmed: true, kind: "group" },
		detail: null,
		endMs: Math.max(...runs.map((run) => run.endMs)),
		icon: null,
		id: CI_WINDOW_GROUP_ID,
		isError: false,
		kind: "ci",
		name: "On the PR while this run ran",
		nativeId: null,
		result: null,
		startMs: Math.min(...runs.map((run) => run.startMs)),
		text: null,
		toolEvent: null,
	};
}

export function withRunCi(
	waterfall: SessionReaderWaterfall,
	ci: readonly RunCiRun[],
	nowMs: number,
): SessionReaderWaterfall {
	if (ci.length === 0) return waterfall;
	const added = ci
		.filter((run) => run.link === "exact")
		.map((run) => runStep(run, false, nowMs));
	const window = ci
		.filter((run) => run.link === "pr_window")
		.map((run) => runStep(run, true, nowMs));
	if (window.length > 0) added.push(windowGroup(window));
	const steps = [...waterfall.steps];
	for (const step of added.sort((a, b) => a.startMs - b.startMs)) {
		let at = steps.length;
		while (at > 0 && (steps[at - 1]?.startMs ?? 0) > step.startMs) at--;
		steps.splice(at, 0, step);
	}
	return { ...waterfall, allSteps: flattenSteps(steps), steps };
}

export const isAgentStep = (step: SessionReaderStep) => step.kind !== "ci";

export function ciRunUrl(run: RunCiRun): string | null {
	if (!run.repository) return null;
	return `https://github.com/${run.repository}/actions/runs/${run.githubRunId}/attempts/${run.attempt}`;
}

export function ciJobUrl(run: RunCiRun, job: RunCiJob): string | null {
	if (!run.repository) return null;
	return `https://github.com/${run.repository}/actions/runs/${run.githubRunId}/job/${job.jobId}`;
}

export function pullRequestUrl(repository: string, number: number): string {
	return `https://github.com/${repository}/pull/${number}`;
}

export function ciUrl(step: SessionReaderStep): string | null {
	const ci = step.ci;
	if (!ci || ci.kind === "group") return null;
	return ci.kind === "job" ? ciJobUrl(ci.run, ci.job) : ciRunUrl(ci.run);
}
