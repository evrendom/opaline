import type {
	SessionDetailTurnSummary,
	SessionSetupFile,
} from "@rudel/api-routes";
import { useCallback, useMemo, useState } from "react";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { Bone, Bones } from "@/app/ui/bones";
import { TraceAttempts } from "@/features/compass/compass-trace-attempts";
import { useSessionReaderBodies } from "../detail/use-session-reader-bodies";
import { mcpTool } from "../model/session-reader-mcp-tool";
import {
	getReaderTurnMarks,
	getReaderWaterfall,
	type SessionReaderBody,
	type SessionReaderStep,
	type SessionReaderWaterfall,
} from "../model/session-reader-model";
import { flattenSteps } from "../model/session-reader-run-steps";
import {
	createRunUiStore,
	type RunUiStore,
} from "../model/session-reader-run-ui-store";
import { createActiveTurnStore } from "../rail/session-reader-turn-rail";
import { findMcpSetupFile } from "../session-places";
import { subagentIdOf } from "../subagents/session-reader-agent-focus";
import { useReaderSubagentBranches } from "../subagents/use-reader-subagent-branches";
import { setupName } from "./session-setup-files";

const NOOP = () => {};
const NO_FILTER: ReadonlySet<string> = new Set();

export type SetupUse = { file: SessionSetupFile; step: SessionReaderStep };

function setupOf(
	step: SessionReaderStep,
	setup: readonly SessionSetupFile[],
): SessionSetupFile | null {
	const server = step.toolEvent
		? mcpTool(step.toolEvent.toolName)?.server
		: null;
	const setupFile = server ? findMcpSetupFile(setup, server) : null;
	if (setupFile)
		return setup.find((file) => file.setupFile === setupFile) ?? null;
	if (step.skill)
		return (
			setup.find(
				(file) => file.kind === "skill_body" && setupName(file) === step.skill,
			) ?? null
		);
	return null;
}

export function agentRun(
	waterfall: SessionReaderWaterfall,
	agent: string | null,
): SessionReaderWaterfall | null {
	if (!agent) return waterfall;
	const launch = waterfall.allSteps.find(
		(step) => subagentIdOf(step) === agent,
	);
	if (!launch || launch.children.length === 0) return null;
	return {
		allSteps: flattenSteps(launch.children),
		endMs: launch.endMs,
		model: launch.model ?? waterfall.model,
		startMs: launch.startMs,
		steps: launch.children,
	};
}

export type RunSetupUses = {
	body: SessionReaderBody | null;
	status: "failed" | "loading" | "ready";
	uses: readonly SetupUse[];
	waterfall: SessionReaderWaterfall | null;
};

export function useRunSetupUses({
	agent,
	model,
	revision,
	sessionId,
	setup,
	turn,
}: {
	agent: string | null;
	model: string | null;
	revision: string;
	sessionId: string;
	setup: readonly SessionSetupFile[];
	turn: SessionDetailTurnSummary | undefined;
}): RunSetupUses {
	const { getBody, requestBody } = useSessionReaderBodies({
		initialWindow: undefined,
		onStaleRevision: NOOP,
		revision,
		sessionId,
	});
	useMountEffect(() => {
		if (turn) requestBody(turn.turnId);
	});
	const bodyState = turn ? getBody(turn.turnId) : null;
	const body = bodyState?.status === "ready" ? bodyState.body : null;
	const branches = useReaderSubagentBranches(body, agent !== null);
	const waterfall = useMemo(() => {
		const whole =
			body && turn ? getReaderWaterfall(body, turn, model, branches) : null;
		return whole ? agentRun(whole, agent) : null;
	}, [agent, body, branches, model, turn]);
	const uses = useMemo(
		() =>
			(waterfall?.allSteps ?? []).flatMap((step) => {
				const file = setupOf(step, setup);
				return file ? [{ file, step }] : [];
			}),
		[setup, waterfall],
	);
	const status =
		bodyState?.status === "failed" ? "failed" : waterfall ? "ready" : "loading";
	return { body, status, uses, waterfall };
}

export function useSetupRunStore(turnId: string | undefined): RunUiStore {
	const [store] = useState(() => {
		const inView = createActiveTurnStore();
		inView.set(turnId ?? null);
		return createRunUiStore(inView);
	});
	return store;
}

export function SetupRunTrace({
	run: { body, status, uses, waterfall },
	stepId,
	store,
	turn,
}: {
	run: RunSetupUses;
	stepId: string | null;
	store: RunUiStore;
	turn: SessionDetailTurnSummary;
}) {
	const shown = stepId ?? uses[0]?.step.id ?? null;
	const attachPane = useCallback(
		(element: HTMLDivElement | null) => {
			if (!element || !shown) return;
			store.pick(turn.turnId, shown);
			requestAnimationFrame(() =>
				element
					.querySelector(`[data-step-row="${CSS.escape(shown)}"]`)
					?.scrollIntoView({ block: "center" }),
			);
		},
		[shown, store, turn.turnId],
	);
	if (status === "failed")
		return (
			<p className="py-1 pl-2 text-[11px] text-muted-foreground">
				This run could not be read.
			</p>
		);
	if (status === "loading" || !waterfall)
		return (
			<Bones label="Reading this run">
				<div className="flex flex-col gap-2 py-2">
					{[80, 64, 72].map((width) => (
						<Bone
							key={width}
							className="h-3.5 rounded-md"
							style={{ width: `${width}%` }}
						/>
					))}
				</div>
			</Bones>
		);
	return (
		<div ref={attachPane} className="pb-8 pl-[calc(2.25rem+9px)]">
			<TraceAttempts
				lanesSlot={null}
				model={waterfall.model}
				run={{
					filter: NO_FILTER,
					filterOptions: [],
					marks: getReaderTurnMarks(turn, body),
					onToggleFilter: NOOP,
					turn,
				}}
				store={store}
				turnId={turn.turnId}
				usage={turn.usageCalls}
				waterfall={waterfall}
			/>
		</div>
	);
}
