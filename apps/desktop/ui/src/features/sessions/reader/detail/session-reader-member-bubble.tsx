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
				"whitespace-pre-wrap text-body-xl [overflow-wrap:anywhere]",
				preview && "text-ink-3",
			)}
		>
			<SignalText
				scanSignals={scanMemberLanguageSignals}
				text={clamped ? `${text.slice(0, MEMBER_TEXT_CLAMP)}…` : text}
			/>
		</p>
	);
	return (
		<div className="flex gap-l">
			{avatar ? (
				<span className="mt-s flex shrink-0">{avatar}</span>
			) : (
				<Avatar className="mt-s size-6 shrink-0 shadow-(--shadow-card) after:hidden">
					{imageUrl ? <AvatarImage src={imageUrl} alt="" /> : null}
					<AvatarFallback className="text-body-xs">
						{label.charAt(0).toUpperCase()}
					</AvatarFallback>
				</Avatar>
			)}
			<div className="min-w-0 flex-1 corner-m bg-card px-l py-l shadow-(--shadow-card) corner-squircle squircle:corner-xl">
				{folded ? (
					<TwoLines className="text-body-xl">{message}</TwoLines>
				) : (
					message
				)}
				{!folded && text.length > MEMBER_TEXT_CLAMP ? (
					<button
						type="button"
						onClick={() => setExpanded((value) => !value)}
						className="mt-s text-body-m text-ink-3 hover:text-ink"
					>
						{expanded ? "Show less" : "Show more"}
					</button>
				) : null}
			</div>
		</div>
	);
}
