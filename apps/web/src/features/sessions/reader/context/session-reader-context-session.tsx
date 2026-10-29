import type {
	SessionDetailTurnSummary,
	SessionSetupFile,
} from "@rudel/api-routes";
import { type ReactNode, useMemo } from "react";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { Skeleton } from "@/app/ui/skeleton";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import { useSessionSetupRuns } from "../../use-session-setup-runs";
import {
	useReadyBodies,
	useSessionReaderBodies,
} from "../detail/use-session-reader-bodies";
import {
	getReaderMemberText,
	getReaderWaterfall,
} from "../model/session-reader-model";
import { useRunFlags } from "../rail/session-reader-run-flags";
import { ContextBar } from "./session-reader-context-bar";
import { byRunMap, runsByPart } from "./session-reader-context-by-run";
import { Unmapped } from "./session-reader-context-card";
import { ContextMapFrame } from "./session-reader-context-frame";
import { ContextMapHead } from "./session-reader-context-head";
import { type ContextMap, getContextMap } from "./session-reader-context-map";
import type { ContextMeasure } from "./session-reader-context-measure";
import {
	type BoxProblems,
	problemsByBox,
} from "./session-reader-context-problems";
import {
	compactedRuns,
	contextRuns,
	fullestCall,
	NO_RUNS,
	readRuns,
	runSetupTexts,
	sessionBaseline,
} from "./session-reader-context-runs";
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
	const target = useMemo(() => {
		let best: SessionDetailTurnSummary | undefined;
		let bestShare = 0;
		for (const each of turns) {
			const share = fullestCall(each)?.share ?? 0;
			if (share > bestShare) {
				best = each;
				bestShare = share;
			}
		}
		return best;
	}, [turns]);
	const runs = useMemo(
		() => (target ? contextRuns(turns, target) : []),
		[target, turns],
	);
	return (
		<ContextMapHead.Provider value={head}>
			<div className="flex min-w-0 flex-col">
				{target ? (
					<WholeContext
						key={target.turnId}
						measure={measure}
						overview={overview}
						runs={runs}
						setup={setup}
						target={target}
						turns={turns}
					/>
				) : (
					<Unmapped>
						Its model's context window isn't known, so there's nothing to fill.
					</Unmapped>
				)}
			</div>
		</ContextMapHead.Provider>
	);
}

function WholeContext({
	measure,
	overview,
	runs,
	setup,
	target,
	turns,
}: {
	measure: ContextMeasure;
	overview: NormalizedSessionDetailOverview;
	runs: readonly SessionDetailTurnSummary[];
	setup: readonly SessionSetupFile[] | undefined;
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
	useMountEffect(() => {
		for (const run of [...compactedTurns, ...runs, ...turns])
			requestBody(run.turnId);
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
	const calls = useMemo(() => runs.flatMap((run) => run.usageCalls), [runs]);
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
		const fullest = fullestCall(target);
		if (!fullest) return null;
		const built = getContextMap({
			baseline: sessionBaseline(turns),
			compacted,
			earlier: null,
			prompt: prompts,
			setup: runSetupTexts(setup ?? [], setupRuns.data?.runs ?? [], {
				agent: null,
				startedAt: target.startedAt,
			}),
			steps: runBodies.flatMap(
				({ body, turn }) => getReaderWaterfall(body, turn, model)?.steps ?? [],
			),
			until: fullest.at,
			use: fullest,
		});
		builtMaps.set(mapKey, built);
		return built;
	}, [
		compacted,
		mapKey,
		model,
		prompts,
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
	if (failed)
		return <Unmapped>Some of its runs' transcripts couldn't be read.</Unmapped>;
	if (!done)
		return (
			<div className="flex flex-col gap-3">
				<ContextBar map={null} titleId={undefined} />
				<ContextMapFrame>
					<Skeleton className="m-[3px] h-[274px] rounded-md" />
				</ContextMapFrame>
				<p className="text-xs text-muted-foreground tabular-nums">
					Reading {read} of {runs.length} runs…
				</p>
			</div>
		);
	if (!map)
		return (
			<Unmapped>
				Its model's context window isn't known, so there's nothing to fill.
			</Unmapped>
		);
	return (
		<ContextTiles
			byRun={byRun}
			calls={calls}
			cost={overview.session.estimatedCost}
			subagentCosts={subagentCosts}
			map={map}
			memory={`session:${overview.session.sessionId}`}
			partRuns={partRuns}
			problems={problems}
			runFigures={runFigures}
			measure={measure}
			whole
		/>
	);
}
