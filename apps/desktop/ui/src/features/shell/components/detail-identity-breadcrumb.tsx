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
			<ol className="flex min-w-0 items-center gap-xs overflow-x-auto overscroll-x-contain whitespace-nowrap">
				{items.map((item, index) => {
					const current = index === items.length - 1;
					const className = cn(
						"max-w-80 truncate",
						current
							? // design-escape-ok(base): no role renders this; neutral-10 at 87.5% in light
								"text-neutral-10/87.5 dark:text-ink"
							: "text-ink-3",
						item.mono && "tabular-nums",
					);
					return (
						<li
							key={item.label}
							className={cn(
								"flex min-w-0 shrink-0 items-center gap-xs",
								"font-medium tracking-m",
								"text-body-l",
							)}
							title={`${item.label}: ${item.title ?? item.value}`}
						>
							{item.onClick ? (
								<button
									type="button"
									className={cn(
										className,
										"corner-xs focus-outline hover:text-ink",
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
									// design-escape-ok(colour): shipped value; #ededed, #373737 in dark
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
