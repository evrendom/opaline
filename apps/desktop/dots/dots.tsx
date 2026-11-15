import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { pebbleMasks } from "@/features/costs/cost-dot-pebble";
import {
	createHoverDateStore,
	HoverDateContext,
	type HoverDateStore,
} from "@/features/costs/cost-hover-date";
import { RollingText } from "@/features/costs/cost-rolling-text";
import { CostDotChart } from "./chart";

type Props = Parameters<typeof CostDotChart>[0];

type Mounted = {
	update: (props: Props) => void;
	focus: (date: string | null) => void;
	unmount: () => void;
};

declare global {
	interface Window {
		opalineDots: {
			mount: (element: HTMLElement, props: Props, onHover?: (date: string | null) => void) => Mounted;
			pebbles: (size: number) => Record<string, string>;
			rolling: (element: HTMLElement) => { set: (text: string) => void };
		};
	}
}

type Placed = { date: string; left: number; top: number; size: number; ink: string };

const READABLE_SPLIT = 0.58;

function inkFor(color: string, dot: HTMLElement) {
	const [lightness = 0.7, , hue = 0] = (color.match(/[\d.]+/g) ?? []).map(Number);
	const dark = document.documentElement.dataset.theme !== "light";
	const surface = dark ? 0.17 : 0.99;
	const level = dot.hasAttribute("data-muted") || dot.hasAttribute("data-empty")
		? 0.06
		: Number(dot.style.getPropertyValue("--dot-level") || 1);
	const seen = surface + (lightness - surface) * level;
	return seen > READABLE_SPLIT ? `oklch(0.24 0.045 ${hue})` : `oklch(0.97 0.014 ${hue})`;
}

const dayIndex = (from: string, date: string) =>
	Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function monthAndDay(date: string) {
	const day = new Date(`${date}T00:00:00Z`);
	return {
		month: day.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
		day: String(day.getUTCDate()),
	};
}

function DayLabels({
	element,
	color,
	first,
	last,
	hover,
}: {
	element: HTMLElement;
	color: string;
	first: string | undefined;
	last: string | undefined;
	hover: HoverDateStore;
}) {
	const active = useSyncExternalStore(hover.subscribe, hover.get, () => null);
	const [placed, setPlaced] = useState<Placed[]>([]);
	const shown = new Set(active ? [active] : [first, last]);
	useLayoutEffect(() => {
		if (!first) return;
		let frame = 0;
		const measure = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const base = element.getBoundingClientRect();
				const dots = element.querySelectorAll<HTMLElement>(".cost-dot");
				const head = dots[0]?.getBoundingClientRect();
				const tail = dots[dots.length - 1]?.getBoundingClientRect();
				if (head && tail) {
					const was = Number.parseFloat(element.style.getPropertyValue("--band-shift") || "0");
					const shift = was - (head.left - base.left - (base.right - tail.right)) / 2;
					if (Math.abs(shift - was) > 0.25) {
						element.style.setProperty("--band-shift", `${shift}px`);
						measure();
						return;
					}
				}
				const until = last ? dayIndex(first, last) : dots.length - 1;
				setPlaced(
					[...dots].slice(0, until + 1).map((dot, index) => {
						const rect = dot.getBoundingClientRect();
						const day = new Date(`${first}T00:00:00Z`);
						day.setUTCDate(day.getUTCDate() + index);
						return {
							date: day.toISOString().slice(0, 10),
							left: rect.left - base.left,
							top: rect.top - base.top,
							size: rect.width,
							ink: inkFor(color, dot),
						};
					}),
				);
			});
		};
		measure();
		const resize = new ResizeObserver(measure);
		resize.observe(element);
		const chart = element.querySelector(".cost-dot-chart");
		const mutations = new MutationObserver(measure);
		if (chart) mutations.observe(chart, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "data-muted", "data-empty"] });
		return () => {
			cancelAnimationFrame(frame);
			resize.disconnect();
			mutations.disconnect();
		};
	}, [element, color, first, last]);
	return (
		<div className="dot-days" aria-hidden="true">
			{placed.map((each) => {
				const { month, day } = monthAndDay(each.date);
				return (
					<span
						key={each.date}
						className="dot-day"
						data-shown={shown.has(each.date) || undefined}
						style={{ left: each.left, top: each.top, width: each.size, height: each.size, color: each.ink }}
					>
						<small>{month}</small>
						{day}
					</span>
				);
			})}
		</div>
	);
}

window.opalineDots = {
	pebbles: (size) => pebbleMasks(size) as Record<string, string>,
	rolling(element) {
		const root = createRoot(element);
		return { set: (text) => root.render(<RollingText text={text} />) };
	},
	mount(element, props, onHover) {
		const root = createRoot(element);
		const hover = createHoverDateStore();
		const stop = onHover ? hover.subscribe(() => onHover(hover.get())) : () => {};
		let current = props;
		let focused: string | null = null;
		const draw = () =>
			root.render(
				<HoverDateContext.Provider value={hover}>
					<CostDotChart {...current} />
					<DayLabels
						element={element}
						color={current.color}
						first={current.points[0]?.date}
						last={current.points.at(-1)?.date}
						hover={hover}
					/>
				</HoverDateContext.Provider>,
			);
		draw();
		return {
			update(next) {
				current = next;
				draw();
			},
			focus(date) {
				if (date === focused) return;
				focused = date;
				const grid = element.querySelector<HTMLElement>("button.cost-dot-grid");
				const first = current.points[0]?.date;
				if (!grid || !first) return;
				if (date === null) {
					grid.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: element, pointerType: "mouse" }));
					return;
				}
				const dot = element.querySelectorAll<HTMLElement>(".cost-dot")[dayIndex(first, date)];
				if (!dot) return;
				const rect = dot.getBoundingClientRect();
				const at = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
				grid.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: element, pointerType: "mouse", ...at }));
				grid.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", ...at }));
			},
			unmount() {
				stop();
				root.unmount();
			},
		};
	},
};
