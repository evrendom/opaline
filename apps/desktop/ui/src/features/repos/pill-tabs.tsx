import type { Icon } from "@tabler/icons-react";
import {
	type ReactNode,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";

type PillBox = { left: number; width: number };

export function PillTabs<T extends string>({
	tabs,
	value,
	onChange,
	label,
	className,
	pillClassName,
	trailing,
}: {
	tabs: readonly {
		activeIcon?: Icon;
		empty?: boolean;
		id: T;
		label: string;
		icon: Icon;
	}[];
	value: T;
	onChange: (tab: T) => void;
	label: string;
	className?: string;
	/** Controls at the row's right end. */
	trailing?: ReactNode;
	pillClassName?: string;
}) {
	const [clicked, setClicked] = useState<{ from: T; to: T } | null>(null);
	if (clicked && clicked.from !== value) setClicked(null);
	const shown = clicked && clicked.from === value ? clicked.to : value;

	const { pill, pillRef, row } = useSlidingPill<HTMLDivElement>(shown);

	return (
		<div
			ref={row}
			role="tablist"
			aria-label={label}
			className={cn(
				// The content background, as the page header has: the shell window
				// draws its edge as an inset ring, which a transparent row shows.
				"relative flex h-11 shrink-0 items-center gap-xs bg-[var(--canvas)]",
				className,
			)}
		>
			{pill ? (
				<span
					ref={pillRef}
					aria-hidden="true"
					className={cn(
						"absolute top-1/2 left-0 h-8",
						"corner-s corner-squircle",
						"pointer-events-none origin-left bg-field will-change-transform",
						"squircle:corner-l",
						pillClassName,
					)}
					style={{
						transform: `translate(${pill.left}px, -50%)`,
						width: pill.width,
					}}
				/>
			) : null}
			{tabs.map(({ activeIcon, empty, id, label: tabLabel, icon }) => {
				const active = id === shown;
				const TabIcon = active && activeIcon ? activeIcon : icon;
				return (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={active}
						data-pill-tab={id}
						onClick={() => {
							setClicked({ from: value, to: id });
							onChange(id);
						}}
						className={cn(
							"relative flex h-8 items-center",
							"corner-s px-[calc(var(--space-m)+var(--space-xxs))] corner-squircle",
							"text-body-xl font-medium",
							"transition-colors focus-outline",
							"squircle:corner-l",
							active && !pill && cn("bg-field", pillClassName),
							active
								? empty
									? "text-ink-3"
									: "text-ink"
								: empty
									? "text-ink-4 hover:text-ink-3"
									: "text-ink-3 hover:text-ink",
						)}
					>
						<span className="flex items-center gap-s">
							<TabIcon aria-hidden="true" className="size-3.5" />
							{tabLabel}
						</span>
					</button>
				);
			})}
			{trailing ? (
				<div className="ml-auto flex min-w-0 items-center">{trailing}</div>
			) : null}
		</div>
	);
}

const SLIDE_EASING = "cubic-bezier(0.32,0.72,0,1)";

type Slide = { animation: Animation; from: PillBox; to: PillBox };

function pillTransform(box: PillBox, width: number) {
	return `translate(${box.left}px, -50%) scaleX(${box.width / width})`;
}

function boxOnScreen(slide: Slide | null, placed: PillBox): PillBox {
	const progress = slide?.animation.effect?.getComputedTiming().progress;
	if (!slide || progress == null) return placed;
	const along = (from: number, to: number) => from + (to - from) * progress;
	return {
		left: along(slide.from.left, slide.to.left),
		width: along(slide.from.width, slide.to.width),
	};
}

export function useSlidingPill<T extends HTMLElement>(shown: string) {
	const row = useRef<T>(null);
	const pillRef = useRef<HTMLSpanElement>(null);
	const [pill, setPill] = useState<PillBox | null>(null);
	const placed = useRef<PillBox | null>(null);
	const slide = useRef<Slide | null>(null);
	const measure = useCallback(() => {
		const tab = row.current?.querySelector<HTMLElement>(
			`[data-pill-tab="${CSS.escape(shown)}"]`,
		);
		if (!tab) return;
		const next = { left: tab.offsetLeft, width: tab.offsetWidth };
		setPill((last) =>
			last && last.left === next.left && last.width === next.width
				? last
				: next,
		);
	}, [shown]);
	useLayoutEffect(() => {
		measure();
		const element = row.current;
		if (!element) return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [measure]);
	useLayoutEffect(() => {
		const element = pillRef.current;
		const last = placed.current;
		placed.current = pill;
		if (!element || !pill || !last) return;
		const from = boxOnScreen(slide.current, last);
		slide.current?.animation.cancel();
		slide.current = null;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const animation = element.animate(
			[
				{ transform: pillTransform(from, pill.width) },
				{ transform: pillTransform(pill, pill.width) },
			],
			{ duration: 200, easing: SLIDE_EASING },
		);
		slide.current = { animation, from, to: pill };
	}, [pill]);
	return { pill, pillRef, row };
}
