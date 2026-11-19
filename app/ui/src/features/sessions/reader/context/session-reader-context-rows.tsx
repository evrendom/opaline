import type { ReactNode } from "react";
import { formatShareOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OpalChip } from "../detail/waterfall/session-reader-waterfall-chips";
import { rowState } from "../detail/waterfall/session-reader-waterfall-layout";
import { TINT, tileGlyph, tileLook } from "./session-reader-context-bar";
import { tileName } from "./session-reader-context-fold";
import type { ContextKind } from "./session-reader-context-map";
import { useMeasure } from "./session-reader-context-measure";
import type { Placed } from "./session-reader-context-place";

export function ContextRows({
	free,
	onPick,
	picked,
	tiles,
	whole,
}: {
	free: number | null;
	onPick: (key: string) => void;
	picked: string | null;
	tiles: readonly Placed[];
	whole: number;
}) {
	const biggestFirst = (each: readonly Placed[]) =>
		[...each].filter((tile) => tile.part).sort((a, b) => b.tokens - a.tokens);
	return (
		<ul className="-mx-2 flex flex-col">
			{biggestFirst(tiles).map((tile) => (
				<BoxRow
					key={tile.key}
					onPick={onPick}
					picked={picked === tile.key}
					tile={tile}
					whole={whole}
				>
					{tile.inside && tile.inside.length > 0 ? (
						<ul className="ml-[18px] flex flex-col border-l border-border pl-2">
							{biggestFirst(tile.inside).map((inner) => (
								<BoxRow
									key={inner.key}
									onPick={onPick}
									picked={picked === inner.key}
									tile={inner}
									whole={whole}
								/>
							))}
						</ul>
					) : null}
				</BoxRow>
			))}
			{free !== null && free > 0 ? (
				<li className="flex min-w-0">
					<button
						type="button"
						data-context-tile=""
						aria-pressed={picked === "free"}
						onClick={() => onPick("free")}
						className={cn(ROW, rowState(picked === "free"))}
					>
						<FreeGlyph />
						<FreeName />
						<ShareBar kind="free" share={whole > 0 ? free / whole : 0} />
						<Figure tokens={free} whole={whole} />
					</button>
				</li>
			) : null}
		</ul>
	);
}

const ROW =
	"flex min-h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1 text-left text-[13px]";

function FreeName() {
	const { freeWord } = useMeasure();
	return <span className="min-w-0 flex-1 truncate">{freeWord}</span>;
}

function BoxRow({
	children,
	onPick,
	picked,
	tile,
	whole,
}: {
	children?: ReactNode;
	onPick: (key: string) => void;
	picked: boolean;
	tile: Placed;
	whole: number;
}) {
	const part = tile.part;
	if (!part) return null;
	const Glyph = tileGlyph(part);
	return (
		<li className="flex min-w-0 flex-col">
			<button
				type="button"
				data-context-tile=""
				aria-pressed={picked}
				onClick={() => onPick(tile.key)}
				className={cn(ROW, rowState(picked))}
			>
				<OpalChip tint={TINT[part.kind]} className="text-(--opal-tint)">
					<Glyph aria-hidden="true" className="size-3" />
				</OpalChip>
				<span className="min-w-0 flex-1 truncate">{tileName(part)}</span>
				<ShareBar
					kind={part.kind}
					share={whole > 0 ? tile.tokens / whole : 0}
				/>
				<Figure tokens={tile.tokens} whole={whole} />
			</button>
			{children}
		</li>
	);
}

function Figure({ tokens, whole }: { tokens: number; whole: number }) {
	const { format } = useMeasure();
	return (
		<>
			<span className="w-14 shrink-0 text-right tabular-nums">
				{format(tokens)}
			</span>
			<span className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
				{formatShareOf(tokens, whole)}
			</span>
		</>
	);
}

function FreeGlyph() {
	const Glyph = tileGlyph(null);
	return (
		<OpalChip tint="var(--color-slate-400)" className="text-muted-foreground">
			<Glyph aria-hidden="true" className="size-3" />
		</OpalChip>
	);
}

function ShareBar({
	kind,
	share,
}: {
	kind: ContextKind | "free";
	share: number;
}) {
	return (
		<span
			aria-hidden="true"
			className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[rgba(0,0,0,0.06)] dark:bg-[rgba(255,255,255,0.08)]"
			style={tileLook(kind).style}
		>
			<span
				className={cn(
					"block h-full rounded-full",
					kind === "free"
						? "bg-[rgba(0,0,0,0.18)] dark:bg-[rgba(255,255,255,0.2)]"
						: "bg-[color-mix(in_oklab,var(--tint)_70%,transparent)]",
				)}
				style={{
					width: `${Math.max(Math.min(share, 1) * 100, share > 0 ? 2 : 0)}%`,
				}}
			/>
		</span>
	);
}
