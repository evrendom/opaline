import { scanMemberLanguageSignals } from "@rudel/language-signals";
import { type ReactNode, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { Card, CardContent } from "@/app/ui/card";
import { Pressable } from "@/app/ui/pressable";
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
				<Avatar size="sm" className="mt-s shrink-0">
					{imageUrl ? <AvatarImage src={imageUrl} alt="" /> : null}
					<AvatarFallback>{label.charAt(0).toUpperCase()}</AvatarFallback>
				</Avatar>
			)}
			<Card size="sm" className="min-w-0 flex-1">
				<CardContent>
					{folded ? (
						<TwoLines className="text-body-xl">{message}</TwoLines>
					) : (
						message
					)}
					{!folded && text.length > MEMBER_TEXT_CLAMP ? (
						<Pressable
							type="button"
							onClick={() => setExpanded((value) => !value)}
							className="mt-s text-body-m text-ink-3 hover:text-ink"
						>
							{expanded ? "Show less" : "Show more"}
						</Pressable>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
