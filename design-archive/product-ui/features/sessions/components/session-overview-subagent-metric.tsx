import type { SessionAnalytics } from "@rudel/api-routes";
import { TraceBotIcon } from "@/components/conversation/conversation-trace-hugeicons";
import { getModelIconComponent } from "@/components/conversation/conversation-trace-model-icon";
import { getModelBrandIconClassName } from "@/features/dashboard/components/dashboard-model-brand";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
	resolveSessionNativeSubagentCount,
	resolveSessionSubagentCount,
} from "./session-overview-metrics";

type SessionOverviewSubagentMetricProps = Pick<
	SessionAnalytics,
	| "linked_subagent_count"
	| "linked_subagents"
	| "source"
	| "subagent_count"
	| "subagent_types"
>;

export function SessionOverviewSubagentMetric(
	props: SessionOverviewSubagentMetricProps,
) {
	const nativeCount = resolveSessionNativeSubagentCount(
		props.subagent_count,
		props.subagent_types,
	);
	const linkedSubagents = props.linked_subagents ?? [];
	const totalCount = resolveSessionSubagentCount(
		props.subagent_count,
		props.subagent_types,
		props.linked_subagent_count,
		linkedSubagents,
	);
	const title = `${formatNumber(totalCount)} ${totalCount === 1 ? "subagent" : "subagents"} spawned`;

	return (
		<div
			className="flex min-w-0 items-center justify-end gap-1.5"
			title={title}
		>
			<div className="flex shrink-0 items-center -space-x-0.5">
				{nativeCount > 0 ? (
					<SubagentProviderIcon
						kind="native"
						model={
							props.source === "claude_code"
								? "claude"
								: props.source === "codex"
									? "codex"
									: "unknown"
						}
					/>
				) : null}
				{linkedSubagents.map((child) => (
					<SubagentProviderIcon
						key={`${child.source}:${child.session_id}`}
						kind="linked"
						model={child.model}
					/>
				))}
			</div>
			<p className="truncate text-base/5 font-[450] text-(--session-overview-muted) tabular-nums sm:text-[0.8125rem]/5">
				{formatNumber(totalCount)}
			</p>
		</div>
	);
}

function SubagentProviderIcon({
	kind,
	model,
}: {
	readonly kind: "linked" | "native";
	readonly model: string;
}) {
	const ModelIcon = getModelIconComponent(model);
	const Icon = ModelIcon ?? TraceBotIcon;
	return (
		<span
			className="flex size-4 items-center justify-center rounded-full bg-(--session-overview-surface)"
			data-subagent-kind={kind}
			data-subagent-model={model}
		>
			<Icon
				className={cn(
					"size-3",
					ModelIcon
						? getModelBrandIconClassName(model)
						: "text-(--session-overview-muted)",
				)}
			/>
		</span>
	);
}
