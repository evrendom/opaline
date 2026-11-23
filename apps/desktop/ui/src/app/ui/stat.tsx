import type * as React from "react";

import { cn } from "@/lib/utils";

// A figure with its label: a total, a count, a cost. The label sits over the
// value in meta ink; the value is medium, with tabular figures so it doesn't
// jitter as it changes. A value that can't be computed passes `null` and
// shows an em dash in ink-3. Lay several out in a row or grid on a parent
// (a `dl` reads best: StatGroup renders one).
function StatGroup({ className, ...props }: React.ComponentProps<"dl">) {
	return (
		<dl
			data-slot="stat-group"
			className={cn("flex flex-wrap gap-x-xxl gap-y-l", className)}
			{...props}
		/>
	);
}

function Stat({
	className,
	label,
	value,
	unit,
}: {
	className?: string;
	label: React.ReactNode;
	value: React.ReactNode | null;
	/** A quiet suffix after the value: "/ day", "tokens". */
	unit?: React.ReactNode;
}) {
	return (
		<div
			data-slot="stat"
			className={cn("flex min-w-0 flex-col gap-xxs", className)}
		>
			<dt className="text-body-s text-ink-3">{label}</dt>
			<dd
				className={cn(
					"flex items-baseline gap-xs text-body-xl font-medium tracking-xs tabular-nums",
					value === null && "text-ink-3",
				)}
			>
				{value === null ? "—" : value}
				{unit && value !== null ? (
					<span className="text-body-m font-regular text-ink-3">{unit}</span>
				) : null}
			</dd>
		</div>
	);
}

export { Stat, StatGroup };
