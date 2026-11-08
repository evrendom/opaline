import { scanMemberLanguageSignals } from "@rudel/language-signals";
import { type ReactNode, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { SignalText } from "@/components/signal-text";
import { cn } from "@/lib/utils";
import { TwoLines } from "./session-reader-two-lines";

const MEMBER_TEXT_CLAMP = 1_200;

export function MemberBubble({
	avatar,
	folded = false,
	imageUrl,
	label,
	preview,
	text,
}: {
	avatar?: ReactNode;
	folded?: boolean;
	imageUrl: string | undefined;
	label: string;
	preview: boolean;
	text: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const clamped = !folded && !expanded && text.length > MEMBER_TEXT_CLAMP;
	const message = (
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
	);
	return (
		<div className="flex gap-3">
			{avatar ? (
				<span className="mt-1.5 flex shrink-0">{avatar}</span>
			) : (
				<Avatar className="mt-1.5 size-6 shrink-0 shadow-(--custom-shadow) after:hidden">
					{imageUrl ? <AvatarImage src={imageUrl} alt="" /> : null}
					<AvatarFallback className="text-[0.625rem]">
						{label.charAt(0).toUpperCase()}
					</AvatarFallback>
				</Avatar>
			)}
			<div className="min-w-0 flex-1 rounded-lg bg-card px-3 py-2.5 shadow-(--custom-shadow) corner-squircle squircle:rounded-2xl">
				{folded ? <TwoLines className="text-sm">{message}</TwoLines> : message}
				{!folded && text.length > MEMBER_TEXT_CLAMP ? (
					<button
						type="button"
						onClick={() => setExpanded((value) => !value)}
						className="mt-1.5 text-xs text-muted-foreground hover:text-foreground"
					>
						{expanded ? "Show less" : "Show more"}
					</button>
				) : null}
			</div>
		</div>
	);
}
