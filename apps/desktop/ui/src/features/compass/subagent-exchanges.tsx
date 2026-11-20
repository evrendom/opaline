import { getRawToolInput, parseTaskNotification } from "@rudel/api-routes";
import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";
import { AssistantResponse } from "@/features/sessions/reader/detail/session-reader-assistant-response";
import { ModelAvatar } from "@/features/sessions/reader/detail/session-reader-model-avatar";
import { OpalChip } from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips";
import type {
	SessionReaderBody,
	SessionReaderStep,
} from "@/features/sessions/reader/model/session-reader-model";
import { LANE_LOOK } from "@/features/sessions/reader/model/session-reader-step-lanes";
import { useSubagentTintById } from "@/features/sessions/reader/subagents/session-reader-subagent-tints";
import { cn } from "@/lib/utils";

export type SubagentExchange = {
	atMs: number;
	direction: "from-main" | "to-main";
	text: string;
};

export function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) =>
			block && typeof block === "object" && "text" in block
				? String(block.text)
				: "",
		)
		.join("\n");
}

export function getSubagentExchanges(
	bodies: readonly SessionReaderBody[],
	subagentId: string,
	launch: SessionReaderStep | null,
): SubagentExchange[] {
	const out: SubagentExchange[] = [];
	for (const item of bodies.flatMap((body) => body.responseItems)) {
		if (item.kind === "system" && item.systemType === "notification") {
			const notice = parseTaskNotification(item.text);
			const text = notice?.result ?? notice?.summary;
			const atMs = Date.parse(item.timestamp);
			if (notice?.taskId === subagentId && text && Number.isFinite(atMs))
				out.push({ atMs, direction: "to-main", text });
			continue;
		}
		if (item.kind !== "agent") continue;
		for (const event of item.events) {
			if (event.kind !== "tool" || event.toolName !== "SendMessage") continue;
			const input = getRawToolInput(event.input);
			const message = input.message ?? input.content;
			const atMs = Date.parse(event.timestamp);
			if (input.to === subagentId && Number.isFinite(atMs))
				out.push({
					atMs,
					direction: "from-main",
					text: typeof message === "string" ? message : textOf(message),
				});
		}
	}
	const result = launch?.result?.trim();
	if (
		!out.some((each) => each.direction === "to-main") &&
		launch &&
		result &&
		!/^Async agent launched/u.test(result)
	)
		out.push({ atMs: launch.endMs, direction: "to-main", text: result });
	return out.filter((each) => each.text.trim()).sort((a, b) => a.atMs - b.atMs);
}

export function SubagentAvatar({ subagentId }: { subagentId: string }) {
	const tint = useSubagentTintById()(subagentId) ?? LANE_LOOK.agent.tint;
	const Ghost = LANE_LOOK.agent.glyph;
	return (
		<OpalChip tint={tint} className="size-6 text-(--opal-tint)">
			<Ghost aria-hidden="true" className="size-3.5" />
		</OpalChip>
	);
}

export function tintedGround(tint: string) {
	return {
		backgroundColor: `color-mix(in oklab, ${tint} 7%, transparent)`,
	};
}

export function SubagentMessage({
	exchange,
	model,
	subagentId,
}: {
	exchange: SubagentExchange;
	model: string | null;
	subagentId: string;
}) {
	const tint = useSubagentTintById()(subagentId) ?? LANE_LOOK.agent.tint;
	const toMain = exchange.direction === "to-main";
	return (
		<div
			data-exchange=""
			className="-ml-[calc(var(--space-xxl)*1.5)] flex gap-l"
		>
			<span className="mt-s flex h-fit shrink-0">
				{toMain ? (
					<SubagentAvatar subagentId={subagentId} />
				) : (
					<ModelAvatar flat loading={false} model={model} />
				)}
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-s">
				<span className="inline-flex items-center gap-xs text-body-m font-medium text-ink-3">
					{toMain ? (
						<>
							To main agent
							<IconArrowRight aria-hidden="true" className="size-3" />
						</>
					) : (
						<>
							<IconArrowLeft aria-hidden="true" className="size-3" />
							From main agent
						</>
					)}
				</span>
				<div
					className={cn(
						"min-w-0 corner-m px-l py-l shadow-(--shadow-card) corner-squircle squircle:corner-xl",
						!toMain && "bg-card",
					)}
					style={toMain ? tintedGround(tint) : undefined}
				>
					<AssistantResponse text={exchange.text} />
				</div>
			</div>
		</div>
	);
}
