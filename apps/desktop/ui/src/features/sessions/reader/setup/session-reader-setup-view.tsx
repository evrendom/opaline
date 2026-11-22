import type {
	SessionDetailTurnSummary,
	SessionSetupFile,
} from "@rudel/api-routes";
import { IconSettings2 } from "@tabler/icons-react";
import { type CSSProperties, useMemo, useState } from "react";
import { Reveal } from "@/app/ui/bones";
import { EmptyState } from "@/components/dashboard/page-parts";
import { cn } from "@/lib/utils";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import { useSessionDetailOverviewPages } from "../../components/use-session-detail-overview-pages";
import { useSessionFileChanges } from "../../use-session-file-changes";
import { useSessionSetupRuns } from "../../use-session-setup-runs";
import { SessionReaderStepDetail } from "../detail/step/session-reader-step-detail";
import { CARD } from "../files/session-reader-files-parts";
import { mcpTool } from "../model/session-reader-mcp-tool";
import { getReaderTurnMarks } from "../model/session-reader-model";
import { useRunUi } from "../model/session-reader-run-ui-store";
import {
	FilesRail,
	RailEmptyPane,
	useFilesRailTags,
} from "../rail/session-reader-files-rail";
import { findMcpSetupFile } from "../session-places";
import { SetupColumnsSample } from "../session-reader-samples";
import { READER_RAIL_BACKGROUND, useReaderPick } from "../session-reader-tabs";
import {
	SessionSubagents,
	useSessionSubagents,
} from "../subagents/session-reader-subagent-marks";
import { ReaderSubagentsContext } from "../subagents/use-reader-subagent-branches";
import type { OpenPlace } from "../summary/session-reader-summary-sections";
import { getSubagentLaunches } from "../summary/session-summary-model";
import { SetupCard, useSetupVersions } from "./session-reader-setup-card";
import {
	SetupColumn,
	type SetupColumnView,
} from "./session-reader-setup-column";
import {
	SetupRunTrace,
	useRunSetupUses,
	useSetupRunStore,
} from "./session-reader-setup-use";
import { setupGroups } from "./session-setup-files";
import {
	getSetupIdleLines,
	getSetupRuns,
	getSetupUsedBy,
	runsOfSetupFile,
} from "./session-setup-runs";

const NO_FILTER: ReadonlySet<string> = new Set();
const NO_LINES: ReadonlySet<string> = new Set();

export function SessionReaderSetupView({
	model,
	onOpenTurn,
	onPick,
	overview,
	picked,
	sessionId,
	setup,
}: {
	model: string | null;
	onOpenTurn: OpenPlace;
	onPick: (setupFile: string) => void;
	overview: NormalizedSessionDetailOverview;
	picked: string | null;
	sessionId: string;
	setup: readonly SessionSetupFile[] | undefined;
}) {
	const pages = useSessionDetailOverviewPages(overview);
	const turns = useMemo(
		() => pages.data.pages.flatMap((page) => page.turnPage.items),
		[pages.data.pages],
	);
	const subagents = useSessionSubagents(turns, overview.subagents);
	const launches = useMemo(() => getSubagentLaunches(turns), [turns]);
	const changes = useSessionFileChanges(sessionId, overview.revision);
	const query = useSessionSetupRuns(sessionId);
	const runs = useMemo(
		() => getSetupRuns(query.data?.runs ?? [], turns, launches),
		[query.data, turns, launches],
	);
	const openSubagent = (subagentId: string) => {
		const turnId = launches.get(subagentId);
		if (turnId) onOpenTurn(turnId, subagentId);
	};
	const { agent, pick: pickRun, run } = useReaderPick();
	const railTags = useFilesRailTags();
	const subagentsContext = useMemo(
		() => ({
			onStaleRevision: () => {},
			revision: overview.revision,
			sessionId,
			subagents: overview.subagents,
		}),
		[overview.revision, overview.subagents, sessionId],
	);
	const usedBy = useMemo(
		() => getSetupUsedBy(setup, runs, changes.data?.runs),
		[changes.data, runs, setup],
	);
	const idle = useMemo(
		() => getSetupIdleLines(usedBy, changes.data?.runs, turns),
		[changes.data, turns, usedBy],
	);
	const called = useMemo(() => {
		const out = new Set<string>();
		if (!run || !setup) return out;
		const steps =
			changes.data?.runs.find((each) => each.turnId === run)?.steps ?? [];
		for (const step of steps) {
			if (step.agentId !== (agent ?? "") || !step.tool) continue;
			const server = mcpTool(step.tool)?.server;
			const file = server ? findMcpSetupFile(setup, server) : null;
			if (file) out.add(file);
		}
		return out;
	}, [agent, changes.data, run, setup]);
	const received = useMemo(
		() =>
			run
				? (setup ?? []).filter((file) =>
						file.kind === "mcp_instructions"
							? called.has(file.setupFile)
							: runsOfSetupFile(runs, file.setupFile).some(
									(each) =>
										each.turnId === run && each.agentId === (agent ?? ""),
								),
					)
				: setup,
		[agent, called, run, runs, setup],
	);
	const shown = received
		? (received.find((file) => file.setupFile === picked) ??
			setupGroups(received)[0]?.files[0])
		: undefined;
	return (
		<SessionSubagents onOpen={openSubagent} subagents={subagents}>
			<div className="h-full overflow-hidden px-[calc(var(--space-xxl)*4/3)] pt-m pb-m">
				<div className="flex h-full min-h-0 gap-xxl">
					<div
						className={cn(
							"flex min-h-0 w-(--reader-rail) shrink-0 flex-col",
							READER_RAIL_BACKGROUND,
						)}
					>
						<FilesRail
							agent={agent}
							idle={setup ? idle : NO_LINES}
							model={model}
							onPickRun={pickRun}
							overview={overview}
							run={run}
							subagents={overview.subagents}
							tags={railTags}
							turns={turns}
						/>
					</div>
					{setup && setup.length === 0 ? (
						<RailEmptyPane>
							<EmptyState
								icon={IconSettings2}
								title="No setup recorded"
								description="This session's agents received no setup Opaline kept: it may have been read before setup was."
							/>
						</RailEmptyPane>
					) : (
						<Reveal
							fill
							className="min-w-0 flex-1"
							label="Reading the setup this session received"
							loading={!setup}
							sample={
								<div className="flex h-full min-h-0 gap-xxl">
									<SetupColumnsSample agent={agent} model={model} run={run} />
								</div>
							}
							sampleId="reader-setup"
						>
							{() =>
								setup ? (
									<ReaderSubagentsContext.Provider value={subagentsContext}>
										<div className="flex h-full min-h-0 gap-xxl">
											<SetupPicked
												key={`${run ?? ""}:${agent ?? ""}`}
												agent={agent}
												model={model}
												overview={overview}
												setup={setup}
												turns={turns}
												onPick={onPick}
												received={received ?? []}
												run={run}
												sessionId={sessionId}
												shown={shown}
											/>
										</div>
									</ReaderSubagentsContext.Provider>
								) : null
							}
						</Reveal>
					)}
				</div>
			</div>
		</SessionSubagents>
	);
}

