import type { SessionDetailTurnSummary } from "@rudel/api-routes";
import {
	IconMessageQuestion,
	IconMoodSad,
	IconMoodSmile,
} from "@tabler/icons-react";
import { Fragment, type ReactNode } from "react";
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

const PILL =
	"inline-flex h-5 items-center gap-xs corner-xl px-m font-medium [&>svg]:size-3";

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
			{/* design-escape-ok(opacity): shipped value; muted-foreground/70 */}
			{share ? <span className="text-ink-3/70"> · {share}</span> : null}
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
		<FactLine className="pl-[calc(var(--space-xxl)*1.5)]">
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
					<span key="commands" className="font-mono">
						{turn.slashCommands.join(" ")}
					</span>
				) : null,
				negative.length > 0 || frustrated || positive.length > 0 ? (
					<span key="signals" className="flex items-center gap-s">
						{negative.length > 0 || frustrated ? (
							<span
								title={
									negative.length > 0
										? quotes(negative)
										: "Tracked as frustrated: the run before it is flagged"
								}
								// design-escape-ok(opacity): shipped value; rose-500/10
								className={cn(PILL, "bg-error/10 text-error")}
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
									// design-escape-ok(opacity,colour): shipped value; emerald-500/10, emerald-700 (emerald-400 in dark)
									"bg-success/10 text-emerald-700 dark:text-emerald-400",
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
						className="flex flex-wrap items-center gap-s"
						data-run-question-tags
					>
						{questions.map((question) => (
							<span
								key={question.id}
								title={runQuestionTagTitle(question)}
								className={cn(
									PILL,
									// design-escape-ok(opacity,colour): shipped value; amber-500/10, amber-700 (amber-400 in dark)
									"bg-warning/10 text-amber-700 dark:text-amber-400",
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
