import { useMemo, useState } from "react";
import { FlagChip, useTurnFlags } from "@/features/compass/session-flags";
import { useScrollFade } from "@/hooks/use-scroll-fade";
import { cn } from "@/lib/utils";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import { useSessionDetailOverviewPages } from "../../components/use-session-detail-overview-pages";
import { useSessionFileChanges } from "../../use-session-file-changes";
import { useCiAccess, useSessionCiRuns } from "../../use-session-run-ci";
import { useSessionSetupRuns } from "../../use-session-setup-runs";
import { useSessionSummaryLinks } from "../../use-session-summary-links";
import { SummaryContext } from "../context/session-reader-context-card";
import type { ContextMeasure } from "../context/session-reader-context-measure";
import { runSetupFiles } from "../context/session-reader-context-runs";
import { SessionContext } from "../context/session-reader-context-session";
import { FilesRail, useFilesRailTags } from "../rail/session-reader-files-rail";
import {
	READER_RAIL_BACKGROUND,
	TabsBandFade,
	useReaderPick,
} from "../session-reader-tabs";
import {
	SessionSubagents,
	useSessionSubagents,
} from "../subagents/session-reader-subagent-marks";
import { SummaryFigures } from "./session-reader-summary-figures";
import {
	ACCENT,
	runFigures,
	sessionFigures,
	subagentFigures,
} from "./session-reader-summary-figures-model";
import {
	SummaryCi,
	SummaryPullRequests,
} from "./session-reader-summary-github";
import {
	type OpenFiles,
	type OpenPlace,
	SummaryChangesStrip,
	SummaryFiles,
	SummarySection,
	SummarySubagents,
} from "./session-reader-summary-sections";
import {
	SummaryMcpAndTools,
	SummarySkillsAndFiles,
} from "./session-reader-summary-setup";
import { SummaryStrip } from "./session-reader-summary-strip";
import {
	getSubagentLaunches,
	getSummaryChanges,
	getSummaryCi,
	getSummaryFiles,
	getSummaryFilesOfChanges,
	getSummarySkills,
	getSummarySubagents,
	groupSetupFiles,
} from "./session-summary-model";

