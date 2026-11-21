import type { ReactNode } from "react";
import { shortRunId } from "@/features/sessions/run-id";
import { cn } from "@/lib/utils";
import { ModelChip } from "../detail/waterfall/session-reader-waterfall-chips";
import { SubagentTag } from "../subagents/session-reader-subagent-chip";

export function PickStrip({
	agent,
	children,
	model,
	run,
	summary,
	untitled = false,
}: {
	agent: string | null;
	children?: ReactNode;
	model: string | null;
	run: string | null;
	summary?: string;
	untitled?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex h-8 shrink-0 items-center gap-s",
				"corner-s pr-xs",
				"text-body-m",
				// design-escape-ok(opacity): no role renders this; bg-field/50
				"bg-field/50",
				untitled && !run && !agent ? "w-max min-w-full pl-xs" : "pl-m",
			)}
		>
			{agent ? (
				<SubagentTag subagentId={agent} />
			) : run ? (
				<>
					<ModelChip model={model} />
					<span className="shrink-0">Run {shortRunId(run)}</span>
				</>
			) : untitled ? null : (
				<span className="shrink-0 font-medium">Entire session</span>
			)}
			{summary ? (
				<span
					// design-escape-ok(type): shipped value; 11px on the strip's 12/16 ratio
					className="min-w-0 truncate text-[11px]/[calc(16/12)] text-ink-3"
				>
					{summary}
				</span>
			) : null}
			{children ? (
				<span
					className={cn(
						"flex items-center gap-xxs",
						untitled && !run && !agent
							? "min-w-0 flex-1 justify-between"
							: "ml-auto shrink-0",
					)}
				>
					{children}
				</span>
			) : null}
		</div>
	);
}
