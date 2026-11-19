import type { SessionRunCiRun } from "@rudel/api-routes";
import { IconAlertTriangle, IconGitPullRequest } from "@tabler/icons-react";
import { type ReactNode, useMemo } from "react";
import { Reveal } from "@/app/ui/bones";
import { EmptyState } from "@/components/dashboard/page-parts";
import { cn } from "@/lib/utils";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import { useSessionDetailOverviewPages } from "../../components/use-session-detail-overview-pages";
import { useSessionFileChanges } from "../../use-session-file-changes";
import { useSessionCi } from "../../use-session-run-ci";
import { useSessionSummaryLinks } from "../../use-session-summary-links";
import { CARD } from "../files/session-reader-files-parts";
import {
	FilesRail,
	RailEmptyPane,
	useFilesRailTags,
} from "../rail/session-reader-files-rail";
import {
	railLineKey,
	subagentIdsOf,
} from "../rail/session-reader-turn-rail-row";
import {
	CI_PARAM,
	PR_PARAM,
	pickOf,
	updateReaderParams,
	useReaderSearchParams,
	writePick,
} from "../reader-params";
import { CiColumnsSample } from "../session-reader-samples";
import { READER_RAIL_BACKGROUND, useReaderPick } from "../session-reader-tabs";
import {
	SessionSubagents,
	useSessionSubagents,
} from "../subagents/session-reader-subagent-marks";
import type { OpenPlace } from "../summary/session-reader-summary-sections";
import {
	getSubagentLaunches,
	getSummaryCi,
} from "../summary/session-summary-model";
import { UnknownPullCard } from "./session-reader-ci-card";
import {
	type CiPull,
	getCiPulls,
	isTitleCheck,
} from "./session-reader-ci-model";
import {
	CiPullCard,
	CiPullColumn,
	defaultPullRow,
	useCiPullRows,
} from "./session-reader-ci-pulls";
import {
	ciOfPick,
	ciOwners,
	getCiReach,
	pullTouchers,
	subagentTasks,
	withReachedPulls,
} from "./session-reader-ci-reach";
import { PullTouchers } from "./session-reader-ci-reachers";
import { getCiRounds } from "./session-reader-ci-rounds";
import { CiRoundMarks } from "./session-reader-ci-rounds-view";

const NO_RUNS: readonly SessionRunCiRun[] = [];
const NO_LINES: ReadonlySet<string> = new Set();

