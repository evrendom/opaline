import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import {
	IconMessageQuestion,
	IconMoodSad,
	IconMoodSmile,
} from "@tabler/icons-react";
import { Fragment, type ReactNode } from "react";
import { Badge } from "@/app/ui/badge";
import { formatModelDisplayLabel } from "@/features/dashboard/components/dashboard-model-brand";
import {
	type RunQuestionAnswer,
	runQuestionTagLabel,
	runQuestionTagTitle,
} from "@/features/sessions/run-question-tags";
import { formatCompactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { resolveSessionOverviewContextWindow } from "../../components/session-thread-overview-context-limits";
import {
	estimateTokens,
	formatWindowShare,
} from "../detail/step/session-reader-token-estimate";

// The small fact line over the member's message in the reader: who, when,
// how long, which commands, the signals their wording gave, and what the
// run questions found in the run.

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	hour: "2-digit",
	hourCycle: "h23",
	minute: "2-digit",
	month: "short",
});

export function formatDateTime(value: string | null) {
	return value ? dateTimeFormatter.format(new Date(value)) : "—";
}

type Signal = SessionDetailTurnSummary["signalOccurrences"][number];

function quotes(signals: readonly Signal[]): string {
	return signals.map((signal) => `“${signal.matchedText}”`).join(", ");
}

/** Facts separated by dots. */
function FactLine({
	children,
	className,
}: {
	children: ReactNode[];
	className?: string;
}) {
	const facts = children.filter(Boolean);
	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-m text-body-m text-ink-3",
				className,
			)}
		>
			{facts.map((fact, index) => (
				// Facts are a fixed, ordered set per line.
				// biome-ignore lint/suspicious/noArrayIndexKey: positions never reorder
				<Fragment key={index}>
					{index > 0 ? <span>·</span> : null}
					{fact}
				</Fragment>
			))}
		</div>
	);
}

function PromptTokens({
	characters,
	turn,
}: {
	characters: number;
	turn: SessionDetailTurnSummary;
}) {
	const call = turn.usageCalls[0];
	const model = call?.model ?? null;
	const estimate = estimateTokens(characters, model);
	const catalog = model ? resolveSessionOverviewContextWindow(model, 0) : null;
	const window =
		call?.contextWindow ??
		(catalog?.source === "catalog" ? catalog.tokenLimit : null);
	const share = window ? formatWindowShare(estimate.tokens / window) : null;
	return (
		<span
			className="tabular-nums"
			title={[
				`${formatCompactNumber(characters)} characters ≈ ${formatCompactNumber(estimate.tokens)} input tokens, at about ${estimate.charsPerToken} characters a token (${estimate.tokenizer})`,
				window && share
					? `${share} of ${model ? formatModelDisplayLabel(model) : "the model"}'s ${formatCompactNumber(window)}-token context window`
					: null,
			]
				.filter(Boolean)
				.join("\n")}
		>
			~{formatCompactNumber(estimate.tokens)} tokens
			{share ? <span className="text-ink-4"> · {share}</span> : null}
		</span>
	);
}

/** Over the member's message: who, when, how long, which commands, how
 * their wording read, and the run questions answered yes about the run. */
export function MemberFactLine({
	frustrated = false,
	questions,
	turn,
	userLabel,
}: {
	frustrated?: boolean;
	/** The run questions answered yes about this run, surest first. */
	questions?: readonly RunQuestionAnswer[];
	turn: SessionDetailTurnSummary;
	userLabel: string;
}) {
	const negative = turn.signalOccurrences.filter(
		(signal) => signal.category === "negative",
	);
	const positive = turn.signalOccurrences.filter(
		(signal) => signal.category === "positive",
	);
	return (
		// Lined up with the message text beside the avatar.
		<FactLine className="pl-xxxl">
			{[
				<span key="who" className="font-medium text-ink">
					{userLabel}
				</span>,
				<span key="when" className="tabular-nums">
					{formatDateTime(turn.startedAt)}
				</span>,
				turn.userCharacterCount ? (
					<PromptTokens
						key="length"
						characters={turn.userCharacterCount}
						turn={turn}
					/>
				) : null,
				turn.slashCommands.length > 0 ? (
					<span key="commands" className="font-data">
						{turn.slashCommands.join(" ")}
					</span>
				) : null,
				negative.length > 0 || frustrated || positive.length > 0 ? (
					<span key="signals" className="flex items-center gap-s">
						{negative.length > 0 || frustrated ? (
							<Badge
								variant="error"
								title={
									negative.length > 0
										? quotes(negative)
										: "Tracked as frustrated: the run before it is flagged"
								}
							>
								<IconMoodSad aria-hidden="true" />
								Frustration
							</Badge>
						) : null}
						{positive.length > 0 ? (
							<Badge variant="success" title={quotes(positive)}>
								<IconMoodSmile aria-hidden="true" />
								Positive
							</Badge>
						) : null}
					</span>
				) : null,
				questions && questions.length > 0 ? (
					<span
						key="questions"
						className="flex flex-wrap items-center gap-s"
						data-run-question-tags
					>
						{questions.map((question) => (
							<Badge
								key={question.id}
								variant="warning"
								title={runQuestionTagTitle(question)}
							>
								<IconMessageQuestion aria-hidden="true" />
								{runQuestionTagLabel(question)}
							</Badge>
						))}
					</span>
				) : null,
			]}
		</FactLine>
	);
}
