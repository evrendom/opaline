import { IconCheck } from "@tabler/icons-react";
import { useId } from "react";
import { FluidMenuHover } from "@/app/ui/fluid-menu-hover";
import { CHART_INTERVALS, type ChartInterval } from "./chart-interval";

export function ChartIntervalPicker({
	value,
	onChange,
}: {
	value: ChartInterval;
	onChange: (interval: ChartInterval) => void;
}) {
	const id = useId();
	return (
		<fieldset className="cost-chart-interval">
			<legend className="sr-only">Chart interval</legend>
			<div data-fluid-menu-root="" className="menu-list">
				<FluidMenuHover />
				{CHART_INTERVALS.map((option) => (
					<label
						key={option.value}
						htmlFor={`${id}-${option.value}`}
						className="menu-row"
					>
						{/* design-escape-ok(element): native; the visually hidden radio the menu row's label drives, no radio primitive */}
						<input
							id={`${id}-${option.value}`}
							name={`${id}-interval`}
							type="radio"
							value={option.value}
							checked={value === option.value}
							onChange={() => onChange(option.value)}
							className="sr-only"
						/>
						<IconCheck
							aria-hidden="true"
							className="menu-icon size-3.5 shrink-0"
						/>
						{option.label}
					</label>
				))}
			</div>
		</fieldset>
	);
}
