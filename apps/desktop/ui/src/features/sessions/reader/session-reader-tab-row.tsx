import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { IconChevronRight } from "@tabler/icons-react";
import { useMemo, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import { CopyButton } from "@/features/shell/components/copy-button";
import {
	useShellCrumbFollows,
	useShellHeaderPortal,
} from "@/features/shell/shell-header-portal";
import type { NormalizedSessionDetailOverview } from "../components/session-detail-fast-response";
import { useSessionDetailOverviewPages } from "../components/use-session-detail-overview-pages";
import { shortRunId, shortSubagentId } from "../run-id";
import { useSessionFileChanges } from "../use-session-file-changes";
import { useSessionCi } from "../use-session-run-ci";
import { useSessionSetupRuns } from "../use-session-setup-runs";
import { useSessionSummaryLinks } from "../use-session-summary-links";
import { ModelChip } from "./detail/waterfall/session-reader-waterfall-chips";
import type { ActiveTurnStore } from "./rail/session-reader-turn-rail";
import { railLineKey } from "./rail/session-reader-turn-rail-row";
import {
	pickedAgentOf,
	pickedRunOf,
	placePick,
	type SessionReaderTab,
} from "./reader-params";
import { SessionReaderTabs, useReaderPick } from "./session-reader-tabs";
import {
	getSetupIdleLines,
	getSetupRuns,
	getSetupUsedBy,
} from "./setup/session-setup-runs";
import { SubagentChip } from "./subagents/session-reader-subagent-chip";
import { useSessionSubagents } from "./subagents/session-reader-subagent-marks";
import {
	SubagentTints,
	useSubagentTintById,
} from "./subagents/session-reader-subagent-tints";
import {
	getSubagentLaunches,
	getSummaryCi,
	getSummaryFiles,
} from "./summary/session-summary-model";

const NO_TABS: ReadonlySet<SessionReaderTab> = new Set();

export function SessionReaderTabRow({
	ci,
	model,
	onChange,
	overview,
	reading,
	value,
}: {
	ci: boolean;
	model: string | null;
	onChange: (tab: SessionReaderTab) => void;
	overview: NormalizedSessionDetailOverview | undefined;
	reading: ActiveTurnStore;
	value: SessionReaderTab;
}) {
	return overview ? (
		<PickedTabs
			ci={ci}
			model={model}
			onChange={onChange}
			overview={overview}
			reading={reading}
			value={value}
		/>
	) : (
		<SessionReaderTabs
			ci={ci}
			empty={NO_TABS}
			onChange={onChange}
			value={value}
		/>
	);
}

function PickedTabs({
	ci,
	model,
	onChange,
	overview,
	reading,
	value,
}: {
	ci: boolean;
	model: string | null;
	onChange: (tab: SessionReaderTab) => void;
	overview: NormalizedSessionDetailOverview;
	reading: ActiveTurnStore;
	value: SessionReaderTab;
}) {
	const pages = useSessionDetailOverviewPages(overview);
	const turns = useMemo(
		() => pages.data.pages.flatMap((page) => page.turnPage.items),
		[pages.data.pages],
	);
	const subagents = useSessionSubagents(turns, overview.subagents);
	const picked = useReaderPick();
	const inView = useSyncExternalStore(
		reading.subscribe,
		reading.get,
		reading.get,
	);
	const placed = placePick(picked.address, getSubagentLaunches(turns));
	const pickedRun = pickedRunOf(placed);
	const pickedAgent = pickedAgentOf(placed);
	const follows = value === "detail" && !pickedAgent && inView !== null;
	const run = follows ? inView : pickedRun;
	const agent = follows ? null : pickedAgent;
	const empty = useEmptyTabs(
		overview,
		turns,
		{ agent, run },
		pickedRun !== null,
	);
	return (
		<>
			<SubagentTints finishes={subagents.finishes} ids={subagents.ids}>
				<PickCrumb
					agent={agent}
					agentModel={
						overview.subagents?.find((each) => each.subagentId === agent)
							?.model ?? model
					}
					model={model}
					run={run}
				/>
			</SubagentTints>
			<SessionReaderTabs
				ci={ci}
				empty={empty}
				onChange={onChange}
				value={value}
			/>
		</>
	);
}

function PickCrumb({
	agent,
	agentModel,
	model,
	run,
}: {
	agent: string | null;
	agentModel: string | null;
	model: string | null;
	run: string | null;
}) {
	const host = useShellHeaderPortal();
	const tint = useSubagentTintById()(agent);
	useShellCrumbFollows(host !== null && (agent !== null || run !== null));
	if (!host || (!agent && !run)) return null;
	return createPortal(
		// design-escape-ok(type): shipped value; -0.025em title tracking
		<div className="-order-1 mr-auto -ml-xxs flex shrink-0 items-center gap-s text-body-xxl font-medium tracking-[-0.025em] tabular-nums">
			<IconChevronRight
				aria-hidden="true"
				className="size-4 shrink-0 text-ink-4"
				stroke={1.5}
			/>
			{agent ? (
				<>
					<SubagentChip selected subagentId={agent} />
					{agentModel ? (
						<span>{formatModelDisplayLabel(agentModel)}</span>
					) : null}
					Subagent
					<span title={agent} style={tint ? { color: tint } : undefined}>
						{shortSubagentId(agent)}
					</span>
					<CopyButton value={agent} title="Copy subagent ID" />
				</>
			) : run ? (
				<>
					<ModelChip model={model} />
					Run
					<span title={run}>{shortRunId(run)}</span>
					<CopyButton value={run} title="Copy run ID" />
				</>
			) : null}
		</div>,
		host,
	);
}

function useEmptyTabs(
	overview: NormalizedSessionDetailOverview,
	turns: readonly SessionDetailTurnSummary[],
	{ agent, run }: { agent: string | null; run: string | null },
	readSetup: boolean,
): ReadonlySet<SessionReaderTab> {
	const sessionId = overview.session.sessionId;
	const links = useSessionSummaryLinks(sessionId);
	const ci = useSessionCi(sessionId);
	const setupRuns = useSessionSetupRuns(sessionId, readSetup);
	const changes = useSessionFileChanges(
		sessionId,
		overview.revision,
		readSetup,
	);
	const setupIdle = useMemo(() => {
		if (!run || !links || !setupRuns.data || !changes.data) return null;
		const launches = getSubagentLaunches(turns);
		const runs = getSetupRuns(setupRuns.data.runs, turns, launches);
		const usedBy = getSetupUsedBy(links.setup, runs, changes.data.runs);
		return getSetupIdleLines(usedBy, changes.data.runs, turns);
	}, [changes.data, links, run, setupRuns.data, turns]);
	return useMemo(() => {
		const out = new Set<SessionReaderTab>();
		const turn = run ? turns.find((each) => each.turnId === run) : undefined;
		if (run && !turn) return out;
		const scope = turn ? [turn] : turns;
		if (
			!agent &&
			getSummaryFiles(scope, turn ? [] : overview.context.files).length === 0
		)
			out.add("files");
		if (
			(links && links.setup.length === 0) ||
			(run && setupIdle?.has(railLineKey(run, agent)))
		)
			out.add("setup");
		if (links && ci.status === "ready") {
			const reached = getSummaryCi(
				ci.runs,
				turns,
				getSubagentLaunches(turns),
			).filter(
				(each) =>
					!run ||
					each.places.some(
						(place) =>
							place.turnId === run && (!agent || place.agent === agent),
					),
			);
			const pulls = run
				? links.pullRequests.filter((pull) =>
						reached.some(
							(each) =>
								each.repository === pull.repository &&
								each.pullRequests.includes(pull.number),
						),
					)
				: links.pullRequests;
			if (reached.length === 0 && pulls.length === 0) out.add("ci");
		}
		return out;
	}, [agent, ci, links, overview, run, setupIdle, turns]);
}
