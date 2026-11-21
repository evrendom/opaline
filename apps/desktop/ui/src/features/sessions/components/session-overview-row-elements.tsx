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
	// design-escape-ok(type): shipped value; 16/20 below sm, weight 450
	"text-base/5 font-[450] tracking-m text-session-overview-text sm:text-body-l";

export const SESSION_OVERVIEW_CELL_CLASS_NAME =
	"flex min-w-0 items-center px-l";

export const SESSION_OVERVIEW_METADATA_CLASS_NAME =
	// design-escape-ok(colour): shipped value; #787774, white/65 in dark
	"whitespace-nowrap text-left text-body-m font-regular text-[#787774] dark:text-white/65 tabular-nums [font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe_UI_Variable_Display','Segoe_UI',Helvetica,Arial,sans-serif]";

export const SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME =
	// design-escape-ok(type,space): shipped value; 10px on the row's 1.5 line, 3px gap
	"flex min-w-0 shrink items-center gap-[3px] corner-xs px-s py-xxs text-[0.625rem] font-regular tabular-nums";

export const SESSION_OVERVIEW_ICON_TAG_CLASS_NAME = "h-[1.1875rem] pl-xs";

export const SESSION_OVERVIEW_TAG_ICON_CLASS_NAME =
	"size-3 shrink-0 [@media(min-resolution:2dppx)]:translate-y-[0.25px]";

export const SESSION_OVERVIEW_TAG_NUMBER_CLASS_NAME =
	"[text-box:trim-both_cap_alphabetic]";

export const SESSION_OVERVIEW_SWEAR_TAG_CLASS_NAME =
	// design-escape-ok(colour): shipped value; the rose chip
	"bg-[#ffe4e6] text-[#be123c] dark:bg-[#4c1d25] dark:text-[#fb7185]";

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
				category === "positive" &&
					// design-escape-ok(colour): shipped value; the green chip
					"bg-[#dcfce7] text-[#15803d] dark:bg-[#173d2a] dark:text-[#4ade80]",
				category === "apology" &&
					// design-escape-ok(colour): shipped value; the amber chip
					"bg-[#fef3c7] text-[#b45309] dark:bg-[#493719] dark:text-[#fbbf24]",
				category === "swear" && SESSION_OVERVIEW_SWEAR_TAG_CLASS_NAME,
			)}
		>
			<span className="min-w-0 truncate" data-session-overview-language-signal>
				{text}
			</span>
			{remainingCount > 0 ? (
				<span
					// design-escape-ok(type): shipped value; 8px on the row's 1.5 line
					className="shrink-0 text-[0.5rem]"
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
