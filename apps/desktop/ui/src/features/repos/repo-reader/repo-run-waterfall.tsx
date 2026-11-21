import type {
	RepositoryRun,
	RepositoryRunCall,
	RepositoryRunsOf,
} from "@rudel/api-routes";
import { describeCommand } from "@rudel/api-routes/command-identity";
import { getShellCommand } from "@rudel/api-routes/session-context/conversation-tools";
import {
	activityOf,
	type LaneStep,
} from "@rudel/api-routes/session-context/session-reader-step-lanes";
import { IconArrowUpRight } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { shortRunId } from "@/features/sessions/run-id";
import { useShellRoutePath } from "@/features/shell/hooks/use-shell-route-path";
import { orpc } from "@/lib/orpc";
import { useRepoRangeInput } from "./repo-page-data";
import { runHref, useRunCalls } from "./repo-run-calls";

const STALE_TIME_MS = 5 * 60_000;

function stepOf(call: RepositoryRunCall): LaneStep {
	let input: Record<string, unknown> = {};
	try {
		const value: unknown = JSON.parse(call.input?.text ?? "{}");
		if (value && typeof value === "object" && !Array.isArray(value))
			input = value as Record<string, unknown>;
	} catch {
		input = { command: call.input?.text ?? "" };
	}
	const shell = getShellCommand(call.tool, input);
	const operation =
		call.op === "read" || call.op === "write" || call.op === "edit"
			? call.op
			: null;
	return {
		kind: "tool",
		name: call.tool,
		toolEvent: {
			id: call.callId,
			input,
			kind: "tool",
			result: undefined,
			timestamp: call.at,
			toolName: call.tool,
		},
		...(shell ? { command: describeCommand(shell) } : {}),
		...(call.path && operation
			? { files: [{ operation, path: call.path }] }
			: {}),
	} as LaneStep;
}

const ON_BRANCH = new Set(["pr_branch_head", "ci_on_branch_window"]);

function tiedToCi(step: LaneStep, run: RepositoryRun): boolean {
	const activity = activityOf(step);
	if (activity === "git" || activity === "ci") return true;
	if (!run.relations.some((relation) => ON_BRANCH.has(relation))) return false;
	return (
		activity === "edit" ||
		(step.files ?? []).some(
			(file) => file.operation === "edit" || file.operation === "write",
		)
	);
}

export function RunWaterfall({
	of,
	picked,
	repoKey,
	runKeyOf,
}: {
	of: RepositoryRunsOf;
	picked: string;
	repoKey: string;
	runKeyOf: (run: RepositoryRun) => string;
}) {
	const range = useRepoRangeInput();
	const runs = useAnalyticsQuery({
		...orpc.analytics.repositories.runs.queryOptions({
			input: { repoKey, of, range },
		}),
		staleTime: STALE_TIME_MS,
	});
	const run = runs.data?.runs.find((each) => runKeyOf(each) === picked);
	if (!run) return null;
	return <RunSteps of={of} repoKey={repoKey} run={run} />;
}

function RunSteps({
	of,
	repoKey,
	run,
}: {
	of: RepositoryRunsOf;
	repoKey: string;
	run: RepositoryRun;
}) {
	const query = useRunCalls(repoKey, of, run);
	const getShellRoutePath = useShellRoutePath();
	const all = query.data?.calls ?? [];
	const onPr = all.filter((call) => tiedToCi(stepOf(call), run)).length;
	return (
		<section className="flex items-baseline gap-m px-l">
			<h3 className="text-body-m font-medium text-ink-80">
				Run {run.turnId ? shortRunId(run.turnId) : run.turn}
			</h3>
			{query.data ? (
				<span className="text-body-s text-ink-3 tabular-nums">
					{onPr} of {all.length} calls on this PR
				</span>
			) : null}
			<Link
				to={runHref(getShellRoutePath, repoKey, run, "ci")}
				className="ml-auto inline-flex items-center gap-xs text-body-m font-medium text-ink-3 transition-colors hover:text-ink"
			>
				Open session
				<IconArrowUpRight aria-hidden="true" className="size-3.5" />
			</Link>
		</section>
	);
}
