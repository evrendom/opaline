import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/app/ui/avatar";
import { ModelAvatar } from "../detail/session-reader-model-avatar";
import { SubagentChip } from "../subagents/session-reader-subagent-chip";
import {
	laneCount,
	mainLaneX,
	type Part,
	subagentX,
} from "./session-reader-minimap-line";

const HEAD_PX = 12;

function Head({
	children,
	x,
	y,
}: {
	children: ReactNode;
	x: number;
	y: number;
}) {
	return (
		<span
			className="absolute flex -translate-x-1/2 motion-safe:[transition:left_300ms_ease-out,top_300ms_ease-out,opacity_150ms_ease-out] motion-safe:starting:opacity-0"
			style={{ left: x, top: y }}
		>
			{children}
		</span>
	);
}

export function MinimapHeads({
	focus,
	member,
	model,
	parts,
	scale,
	width,
}: {
	focus: string | null;
	member: { imageUrl: string | undefined; label: string };
	model: string | null;
	parts: readonly Part[];
	scale: number;
	width: number;
}) {
	if (width <= 0) return null;
	const lanes = laneCount(parts);
	const main = mainLaneX(lanes);
	const railStart = parts.find(
		(part) => part.kind === "member" || part.kind === "agent",
	);
	if (!railStart) return null;
	const y = Math.max(railStart.top * scale - HEAD_PX / 2, 0);
	const byLane = new Map<number, Part & { id: string }>();
	for (const part of parts) {
		if (part.kind !== "subagent" || !part.id) continue;
		const lane = part.lane ?? 0;
		if (!byLane.has(lane)) byLane.set(lane, { ...part, id: part.id });
	}
	const focused = parts.find(
		(part) => part.kind === "subagent" && part.id === focus,
	);
	if (focused?.id)
		byLane.set(focused.lane ?? 0, { ...focused, id: focused.id });
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 z-20"
		>
			<Head x={main.member * width} y={y}>
				<Avatar className="size-3 shadow-card after:hidden">
					{member.imageUrl ? (
						<AvatarImage src={member.imageUrl} alt="" />
					) : null}
					{/* design-escape-ok(type): shipped value; 6.4px initials */}
					<AvatarFallback className="text-[0.4rem]">
						{member.label.charAt(0).toUpperCase()}
					</AvatarFallback>
				</Avatar>
			</Head>
			<Head x={main.agent * width} y={y}>
				<span className="-m-s flex scale-50">
					<ModelAvatar loading={false} model={model} shadowless solid />
				</span>
			</Head>
			{[...byLane].map(([lane, first]) => (
				<Head key={lane} x={subagentX(lane, lanes) * width} y={y}>
					<span className="-m-xxs flex scale-75">
						<SubagentChip
							ringed
							selected={first.id === focus}
							solid
							subagentId={first.id}
						/>
					</span>
				</Head>
			))}
		</div>
	);
}
