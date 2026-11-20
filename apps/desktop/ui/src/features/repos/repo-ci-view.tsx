import type {
	RepositoryPullRequest,
	RepositoryRunsOf,
	SessionPullRequest,
} from "@rudel/api-routes";
import { IconGitPullRequest } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState } from "@/components/dashboard/page-parts";
import { FluidList } from "@/components/fluid-list";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import type { CiPull } from "@/features/sessions/reader/ci/session-reader-ci-model";
import {
	CiPullCard,
	type CiPullRow,
	PullLine,
	useCiPullRows,
} from "@/features/sessions/reader/ci/session-reader-ci-pulls";
import {
	CARD,
	ScrollColumn,
	ViewToggle,
} from "@/features/sessions/reader/files/session-reader-files-parts";
import { pullRequestKey } from "@/features/sessions/reader/session-places";
import { parseSessionOverviewRows } from "@/features/sessions/session-overview-response";
import { isFamilyMemberRow } from "@/features/sessions/session-row-key";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { money } from "./repo-reader/repo-page-kit";
import {
	getPullCosts,
	type PullCost,
	type PullCosts,
} from "./repo-reader/repo-pull-cost";
import { RunWaterfall } from "./repo-reader/repo-run-waterfall";
import {
	RepoRunsColumn,
	RUNS_SHELF,
	runKeyOf,
	usePickedRun,
} from "./repo-reader/repo-runs-column";

const PR_PARAM = "pr";
const CI_PARAM = "ci";

function toCiPull(pull: RepositoryPullRequest): CiPull {
	const session: SessionPullRequest = {
		authorLogin: pull.authorLogin,
		draft: pull.draft,
		headRef: pull.headRef,
		mergedAt: pull.mergedAt,
		number: pull.number,
		relations: [],
		repository: pull.repository,
		state: pull.state,
		title: pull.title,
	};
	return {
		key: pullRequestKey(pull.repository, pull.number),
		pull: session,
		runs: pull.ci.map((run) => ({ ...run, places: [] })),
	};
}

