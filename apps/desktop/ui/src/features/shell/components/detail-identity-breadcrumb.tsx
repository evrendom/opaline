import { IconChevronRight } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface DetailIdentityItem {
	label: string;
	value: string;
	title?: string;
	mono?: boolean;
	onClick?: () => void;
}

export function DetailIdentityBreadcrumb({
	label,
	items,
}: {
	label: string;
	items: readonly DetailIdentityItem[];
}) {
	return (
		<nav aria-label={label} className="min-w-0 flex-1 overflow-hidden">
			<ol className="flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain whitespace-nowrap">
				{items.map((item, index) => {
					const current = index === items.length - 1;
					const className = cn(
						"max-w-80 truncate",
						current
							? "text-black/87.5 dark:text-white/90"
							: "text-black/[0.608] dark:text-white/60",
						item.mono && "tabular-nums",
					);
					return (
						<li
							key={item.label}
							className="flex min-w-0 shrink-0 items-center gap-1 text-[0.8125rem]/5 font-medium tracking-normal"
							title={`${item.label}: ${item.title ?? item.value}`}
						>
							{item.onClick ? (
								<button
									type="button"
									className={cn(
										className,
										"rounded-sm outline-none hover:text-foreground",
									)}
									onClick={item.onClick}
								>
									{item.value}
								</button>
							) : (
								<span
									aria-current={current ? "page" : undefined}
									className={className}
								>
									{item.value}
								</span>
							)}
							{!current ? (
								<IconChevronRight
									aria-hidden="true"
									className="size-4 shrink-0 text-[#ededed] dark:text-[#373737]"
								/>
							) : null}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
