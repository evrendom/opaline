import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { NewseshLanguageSignalMatch } from "./newsesh-session-language-signal";

export const SESSION_OVERVIEW_ROW_CLASS_NAME =
	"group/session grid h-12 w-full text-left outline-none focus-visible:z-20 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--session-overview-accent)";

export const SESSION_OVERVIEW_MODEL_LABEL_CLASS_NAME =
	"text-base/5 font-[450] tracking-normal text-(--session-overview-text) sm:text-[0.8125rem]/5";

export const SESSION_OVERVIEW_CELL_CLASS_NAME =
	"flex min-w-0 items-center px-3";

export const SESSION_OVERVIEW_METADATA_CLASS_NAME =
	"whitespace-nowrap text-left text-xs font-normal tracking-normal text-[#787774] tabular-nums [font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe_UI_Variable_Display','Segoe_UI',Helvetica,Arial,sans-serif] dark:text-white/65";

export const SESSION_OVERVIEW_SIGNAL_TAG_CLASS_NAME =
	"flex min-w-0 shrink items-center gap-0.75 rounded-sm px-1.5 py-0.5 text-[0.625rem] font-normal tabular-nums";

export const SESSION_OVERVIEW_SWEAR_TAG_CLASS_NAME =
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
					"bg-[#dcfce7] text-[#15803d] dark:bg-[#173d2a] dark:text-[#4ade80]",
				category === "apology" &&
					"bg-[#fef3c7] text-[#b45309] dark:bg-[#493719] dark:text-[#fbbf24]",
				category === "swear" && SESSION_OVERVIEW_SWEAR_TAG_CLASS_NAME,
			)}
		>
			<span className="min-w-0 truncate" data-session-overview-language-signal>
				{text}
			</span>
			{remainingCount > 0 ? (
				<span
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
