import type { SessionAnalytics } from "@rudel/api-routes";
import type { ReactNode } from "react";
import { Tag } from "@/app/ui/tag";
import {
	getNewseshLanguageSignalMatches,
	type NewseshLanguageSignalMatch,
} from "./newsesh-session-language-signal";

export const SESSION_OVERVIEW_ROW_CLASS_NAME =
	"group/session grid h-12 w-full text-left focus-outline focus-visible:z-20";

export const SESSION_OVERVIEW_MODEL_LABEL_CLASS_NAME =
	"text-body-xxl font-[450] tracking-m text-ink sm:text-body-l";

export const SESSION_OVERVIEW_CELL_CLASS_NAME =
	"flex min-w-0 items-center px-l";

export const SESSION_OVERVIEW_METADATA_CLASS_NAME =
	"whitespace-nowrap text-left text-body-m font-regular text-ink-3 tabular-nums";

const LANGUAGE_SIGNAL_TONES = {
	positive: "success",
	apology: "warning",
	swear: "error",
} as const satisfies Record<NewseshLanguageSignalMatch["category"], string>;

export function SessionLanguageSignalTag({
	category,
	text,
	title,
	remainingCount,
	remainingTitle,
}: {
	category: NewseshLanguageSignalMatch["category"];
	text: ReactNode;
	title: string;
	remainingCount: number;
	remainingTitle: string;
}) {
	return (
		<Tag
			render={<div />}
			tone={LANGUAGE_SIGNAL_TONES[category]}
			className="shrink"
			title={title}
			data-language-signal-category={category}
			data-signal-category={category}
		>
			<span className="min-w-0 truncate" data-session-overview-language-signal>
				{text}
			</span>
			{remainingCount > 0 ? (
				<span
					className="shrink-0 text-body-xxs"
					data-session-overview-language-signal-overflow
					title={remainingTitle}
				>
					+{remainingCount}
				</span>
			) : null}
		</Tag>
	);
}

export function SessionOverviewLanguageSignals({
	session,
	speaker,
}: {
	session: SessionAnalytics;
	speaker: NewseshLanguageSignalMatch["speaker"];
}) {
	const signals = getNewseshLanguageSignalMatches(session, speaker);
	if (signals.length === 0) {
		return null;
	}

	const signalSummary = signals.map((signal) => signal.matchedText).join(", ");

	return (
		<div
			className="flex min-w-0 max-w-full items-center gap-xs overflow-hidden"
			data-language-signal-speaker={speaker}
			title={`${speaker === "member" ? "Member" : "Model"} language signals: ${signalSummary}`}
		>
			{(["positive", "apology", "swear"] as const).map((category) => {
				const [signal, ...hidden] = signals.filter(
					(signal) => signal.category === category,
				);
				if (!signal) {
					return null;
				}
				return (
					<SessionLanguageSignalTag
						key={category}
						category={category}
						text={signal.matchedText}
						title={`${speaker === "member" ? "Member" : "Model"}: ${signal.matchedText}`}
						remainingCount={hidden.length}
						remainingTitle={hidden
							.map(
								(signal) =>
									`${speaker === "member" ? "Member" : "Model"}: ${signal.matchedText}`,
							)
							.join(" · ")}
					/>
				);
			})}
		</div>
	);
}
