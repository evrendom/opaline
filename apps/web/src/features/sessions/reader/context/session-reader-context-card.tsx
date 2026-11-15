import type {
	SessionDetailTurnSummary,
	SessionSetupFile,
} from "@rudel/api-routes";
import { IconAlertTriangle } from "@tabler/icons-react";
import { type ReactNode, useMemo } from "react";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { Reveal } from "@/app/ui/bones";
import { EmptyState } from "@/components/dashboard/page-parts";
import { formatCompactNumber } from "@/lib/format";
import type { NormalizedSessionDetailOverview } from "../../components/session-detail-fast-response";
import { useSessionSetupRuns } from "../../use-session-setup-runs";
import {
	useReadyBodies,
	useSessionReaderBodies,
} from "../detail/use-session-reader-bodies";
import {
	getReaderMemberText,
	getReaderWaterfall,
	type SessionReaderStep,
} from "../model/session-reader-model";
import { useRunFlags } from "../rail/session-reader-run-flags";
import { agentRun } from "../setup/session-reader-setup-use";
import {
	subagentBrief,
	subagentIdOf,
} from "../subagents/session-reader-agent-focus";
import {
	ReaderSubagentsContext,
	useReaderSubagentBranches,
} from "../subagents/use-reader-subagent-branches";
import { ContextBar } from "./session-reader-context-bar";
import {
	type ContextRuns,
	sinceCompaction,
} from "./session-reader-context-before";
import { tokensOf } from "./session-reader-context-collect";
import { ContextMapFrame } from "./session-reader-context-frame";
import { ContextMapHead } from "./session-reader-context-head";
import { getContextMap } from "./session-reader-context-map";
import { ContextMapSample } from "./session-reader-context-map-sample";
import type { ContextMeasure } from "./session-reader-context-measure";
import { problemsByBox } from "./session-reader-context-problems";
import {
	callBefore,
	compactedRuns,
	contextRuns,
	firstCallInput,
	fullestCall,
	NO_RUNS,
	readRuns,
	runSetupTexts,
	sessionBaseline,
} from "./session-reader-context-runs";
import { ContextTiles } from "./session-reader-context-tiles";

const NOOP = () => {};

export function SummaryContext({
	agent,
	head,
	measure,
	overview,
	setup,
	turn,
	turns,
}: {
	agent: string | null;
	head?: ReactNode;
	measure: ContextMeasure;
	setup: readonly SessionSetupFile[] | undefined;
	overview: NormalizedSessionDetailOverview;
	turn: SessionDetailTurnSummary;
	turns: readonly SessionDetailTurnSummary[];
}) {
	const subagents = useMemo(
		() => ({
			onStaleRevision: NOOP,
			revision: overview.revision,
			sessionId: overview.session.sessionId,
			subagents: overview.subagents,
		}),
		[overview.revision, overview.session.sessionId, overview.subagents],
	);
	return (
		<div className="flex min-w-0 flex-col">
			<ContextMapHead.Provider value={head}>
				<ReaderSubagentsContext.Provider value={subagents}>
					<RunContext
						key={`${turn.turnId}:${agent ?? ""}`}
						agent={agent}
						measure={measure}
						overview={overview}
						setup={setup}
						turn={turn}
						turns={turns}
						whole={false}
					/>
				</ReaderSubagentsContext.Provider>
			</ContextMapHead.Provider>
		</div>
	);
}

function Unknown() {
	return (
		<Unmapped>
			{"Its model's context window isn't known, so there's nothing to fill."}
		</Unmapped>
	);
}

export function Unmapped({ children }: { children: ReactNode }) {
	return (
		<ContextMapFrame>
			<p className="px-4 py-3 text-xs text-muted-foreground">{children}</p>
		</ContextMapFrame>
	);
}

function compactionContext(
	steps: readonly SessionReaderStep[],
	compacted: ContextRuns | null,
	turns: readonly SessionDetailTurnSummary[],
	turn: SessionDetailTurnSummary,
) {
	const { cut } = sinceCompaction(steps);
	const at = steps[cut]?.compaction;
	const call = callBefore(turns, turn);
	if (!at?.beforeTokens || !compacted || !call) return null;
	return getContextMap({
		baseline: sessionBaseline(turns),
		earlier:
			at.afterTokens !== undefined
				? `Compacted into ${formatCompactNumber(at.afterTokens)}`
				: "Compacted",
		earlierRuns: {
			prompts: compacted.prompts,
			steps: [...compacted.steps, ...steps.slice(0, cut)],
		},
		firstInput: at.beforeTokens,
		prompt: null,
		steps: [],
		until: null,
		use: { model: call.model, tokens: at.beforeTokens, window: call.window },
	});
}

