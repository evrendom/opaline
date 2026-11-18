import type {
	SessionDetailTurnSummary,
	SessionSetupFile,
} from "@rudel/api-routes";
import {
	buildContextMap,
	contextTarget,
} from "@rudel/api-routes/session-context/session-context-snapshot";
import {
	type ComponentProps,
	type ReactNode,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useEffectOnceWhen } from "@/app/hooks/useEffectOnceWhen";
import { Bones } from "@/app/ui/bones";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import { useSessionSetupRuns } from "../../use-session-setup-runs";
import {
	useReadyBodies,
	useSessionReaderBodies,
} from "../detail/use-session-reader-bodies";
import { getReaderMemberText } from "../model/session-reader-model";
import { useRunFlags } from "../rail/session-reader-run-flags";
import { ContextBar } from "./session-reader-context-bar";
import { byRunMap, runsByPart } from "./session-reader-context-by-run";
import { Unmapped } from "./session-reader-context-card";
import {
	CompactionToggle,
	compactedLater,
	segmentOf,
} from "./session-reader-context-compaction";
import { ContextMapFrame } from "./session-reader-context-frame";
import {
	ContextMapHead,
	ContextToggleSlot,
} from "./session-reader-context-head";
import type { ContextMap } from "./session-reader-context-map";
import { ContextMapSample } from "./session-reader-context-map-sample";
import type { ContextMeasure } from "./session-reader-context-measure";
import {
	type BoxProblems,
	problemsByBox,
} from "./session-reader-context-problems";
import {
	compactedRuns,
	contextRuns,
	NO_RUNS,
	readRuns,
} from "./session-reader-context-runs";
import { useStoredContextSnapshot } from "./session-reader-context-stored";
import { ContextTiles } from "./session-reader-context-tiles";

const NOOP = () => {};

const builtMaps = new Map<string, ContextMap | null>();
const builtProblems = new Map<string, Map<string, BoxProblems>>();

export function SessionContext({
	head,
	measure,
	overview,
	setup,
	turns,
}: {
	head?: ReactNode;
	measure: ContextMeasure;
	overview: NormalizedSessionDetailOverview;
	setup: readonly SessionSetupFile[] | undefined;
	turns: readonly SessionDetailTurnSummary[];
}) {
	const [withCompaction, setWithCompaction] = useState<boolean | null>(null);
	const { showingWith, sides, target } = useMemo(
		() => contextTarget(turns, withCompaction),
		[turns, withCompaction],
	);
	const runs = useMemo(
		() => (target ? contextRuns(turns, target) : []),
		[target, turns],
	);
	const segment = useMemo(
		() => (target ? segmentOf(turns, target) : []),
		[target, turns],
	);
	const segmentCost = segment.reduce(
		(sum, turn) => sum + (turn.estimatedCost ?? 0),
		0,
	);
	const later = target ? segment.length - 1 - segment.indexOf(target) : 0;
	const costOutside = `After its fullest moment${later > 0 ? ` · ${later} ${later === 1 ? "run" : "runs"}` : ""}`;
	const toggleSlot = useContext(ContextToggleSlot);
	const toggle = sides ? (
		<CompactionToggle value={showingWith} onChange={setWithCompaction} />
	) : null;
	return (
		<ContextMapHead.Provider value={head}>
			<div className="flex min-w-0 flex-col">
				{target ? (
					<WholeContext
						footer={toggleSlot ? null : toggle}
						cost={sides ? segmentCost : overview.session.estimatedCost}
						costOutside={costOutside}
						measure={measure}
						overview={overview}
						runs={runs}
						segment={segment}
						setup={setup}
						showingWith={showingWith}
						target={target}
						turns={turns}
					/>
				) : (
					<Unmapped>
						Its model's context window isn't known, so there's nothing to fill.
					</Unmapped>
				)}
			</div>
			{toggleSlot && toggle ? createPortal(toggle, toggleSlot) : null}
		</ContextMapHead.Provider>
	);
}

