import NumberFlow, {
	type Format,
	NumberFlowGroup,
	type Trend,
} from "@number-flow/react";
import { useEffect, useMemo, useState } from "react";
import { type Figure, figureLocale } from "@/lib/figure";
import { cn } from "@/lib/utils";

const COUNT_TIMING = {
	duration: 1100,
	easing: "cubic-bezier(0.25, 1, 0.5, 1)",
} as const;

type CountPhase = "zero" | "counting" | "done";

function integerDigits(
	value: number,
	format: Format | undefined,
	locales: Intl.LocalesArgument,
) {
	const digits = new Intl.NumberFormat(locales, format)
		.formatToParts(Math.abs(value))
		.filter((part) => part.type === "integer")
		.reduce((sum, part) => sum + part.value.length, 0);
	return Math.min(Math.max(digits, 1), 21);
}

export function FlowNumber({
	value,
	format,
	prefix,
	suffix,
	trend,
	countUp = false,
	visitorLocale = false,
	className,
}: {
	value: number;
	format?: Format;
	prefix?: string;
	suffix?: string;
	trend?: Trend;
	countUp?: boolean;
	visitorLocale?: boolean;
	className?: string;
}) {
	const locales = figureLocale({ visitorLocale });
	const [phase, setPhase] = useState<CountPhase>(countUp ? "zero" : "done");
	useEffect(() => {
		if (phase === "zero") {
			const frame = requestAnimationFrame(() => setPhase("counting"));
			return () => cancelAnimationFrame(frame);
		}
		if (phase === "counting") {
			const timer = setTimeout(
				() => setPhase("done"),
				COUNT_TIMING.duration + 100,
			);
			return () => clearTimeout(timer);
		}
	}, [phase]);
	const counting = phase !== "done";
	const shownFormat = useMemo(
		() =>
			counting
				? {
						...format,
						minimumIntegerDigits: integerDigits(value, format, locales),
					}
				: format,
		[counting, format, value, locales],
	);
	return (
		<NumberFlow
			className={cn("tabular-nums", className)}
			value={phase === "zero" ? 0 : value}
			format={shownFormat}
			prefix={prefix}
			suffix={suffix}
			locales={locales}
			trend={trend}
			spinTiming={phase === "counting" ? COUNT_TIMING : undefined}
		/>
	);
}

function keyed(figure: Figure) {
	let numbers = 0;
	let texts = 0;
	return figure.map((part) => ({
		part,
		key: typeof part === "string" ? `text-${texts++}` : `number-${numbers++}`,
	}));
}

export function FlowFigure({
	figure,
	trend,
	countUp,
	className,
}: {
	figure: Figure;
	trend?: Trend;
	countUp?: boolean;
	className?: string;
}) {
	return (
		<span className={cn("whitespace-pre", className)}>
			<NumberFlowGroup>
				{keyed(figure).map(({ part, key }) =>
					typeof part === "string" ? (
						<span key={key}>{part}</span>
					) : (
						<FlowNumber
							key={key}
							value={part.value}
							format={part.format}
							prefix={part.prefix}
							suffix={part.suffix}
							visitorLocale={part.visitorLocale}
							trend={trend}
							countUp={countUp}
						/>
					),
				)}
			</NumberFlowGroup>
		</span>
	);
}
