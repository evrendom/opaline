import { IconCheck, IconSearch } from "@tabler/icons-react";
import { useId, useState } from "react";
import { Checkbox } from "@/app/ui/checkbox";
import { FluidMenuHover } from "@/app/ui/fluid-menu-hover";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/app/ui/input-group";
import type { SessionOverviewFilterOption } from "@/features/sessions/components/sessions-overview-table-utils";

export function SessionOverviewFilterOptionsPanel({
	excludedValues,
	label,
	onOptionChecked,
	options,
	variant = "default",
}: {
	excludedValues: ReadonlySet<string>;
	label: string;
	onOptionChecked: (value: string, checked: boolean) => void;
	options: readonly SessionOverviewFilterOption[];
	variant?: "default" | "linear" | "linear-side";
}) {
	const [searchQuery, setSearchQuery] = useState("");
	const controlId = useId();
	const canSearch = variant === "default" && options.length > 8;
	const normalizedSearchQuery = canSearch
		? searchQuery.trim().toLocaleLowerCase()
		: "";
	const visibleOptions = options.filter(
		(option) =>
			normalizedSearchQuery.length === 0 ||
			option.label.toLocaleLowerCase().includes(normalizedSearchQuery) ||
			option.value.toLocaleLowerCase().includes(normalizedSearchQuery),
	);
	const selectedOptionCount = options.reduce(
		(count, option) => count + (excludedValues.has(option.value) ? 0 : 1),
		0,
	);

	return (
		<>
			{canSearch ? (
				<div className="relative edge-b-m border-line p-m">
					<label className="sr-only" htmlFor={`${controlId}-search`}>
						{`Search ${label.toLocaleLowerCase()}`}
					</label>
					<InputGroup>
						<InputGroupAddon>
							<IconSearch aria-hidden="true" className="size-4 text-ink-3" />
						</InputGroupAddon>
						<InputGroupInput
							id={`${controlId}-search`}
							type="text"
							name={`${controlId}-search`}
							placeholder={`Search ${label.toLocaleLowerCase()}`}
							value={searchQuery}
							onChange={(event) => setSearchQuery(event.target.value)}
						/>
					</InputGroup>
				</div>
			) : null}
			<div
				className={
					variant !== "default"
						? "menu-list"
						: "max-h-72 overflow-y-auto overscroll-contain p-s"
				}
				data-session-filter-scroll-region="true"
				data-fluid-menu-root=""
			>
				<FluidMenuHover items="label[for]" />
				{visibleOptions.length > 0 ? (
					visibleOptions.map((option, optionIndex) => {
						const optionId = `${controlId}-option-${optionIndex}`;
						const isChecked = !excludedValues.has(option.value);

						return variant !== "default" ? (
							<label
								key={option.value}
								htmlFor={optionId}
								className="menu-row"
								title={option.value}
							>
								<Checkbox
									id={optionId}
									checked={isChecked}
									className="sr-only"
									name={optionId}
									onCheckedChange={(checked) =>
										onOptionChecked(option.value, Boolean(checked))
									}
								/>
								{variant === "linear-side" ? (
									<span className="menu-check-slot" aria-hidden="true">
										<span className="menu-checkbox" data-checked={isChecked}>
											{isChecked ? (
												<IconCheck aria-hidden="true" className="size-2.5" />
											) : null}
										</span>
									</span>
								) : null}
								<span className="min-w-0 flex-1 truncate">{option.label}</span>
								{variant === "linear" && isChecked ? (
									<IconCheck
										aria-hidden="true"
										className="size-3.5 shrink-0 text-ink"
									/>
								) : null}
							</label>
						) : (
							<label
								key={option.value}
								htmlFor={optionId}
								className="flex min-h-9 items-center gap-l corner-m px-l py-s text-body-xl font-medium focus-outline hover:bg-hover hover:text-ink"
								title={option.value}
							>
								<Checkbox
									id={optionId}
									checked={isChecked}
									onCheckedChange={(checked) =>
										onOptionChecked(option.value, Boolean(checked))
									}
								/>
								<span className="min-w-0 truncate">{option.label}</span>
							</label>
						);
					})
				) : (
					<p className="px-l py-xxl text-center text-body-xl text-ink-3">
						No options found.
					</p>
				)}
			</div>
			{variant === "default" ? (
				<div className="edge-t-m border-line px-l py-m text-body-m tabular-nums text-ink-3">
					{selectedOptionCount.toLocaleString()} of{" "}
					{options.length.toLocaleString()} selected
				</div>
			) : null}
		</>
	);
}