function WholeContext({
	cost,
	costOutside,
	footer,
	measure,
	overview,
	runs,
	segment,
	setup,
	showingWith,
	target,
	turns,
}: {
	cost: number | null;
	costOutside: string;
	footer: ReactNode;
	measure: ContextMeasure;
	overview: NormalizedSessionDetailOverview;
	runs: readonly SessionDetailTurnSummary[];
	segment: readonly SessionDetailTurnSummary[];
	setup: readonly SessionSetupFile[] | undefined;
	showingWith: boolean;
	target: SessionDetailTurnSummary;
	turns: readonly SessionDetailTurnSummary[];
}) {
	const { getBody, requestBody } = useSessionReaderBodies({
		initialWindow: undefined,
		onStaleRevision: NOOP,
		revision: overview.revision,
		sessionId: overview.session.sessionId,
	});
	const compactedTurns = useMemo(
		() => compactedRuns(turns, target),
		[target, turns],
	);
	useEffectOnceWhen({
		effect: () => {
			for (const run of [...compactedTurns, ...runs, ...turns])
				requestBody(run.turnId);
		},
		isReady: true,
		key: `${compactedTurns[0]?.turnId}:${compactedTurns.length}:${runs[0]?.turnId}:${runs.length}:${turns.length}`,
	});
	const flags = useRunFlags(overview, turns);
	const allBodies = useReadyBodies(turns, getBody);
	const subagentCosts = useMemo(
		() =>
			new Map(
				(overview.subagents ?? []).map((each) => [
					each.subagentId,
					each.estimatedCost,
				]),
			),
		[overview.subagents],
	);
	const problemsKey = `${overview.session.sessionId}:${overview.revision}:${flags.size}`;
	const problems = useMemo(() => {
		if (!allBodies) return undefined;
		const kept = builtProblems.get(problemsKey);
		if (kept) return kept;
		const built = problemsByBox(allBodies, flags, overview.session.modelUsed);
		builtProblems.set(problemsKey, built);
		return built;
	}, [allBodies, flags, overview.session.modelUsed, problemsKey]);
	const states = runs.map((run) => getBody(run.turnId));
	const read = states.filter((state) => state.status === "ready").length;
	const failed = states.some((state) => state.status === "failed");
	const setupRuns = useSessionSetupRuns(overview.session.sessionId);
	const calls = useMemo(
		() => segment.flatMap((run) => run.usageCalls),
		[segment],
	);
	const model = overview.session.modelUsed;
	const done = read === runs.length;
	const runBodies = useReadyBodies(runs, getBody);
	const compactedBodies = useReadyBodies(compactedTurns, getBody);
	const compacted = useMemo(
		() =>
			compactedBodies?.length === 0
				? NO_RUNS
				: compactedBodies
					? readRuns(compactedBodies, model)
					: null,
		[compactedBodies, model],
	);
	const prompts = useMemo(
		() => runBodies?.map(({ body }) => getReaderMemberText(body)) ?? [],
		[runBodies],
	);
	const mapKey = `${overview.session.sessionId}:${overview.revision}:${target.turnId}:${setup?.length ?? -1}:${setupRuns.data?.runs.length ?? -1}:${compacted === null ? "-" : "c"}`;
	const map = useMemo(() => {
		if (!runBodies) return null;
		if (builtMaps.has(mapKey)) return builtMaps.get(mapKey) ?? null;
		const built = buildContextMap({
			compacted,
			model,
			runBodies,
			setup: setup ?? [],
			setupRuns: setupRuns.data?.runs ?? [],
			target,
			turns,
		});
		builtMaps.set(mapKey, built);
		return built;
	}, [
		compacted,
		mapKey,
		model,
		runBodies,
		setup,
		setupRuns.data,
		target,
		turns,
	]);
	const partRuns = useMemo(
		() => (map ? runsByPart(map, runs) : undefined),
		[map, runs],
	);
	const runFigures = useMemo(
		() =>
			new Map(
				runs.map((run) => [
					run.turnId,
					{
						cost: run.estimatedCost ?? null,
						ms:
							run.startedAt && run.endedAt
								? Date.parse(run.endedAt) - Date.parse(run.startedAt)
								: null,
					},
				]),
			),
		[runs],
	);
	const byRun = useMemo(
		() => (map ? byRunMap(map, runs, prompts) : null),
		[map, prompts, runs],
	);
	const compactedKeys = useMemo(
		() => compactedTurns.map((turn) => `run:${turn.turnId}`),
		[compactedTurns],
	);
	const compacting = useMemo(() => compactedLater(turns, runs), [runs, turns]);
	const stored = useStoredContextSnapshot(overview.session.sessionId);
	const storedView =
		stored.data?.views.find((view) => view.withCompaction === showingWith) ??
		stored.data?.views[0];
	const lastShown = useRef<ComponentProps<typeof ContextTiles> | null>(null);
	if (failed)
		return <Unmapped>Some of its runs' transcripts couldn't be read.</Unmapped>;
	if (!done && lastShown.current)
		return (
			<ContextTiles {...lastShown.current} footer={footer} measure={measure} />
		);
	if (!done && storedView && measure === "context")
		return (
			<ContextTiles
				compactedRuns={storedView.compactedRuns}
				compacting={new Set(storedView.compacting)}
				cost={cost}
				costOutside={costOutside}
				footer={footer}
				map={storedView.map}
				measure={measure}
				memory={`session:${overview.session.sessionId}`}
				whole
			/>
		);
	if (!done)
		return (
			<div className="flex flex-col gap-3">
				<ContextBar map={null} titleId={undefined} />
				<ContextMapFrame>
					<Bones label="Reading its context">
						<ContextMapSample />
					</Bones>
					{footer ? (
						<div className="flex px-[3px] pt-2 pb-[3px]">{footer}</div>
					) : null}
				</ContextMapFrame>
			</div>
		);
	if (!map)
		return (
			<Unmapped>
				Its model's context window isn't known, so there's nothing to fill.
			</Unmapped>
		);
	const tilesProps: ComponentProps<typeof ContextTiles> = {
		byRun,
		calls,
		compactedRuns: compactedKeys,
		compacting,
		cost,
		costOutside,
		footer,
		map,
		measure,
		memory: `session:${overview.session.sessionId}`,
		partRuns,
		problems,
		runFigures,
		runs,
		subagentCosts,
		whole: true,
	};
	lastShown.current = tilesProps;
	return <ContextTiles {...tilesProps} />;
}
