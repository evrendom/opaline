import type { SessionAnalytics } from "@rudel/api-routes";
import type { CSSProperties } from "react";
import { TraceBotIcon } from "@/components/conversation/conversation-trace-hugeicons";
import { getModelIconComponent } from "@/components/conversation/conversation-trace-model-icon";
import {
	formatModelDisplayLabel,
	getModelBrandIconClassName,
} from "@/features/dashboard/components/dashboard-model-brand";
import { cn } from "@/lib/utils";
import { resolveSessionNativeSubagentCount } from "./session-overview-metrics";

interface SubagentStackStyle extends CSSProperties {
	"--subagent-step": string;
	"--subagent-stack-width": string;
}

type SessionSubagentData = Pick<
	SessionAnalytics,
	| "subagent_count"
	| "subagent_types"
	| "native_subagents"
	| "native_child_sessions"
	| "linked_subagent_count"
	| "linked_subagents"
>;

interface SessionOverviewSubagent {
	id: string;
	label: string;
	model: string | null;
}

export function getSessionOverviewSubagents(
	session: SessionSubagentData,
): SessionOverviewSubagent[] {
	const nativeCount = Math.max(
		resolveSessionNativeSubagentCount(
			session.subagent_count,
			session.subagent_types,
		),
		session.native_subagents?.length ?? 0,
		session.native_child_sessions?.length ?? 0,
	);
	const uploadedChildren = session.native_child_sessions ?? [];
	const native = Array.from({ length: nativeCount }, (_, index) => {
		const child = uploadedChildren[index];
		const agent =
			uploadedChildren.length === 0
				? session.native_subagents?.[index]
				: undefined;
		return {
			id: `native:${child?.session_id ?? agent?.subagent_id ?? index}`,
			model: child?.model ?? agent?.model ?? null,
			// Types are a distinct aggregate, not an index-aligned identity map.
			label: `Subagent ${index + 1}`,
		};
	});
	const linked = session.linked_subagents ?? [];
	const linkedCount = Math.max(
		session.linked_subagent_count ?? 0,
		linked.length,
	);
	return [
		...native,
		...Array.from({ length: linkedCount }, (_, index) => {
			const agent = linked[index];
			return {
				id: `linked:${agent?.session_id ?? index}`,
				model: agent?.model ?? null,
				label: `Linked subagent ${index + 1}`,
			};
		}),
	];
}

export function SessionOverviewSubagentStack({
	session,
}: {
	session: SessionSubagentData;
}) {
	const agents = getSessionOverviewSubagents(session);
	if (agents.length === 0) return null;
	// Keep one glyph per agent while allowing large stacks to stay compact.
	const step = Math.min(0.5, 2.75 / Math.max(1, agents.length - 1));
	const style: SubagentStackStyle = {
		"--subagent-step": `${step}rem`,
		"--subagent-stack-width": `${1.25 + step * (agents.length - 1)}rem`,
	};
	const title = `${agents.length} ${agents.length === 1 ? "subagent" : "subagents"}`;
	return (
		<div
			aria-label={title}
			className="isolate grid h-5 w-(--subagent-stack-width) shrink-0 grid-flow-col auto-cols-(--subagent-step) items-center"
			data-session-overview-subagent-stack
			data-subagent-icon-count={agents.length}
			role="img"
			style={style}
			title={title}
		>
			{agents.map((agent) => {
				const ModelIcon = getModelIconComponent(agent.model ?? undefined);
				const Icon = ModelIcon ?? TraceBotIcon;
				const label = `${agent.label}: ${agent.model ? formatModelDisplayLabel(agent.model) : "Model unavailable"}`;
				const icon = (
					<span
						key={agent.id}
						aria-label={label}
						className="relative flex size-5 shrink-0 drop-shadow-[0_0_0.75px_rgb(0_0_0_/_14%)] hover:z-10"
						data-subagent-model-icon
						data-subagent-model={agent.model ?? "unknown"}
						data-subagent-icon-kind={ModelIcon ? "model" : "bot"}
						role="img"
						title={label}
					>
						<span className="flex size-5 items-center justify-center bg-white [-webkit-mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat] [mask:url('/opaline-trace-fill.svg')_center/contain_no-repeat]">
							<Icon
								className={cn(
									"size-3.5 shrink-0",
									ModelIcon
										? getModelBrandIconClassName(agent.model ?? undefined)
										: "text-[#8d8d8d]",
								)}
							/>
						</span>
					</span>
				);
				return <span key={agent.id}>{icon}</span>;
			})}
		</div>
	);
}
