import {
	deriveTranscriptToolActivity,
	type SessionDetailTurnSummary,
} from "@rudel/api-routes";
import { useCallback, useMemo, useState } from "react";
import { Skeleton } from "@/components/dashboard/skeleton";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import {
	fetchSessionDetailTurn,
	SESSION_DETAIL_IMMUTABLE_STALE_TIME_MS,
	sessionDetailTurnQueryKey,
} from "@/features/sessions/components/session-detail-fast-query";
import { getReaderTurnMarks } from "@/features/sessions/components/session-reader-model";
import {
	getReaderWaterfall,
	type SessionReaderStep,
} from "@/features/sessions/components/session-reader-run-steps";
import { toggleFilterKey } from "@/features/sessions/components/session-reader-run-ui-store";
import type { SessionReaderStepSelection } from "@/features/sessions/components/session-reader-step-detail";
import {
	SessionReaderWaterfallView,
	WHOLE_TURN_ID,
} from "@/features/sessions/components/session-reader-waterfall";
import { getWaterfallFilterOptions } from "@/features/sessions/components/session-reader-waterfall-rows";

/** Every step where the run used the skill (plugin skills carry a
 * `plugin:` prefix), subagents' included, in order: the calls that loaded
 * it. A skill the member invoked themselves has no call, so then it's the
 * first step from each time the run recorded the skill. */
export function findSkillSteps(
	steps: readonly SessionReaderStep[],
	skillName: string,
	skillEvents: SessionDetailTurnSummary["skillEvents"] = [],
): SessionReaderStep[] {
	const matches = (name: string) =>
		name === skillName || name.endsWith(`:${skillName}`);
	const calls = steps.filter(
		(step) =>
			step.toolEvent !== null &&
			(
				step.toolEvent.activity ?? deriveTranscriptToolActivity(step.toolEvent)
			).skills.some(matches),
	);
	if (calls.length > 0) return calls;
	const found = new Set<SessionReaderStep>();
	for (const event of skillEvents) {
		if (!matches(event.skill)) continue;
		const usedAt = Date.parse(event.at);
		const step = Number.isFinite(usedAt)
			? steps.find((candidate) => candidate.startMs >= usedAt)
			: undefined;
		if (step) found.add(step);
	}
	return steps.filter((step) => found.has(step));
}

/** What a pick in the waterfall puts beside it: another skill's file when
 * the step loaded one, else the step's own detail. */
export type SkillTracePick =
	| { kind: "skill"; name: string }
	| { kind: "step"; selection: SessionReaderStepSelection };

/**
 * One agent run as the session reader shows it: its steps as a waterfall,
 * folded as the reader folds them except for each use of the skill, which
 * stays out of its fold; the first is selected and scrolled to. The turn is cached under
 * the reader's own key, so opening the session at this run doesn't fetch it
 * again.
 */
export function SkillRunWaterfall({
	sessionId,
	revision,
	run,
	model,
	skillName,
	onStepSelect,
	onClose,
}: {
	sessionId: string;
	revision: string;
	run: SessionDetailTurnSummary;
	model: string | null;
	skillName: string;
	/** A step picked other than the skill's own call, for a panel beside the
	 * list; null when the pick goes back to the skill or the run. */
	onStepSelect?: (pick: SkillTracePick | null) => void;
	/** Closes the run: its root row folds the waterfall away. */
	onClose: () => void;
}) {
	const input = { revision, sessionId, turnId: run.turnId };
	const body = useAnalyticsQuery({
		queryKey: sessionDetailTurnQueryKey(input),
		queryFn: ({ signal }) => fetchSessionDetailTurn(input, signal),
		select: (turn) => ({
			responseItems: turn.responseItems,
			userItems: turn.userItems,
		}),
		staleTime: SESSION_DETAIL_IMMUTABLE_STALE_TIME_MS,
	});
	const waterfall = useMemo(
		() => (body.data ? getReaderWaterfall(body.data, run, model) : null),
		[body.data, run, model],
	);
	const filterOptions = useMemo(
		() => getWaterfallFilterOptions(waterfall?.allSteps ?? []),
		[waterfall],
	);
	const [filter, setFilter] = useState<ReadonlySet<string>>(new Set());
	// Every use stays out of the folds; the first starts selected.
	const skillStepIds = useMemo(
		() =>
			waterfall
				? findSkillSteps(waterfall.allSteps, skillName, run.skillEvents).map(
						(step) => step.id,
					)
				: [],
		[waterfall, skillName, run.skillEvents],
	);
	const [picked, setPicked] = useState<string | null>(null);
	const selected = picked ?? skillStepIds[0] ?? WHOLE_TURN_ID;
	// Once, as the steps first show: bring the skill call into view.
	const revealSelection = useCallback((node: HTMLDivElement | null) => {
		node
			?.querySelector("[data-active-row]")
			?.scrollIntoView({ block: "nearest" });
	}, []);

	if (body.isLoading)
		return (
			<div className="flex flex-col gap-2 p-3">
				<Skeleton className="h-5 w-full" />
				<Skeleton className="h-5 w-5/6" />
				<Skeleton className="h-5 w-2/3" />
			</div>
		);
	if (body.isError || !body.data || !waterfall)
		return (
			<p className="p-3 text-xs text-muted-foreground">
				This run’s steps couldn’t load.
			</p>
		);
	const runView = {
		filter,
		filterOptions,
		marks: getReaderTurnMarks(run, body.data),
		onToggleFilter: (key: string) =>
			setFilter((now) => toggleFilterKey(now, key)),
		turn: run,
	};
	function select(stepId: string) {
		setPicked(stepId);
		const step = waterfall?.allSteps.find(
			(candidate) => candidate.id === stepId,
		);
		onStepSelect?.(
			!step || !waterfall || skillStepIds.includes(stepId)
				? null
				: step.skill
					? { kind: "skill", name: step.skill }
					: { kind: "step", selection: { run: runView, step, waterfall } },
		);
	}
	return (
		// Isolated, so the rows' own stacking stays under the frozen run row
		// above it. Place it on the reader's own ground, where a selected row's
		// tint reads; it draws none itself, so a rounded card around it keeps
		// its corners. As in the reader, its header and root row (with its
		// reading progress) freeze while the steps scroll under them, below
		// the run's row (`--frozen-offset`, set by the list).
		// The card's cap above holds its top inset, so the header (whose own
		// top padding covers the reader's inset) keeps just a sliver of it.
		<div
			ref={revealSelection}
			className="isolate min-w-0 px-3 pt-1 pb-3 [&_[data-frozen-header]]:-mt-1 [&_[data-frozen-header]]:pt-1"
		>
			<SessionReaderWaterfallView
				collapse={{ onToggle: onClose, open: true }}
				keepOut={skillStepIds}
				run={runView}
				selection={{ onSelect: select, selected }}
				waterfall={waterfall}
			/>
		</div>
	);
}