export function RepoCiView({
	pullRequests,
	repoKey,
}: {
	pullRequests: readonly RepositoryPullRequest[];
	repoKey: string;
}) {
	const [searchParams, setSearchParams] = useSearchParams();
	const pulls = useMemo(() => pullRequests.map(toCiPull), [pullRequests]);
	const rows = useCiPullRows(pulls);
	const costs = usePullCosts(pullRequests, repoKey);
	const pickedKey = searchParams.get(PR_PARAM);
	const pickedRun = searchParams.get(CI_PARAM);
	const shown = rows.find((row) => row.entry.key === pickedKey);
	const shownPull = shown
		? pullRequests.find(
				(pull) =>
					pullRequestKey(pull.repository, pull.number) === shown.entry.key,
			)
		: undefined;
	const shownNode = shownPull?.node;
	const runsOf: RepositoryRunsOf | null = pickedRun
		? { kind: "ci_run", node: pickedRun }
		: shownNode
			? { kind: "pull_request", node: shownNode }
			: null;
	const [pickedAgentRun] = usePickedRun();
	const setPicks = (pr: string | null, ci: string | null) =>
		setSearchParams(
			(params) => {
				for (const [key, value] of [
					[PR_PARAM, pr],
					[CI_PARAM, ci],
				] as const) {
					if (value) params.set(key, value);
					else params.delete(key);
				}
				params.delete("pickedRun");
				params.delete("pickedCall");
				return params;
			},
			{ replace: true },
		);
	return (
		<div className="flex h-full min-h-0 gap-xxl overflow-hidden pt-m pr-[calc(var(--space-xxl)*4/3)] pb-m pl-xxl">
			<RepoPullColumn
				costs={costs}
				onPick={(key) => setPicks(key, null)}
				onPickRun={(ciRunId, key) =>
					setPicks(key, ciRunId === pickedRun ? null : ciRunId)
				}
				picked={shown?.entry.key ?? null}
				pickedRun={pickedRun}
				rows={rows}
			/>
			<div className={RUNS_SHELF}>
				<RepoRunsColumn
					empty={
						pickedRun ? "No run behind this CI run" : "No run behind this PR"
					}
					label={pickedRun ? "Runs behind the CI run" : "Runs behind the PR"}
					of={runsOf}
					repoKey={repoKey}
					scope={
						shownPull
							? { name: `#${shownPull.number} ${shownPull.title ?? ""}`.trim() }
							: undefined
					}
				/>
				<div
					className={cn(
						"relative z-10 flex min-h-0 min-w-0 flex-1 overflow-hidden",
						CARD,
					)}
				>
					{shown ? (
						<CiPullCard
							onPickRun={(ciRunId) => setPicks(shown.entry.key, ciRunId)}
							pickedRun={pickedRun}
							reachedBy={
								runsOf && pickedAgentRun ? (
									<RunWaterfall
										of={runsOf}
										picked={pickedAgentRun}
										repoKey={repoKey}
										runKeyOf={runKeyOf}
									/>
								) : null
							}
							row={shown}
						/>
					) : (
						<div className="flex min-w-0 flex-1 flex-col p-xl">
							<EmptyState
								icon={IconGitPullRequest}
								title="Pick a pull request"
								description="Pick a pull request on the left to see its CI and the runs behind it."
							/>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function RepoPullColumn({
	costs,
	onPick,
	onPickRun,
	picked,
	pickedRun,
	rows,
}: {
	costs: PullCosts;
	onPick: (key: string) => void;
	onPickRun: (ciRunId: string, key: string) => void;
	picked: string | null;
	pickedRun: string | null;
	rows: readonly CiPullRow[];
}) {
	const [status, setStatus] = useState<PullStatus>("all");
	const shownRows = rows.filter((row) => statusOf(row, status));
	return (
		<div className="-mb-m flex min-h-0 w-[320px] shrink-0 flex-col gap-s">
			<div
				className={cn(
					"flex h-8 shrink-0 items-center gap-s",
					"corner-s px-xs",
					"text-body-m",
					"bg-field/50",
				)}
			>
				<span>
					<ViewToggle
						label="Which pull requests to list"
						onPick={setStatus}
						options={PULL_STATUSES.map((each) => ({
							id: each.id,
							label: each.label,
							off: !rows.some((row) => statusOf(row, each.id)),
						}))}
						value={status}
					/>
				</span>
			</div>
			<ScrollColumn className="-mx-xs px-xs pb-[calc(var(--space-xxl)*4/3)]">
				<FluidList>
					<ul className="flex flex-col gap-xxs">
						{shownRows.map((row, index) => (
							<li key={row.entry.key}>
								<PullLine
									index={index}
									isPicked={row.entry.key === picked}
									meta={<PullCostLabel cost={costs.byKey.get(row.entry.key)} />}
									onPick={() => onPick(row.entry.key)}
									onPickRun={(ciRunId) => onPickRun(ciRunId, row.entry.key)}
									pickedRun={pickedRun}
									row={row}
								/>
							</li>
						))}
					</ul>
				</FluidList>
			</ScrollColumn>
		</div>
	);
}

type PullStatus = "all" | "open" | "merged" | "closed";

const PULL_STATUSES: readonly { id: PullStatus; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "open", label: "Open" },
	{ id: "merged", label: "Merged" },
	{ id: "closed", label: "Closed" },
];

function statusOf(row: CiPullRow, status: PullStatus): boolean {
	const pull = row.entry.pull;
	if (status === "all") return true;
	if (!pull) return false;
	if (status === "merged") return Boolean(pull.mergedAt);
	if (status === "closed") return pull.state === "closed" && !pull.mergedAt;
	return pull.state === "open";
}

const DAY_MS = 86_400_000;

function usePullCosts(
	pullRequests: readonly RepositoryPullRequest[],
	repoKey: string,
): PullCosts {
	const range = useMemo(() => {
		const opened = pullRequests
			.map((pull) => Date.parse(pull.createdAt ?? ""))
			.filter(Number.isFinite);
		const from = Math.max(
			opened.length > 0 ? Math.min(...opened) - 7 * DAY_MS : Date.now(),
			Date.now() - 364 * DAY_MS,
		);
		return {
			startDate: new Date(from).toISOString().slice(0, 10),
			endDate: new Date().toISOString().slice(0, 10),
		};
	}, [pullRequests]);
	const query = useAnalyticsQuery(
		orpc.analytics.sessions.list.queryOptions({
			input: { repoKey, ...range, limit: 1000, offset: 0 },
		}),
	);
	return useMemo(
		() =>
			getPullCosts(
				pullRequests,
				new Map(
					(query.data ? parseSessionOverviewRows(query.data) : [])
						.filter((session) => !isFamilyMemberRow(session))
						.map((session) => [session.session_id, session]),
				),
			),
		[pullRequests, query.data],
	);
}

function PullCostLabel({ cost }: { cost: PullCost | undefined }) {
	const known = cost !== undefined && cost.cost > 0;
	return (
		<span
			title={known ? undefined : "No agent session's cost was found for it"}
			className="w-12 shrink-0 text-right text-body-s text-ink-3 tabular-nums"
		>
			{known ? money(cost.cost) : "—"}
		</span>
	);
}
