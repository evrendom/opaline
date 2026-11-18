import { type Icon, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useSlidingPill } from "@/features/repos/pill-tabs";
import { useScrollFade } from "@/hooks/use-scroll-fade";
import { formatNumber, formatShortCount } from "@/lib/format";
import { cn } from "@/lib/utils";

export const TOGGLE =
	"text-muted-foreground active:not-aria-[haspopup]:translate-y-0 aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-(--custom-shadow) dark:aria-pressed:bg-muted-foreground/10";

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
			className="relative inline-flex shrink-0 items-center gap-0.5"
		>
			{pill ? (
				<span
					ref={pillRef}
					aria-hidden="true"
					skullet-ignore=""
					className="pointer-events-none absolute top-1/2 left-0 h-6 origin-left rounded-md bg-card shadow-(--custom-shadow) corner-squircle will-change-transform squircle:rounded-xl dark:bg-muted-foreground/10"
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
						"relative flex h-6 items-center gap-1 rounded-md text-xs font-medium transition-colors outline-none corner-squircle focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-45 squircle:rounded-xl",
						iconsOnly ? "px-1.5" : "px-2",
						id === value
							? "text-foreground"
							: "text-muted-foreground enabled:hover:text-foreground",
					)}
				>
					{Glyph ? <Glyph aria-hidden="true" className="size-3.5" /> : null}
					{iconsOnly ? null : word}
					{count === undefined ? null : (
						<span className="font-normal text-muted-foreground tabular-nums">
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
	"rounded-lg bg-card shadow-(--custom-shadow) corner-squircle squircle:rounded-3xl";

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
			className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted/70 py-0.5 pr-0.5 pl-2 text-sm font-medium"
			title={title}
		>
			<span className="min-w-0 truncate">{children}</span>
			{onClear ? (
				<button
					type="button"
					aria-label="Let go"
					onClick={onClear}
					className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
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
	return <span className="shrink-0 text-muted-foreground/50">›</span>;
}
