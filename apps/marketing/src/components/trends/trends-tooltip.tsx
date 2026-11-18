import {
	type CSSProperties,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import type { TrendsProvider } from "../../trends/trends-snapshot";
import { ProviderMark } from "./trends-marks";

export interface TooltipRow {
	readonly label: string;
	readonly value: string;
	readonly color?: string;
	/** The plot axis this row reads, so a comparison can set it against
	 * another point's. */
	readonly axis?: "horizontal" | "vertical";
}

export interface TooltipContent {
	readonly sourceUrl?: string;
	readonly title: string;
	/** Shown as a provider mark before the title. */
	readonly provider?: TrendsProvider;
	readonly rows: readonly TooltipRow[];
}

interface TooltipState extends TooltipContent {
	readonly cancelHide: () => void;
	readonly hide: () => void;
	readonly left: number;
	readonly top: number;
	readonly align: "start" | "center" | "end";
}

export function useChartTooltip<
	Element extends HTMLElement = HTMLDivElement,
>() {
	const containerRef = useRef<Element>(null);
	const [tooltip, setTooltip] = useState<TooltipState | null>(null);
	const tooltipId = useId();
	const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
	const cancelHide = useCallback(() => {
		if (hideTimeout.current !== null) clearTimeout(hideTimeout.current);
	}, []);
	const hide = useCallback(() => {
		cancelHide();
		hideTimeout.current = setTimeout(() => setTooltip(null), 250);
	}, [cancelHide]);
	useEffect(() => cancelHide, [cancelHide]);

	const showAt = useCallback(
		(clientX: number, clientY: number, content: TooltipContent) => {
			cancelHide();
			const container = containerRef.current;
			if (!container) return;
			const rect = container.getBoundingClientRect();
			const left = clientX - rect.left;
			const ratio = rect.width > 0 ? left / rect.width : 0.5;
			setTooltip({
				...content,
				cancelHide,
				hide,
				left,
				top: clientY - rect.top,
				align: ratio < 0.25 ? "start" : ratio > 0.75 ? "end" : "center",
			});
		},
		[cancelHide, hide],
	);

	const showFor = useCallback(
		(element: HTMLElement | SVGElement, content: TooltipContent) => {
			const rect = element.getBoundingClientRect();
			showAt(rect.left + rect.width / 2, rect.top, content);
		},
		[showAt],
	);

	return { containerRef, tooltip, tooltipId, showAt, showFor, hide };
}

export function ChartTooltip({
	tooltip,
	id,
}: {
	tooltip: TooltipState | null;
	id?: string;
}) {
	if (!tooltip) return null;
	return (
		<div
			id={id}
			className="trends-tooltip"
			data-align={tooltip.align}
			style={
				{
					"--tooltip-left": `${tooltip.left}px`,
					"--tooltip-top": `${tooltip.top}px`,
				} as CSSProperties
			}
			role="tooltip"
			onPointerEnter={tooltip.cancelHide}
			onPointerLeave={tooltip.hide}
			onFocus={tooltip.cancelHide}
			onBlur={tooltip.hide}
		>
			<p className="trends-tooltip-title">
				{tooltip.provider ? <ProviderMark provider={tooltip.provider} /> : null}
				{tooltip.title}
			</p>
			<dl className="trends-tooltip-rows">
				{tooltip.rows.map((row) => (
					<div key={row.label} className="trends-tooltip-row">
						<dt>
							{row.color ? (
								<span
									className="trends-tooltip-key"
									style={{ "--key-color": row.color } as CSSProperties}
									aria-hidden="true"
								/>
							) : null}
							{row.label}
						</dt>
						<dd>{row.value}</dd>
					</div>
				))}
			</dl>
			{tooltip.sourceUrl ? (
				<a
					className="trends-table-link"
					href={tooltip.sourceUrl}
					target="_blank"
					rel="noreferrer"
				>
					View source ↗
				</a>
			) : null}
		</div>
	);
}

/** Shift, Cmd or Ctrl: add to the focused models instead of replacing them. */
export function isAdditive(event: {
	readonly shiftKey: boolean;
	readonly metaKey: boolean;
	readonly ctrlKey: boolean;
}) {
	return event.shiftKey || event.metaKey || event.ctrlKey;
}