function RunContext({
	agent,
	measure,
	overview,
	setup,
	turn,
	turns,
	whole,
}: {
	agent: string | null;
	measure: ContextMeasure;
	overview: NormalizedSessionDetailOverview;
	setup: readonly SessionSetupFile[] | undefined;
	turn: SessionDetailTurnSummary;
	turns: readonly SessionDetailTurnSummary[];
	whole: boolean;
}) {
	const { getBody, requestBody } = useSessionReaderBodies({
		initialWindow: undefined,
		onStaleRevision: NOOP,
		revision: overview.revision,
		sessionId: overview.session.sessionId,
	});
	const earlierTurns = useMemo(
		() => (agent ? [] : contextRuns(turns, turn).slice(0, -1)),
		[agent, turn, turns],
	);
	const compactedTurns = useMemo(
		() => (agent ? [] : compactedRuns(turns, turn)),
		[agent, turn, turns],
	);
	useMountEffect(() => {
		requestBody(turn.turnId);
		for (const each of [...compactedTurns, ...earlierTurns])
			requestBody(each.turnId);
	});
	const state = getBody(turn.turnId);
	const body = state.status === "ready" ? state.body : null;
	const model = overview.session.modelUsed;
	const earlierBodies = useReadyBodies(earlierTurns, getBody);
	const earlierRuns = useMemo(
		() =>
			earlierBodies && earlierBodies.length > 0
				? readRuns(earlierBodies, model)
				: null,
		[earlierBodies, model],
	);
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
	const branches = useReaderSubagentBranches(body, agent !== null, {
		focus: agent ?? undefined,
	});
	const setupRuns = useSessionSetupRuns(overview.session.sessionId);
	const texts = useMemo(
		() =>
			runSetupTexts(setup ?? [], setupRuns.data?.runs ?? [], {
				agent,
				startedAt: turn.startedAt,
			}),
		[agent, setup, setupRuns.data, turn.startedAt],
	);
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
	const flags = useRunFlags(overview, turns);
	const problems = useMemo(
		() =>
			body && !agent
				? problemsByBox([{ body, turn }], flags, model)
				: undefined,
		[agent, body, flags, model, turn],
	);
	const map = useMemo(() => {
		if (!body) return null;
		const whole = getReaderWaterfall(body, turn, model, branches);
		if (!whole) return null;
		if (agent) {
			const launch = whole.allSteps.find(
				(step) => subagentIdOf(step) === agent,
			);
			const run = agentRun(whole, agent);
			const subagent = overview.subagents?.find(
				(each) => each.subagentId === agent,
			);
			const use = subagent?.context;
			if (!launch || !run || !use) return null;
			const brief = subagentBrief(launch).prompt;
			const first = subagent?.firstInputTokens;
			return getContextMap({
				baseline:
					first !== null && first !== undefined
						? Math.max(0, first - tokensOf(brief))
						: null,
				earlier: null,
				setup: texts,
				prompt: brief,
				steps: run.steps,
				until: null,
				use,
			});
		}
		const fullest = fullestCall(turn);
		if (!fullest) return compactionContext(whole.steps, compacted, turns, turn);
		return getContextMap({
			baseline: sessionBaseline(turns),
			earlier: turns.indexOf(turn) > 0 ? "Earlier turns" : null,
			compacted,
			earlierRuns,
			firstInput: firstCallInput(turn),
			setup: texts,
			prompt: getReaderMemberText(body),
			steps: whole.steps,
			until: fullest.at,
			use: fullest,
		});
	}, [
		agent,
		body,
		branches,
		compacted,
		earlierRuns,
		model,
		overview.subagents,
		texts,
		turn,
		turns,
	]);
	if (state.status === "failed")
		return <Unmapped>Its transcript couldn't be read.</Unmapped>;
	if (body && !map)
		return !agent && turn.usageCalls.length === 0 ? (
			<ContextMapFrame>
				<div className="relative">
					<div aria-hidden="true" className="invisible">
						<ContextMapSample />
					</div>
					<EmptyState
						className="absolute inset-0 py-0"
						icon={IconAlertTriangle}
						title="No model call"
						description="It ended before its first model call, so nothing filled its context."
					/>
				</div>
			</ContextMapFrame>
		) : (
			<Unknown />
		);
	return (
		<Reveal
			label="Reading its context"
			loading={!body}
			sample={
				<div className="flex flex-col gap-3">
					<ContextBar map={null} titleId={undefined} />
					<ContextMapFrame>
						<ContextMapSample />
					</ContextMapFrame>
				</div>
			}
			sampleId="context-run"
		>
			{() =>
				map ? (
					<ContextTiles
						calls={agent ? undefined : turn.usageCalls}
						cost={agent ? undefined : turn.estimatedCost}
						subagentCosts={agent ? undefined : subagentCosts}
						caption={
							!agent && !fullestCall(turn) ? "before its compaction" : undefined
						}
						map={map}
						measure={measure}
						memory={`run:${turn.turnId}:${agent ?? ""}`}
						problems={problems}
						whole={whole}
					/>
				) : null
			}
		</Reveal>
	);
}
