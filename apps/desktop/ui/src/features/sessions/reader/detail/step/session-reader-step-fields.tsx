import type { RunCiRun } from "@rudel/api-routes";
import type { ReactNode } from "react";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { formatCompactNumber, formatTimeOfDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
	CiViewLink,
	ciRunPicks,
	GitHubLink,
} from "../../ci/session-reader-ci-link";
import { ciUrl } from "../../ci/session-reader-run-ci";
import type {
	SessionReaderStep,
	SessionReaderWaterfall,
} from "../../model/session-reader-model";
import { useSessionPlaces } from "../../session-places";
import {
	formatDuration,
	formatSpanDuration,
} from "../waterfall/session-reader-waterfall-chips";
import { toolSearchFields } from "./session-reader-tool-search";

export type FieldSpec = { label: string; value: ReactNode; wide?: boolean };

export function Field({ label, value, wide }: FieldSpec) {
	return (
		<div className={cn("flex min-w-0 flex-col gap-xs", wide && "col-span-2")}>
			<span className="text-body-m text-ink-3">{label}</span>
			<span className="text-body-l tabular-nums [overflow-wrap:anywhere]">
				{value}
			</span>
		</div>
	);
}

function InSessionGitHubLink({ href }: { href: string }) {
	if (!useSessionPlaces()) return null;
	return <GitHubLink href={href} label="Open on GitHub" />;
}

function StartedField(atMs: number, turnStartMs: number): FieldSpec {
	return {
		label: "Started",
		value: (
			<span>
				+{formatDuration(atMs - turnStartMs)}{" "}
				<span className="text-ink-3">{formatTimeOfDay(atMs)}</span>
			</span>
		),
	};
}

function turnFields(step: SessionReaderStep): FieldSpec[] {
	const fields: FieldSpec[] = [];
	if (step.waitsOnYou)
		fields.push({
			label: "Waited on you",
			value: formatSpanDuration(step.endMs - step.startMs),
		});
	return fields;
}

export const CI_STATUS: Record<string, string> = {
	action_required: "Needs approval",
	cancelled: "Cancelled",
	completed: "Completed",
	failed: "Failed",
	failure: "Failed",
	killed: "Killed",
	in_progress: "Running",
	neutral: "Neutral",
	queued: "Queued",
	skipped: "Skipped",
	startup_failure: "Failed to start",
	success: "Passed",
	timed_out: "Timed out",
};

function ciLink(run: RunCiRun): string {
	if (run.link === "pr_window") {
		const prs = run.pullRequests.map((pr) => `#${pr}`).join(", ");
		return `GitHub ran it for ${prs || "a PR"} this run named, while the run was going. A push by anyone else then would read the same.`;
	}
	if (run.relations.includes("commit_pushed"))
		return "It ran on a commit this run pushed.";
	return "This run read its status.";
}