export function SessionReaderSummary({
	model,
	onOpenFiles,
	onOpenSetup,
	onOpenTurn,
	overview,
}: {
	model: string | null;
	onOpenFiles: OpenFiles;
	onOpenSetup: (setupFile: string) => void;
	onOpenTurn: OpenPlace;
	overview: NormalizedSessionDetailOverview;
}) {
	const pages = useSessionDetailOverviewPages(overview);
	const turns = useMemo(
		() => pages.data.pages.flatMap((page) => page.turnPage.items),
		[pages.data.pages],
	);
	const totalTurns = overview.turnPage.total;
	const sessionId = overview.session.sessionId;
	const links = useSessionSummaryLinks(sessionId);
	const ciRuns = useSessionCiRuns(sessionId);
	const ciShown = useCiAccess(sessionId) === "on";
	const launches = useMemo(() => getSubagentLaunches(turns), [turns]);
	const sessionSubagents = useSessionSubagents(turns, overview.subagents);
	const openSubagent = (subagentId: string) => {
		const turnId = launches.get(subagentId);
		if (turnId) onOpenTurn(turnId, subagentId);
	};
	const { agent, pick, run } = useReaderPick();
	const pickedTurn = run
		? turns.find((turn) => turn.turnId === run)
		: undefined;
	const scope = useMemo(
		() => (pickedTurn ? [pickedTurn] : run ? [] : turns),
		[pickedTurn, run, turns],
	);
	const pickedSubagent = agent
		? overview.subagents?.find((each) => each.subagentId === agent)
		: undefined;
	const skills = useMemo(
		() => getSummarySkills(scope, links?.setup ?? []),
		[scope, links],
	);
	const fileChanges = useSessionFileChanges(sessionId, overview.revision);
	const files = useMemo(
		() =>
			fileChanges.data
				? getSummaryFilesOfChanges(fileChanges.data.files, run)
				: getSummaryFiles(scope, run ? [] : overview.context.files),
		[fileChanges.data, scope, run, overview.context.files],
	);
	const changes = useMemo(
		() =>
			fileChanges.data ? getSummaryChanges(fileChanges.data.files, run) : null,
		[fileChanges.data, run],
	);
	const ci = useMemo(
		() =>
			getSummaryCi(ciRuns, turns, launches).filter(
				(each) =>
					!run ||
					each.places.some(
						(place) =>
							place.turnId === run && (!agent || place.agent === agent),
					),
			),
		[agent, ciRuns, turns, launches, run],
	);
	const pullRequests = useMemo(
		() =>
			run
				? links?.pullRequests.filter((pull) =>
						ci.some(
							(each) =>
								each.repository === pull.repository &&
								each.pullRequests.includes(pull.number),
						),
					)
				: links?.pullRequests,
		[ci, links, run],
	);
	const subagents = useMemo(
		() =>
			getSummarySubagents(overview.subagents, launches, turns).filter(
				(each) =>
					!run ||
					(each.turnId === run && (!agent || each.subagentId === agent)),
			),
		[agent, overview.subagents, launches, run, turns],
	);
	const setupRuns = useSessionSetupRuns(sessionId, !!run);
	const uncalled =
		!!pickedTurn &&
		!pickedSubagent &&
		pickedTurn.usageCalls.length === 0 &&
		pickedTurn.estimatedCost === null;
	const runSetup = useMemo(() => {
		if (!links || !run) return links?.setup;
		if (uncalled) return [];
		if (setupRuns.isError) return links.setup;
		if (!setupRuns.data || !pickedTurn) return undefined;
		return runSetupFiles(links.setup, setupRuns.data.runs, {
			agent: pickedSubagent ? (agent ?? null) : null,
			startedAt: pickedTurn.startedAt,
		});
	}, [
		agent,
		links,
		pickedSubagent,
		pickedTurn,
		run,
		setupRuns.data,
		setupRuns.isError,
		uncalled,
	]);
	const setupEmpty = uncalled
		? "It ended before its first model call, so no model received any."
		: undefined;
	const setup = runSetup ? groupSetupFiles(runSetup) : undefined;
	const railTags = useFilesRailTags();
	const scroll = useScrollFade<HTMLDivElement>();
	const subagentCount = overview.subagents?.length ?? 0;
	const [measure, setMeasure] = useState<ContextMeasure>("context");
	const { flags: runFlags } = useTurnFlags(
		{
			from: overview.session.sessionDate,
			sessionId: overview.session.sessionId,
			to: overview.session.lastInteractionDate,
			totalTurns,
			turns,
		},
		scope,
		pickedSubagent ? (agent ?? null) : null,
	);
	const flagged = new Set(runFlags.map((flag) => flag.kind));
	const figures = (
		pickedSubagent
			? subagentFigures(pickedSubagent)
			: pickedTurn
				? runFigures(pickedTurn, turns)
				: sessionFigures(overview.session, turns, totalTurns, subagentCount)
	).map((figure) => {
		const kinds = (["expensive_run", "long_run"] as const).filter((kind) =>
			flagged.has(kind),
		);
		const own =
			figure.measure === "cost"
				? kinds.filter((kind) => kind === "expensive_run")
				: figure.measure === "time"
					? kinds.filter((kind) => kind === "long_run")
					: [];
		const badged = pickedTurn ? own : figure.measure === "runs" ? kinds : [];
		return badged.length > 0
			? {
					...figure,
					badge: (
						<span className="flex items-center gap-xs">
							{badged.map((kind) => (
								<FlagChip key={kind} kind={kind} />
							))}
						</span>
					),
				}
			: figure;
	});
	const figuresHead = (
		<SummaryFigures
			accent={ACCENT}
			figures={figures}
			measure={measure}
			onMeasure={setMeasure}
		/>
	);
	return (
		<SessionSubagents onOpen={openSubagent} subagents={sessionSubagents}>
			<div className="h-full overflow-hidden px-xxxl pt-m pb-m">
				<div className="flex h-full min-h-0 gap-xxl">
					<div
						className={cn(
							"flex min-h-0 w-(--reader-rail) shrink-0 flex-col",
							READER_RAIL_BACKGROUND,
						)}
					>
						<FilesRail
							agent={agent}
							model={model}
							onPickRun={pick}
							overview={overview}
							run={run}
							subagents={overview.subagents}
							tags={railTags}
							turns={turns}
						/>
					</div>
					<div
						ref={scroll.ref}
						{...scroll.fade}
						className={cn(
							"flex min-h-0 min-w-0 flex-1 flex-col gap-xl overflow-y-auto [--scroll-fade-top-depth:0px] [--summary-top:var(--panes-top)] [container-type:size]",
							"-mx-m -mb-m px-m pt-(--summary-top) pb-xxxl",
							"scroll-fade",
							"*:shrink-0",
						)}
					>
						<TabsBandFade className="-mx-m -mt-s -mb-xl h-1.5 top-[calc(var(--stage-top)-0.5rem-var(--summary-top))] shrink-0" />
						<SummaryStrip
							agent={pickedSubagent ? (agent ?? undefined) : undefined}
							overview={overview}
							turn={pickedTurn}
						/>

						{pickedTurn ? (
							<SummaryContext
								agent={pickedSubagent ? agent : null}
								head={figuresHead}
								measure={measure}
								overview={overview}
								setup={links?.setup}
								turn={pickedTurn}
								turns={turns}
							/>
						) : run ? (
							figuresHead
						) : (
							<SessionContext
								head={figuresHead}
								measure={measure}
								overview={overview}
								setup={links?.setup}
								turns={turns}
							/>
						)}

						<div className="grid gap-xl lg:grid-cols-2">
							<SummarySection
								anchor="skills"
								title="Skills & Context files"
								count={
									setup ? skills.length + setup.instructions.length : undefined
								}
							>
								<SummarySkillsAndFiles
									empty={setupEmpty}
									onOpen={onOpenTurn}
									onOpenSetup={onOpenSetup}
									setup={runSetup}
									skills={skills}
								/>
							</SummarySection>
							<SummarySection
								anchor="context"
								title="MCP & Tools"
								count={
									setup ? setup.mcp.length + setup.harness.length : undefined
								}
							>
								<SummaryMcpAndTools
									empty={setupEmpty}
									onOpen={onOpenSetup}
									setup={runSetup}
								/>
							</SummarySection>
						</div>

						<div className="grid gap-xl lg:grid-cols-2">
							<SummarySection
								anchor="files"
								className={ciShown ? undefined : "lg:col-span-2"}
								title="Files"
								count={files.length}
								fill
								aside={
									changes &&
									changes.added + changes.edited + changes.deleted > 0 ? (
										<SummaryChangesStrip changes={changes} />
									) : undefined
								}
							>
								<SummaryFiles files={files} onOpenFiles={onOpenFiles} />
							</SummarySection>
							{ciShown ? (
								<div className="grid min-w-0 grid-rows-2 gap-xl">
									<SummarySection
										anchor="pull-requests"
										fill
										title="Pull requests"
										count={pullRequests?.length}
									>
										<SummaryPullRequests pullRequests={pullRequests} />
									</SummarySection>
									<SummarySection anchor="ci" fill title="CI" count={ci.length}>
										<SummaryCi ci={ci} onOpen={onOpenTurn} />
									</SummarySection>
								</div>
							) : null}
							<SummarySection
								anchor="subagents"
								className="lg:col-span-2"
								title="Subagents"
								count={subagents.length}
							>
								<SummarySubagents onOpen={onOpenTurn} subagents={subagents} />
							</SummarySection>
						</div>
					</div>
				</div>
			</div>
		</SessionSubagents>
	);
}
