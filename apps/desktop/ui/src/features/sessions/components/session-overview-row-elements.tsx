import type { SessionAnalytics } from "@rudel/api-routes";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
	getNewseshLanguageSignalMatches,
	type NewseshLanguageSignalMatch,
} from "./newsesh-session-language-signal";

export const SESSION_OVERVIEW_ROW_CLASS_NAME =
	"group/session grid h-12 w-full text-left focus-outline focus-visible:z-20";

export const SESSION_OVERVIEW_MODEL_LABEL_CLASS_NAME =
	// design-escape-ok(type): no role renders this; 16/20 below sm
	"text-base/5 font-medium tracking-m text-ink sm:text-body-l";

export const SESSION_OVERVIEW_CELL_CLASS_NAME =
	"flex min-w-0 items-center px-l";

export const SESSION_OVERVIEW_METADATA_CLASS_NAME =
	"whitespace-nowrap text-left text-body-m font-regular text-ink-3 tabular-nums [font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe_UI_Variable_Display','Segoe_UI',Helvetica,Arial,sans-serif]";

export const SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME =
	"flex min-w-0 shrink items-center gap-xs corner-xs px-s py-xxs text-body-xs font-regular tabular-nums";

export const SESSION_OVERVIEW_ICON_TAG_CLASS_NAME = "h-[1.1875rem] pl-xs";

export const SESSION_OVERVIEW_TAG_ICON_CLASS_NAME =
	"size-3 shrink-0 [@media(min-resolution:2dppx)]:translate-y-[0.25px]";

export const SESSION_OVERVIEW_TAG_NUMBER_CLASS_NAME =
	"[text-box:trim-both_cap_alphabetic]";

export const SESSION_OVERVIEW_SWEAR_TAG_CLASS_NAME = "bg-error-tint text-error";

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
		<div
			title={title}
			data-language-signal-category={category}
			data-signal-category={category}
			className={cn(
				SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME,
				category === "positive" && "bg-success-tint text-success",
				category === "apology" && "bg-warning-tint text-warning",
				category === "swear" && SESSION_OVERVIEW_SWEAR_TAG_CLASS_NAME,
			)}
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
		</div>
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