function ciFields(
	step: SessionReaderStep,
	waterfall: SessionReaderWaterfall,
): FieldSpec[] {
	const ci = step.ci;
	const started = StartedField(step.startMs, waterfall.startMs);
	if (!ci || ci.kind === "group")
		return [
			started,
			{ label: "CI runs", value: String(step.children.length) },
			{
				label: "Linked",
				value:
					"GitHub ran these for PRs this run named, while it was going. A push by anyone else then would read the same, so they aren't counted as the run's own.",
				wide: true,
			},
		];
	const { run } = ci;
	const url = ciUrl(step);
	const fields: FieldSpec[] = [started];
	if (ci.kind === "job") {
		const queuedUntil = ci.startedMs ?? step.endMs;
		fields.push(
			{
				label: "Status",
				value:
					CI_STATUS[ci.job.conclusion ?? ci.job.status] ??
					(ci.job.conclusion || ci.job.status),
			},
			{ label: "Queued", value: formatDuration(queuedUntil - step.startMs) },
			{
				label: "Ran",
				value:
					ci.startedMs === null
						? "—"
						: formatSpanDuration(step.endMs - ci.startedMs),
			},
			{ label: "Runner", value: ci.job.runnerName || "—" },
		);
	} else {
		fields.push(
			{
				label: "Status",
				value: run.conclusion
					? (CI_STATUS[run.conclusion] ?? run.conclusion)
					: "Running",
			},
			{
				label: "Duration",
				value: formatSpanDuration(step.endMs - step.startMs),
			},
			{ label: "Jobs", value: String(run.jobs.length) },
		);
	}
	fields.push(
		{ label: "Workflow", value: run.workflowName || "—" },
		{ label: "Trigger", value: run.event || "—" },
		{
			label: "Commit",
			value: (
				<span className="font-data text-body-m">
					{run.headBranch || "—"}
					{run.headSha ? ` @ ${run.headSha.slice(0, 7)}` : ""}
				</span>
			),
			wide: true,
		},
		{ label: "Linked", value: ciLink(run), wide: true },
	);
	fields.push({
		label: "GitHub",
		value: (
			<span className="inline-flex items-center gap-xs">
				<CiViewLink
					github={url}
					picks={ciRunPicks(run)}
					className="underline underline-offset-2"
				>
					{ci.kind === "job" ? `Job ${ci.job.jobId}` : `Run ${run.githubRunId}`}
					{run.attempt > 1 ? `, attempt ${run.attempt}` : ""}
				</CiViewLink>
				{url ? <InSessionGitHubLink href={url} /> : null}
			</span>
		),
		wide: true,
	});
	return fields;
}

function backgroundFields(
	step: SessionReaderStep,
	waterfall: SessionReaderWaterfall,
): FieldSpec[] {
	const background = step.toolEvent?.background;
	if (!background) return [];
	if (step.toolEvent?.toolName === "SendMessage")
		return [
			{
				label: "Answered",
				value: background.finishedAt
					? `${formatDuration(Date.parse(background.finishedAt) - step.endMs)} later`
					: "No answer recorded",
			},
		];
	const handedMs = step.backgroundFromMs ?? step.endMs;
	const ended = background.finishedAt
		? [
				CI_STATUS[background.status ?? ""] ?? background.status ?? "Ended",
				background.exitCode === null ? null : `exit ${background.exitCode}`,
				`at +${formatDuration(Date.parse(background.finishedAt) - waterfall.startMs)}`,
			]
				.filter(Boolean)
				.join(", ")
		: "No notification recorded";
	return [
		{
			label: "Background",
			value: background.timedOut
				? `Moved there after ${formatDuration(handedMs - step.startMs)}, at its timeout`
				: "Started there",
		},
		{ label: "Ended", value: ended },
		{
			label: "Output",
			value: `Written to a file on the member's machine (task ${background.taskId}), not to the transcript.`,
			wide: true,
		},
	];
}

const COMPACTION_TRIGGER: Record<string, string> = {
	auto: "Automatic, the context was full",
	manual: "Manual, /compact",
};

function compactionFields(step: SessionReaderStep): FieldSpec[] {
	const compaction = step.compaction ?? {};
	const { afterTokens, beforeTokens, keptMessages, loadedTools, trigger } =
		compaction;
	const dropped =
		beforeTokens !== undefined && afterTokens !== undefined
			? Math.max(0, beforeTokens - afterTokens)
			: undefined;
	const tokens = (value: number | undefined) =>
		value === undefined ? "—" : `${formatCompactNumber(value)} tokens`;
	const fields: FieldSpec[] = [
		{
			label: "Trigger",
			value: trigger ? (COMPACTION_TRIGGER[trigger] ?? trigger) : "—",
		},
		{
			label: "Took",
			value:
				step.endMs > step.startMs
					? formatSpanDuration(step.endMs - step.startMs)
					: "—",
		},
		{ label: "Context before", value: tokens(beforeTokens) },
		{ label: "Context after", value: tokens(afterTokens) },
		{
			label: "Dropped",
			value:
				dropped === undefined
					? "—"
					: `${tokens(dropped)}, ${Math.round((dropped / Math.max(1, beforeTokens ?? 0)) * 100)}%`,
		},
		{
			label: "Kept as written",
			value:
				keptMessages === undefined
					? "—"
					: `${keptMessages} ${keptMessages === 1 ? "message" : "messages"}`,
		},
	];
	if (loadedTools?.length)
		fields.push({
			label: `Loaded tools carried over · ${loadedTools.length}`,
			value: loadedTools.join(", "),
			wide: true,
		});
	fields.push({
		label: "Left out",
		value:
			"Not recorded. The summary stands in for everything before it except the kept messages; what it dropped is only in the transcript above.",
		wide: true,
	});
	return fields;
}

