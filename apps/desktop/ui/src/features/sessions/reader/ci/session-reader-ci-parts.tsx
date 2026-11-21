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
	["failed", "failed", "text-rose-ink"],
	["running", "running", "text-amber-ink"],
	["passed", "passed", "text-emerald-ink"],
	["cancelled", "cancelled", "text-ink-3"],
	["other", "other", "text-ink-3"],
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
				"inline-flex flex-wrap items-baseline gap-x-m",
				"text-body-s whitespace-nowrap tabular-nums",
				"text-ink-3",
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
