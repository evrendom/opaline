import { getRawToolInput } from "@rudel/api-routes";
import { IconArrowRight } from "@tabler/icons-react";
import type { CSSProperties } from "react";
import { Pressable } from "@/app/ui/pressable";
import { textOf, tintedGround } from "@/features/compass/subagent-exchanges";
import { cn } from "@/lib/utils";
import type { SessionReaderStep } from "../model/session-reader-model";
import { AssistantResponse } from "./session-reader-assistant-response";
import { ModelAvatar } from "./session-reader-model-avatar";

function sentMessageText(step: SessionReaderStep): string {
	const input = getRawToolInput(step.toolEvent?.input ?? {});
	const message = input.message ?? input.content;
	return typeof message === "string" ? message : textOf(message);
}

export function SentMessage({
	model,
	onSelect,
	selected,
	step,
	tint,
}: {
	model: string | null;
	onSelect: () => void;
	selected: boolean;
	step: SessionReaderStep;
	tint: string | null;
}) {
	return (
		<div className="flex w-full max-w-[33rem] gap-l py-s">
			<span className="mt-s flex h-fit shrink-0">
				<ModelAvatar flat loading={false} model={model} />
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-s">
				<Pressable
					type="button"
					onClick={onSelect}
					className={cn(
						"inline-flex w-fit items-center gap-xs",
						"corner-xs",
						"text-body-m font-medium",
						"text-ink-3",
						"hover:text-ink",
						selected && "text-ink",
					)}
				>
					To subagent
					<IconArrowRight aria-hidden="true" className="size-3" />
				</Pressable>
				<div
					className={cn(
						"min-w-0 corner-m px-l py-m shadow-card corner-squircle squircle:corner-xl-inner",
						!tint && "bg-hover",
						selected && "ring-[1.5px] ring-accent-line",
					)}
					style={
						{
							...(tint ? tintedGround(tint) : {}),
							"--sent-tint": tint ?? "var(--ink)",
						} as CSSProperties
					}
				>
					<AssistantResponse text={sentMessageText(step)} />
				</div>
			</div>
		</div>
	);
}
