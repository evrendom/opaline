import { getRawToolInput } from "@rudel/api-routes";
import { IconArrowRight } from "@tabler/icons-react";
import type { CSSProperties } from "react";
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
		<div className="flex w-full max-w-[33rem] gap-3 py-1.5">
			<span className="mt-1.5 flex h-fit shrink-0">
				<ModelAvatar flat loading={false} model={model} />
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				<button
					type="button"
					onClick={onSelect}
					className={cn(
						"inline-flex w-fit items-center gap-1 rounded text-xs font-medium text-muted-foreground outline-none hover:text-foreground",
						selected && "text-foreground",
					)}
				>
					To subagent
					<IconArrowRight aria-hidden="true" className="size-3" />
				</button>
				<div
					className={cn(
						"min-w-0 rounded-lg px-3 py-2.5 shadow-(--custom-shadow) corner-squircle squircle:rounded-2xl",
						!tint && "bg-black/[0.025] dark:bg-white/[0.04]",
						selected && "ring-[1.5px] ring-(--sent-tint)/40",
					)}
					style={
						{
							...(tint ? tintedGround(tint) : {}),
							"--sent-tint": tint ?? "var(--foreground)",
						} as CSSProperties
					}
				>
					<AssistantResponse text={sentMessageText(step)} />
				</div>
			</div>
		</div>
	);
}
