import { type Icon, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useSlidingPill } from "@/features/repos/pill-tabs";
import { useScrollFade } from "@/hooks/use-scroll-fade";
import { formatNumber, formatShortCount } from "@/lib/format";
import { cn } from "@/lib/utils";

export const TOGGLE =
	"text-ink-3 active:not-aria-[haspopup]:translate-y-0 aria-pressed:bg-card aria-pressed:text-ink aria-pressed:shadow-(--shadow-card) dark:aria-pressed:bg-ink-3/10";

export function ViewToggle<View extends string>({
	iconsOnly = false,
	label,
	onPick,
	options,
	value,
}: {
	iconsOnly?: boolean;
	label: string;
	onPick: (view: View) => void;
	options: readonly {
		count?: number;
		icon?: Icon;
		id: View;
		label: string;
		off?: boolean;
	}[];
	value: View;
}) {
	const { pill, pillRef, row } = useSlidingPill<HTMLFieldSetElement>(value);
	return (
		<fieldset
			ref={row}
			aria-label={label}
			className="relative inline-flex shrink-0 items-center gap-xxs"
		>
			{pill ? (
				<span
					ref={pillRef}
					aria-hidden="true"
					skullet-ignore=""
					className="pointer-events-none absolute top-1/2 left-0 h-6 origin-left corner-s bg-card shadow-(--shadow-card) corner-squircle will-change-transform squircle:corner-l dark:bg-ink-3/10"
					style={{
						transform: `translate(${pill.left}px, -50%)`,
						width: pill.width,
					}}
				/>
			) : null}
			{options.map(({ count, icon: Glyph, id, label: word, off }) => (
				<button
					key={id}
					type="button"
					skullet-block=""
					aria-label={iconsOnly ? word : undefined}
					aria-pressed={id === value}
					data-pill-tab={id}
					title={iconsOnly ? word : undefined}
					disabled={off}
					onClick={() => onPick(id)}
					className={cn(
						"relative flex h-6 items-center gap-xs",
						"corner-s corner-squircle",
						"text-body-m font-medium",
						"transition-colors outline-none",
						"focus-visible:ring-2 focus-visible:ring-focus/50 disabled:cursor-default disabled:opacity-45 squircle:corner-l",
						iconsOnly ? "px-s" : "px-m",
						id === value ? "text-ink" : "text-ink-3 enabled:hover:text-ink",
					)}
				>
					{Glyph ? <Glyph aria-hidden="true" className="size-3.5" /> : null}
					{iconsOnly ? null : word}
					{count === undefined ? null : (
						<span className="font-regular text-ink-3 tabular-nums">
							<span aria-hidden="true">{formatShortCount(count)}</span>
							<span className="sr-only">{formatNumber(count)}</span>
						</span>
					)}
				</button>
			))}
		</fieldset>
	);
}

export const CARD =
	"corner-m bg-card shadow-(--shadow-card) corner-squircle squircle:corner-xl";

export function ScrollColumn({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	const { fade, ref } = useScrollFade<HTMLDivElement>();
	return (
		<div
			ref={ref}
			{...fade}
			data-lazy-root=""
			className={cn("scroll-fade min-h-0 flex-1 overflow-y-auto", className)}
		>
			{children}
		</div>
	);
}

export function Crumb({
	children,
	onClear,
	title,
}: {
	children: ReactNode;
	onClear?: () => void;
	title?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex min-w-0 items-center gap-xs",
				"corner-s py-xxs pr-xxs pl-m",
				"text-body-xl font-medium",
				"bg-field/70",
			)}
			title={title}
		>
			<span className="min-w-0 truncate">{children}</span>
			{onClear ? (
				<button
					type="button"
					aria-label="Let go"
					onClick={onClear}
					className="shrink-0 corner-xs p-xxs text-ink-3 hover:bg-hover hover:text-ink"
				>
					<IconX className="size-3" />
				</button>
			) : (
				<span className="w-1" />
			)}
		</span>
	);
}

export function CrumbSeparator() {
	return <span className="shrink-0 text-ink-3/50">›</span>;
}