function launchOf(
	steps: readonly SessionReaderStep[],
	id: string,
	owner: SessionReaderStep | null = null,
): SessionReaderStep | null {
	for (const each of steps) {
		if (each.id === id) return owner;
		const found = launchOf(
			each.children,
			id,
			each.kind === "agent" ? each : owner,
		);
		if (found) return found;
	}
	return null;
}

export function subagentModelLabel(
	launch: SessionReaderStep,
	ranOn: string | null,
): string | null {
	const name = ranOn ?? launch.model;
	const effort = launch.effort
		? launch.effort[0]?.toUpperCase() + launch.effort.slice(1)
		: null;
	const label = name ? formatModelDisplayLabel(name) : null;
	return label && effort ? `${label} · ${effort}` : (label ?? effort);
}

export function stepFields(
	step: SessionReaderStep,
	waterfall: SessionReaderWaterfall,
	carded: boolean,
	ranOn: (launch: SessionReaderStep) => string | null = () => null,
): FieldSpec[] {
	if (step.kind === "ci") return ciFields(step, waterfall);
	if (step.harness === "compaction") return compactionFields(step);
	if (step.harness === "member") return [];
	const isTool = step.kind === "agent" || step.kind === "tool";
	const fields: FieldSpec[] = turnFields(step);
	if (carded) {
		fields.push(...backgroundFields(step, waterfall));
		return fields;
	}
	if (step.kind === "agent") {
		fields.push(
			{ label: "Model", value: subagentModelLabel(step, ranOn(step)) ?? "—" },
			...backgroundFields(step, waterfall).filter(
				(field) => field.label === "Ended",
			),
		);
		return fields;
	}
	if (step.harness === "notification" && step.notification?.agent)
		return fields;
	if (step.harness === "notification") {
		fields.push(...backgroundFields(step, waterfall));
		if (step.detail)
			fields.push({ label: "Target", value: step.detail, wide: true });
		return fields;
	}
	if (isTool) {
		if (!step.skill && step.toolEvent?.toolName !== "ToolSearch")
			fields.push(
				{
					label: "Tool",
					value: <span>{step.toolEvent?.toolName ?? step.name}</span>,
				},
				{
					label: "Status",
					value: step.isError
						? "Failed"
						: step.result === null
							? "No result"
							: "Succeeded",
				},
			);
		fields.push(
			...toolSearchFields(step, waterfall),
			...backgroundFields(step, waterfall),
		);
		if (step.detail && !carded && step.toolEvent?.toolName !== "ToolSearch") {
			fields.push({
				label: "Target",
				value: step.detail,
				wide: true,
			});
		}
		return fields;
	}
	if (step.kind === "thinking" && !step.text) {
		const call = step.writes
			? waterfall.allSteps.find((candidate) => candidate.id === step.writes)
			: undefined;
		const lead = call ? (call.command?.lead ?? call.name) : null;
		const took = formatSpanDuration(step.endMs - step.startMs);
		fields.push({
			label: "What happened",
			value: lead
				? `The model spent ${took} deciding on its next call, ${lead}, and writing it. It wrote no thinking down, so the call is all there is to show.`
				: `The model spent ${took} working out what to do next. It wrote no thinking down.`,
			wide: true,
		});
		return fields;
	}
	const owner = launchOf(waterfall.steps, step.id);
	const model = owner
		? subagentModelLabel(owner, ranOn(owner))
		: waterfall.model
			? formatModelDisplayLabel(waterfall.model)
			: null;
	if (step.kind === "message" && model) {
		fields.push({ label: "Model", value: model });
	}
	return fields;
}
