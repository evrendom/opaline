import { IconBattery2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

function formatPlanShare(points: number): string {
	if (points >= 0.95) return `${Math.round(points)}%`;
	return `${points >= 0.1 ? points.toFixed(1) : points.toFixed(2)}%`;
}

function planUsageText(points: number, ofSession: number | undefined): string {
	return ofSession !== undefined && ofSession >= points
		? ` of the session’s ${formatPlanShare(ofSession)}`
		: " of the limit";
}

export function SessionPlanUsage({
	points,
	ofSession,
	limited,
}: {
	points: number | undefined;
	ofSession: number | undefined;
	limited: boolean;
}) {
	if (points === undefined && !limited) return null;
	return (
		<span
			className="ml-xs inline-flex items-center gap-xxs tabular-nums"
			data-session-overview-metric-value="plan-usage"
			data-limited={limited || undefined}
		>
			<IconBattery2
				aria-hidden="true"
				className={cn("size-3.5", limited && "text-error")}
			/>
			{points === undefined ? null : <span>{formatPlanShare(points)}</span>}
			<span className="sr-only">
				{points === undefined ? "" : planUsageText(points, ofSession)}
				{limited ? " · hit the usage limit" : ""}
			</span>
		</span>
	);
}
