import type { Icon } from "@tabler/icons-react";
import type { ComponentType, ReactNode } from "react";
import { FlowFigure } from "@/app/ui/flow-number";
import { StatCard } from "@/components/dashboard/page-parts";
import type { Figure } from "@/lib/figure";
import { cn } from "@/lib/utils";
import type { ContextMeasure } from "../context/session-reader-context-measure";
import { usePickedBox } from "../context/session-reader-context-pick";
import type { FlagGroup } from "./session-reader-summary-flags";

export type SummaryFigure = {
	detail: string;
	icon: Icon | ComponentType<{ className?: string }>;
	label: string;
	shortLabel?: string;
	badge?: ReactNode;
	note?: ReactNode;
	noteBelow?: boolean;
	valueTip?: ReactNode;
	measure?: ContextMeasure;
	tint: string;
	value: Figure;
};

function groupOf(figure: SummaryFigure): FlagGroup {
	if (figure.measure === "cost") return "cost";
	if (figure.measure === "time") return "time";
	if (figure.measure === "context") return "context";
	return "turns";
}

export function SummaryFigures({
	accent,
	figures,
	flags,
	measure,
	onMeasure,
}: {
	accent: Record<ContextMeasure, string>;
	figures: readonly SummaryFigure[];
	flags?: (group: FlagGroup) => ReactNode;
	measure: ContextMeasure;
	onMeasure: (measure: ContextMeasure) => void;
}) {
	const picked = usePickedBox();
	const ordered = [...figures].sort(
		(a, b) => Number(b.measure === "context") - Number(a.measure === "context"),
	);
	return (
		<div className="@container">
			<div
				className={cn(
					"grid grid-cols-2 items-start gap-xl",
					ordered.length === 3 ? "@2xl:grid-cols-3" : "@2xl:grid-cols-4",
				)}
			>
				{ordered.map((stat) => {
					const { measure: picks } = stat;
					const own = picked && picks ? (picked.figures[picks] ?? ["—"]) : null;
					return (
						<div key={stat.label} className="flex min-w-0 flex-col">
							<div className="relative z-10">
								<StatCard
									accent={picks ? accent[picks] : undefined}
									icon={stat.icon}
									iconClassName={stat.tint}
									label={stat.label}
									shortLabel={stat.shortLabel}
									badge={stat.badge}
									note={own ? undefined : stat.note}
									noteBelow={stat.noteBelow}
									valueTip={own ? undefined : stat.valueTip}
									onSelect={picks ? () => onMeasure(picks) : undefined}
									selected={picks === measure}
									title={stat.detail || undefined}
									value={<FlowFigure figure={own ?? stat.value} />}
								/>
							</div>
							{flags ? (
								<div className="relative -mt-xxl corner-b-m bg-inset px-xl pt-xxxl pb-l shadow-inset corner-squircle squircle:corner-b-xl">
									{flags(groupOf(stat))}
								</div>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}
