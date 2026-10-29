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

	const { pill, row, slides } = useSlidingPill<HTMLDivElement>(shown);

	return (
		<div
			ref={row}
			role="tablist"
			aria-label={label}
			className={cn(
				// The content background, as the page header has: the shell window
				// draws its edge as an inset ring, which a transparent row shows.
				"relative flex h-11 shrink-0 items-center gap-1 bg-[var(--dashboard-01-content-background)]",
				className,
			)}
		>
			{pill ? (
				<span
					aria-hidden="true"
					className={cn(
						"pointer-events-none absolute top-1/2 left-0 h-8 rounded-md bg-muted corner-squircle squircle:rounded-xl will-change-transform dark:bg-muted/50",
						slides &&
							"transition-[transform,width] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
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
							"relative flex h-8 cursor-pointer items-center rounded-md px-2.5 text-sm font-medium transition-colors outline-none corner-squircle squircle:rounded-xl",
							active
								? empty
									? "text-foreground/45"
									: "text-foreground"
								: empty
									? "text-muted-foreground/45 hover:text-muted-foreground"
									: "text-muted-foreground hover:text-foreground",
						)}
					>
						<span className="flex items-center gap-1.5">
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

export function useSlidingPill<T extends HTMLElement>(shown: string) {
	const row = useRef<T>(null);
	const [pill, setPill] = useState<PillBox | null>(null);
	const [pastFirstPlacement, setPastFirstPlacement] = useState(false);
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
		if (pill && !pastFirstPlacement) {
			const frame = requestAnimationFrame(() => setPastFirstPlacement(true));
			return () => cancelAnimationFrame(frame);
		}
	}, [pill, pastFirstPlacement]);
	return { pill, row, slides: pastFirstPlacement };
}
