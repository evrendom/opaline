import {
	type Icon,
	IconChevronRight,
	IconFilterEdit,
} from "@tabler/icons-react";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";

type LinearFilterItem = {
	group: "identity" | "usage" | "activity";
	icon: Icon;
	key: string;
	label: string;
};

export function LinearActiveFiltersButton({
	count,
	onClick,
}: {
	count: number;
	onClick: () => void;
}) {
	const label = `Review ${count.toLocaleString()} active session ${count === 1 ? "filter" : "filters"}`;

	return (
		<button
			type="button"
			aria-label={label}
			className="relative flex size-7 shrink-0 items-center justify-center rounded-md text-black outline-none hover:bg-[#ececed] focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-black dark:text-[#f4f4f5] dark:hover:bg-white/8"
			onClick={onClick}
			title={label}
		>
			<IconFilterEdit aria-hidden="true" className="size-4" />
			<span
				aria-hidden="true"
				className="absolute top-1 right-1 size-1.5 rounded-full bg-black ring-1 ring-[#fcfcfc] dark:bg-[#f4f4f5] dark:ring-[#1c1c1d]"
			/>
		</button>
	);
}

export function LinearFilterList<TFilter extends LinearFilterItem>({
	activeFilterKey,
	filters,
	getFilterSummary,
	isFilterActive,
	onActivate,
}: {
	activeFilterKey: string | null;
	filters: readonly TFilter[];
	getFilterSummary: (filter: TFilter) => string | null;
	isFilterActive: (filter: TFilter) => boolean;
	onActivate: (filterKey: TFilter["key"], row: HTMLButtonElement) => void;
}) {
	if (filters.length === 0) {
		return <p className="session-menu-empty">No matching filters</p>;
	}

	return (
		<div
			className="session-menu-list"
			data-session-filter-scroll-region="true"
			data-fluid-menu-root=""
		>
			<FluidMenuHover />
			<ul>
				{filters.map((filter, index) => {
					const previousFilter = filters[index - 1];
					const showSeparator =
						previousFilter !== undefined &&
						previousFilter.group !== filter.group;
					const isActive = isFilterActive(filter);
					const isPreviewed = activeFilterKey === filter.key;
					const summary = getFilterSummary(filter);

					return (
						<li key={filter.key}>
							{showSeparator ? (
								<div aria-hidden="true" className="session-menu-separator" />
							) : null}
							<button
								type="button"
								aria-label={`Configure ${filter.label} filter`}
								className="session-menu-row"
								data-active={isActive ? "true" : undefined}
								data-previewed={isPreviewed ? "true" : undefined}
								aria-expanded={isPreviewed}
								aria-haspopup="dialog"
								title={summary ?? undefined}
								onClick={(event) => onActivate(filter.key, event.currentTarget)}
								onFocus={(event) => onActivate(filter.key, event.currentTarget)}
								onMouseEnter={(event) =>
									onActivate(filter.key, event.currentTarget)
								}
							>
								<span className="session-menu-icon flex size-4 items-center justify-center">
									<filter.icon aria-hidden="true" className="size-4" />
								</span>
								<span className="min-w-0 flex-1 truncate">{filter.label}</span>
								{isActive ? (
									<span
										aria-hidden="true"
										className="session-menu-active-dot"
									/>
								) : null}
								<IconChevronRight
									aria-hidden="true"
									className="session-menu-icon size-3"
									stroke={2.25}
								/>
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
