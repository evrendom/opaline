import type { Icon } from "@tabler/icons-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A row of tabs with one background pill that slides to the active tab, as
 * in Settings. `layoutId` must be unique per row on the page. */
export function PillTabs<T extends string>({
	tabs,
	value,
	onChange,
	label,
	layoutId,
	className,
	trailing,
}: {
	tabs: readonly { id: T; label: string; icon: Icon }[];
	value: T;
	onChange: (tab: T) => void;
	label: string;
	layoutId: string;
	className?: string;
	/** Controls at the row's right end. */
	trailing?: ReactNode;
}) {
	return (
		<div
			role="tablist"
			aria-label={label}
			className={cn(
				// The content background, as the page header has: the shell window
				// draws its edge as an inset ring, which a transparent row shows.
				"flex h-11 shrink-0 items-center gap-1 bg-[var(--dashboard-01-content-background)]",
				className,
			)}
		>
			{tabs.map(({ id, label: tabLabel, icon: TabIcon }) => {
				const active = id === value;
				return (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={active}
						onClick={() => onChange(id)}
						className={cn(
							"relative flex h-8 cursor-pointer items-center rounded-md px-2.5 text-sm font-medium outline-none corner-squircle squircle:rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--dashboard-01-metric-button-focus-ring)]",
							active
								? "text-foreground"
								: "text-muted-foreground hover:text-foreground hover:transition-colors",
						)}
					>
						{active ? (
							<motion.span
								layoutId={layoutId}
								initial={false}
								transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
								className="absolute inset-0 z-0 rounded-md bg-muted corner-squircle squircle:rounded-xl dark:bg-muted/50"
							/>
						) : null}
						<span className="relative z-10 flex items-center gap-1.5">
							<TabIcon aria-hidden="true" className="size-3.5" />
							{tabLabel}
						</span>
					</button>
				);
			})}
			{trailing ? (
				<div className="ml-auto flex min-w-0 items-center">{trailing}</div>
			) : null}
		</div>
	);
}