export function SessionReaderCiView({
	model,
	onOpenTurn,
	overview,
	picked,
}: {
	model: string | null;
	onOpenTurn: OpenPlace;
	overview: NormalizedSessionDetailOverview;
	picked: { ci: string | null; pr: string | null };
}) {
	const sessionId = overview.session.sessionId;
	const state = useSessionCi(sessionId);
	const links = useSessionSummaryLinks(sessionId);
	const pages = useSessionDetailOverviewPages(overview);
	const turns = useMemo(
		() => pages.data.pages.flatMap((page) => page.turnPage.items),
		[pages.data.pages],
	);
	const subagents = useSessionSubagents(turns, overview.subagents);
	const launches = useMemo(() => getSubagentLaunches(turns), [turns]);
	const runs = state.status === "ready" ? state.runs : NO_RUNS;
	const changes = useSessionFileChanges(sessionId, overview.revision);
	const tasks = useMemo(
		() => subagentTasks(changes.data?.runs),
		[changes.data],
	);
	const reach = useMemo(
		() => getCiReach(runs, turns, launches, tasks),
		[runs, turns, launches, tasks],
	);
	const ci = useMemo(
		() => withReachedPulls(getSummaryCi(runs, turns, launches), reach),
		[runs, turns, launches, reach],
	);
	const pulls = useMemo(
		() => getCiPulls(links?.pullRequests ?? [], ci),
		[links, ci],
	);
	const railTags = useFilesRailTags();
	const { agent, run } = useReaderPick();
	const [, setSearchParams] = useReaderSearchParams();
	const setPicks = (
		next: { ci?: string | null; pr?: string | null },
		rail?: { run: string | null; subagent: string | null },
	) =>
		updateReaderParams(setSearchParams, (params) => {
			for (const [key, value] of [
				[CI_PARAM, next.ci],
				[PR_PARAM, next.pr],
			] as const)
				if (value === null) params.delete(key);
				else if (value !== undefined) params.set(key, value);
			if (rail) writePick(params, pickOf(rail.run, rail.subagent));
		});
	const pickRun = (turnId: string | null, subagent: string | null = null) =>
		setPicks({ ci: null }, { run: turnId, subagent });
	const openSubagent = (subagentId: string) => {
		const turnId = launches.get(subagentId);
		if (turnId) onOpenTurn(turnId, subagentId);
	};
	const pickTurn = run
		? reach.turns.find((each) => each.turnId === run)
		: undefined;
	const reached = useMemo(
		() =>
			run ? new Set(pickTurn ? ciOfPick(pickTurn, agent).keys() : []) : null,
		[agent, pickTurn, run],
	);
	const pickPulls = useMemo<CiPull[]>(
		() =>
			reached
				? pulls.flatMap((each) => {
						const own = each.runs.filter((ci) => reached.has(ci.ciRunId));
						return own.length > 0 ? [{ ...each, runs: own }] : [];
					})
				: pulls,
		[pulls, reached],
	);
	const rows = useCiPullRows(pickPulls);
	const turnMarks = useMemo(() => {
		const byId = new Map(ci.map((each) => [each.ciRunId, each]));
		const marks = new Map<string, ReactNode>();
		for (const [key, ids] of ciOwners(reach)) {
			const runs = ids.flatMap((id) => {
				const each = byId.get(id);
				return each && !isTitleCheck(each) ? [each] : [];
			});
			if (runs.length > 0)
				marks.set(
					key,
					<CiRoundMarks key="ci" compact rounds={getCiRounds(runs)} />,
				);
		}
		return marks;
	}, [ci, reach]);
	const idle = useMemo(() => {
		const byTurn = new Map(reach.turns.map((each) => [each.turnId, each]));
		const out = new Set<string>();
		for (const turn of turns) {
			const reachTurn = byTurn.get(turn.turnId);
			if (!reachTurn) out.add(railLineKey(turn.turnId, null));
			for (const subagentId of subagentIdsOf(turn))
				if (!reachTurn?.subagents.some((each) => each.agent === subagentId))
					out.add(railLineKey(turn.turnId, subagentId));
		}
		return out;
	}, [reach, turns]);

	const pending = state.status === "pending" || !links;
	const railColumn = (
		<div
			className={cn(
				"flex min-h-0 w-(--reader-rail) shrink-0 flex-col",
				READER_RAIL_BACKGROUND,
			)}
		>
			<FilesRail
				agent={agent}
				idle={pending ? NO_LINES : idle}
				figureMarks={pending ? undefined : turnMarks}
				model={model}
				onPickRun={pickRun}
				overview={overview}
				run={run}
				subagents={overview.subagents}
				tags={railTags}
				turns={turns}
			/>
		</div>
	);
	const empty =
		state.status === "error" ? (
			<EmptyState
				icon={IconAlertTriangle}
				title="The CI could not be read"
				description="Reading this session's CI failed. Try the tab again in a moment."
			/>
		) : !pending && pulls.length === 0 ? (
			<EmptyState
				icon={IconGitPullRequest}
				title="No pull requests or CI"
				description={
					state.enabled
						? "This session's runs named no pull request and reached no CI."
						: "Pull requests and CI show where the workspace has GitHub connected, with the repositories this session worked in."
				}
			/>
		) : null;
	if (empty)
		return (
			<Frame>
				<SessionSubagents onOpen={openSubagent} subagents={subagents}>
					<div className="flex h-full min-h-0 gap-6">
						{railColumn}
						<RailEmptyPane>{empty}</RailEmptyPane>
					</div>
				</SessionSubagents>
			</Frame>
		);

	const pickedRun = picked.ci
		? ci.find(
				(each) =>
					each.ciRunId === picked.ci && (!reached || reached.has(each.ciRunId)),
			)
		: undefined;
	const holding = pickedRun
		? pickPulls.filter((each) => each.runs.includes(pickedRun))
		: [];
	const openKey = pickedRun
		? (holding.find((each) => each.key === picked.pr) ?? holding[0])?.key
		: picked.pr;
	const shown =
		rows.find((row) => row.entry.key === openKey) ??
		(openKey && !run ? undefined : defaultPullRow(rows));
	const unknown =
		picked.pr && !run && !pulls.some((each) => each.key === picked.pr)
			? picked.pr
			: null;

	return (
		<Frame>
			<SessionSubagents onOpen={openSubagent} subagents={subagents}>
				<div className="flex h-full min-h-0 gap-6">
					{railColumn}
					<Reveal
						fill
						className="min-w-0 flex-1"
						label="Reading the pull requests and CI this session reached"
						loading={pending}
						sample={
							<div className="flex h-full min-h-0 gap-6">
								<CiColumnsSample agent={agent} model={model} run={run} />
							</div>
						}
						sampleId="reader-ci"
					>
						{() => (
							<div className="flex h-full min-h-0 gap-6">
								<CiPullColumn
									agent={agent}
									model={model}
									onPick={(key) => setPicks({ ci: null, pr: key })}
									onPickRun={(ciRunId, key) =>
										setPicks({ ci: ciRunId, pr: key })
									}
									picked={shown?.entry.key ?? null}
									pickedRun={pickedRun?.ciRunId ?? null}
									rows={rows}
									run={run}
									unplaced={reach.unplaced}
								/>
								<div
									className={cn(
										"mt-(--panes-top) flex min-h-0 min-w-0 flex-1 overflow-hidden",
										CARD,
									)}
								>
									{shown ? (
										<CiPullCard
											onPickRun={(ciRunId) =>
												setPicks({ ci: ciRunId, pr: shown.entry.key })
											}
											pickedRun={pickedRun?.ciRunId ?? null}
											reachedBy={
												shown.entry.pull && !run ? (
													<PullTouchers
														onOpenTurn={onOpenTurn}
														touchers={pullTouchers(
															shown.entry.key,
															shown.entry.runs,
															reach,
														)}
													/>
												) : null
											}
											row={shown}
										/>
									) : unknown ? (
										<UnknownPullCard pickKey={unknown} />
									) : null}
								</div>
							</div>
						)}
					</Reveal>
				</div>
			</SessionSubagents>
		</Frame>
	);
}

function Frame({ children }: { children: ReactNode }) {
	return (
		<div className="h-full overflow-hidden px-8 pt-2 pb-2">{children}</div>
	);
}