function SetupPicked({
	agent,
	model,
	overview,
	setup,
	turns,
	onPick,
	received,
	run,
	sessionId,
	shown,
}: {
	agent: string | null;
	model: string | null;
	overview: NormalizedSessionDetailOverview;
	setup: readonly SessionSetupFile[];
	turns: readonly SessionDetailTurnSummary[];
	onPick: (setupFile: string) => void;
	received: readonly SessionSetupFile[];
	run: string | null;
	sessionId: string;
	shown: SessionSetupFile | undefined;
}) {
	const versions = useSetupVersions(sessionId, shown?.setupFile ?? "");
	const pickedTurn = run
		? turns.find((turn) => turn.turnId === run)
		: undefined;
	const runUses = useRunSetupUses({
		agent,
		model,
		revision: overview.revision,
		sessionId,
		setup,
		turn: pickedTurn,
	});
	const [pickedUse, setPickedUse] = useState<string | null>(null);
	const store = useSetupRunStore(pickedTurn?.turnId);
	const timelineUi = useRunUi(store, pickedTurn?.turnId ?? "");
	const otherStep =
		timelineUi.picked &&
		!runUses.uses.some(
			(use) =>
				use.step.id === timelineUi.selected &&
				use.file.setupFile === shown?.setupFile,
		)
			? (runUses.waterfall?.allSteps.find(
					(step) => step.id === timelineUi.selected,
				) ?? null)
			: null;
	const detailStep =
		otherStep ??
		(pickedUse
			? (runUses.waterfall?.allSteps.find((step) => step.id === pickedUse) ??
				null)
			: null);
	const [view, setView] = useState<SetupColumnView>("setup");
	const timelineStep =
		pickedUse ??
		runUses.uses.find((use) => use.file.setupFile === shown?.setupFile)?.step
			.id ??
		null;
	return (
		<>
			<SetupColumn
				agent={agent}
				model={model}
				onPick={(setupFile) => {
					setPickedUse(null);
					onPick(setupFile);
				}}
				onPickUse={(use) => {
					setPickedUse(use.step.id);
					onPick(use.file.setupFile);
				}}
				onView={setView}
				pickedUse={pickedUse}
				timeline={
					pickedTurn ? (
						<SetupRunTrace
							key={timelineStep ?? ""}
							run={runUses}
							stepId={timelineStep}
							store={store}
							turn={pickedTurn}
						/>
					) : null
				}
				uses={run ? runUses : undefined}
				view={view}
				run={run}
				setup={received}
				shown={shown}
			/>
			<div
				className={cn(
					"mt-(--panes-top) flex min-h-0 shrink overflow-hidden",
					CARD,
				)}
				style={SETUP_CARD_WIDTH}
			>
				{shown ? (
					<div className="flex min-h-0 min-w-0 flex-1 flex-col">
						<div
							className={cn(
								"flex min-h-0 flex-col",
								detailStep ? "max-h-1/2 flex-none" : "flex-1",
							)}
						>
							<SetupCard file={shown} versions={versions} />
						</div>
						{detailStep && pickedTurn && runUses.waterfall ? (
							<div className="flex min-h-0 flex-1 flex-col edge-t-m border-line-soft">
								<SessionReaderStepDetail
									bare
									fields={false}
									fit
									run={{
										filter: NO_FILTER,
										filterOptions: [],
										marks: getReaderTurnMarks(pickedTurn, runUses.body),
										onToggleFilter: () => {},
										turn: pickedTurn,
									}}
									step={detailStep}
									waterfall={runUses.waterfall}
								/>
							</div>
						) : null}
					</div>
				) : null}
			</div>
		</>
	);
}

const SETUP_TEXT_MEASURE_REM = { narrowest: 20, widest: 27 };
const SETUP_CARD_PADDING_X_REM = 2 * 1.25;
const SETUP_CARD_WIDTH = {
	minWidth: `${SETUP_TEXT_MEASURE_REM.narrowest + SETUP_CARD_PADDING_X_REM}rem`,
	width: `${SETUP_TEXT_MEASURE_REM.widest + SETUP_CARD_PADDING_X_REM}rem`,
} satisfies CSSProperties;
