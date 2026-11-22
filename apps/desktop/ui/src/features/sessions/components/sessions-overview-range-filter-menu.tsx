import { SliderRangeInput } from "@/app/ui/slider-range-input";
import { formatSessionOverviewRangeValue } from "@/features/sessions/components/sessions-overview-filter-state";
import type {
	SessionOverviewRangeBounds,
	SessionOverviewRangeFilter,
	SessionOverviewRangeFilterValues,
} from "@/features/sessions/components/sessions-overview-table-utils";

type RangeBounds = {
	minimum: number;
	maximum: number;
	step: number;
};

export function SessionOverviewRangeFilterPanel({
	bounds,
	formatValue,
	label,
	onChange,
	onInteractionEnd,
	onInteractionStart,
	value,
	variant = "default",
}: {
	bounds: RangeBounds;
	formatValue: (value: number) => string;
	label: string;
	onChange: (value: SessionOverviewRangeFilter) => void;
	onInteractionEnd?: () => void;
	onInteractionStart?: () => void;
	value: SessionOverviewRangeFilter;
	variant?: "default" | "linear";
}) {
	const boundedMinimum = clamp(
		value.minimum ?? bounds.minimum,
		bounds.minimum,
		bounds.maximum,
	);
	const boundedMaximum = clamp(
		value.maximum ?? bounds.maximum,
		bounds.minimum,
		bounds.maximum,
	);
	const effectiveMinimum = Math.min(boundedMinimum, boundedMaximum);
	const effectiveMaximum = Math.max(boundedMinimum, boundedMaximum);
	const isDisabled = bounds.minimum === bounds.maximum;

	function setRange([nextMinimum, nextMaximum]: readonly [number, number]) {
		setMinimumAndMaximum(nextMinimum, nextMaximum);
	}

	function setMinimumAndMaximum(nextMinimum: number, nextMaximum: number) {
		const constrainedMinimum = clamp(nextMinimum, bounds.minimum, nextMaximum);
		const constrainedMaximum = clamp(
			nextMaximum,
			constrainedMinimum,
			bounds.maximum,
		);
		onChange({
			maximum: constrainedMaximum >= bounds.maximum ? null : constrainedMaximum,
			minimum: constrainedMinimum <= bounds.minimum ? null : constrainedMinimum,
		});
	}

	return (
		<div
			className={
				variant === "linear"
					? "min-h-0 flex-1 px-m pt-[calc(var(--space-m)+var(--space-xxs))] pb-m [--slider-range-card-inset:0.5rem] [--slider-range-card-radius:var(--radius-l)] [--session-range-slider-background:var(--inset)] dark:[--session-range-slider-background:var(--hover-strong)]"
					: "px-m pt-l pb-m [--slider-range-card-inset:0.5rem] [--slider-range-card-radius:var(--radius-l)] [--session-range-slider-background:var(--field)] dark:[--session-range-slider-background:var(--hover-strong)]"
			}
		>
			<SliderRangeInput
				disabled={isDisabled}
				formatValue={formatValue}
				max={bounds.maximum}
				maximumAriaLabel={`Maximum ${label}`}
				min={bounds.minimum}
				minimumAriaLabel={`Minimum ${label}`}
				onChange={setRange}
				onCommit={setRange}
				onInteractionEnd={onInteractionEnd}
				onInteractionStart={onInteractionStart}
				progressOverlay="color-mix(in srgb, var(--ink, var(--accent, #000)) 18%, transparent)"
				step={bounds.step}
				trackBackground="var(--session-range-slider-background)"
				value={[effectiveMinimum, effectiveMaximum]}
			/>
		</div>
	);
}

export function SessionOverviewTokenRangeFilterPanel({
	onChange,
	onInteractionEnd,
	onInteractionStart,
	rangeFilterBounds,
	rangeFilterValues,
	variant = "default",
}: {
	onChange: (
		filterKey: "input" | "output",
		value: SessionOverviewRangeFilter,
	) => void;
	onInteractionEnd?: () => void;
	onInteractionStart?: () => void;
	rangeFilterBounds: SessionOverviewRangeBounds;
	rangeFilterValues: SessionOverviewRangeFilterValues;
	variant?: "default" | "linear";
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col py-s">
			{(["input", "output"] as const).map((filterKey) => {
				const label = filterKey === "input" ? "Input tokens" : "Output tokens";

				return (
					<section
						key={filterKey}
						aria-label={label}
						className="min-h-0 flex-1"
					>
						<div className="px-l pt-s text-body-s font-medium tracking-l text-ink-3">
							{label}
						</div>
						<SessionOverviewRangeFilterPanel
							bounds={rangeFilterBounds[filterKey]}
							formatValue={(value) =>
								formatSessionOverviewRangeValue(filterKey, value)
							}
							label={label}
							onChange={(value) => onChange(filterKey, value)}
							onInteractionEnd={onInteractionEnd}
							onInteractionStart={onInteractionStart}
							value={rangeFilterValues[filterKey]}
							variant={variant}
						/>
					</section>
				);
			})}
		</div>
	);
}

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(Math.max(value, minimum), maximum);
}
