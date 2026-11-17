import { cn } from "@/lib/utils";
import { getFileLanguage } from "../files/session-reader-file-tag";
import { squarify } from "../summary/session-reader-breakdown";
import type { TileGlyph } from "./session-reader-context-bar";
import { fitting } from "./session-reader-context-fit";
import type { ContextPart } from "./session-reader-context-map";
import type { Tone } from "./session-reader-context-problems";

const INSET = 6;
const MIN_AREA = { h: 28, w: 40 } as const;
const MIN_CELL = 18;

const MARK: Record<Tone, string> = {
	later: "[--mark:currentColor]",
	minor: "[--mark:currentColor]",
	never: "[--mark:var(--color-rose-500)]",
};

const MARKED =
	"border-[color-mix(in_oklab,var(--mark)_28%,transparent)] bg-[color-mix(in_oklab,var(--mark)_9%,transparent)] shadow-[0_0_0_0.5px_color-mix(in_oklab,var(--mark)_20%,transparent),0_2px_4px_-1px_color-mix(in_oklab,var(--mark)_35%,transparent),0_8px_18px_-6px_color-mix(in_oklab,var(--mark)_55%,transparent)]";

export function markOf(
	marks: ReadonlyMap<string, Tone> | undefined,
	label: string,
): Tone | undefined {
	if (!marks) return undefined;
	const tone =
		marks.get(label) ??
		(label.length >= 20
			? [...marks].find(
					([each]) => each.slice(0, 40) === label.slice(0, 40),
				)?.[1]
			: undefined);
	return tone;
}

const TEXT: Record<Tone, string> = {
	later: "text-opal-4",
	minor: "text-opal-3",
	never: "text-rose-500",
};

const ICON_ROOM = 16;

export const ownsInside = (part: ContextPart) =>
	part.kind !== "summary" && part.kind !== "earlier";

export function drawsSubTiles(
	part: ContextPart,
	w: number,
	h: number,
	top: number,
): boolean {
	const things = (part.items ?? []).filter((item) => item.tokens > 0).length;
	return (
		ownsInside(part) &&
		things >= 2 &&
		w - 2 * INSET >= MIN_AREA.w &&
		h - top - INSET >= MIN_AREA.h
	);
}

export function ContextSubTiles({
	glyph: Glyph,
	h,
	marks,
	part,
	top,
	w,
}: {
	glyph: TileGlyph;
	marks?: ReadonlyMap<string, Tone>;
	h: number;
	part: ContextPart;
	top: number;
	w: number;
}) {
	const area = { h: h - top - INSET, w: w - 2 * INSET };
	const files = part.key
		.replace(/^(?:compacted|earlier):/u, "")
		.startsWith("files:");
	const items = [...(part.items ?? [])]
		.filter((item) => item.tokens > 0)
		.sort((a, b) => b.tokens - a.tokens);
	if (!drawsSubTiles(part, w, h, top)) return null;
	const marked = (label: string) => markOf(marks, label) !== undefined;
	const shown = fitting(
		items,
		(item) => item.tokens,
		area.w,
		area.h,
		MIN_CELL,
		(item) => marked(item.label),
	);
	const whole = shown.reduce((sum, item) => sum + item.tokens, 0);
	const least = (whole * (ICON_ROOM + 10) ** 2) / Math.max(1, area.w * area.h);
	const cells = squarify(
		shown.map((item, index) => ({
			color: "",
			label: String(index),
			value: marked(item.label) ? Math.max(item.tokens, least) : item.tokens,
		})),
		area.w,
		area.h,
	);
	return (
		<span
			aria-hidden="true"
			className="pointer-events-none absolute"
			style={{ height: area.h, left: INSET, top, width: area.w }}
		>
			{cells.map((cell) => {
				const item = shown[Number(cell.part.label)];
				const mark = markOf(marks, item?.label ?? "");
				const Mark =
					files && item
						? getFileLanguage(item.label.split("/").pop() ?? item.label).Icon
						: Glyph;
				const width = Math.max(0, cell.width - 2);
				const height = Math.max(0, cell.height - 2);
				return (
					<span
						key={cell.part.label}
						className="absolute flex items-center justify-center"
						style={{ height, left: cell.left, top: cell.top, width }}
					>
						<span
							className={cn(
								"absolute inset-0 rounded-[3px] border corner-squircle squircle:rounded-[6px]",
								mark ? `${MARK[mark]} ${MARKED}` : "border-current opacity-20",
							)}
						/>
						{width >= ICON_ROOM && height >= ICON_ROOM ? (
							<Mark
								className={cn(
									"relative size-3",
									mark && mark !== "minor" ? TEXT[mark] : "opacity-45",
								)}
							/>
						) : null}
					</span>
				);
			})}
		</span>
	);
}
