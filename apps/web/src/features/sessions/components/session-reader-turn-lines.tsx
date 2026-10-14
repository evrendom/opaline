import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import {
	IconMessageQuestion,
	IconMoodSad,
	IconMoodSmile,
} from "@tabler/icons-react";
import { Fragment, type ReactNode } from "react";
import {
	type RunQuestionAnswer,
	runQuestionTagLabel,
	runQuestionTagTitle,
} from "@/features/sessions/run-question-tags";
import { formatCompactNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

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

const PILL =
	"inline-flex h-5 items-center gap-1 rounded-3xl px-2 font-medium [&>svg]:size-3";

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
				"flex flex-wrap items-center gap-2 text-xs text-muted-foreground",
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

/** Over the member's message: who, when, how long, which commands, how
 * their wording read, and the run questions answered yes about the run. */
export function MemberFactLine({
	questions,
	turn,
	userLabel,
}: {
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
		<FactLine className="pl-9">
			{[
				<span key="who" className="font-medium text-foreground">
					{userLabel}
				</span>,
				<span key="when" className="tabular-nums">
					{formatDateTime(turn.startedAt)}
				</span>,
				turn.userCharacterCount ? (
					<span key="length" className="tabular-nums">
						{formatCompactNumber(turn.userCharacterCount)} chars
					</span>
				) : null,
				turn.slashCommands.length > 0 ? (
					<span key="commands" className="font-mono">
						{turn.slashCommands.join(" ")}
					</span>
				) : null,
				negative.length > 0 || positive.length > 0 ? (
					<span key="signals" className="flex items-center gap-1.5">
						{negative.length > 0 ? (
							<span
								title={quotes(negative)}
								className={cn(
									PILL,
									"bg-rose-500/10 text-rose-600 dark:text-rose-400",
								)}
							>
								<IconMoodSad aria-hidden="true" />
								Frustration
							</span>
						) : null}
						{positive.length > 0 ? (
							<span
								title={quotes(positive)}
								className={cn(
									PILL,
									"bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
								)}
							>
								<IconMoodSmile aria-hidden="true" />
								Positive
							</span>
						) : null}
					</span>
				) : null,
				questions && questions.length > 0 ? (
					<span
						key="questions"
						className="flex flex-wrap items-center gap-1.5"
						data-run-question-tags
					>
						{questions.map((question) => (
							<span
								key={question.id}
								title={runQuestionTagTitle(question)}
								className={cn(
									PILL,
									"bg-amber-500/10 text-amber-700 dark:text-amber-400",
								)}
							>
								<IconMessageQuestion aria-hidden="true" />
								{runQuestionTagLabel(question)}
							</span>
						))}
					</span>
				) : null,
			]}
		</FactLine>
	);
}
