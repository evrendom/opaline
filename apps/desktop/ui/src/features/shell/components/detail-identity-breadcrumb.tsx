import { IconChevronRight } from "@tabler/icons-react";
import { Pressable } from "@/app/ui/pressable";
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
						current ? "text-ink" : "text-ink-3",
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
								<Pressable
									className={cn(className, "corner-xs hover:text-ink")}
									onClick={item.onClick}
								>
									{item.value}
								</Pressable>
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
									className="size-4 shrink-0 text-line"
								/>
							) : null}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
