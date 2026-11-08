import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Bone, Bones } from "@/app/ui/bones";
import { shortSubagentId } from "@/features/sessions/run-id";
import { cn } from "@/lib/utils";
import {
	getReaderWaterfall,
	type SessionReaderBody,
} from "../model/session-reader-model";
import type { RunUiStore } from "../model/session-reader-run-ui-store";
import { readerScrollerOf, TURN_ANSWER_MARK, turnMarks } from "../reader-dom";
import {
	subagentBrief,
	subagentIdOf,
} from "../subagents/session-reader-agent-focus";
import {
	SubagentStrip,
	type SubagentSummary,
} from "../subagents/session-reader-subagent-strip";
import { MemberBubble } from "./session-reader-member-bubble";
import { ModelAvatar } from "./session-reader-model-avatar";
import { READING_MEASURE } from "./session-reader-turn-block";
import { RunSummaryBar } from "./session-reader-turn-steps";
import { TurnTrace } from "./session-reader-turn-trace";
import type { SessionReaderBodyState } from "./use-session-reader-bodies";

export function FocusedSubagent({
	bodyState,
	laterBodies,
	model,
	store,
	subagentId,
	summary,
	turn,
}: {
	bodyState: SessionReaderBodyState;
	laterBodies: readonly SessionReaderBody[];
	model: string | null;
	store: RunUiStore;
	subagentId: string;
	summary: SubagentSummary | undefined;
	turn: SessionDetailTurnSummary;
}) {
	const body = bodyState.status === "ready" ? bodyState.body : null;
	const launch = useMemo(() => {
		const waterfall = body ? getReaderWaterfall(body, turn, model) : null;
		return (
			waterfall?.allSteps.find((step) => subagentIdOf(step) === subagentId) ??
			null
		);
	}, [body, turn, model, subagentId]);
	const brief = launch ? subagentBrief(launch) : null;
	const rootRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		if (subagentId) readerScrollerOf(rootRef.current)?.scrollTo({ top: 0 });
	}, [subagentId]);
	const stripRef = useRef<HTMLDivElement>(null);
	const belowRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const strip = stripRef.current;
		const below = belowRef.current;
		if (!strip || !below) return;
		const scroller = readerScrollerOf(strip);
		const place = () => {
			const top = Number.parseFloat(getComputedStyle(strip).top) || 24;
			const bottom = top + strip.offsetHeight;
			below.style.setProperty("--frozen-offset", `${bottom}px`);
			below.style.setProperty(
				"--frozen-subagents",
				`calc(${bottom}px + 1rem - var(--reader-pane-top, var(--reader-top, 1rem)))`,
			);
			scroller?.style.setProperty("--focused-strip-bottom", `${bottom}px`);
		};
		place();
		const resize = new ResizeObserver(place);
		resize.observe(strip);
		return () => {
			resize.disconnect();
			scroller?.style.removeProperty("--focused-strip-bottom");
		};
	}, []);
	return (
		<div
			ref={rootRef}
			{...turnMarks({ index: 0, turnId: turn.turnId })}
			className="flex w-full flex-col gap-8 text-sm"
		>
			<div
				ref={stripRef}
				className="sticky top-[calc(var(--stage-top,var(--reader-top,1rem))+0.5rem)] z-40 -mt-[calc(var(--reader-top,1rem)-var(--stage-top,var(--reader-top,1rem)))] xl:-mr-(--scrollbar,0px) bg-(--dashboard-01-content-background,var(--background)) before:pointer-events-none before:absolute before:-z-10 before:inset-x-0 before:bottom-full before:h-2 before:bg-(--dashboard-01-content-background,var(--background)) after:pointer-events-none after:absolute after:-z-10 after:inset-x-0 after:top-full after:h-4 after:bg-linear-to-b after:from-(--dashboard-01-content-background,var(--background)) after:to-transparent"
			>
				<SubagentStrip
					launch={launch}
					purpose={brief?.purpose ?? null}
					subagentId={subagentId}
					summary={summary}
				/>
			</div>
			<div ref={belowRef} className="contents">
				{brief?.prompt ? (
					<div className={cn("flex flex-col gap-2", READING_MEASURE)}>
						<MemberBubble
							avatar={<ModelAvatar loading={false} model={model} />}
							imageUrl={undefined}
							label="Main agent"
							preview={false}
							text={brief.prompt}
						/>
					</div>
				) : null}
				<div {...TURN_ANSWER_MARK} className="flex flex-col gap-4">
					{body ? (
						<TurnTrace
							agent={subagentId}
							body={body}
							head={(waterfall) => (
								<RunSummaryBar
									copyLabel="Copy subagent ID"
									expanded
									id={subagentId}
									model={summary?.model ?? waterfall.model}
									shortId={shortSubagentId(subagentId)}
									waterfall={waterfall}
								/>
							)}
							laterBodies={laterBodies}
							model={model}
							store={store}
							turn={turn}
						/>
					) : (
						<Bones label="Reading this subagent">
							<div className="flex flex-col gap-2 px-1 pt-1">
								<Bone className="h-3.5 w-full rounded-sm" />
								<Bone className="h-3.5 w-2/3 rounded-sm" />
							</div>
						</Bones>
					)}
				</div>
			</div>
		</div>
	);
}
