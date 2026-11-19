import { cn } from "@/lib/utils";
import type { CiVerdict } from "./session-reader-ci-model";

const whenFormatter = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	month: "short",
});

export function formatWhen(iso: string | null): string {
	const at = iso ? Date.parse(iso) : Number.NaN;
	return Number.isFinite(at) ? whenFormatter.format(at) : "—";
}

const VERDICT_PARTS = [
	["failed", "failed", "text-rose-600 dark:text-rose-400"],
	["running", "running", "text-amber-600 dark:text-amber-400"],
	["passed", "passed", "text-emerald-600 dark:text-emerald-400"],
	["cancelled", "cancelled", "text-muted-foreground"],
	["other", "other", "text-muted-foreground"],
] as const;

export function VerdictCounts({
	className,
	verdict,
}: {
	className?: string;
	verdict: CiVerdict;
}) {
	const parts = VERDICT_PARTS.filter(([key]) => verdict[key] > 0);
	return (
		<span
			className={cn(
				"inline-flex flex-wrap items-baseline gap-x-2 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums",
				className,
			)}
		>
			{parts.length === 0
				? "No CI"
				: parts.map(([key, label, tone]) => (
						<span key={key}>
							<span className={cn("font-medium", tone)}>{verdict[key]}</span>{" "}
							{label}
						</span>
					))}
		</span>
	);
}
