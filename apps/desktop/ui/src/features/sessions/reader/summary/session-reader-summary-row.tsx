import { IconCircleXFilled } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { OpalChip } from "../detail/waterfall/session-reader-waterfall-chips";

export function ErrorChip({ quiet = false }: { quiet?: boolean }) {
	const tint = quiet ? "var(--color-slate-400)" : "var(--color-rose-500)";
	return (
		<OpalChip solid tint={tint} className="size-4">
			<IconCircleXFilled
				aria-hidden="true"
				className="size-2.5"
				style={{ color: tint }}
			/>
		</OpalChip>
	);
}

export const ROW_GRID =
	"grid min-w-0 grid-cols-[minmax(0,13rem)_minmax(0,1fr)] items-start gap-4 py-2.5 text-[13px] first:pt-0 last:pb-0";

export function Row({
	children,
	chip,
	label,
	reasons,
}: {
	children?: ReactNode;
	chip: ReactNode;
	label: string;
	reasons: readonly ReactNode[];
}) {
	return (
		<li className={ROW_GRID}>
			<span className="flex h-6 min-w-0 items-center gap-2.5">
				<span className="flex shrink-0">{chip}</span>
				<span className="truncate font-medium">{label}</span>
			</span>
			<span className="flex min-w-0 flex-col gap-1.5">
				{reasons.length > 0 ? (
					<span className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
						{reasons.map((reason, index) => (
							<span
								key={typeof reason === "string" ? reason : index}
								className="text-xs text-muted-foreground tabular-nums"
							>
								{reason}
							</span>
						))}
					</span>
				) : null}
				{children}
			</span>
		</li>
	);
}
