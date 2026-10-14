import { scanMemberLanguageSignals } from "@rudel/language-signals";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { SignalText } from "@/components/signal-text";
import { cn } from "@/lib/utils";

// The member's message in the reader: their avatar beside the text, long
// messages clamped behind "Show more", and the words that signal how they
// felt marked as they are elsewhere.

/** Characters of a member's message shown before it is clamped. */
const MEMBER_TEXT_CLAMP = 1_200;

export function MemberBubble({
	imageUrl,
	label,
	preview,
	text,
}: {
	imageUrl: string | undefined;
	label: string;
	preview: boolean;
	text: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const clamped = !expanded && text.length > MEMBER_TEXT_CLAMP;
	return (
		<div className="flex gap-3">
			<Avatar className="mt-1.5 size-6 shrink-0 shadow-(--custom-shadow) after:hidden">
				{imageUrl ? <AvatarImage src={imageUrl} alt="" /> : null}
				<AvatarFallback className="text-[0.625rem]">
					{label.charAt(0).toUpperCase()}
				</AvatarFallback>
			</Avatar>
			<div className="min-w-0 flex-1 rounded-lg bg-card px-3 py-2.5 shadow-(--custom-shadow) corner-squircle squircle:rounded-2xl dark:bg-muted-foreground/10">
				<p
					className={cn(
						"whitespace-pre-wrap text-sm [overflow-wrap:anywhere]",
						preview && "text-muted-foreground",
					)}
				>
					<SignalText
						scanSignals={scanMemberLanguageSignals}
						text={clamped ? `${text.slice(0, MEMBER_TEXT_CLAMP)}…` : text}
					/>
				</p>
				{text.length > MEMBER_TEXT_CLAMP ? (
					<button
						type="button"
						onClick={() => setExpanded((value) => !value)}
						className="mt-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
					>
						{expanded ? "Show less" : "Show more"}
					</button>
				) : null}
			</div>
		</div>
	);
}
