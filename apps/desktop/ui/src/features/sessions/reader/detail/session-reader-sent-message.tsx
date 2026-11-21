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
		<div className="flex w-full max-w-[33rem] gap-l py-s">
			<span className="mt-s flex h-fit shrink-0">
				<ModelAvatar flat loading={false} model={model} />
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-s">
				<button
					type="button"
					onClick={onSelect}
					className={cn(
						"inline-flex w-fit items-center gap-xs",
						"corner-xs",
						"text-body-m font-medium",
						"text-ink-3 focus-outline",
						"hover:text-ink",
						selected && "text-ink",
					)}
				>
					To subagent
					<IconArrowRight aria-hidden="true" className="size-3" />
				</button>
				<div
					className={cn(
						// design-escape-ok(space): shipped value; 10px block padding
						"min-w-0 corner-m px-l py-[10px] shadow-card corner-squircle squircle:corner-xl-inner",
						// design-escape-ok(colour): shipped value; black/2.5% (white/4% in dark)
						!tint && "bg-black/[0.025] dark:bg-white/[0.04]",
						// design-escape-ok(opacity): no role renders this; ring-(--sent-tint)/40
						selected && "ring-[1.5px] ring-(--sent-tint)/40",
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
