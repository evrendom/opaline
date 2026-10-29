import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { RunQuestionAnswer } from "../../run-question-tags";
import {
	getReaderFinalMessage,
	getReaderMemberText,
	getReaderRunMode,
	getReaderTurnMarks,
	getReaderWaterfall,
} from "../model/session-reader-model";
import {
	type RunUiStore,
	useRunUi,
} from "../model/session-reader-run-ui-store";
import { MemberFactLine } from "../rail/session-reader-turn-lines";
import { TURN_ANSWER_MARK, TURN_REPLY_MARK } from "../reader-dom";
import { PendingSubagentMarks } from "../subagents/session-reader-subagent-marks";
import {
	AssistantResponse,
	AssistantSkeleton,
} from "./session-reader-assistant-response";
import { MemberBubble } from "./session-reader-member-bubble";
import { ModelAvatar } from "./session-reader-model-avatar";
import { RunSummaryBar, TurnSteps } from "./session-reader-turn-steps";
import { TurnTrace } from "./session-reader-turn-trace";
import type { SessionReaderBodyState } from "./use-session-reader-bodies";

export const READING_MEASURE =
	"w-full max-w-[33rem] xl:max-w-[min(33rem,calc(100%-var(--reader-card)-3.5rem-4rem))]";

const NOTHING_HIDDEN: ReadonlySet<string> = new Set();

export const TurnBlock = memo(function TurnBlock({
	bodyState,
	costShade,
	frustrated = false,
	hidden = NOTHING_HIDDEN,
	model,
	onRetry,
	questions,
	store,
	subagentDurations,
	turn,
	userImageUrl,
	userLabel,
}: {
	bodyState: SessionReaderBodyState;
	costShade?: string;
	hidden?: ReadonlySet<string>;
	subagentDurations?: ReadonlyMap<string, number | null | undefined>;
	frustrated?: boolean;
	model: string | null;
	onRetry: (turnId: string) => void;
	questions: readonly RunQuestionAnswer[] | undefined;
	store: RunUiStore;
	turn: SessionDetailTurnSummary;
	userImageUrl: string | undefined;
	userLabel: string;
}) {
	const body = bodyState.status === "ready" ? bodyState.body : null;
	const { open } = useRunUi(store, turn.turnId);
	const callsHidden = hidden.has("toolCalls");
	const toggleRun = () =>
		store.update(turn.turnId, (state) => ({ open: !state.open }));
	const memberText = body ? getReaderMemberText(body) : turn.userPreview;
	const finalMessage = body ? getReaderFinalMessage(body) : null;
	const waterfall = useMemo(
		() => (body ? getReaderWaterfall(body, turn, model) : null),
		[body, turn, model],
	);
	const bar = waterfall ? (
		<RunSummaryBar
			expanded
			id={turn.turnId}
			mode={body ? getReaderRunMode(body) : undefined}
			model={model}
			onToggle={toggleRun}
			waterfall={waterfall}
		/>
	) : null;

	const answer = hidden.has("responses") ? null : (
		<div
			{...TURN_REPLY_MARK}
			className={cn(
				"flex gap-3",
				body ? "w-full max-w-[33rem]" : READING_MEASURE,
			)}
		>
			<ModelAvatar loading={bodyState.status === "loading"} model={model} />
			<div className="min-w-0 flex-1">
				{bodyState.status === "loading" ? (
					<AssistantSkeleton />
				) : bodyState.status === "failed" ? (
					<p className="pt-0.5 text-sm text-muted-foreground">
						This turn could not be loaded.{" "}
						<button
							type="button"
							onClick={() => onRetry(turn.turnId)}
							className="cursor-pointer underline underline-offset-2 hover:text-foreground"
						>
							Retry
						</button>
					</p>
				) : finalMessage ? (
					<AssistantResponse text={finalMessage} />
				) : (
					<p className="pt-0.5 text-sm italic text-muted-foreground">
						No response recorded.
					</p>
				)}
			</div>
		</div>
	);

	return (
		<div
			data-turn-steps={turn.toolCallCount}
			data-turn-pending={body ? undefined : ""}
			className="flex w-full flex-col gap-8 text-sm"
		>
			{memberText && !hidden.has("prompts") ? (
				<div className={cn("flex flex-col gap-2", READING_MEASURE)}>
					<MemberFactLine
						frustrated={frustrated}
						questions={questions}
						turn={turn}
						userLabel={userLabel}
					/>
					<MemberBubble
						imageUrl={userImageUrl}
						label={userLabel}
						preview={!body}
						text={memberText}
					/>
				</div>
			) : null}

			<div
				{...TURN_ANSWER_MARK}
				className="relative flex scroll-mt-(--reader-top,1rem) flex-col gap-4"
			>
				{body ? null : (
					<PendingSubagentMarks durations={subagentDurations} turn={turn} />
				)}
				{callsHidden ? (
					answer
				) : body && waterfall && !open && !callsHidden ? (
					<>
						<div className={READING_MEASURE}>
							<TurnSteps
								body={body}
								costShade={costShade}
								marks={getReaderTurnMarks(turn, body)}
								model={model}
								runUi={store}
								turn={turn}
								waterfall={waterfall}
							/>
						</div>
						{answer}
					</>
				) : body ? (
					<TurnTrace
						body={body}
						foot={answer ?? undefined}
						head={
							waterfall ? (
								<div className="w-full max-w-[33rem]">{bar}</div>
							) : null
						}
						model={model}
						store={store}
						turn={turn}
					/>
				) : (
					answer
				)}
			</div>
		</div>
	);
});
