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
	later: "[--mark:var(--color-opal-4)]",
	minor: "[--mark:var(--color-opal-3)]",
	never: "[--mark:var(--color-rose-500)]",
};

const MARKED =
	// design-escape-ok(shadow): artwork; a marked tile glows in its mark's colour
	"border-[color-mix(in_oklab,var(--mark)_45%,transparent)] shadow-[0_0_4px_color-mix(in_oklab,var(--mark)_60%,transparent),0_0_14px_color-mix(in_oklab,var(--mark)_45%,transparent)]";

export const markGlow = (tone: Tone) => `${MARK[tone]} ${MARKED}`;

const MARK_ORDER: readonly Tone[] = ["never", "later", "minor"];

const MARK_LABEL: Record<Tone, string> = {
	later: "Resolved later",
	minor: "Resolved instantly",
	never: "Unresolved",
};

export function MarkLegend({
	className,
	tones,
}: {
	className?: string;
	tones: ReadonlySet<Tone>;
}) {
	const shown = MARK_ORDER.filter((tone) => tones.has(tone));
	if (shown.length === 0) return null;
	return (
		<div
			className={cn(
				"inline-flex min-w-0 shrink-0 items-center gap-xxs",
				"corner-m p-xxs corner-squircle",
				"text-body-m font-medium",
				"bg-hover text-ink-3",
				"squircle:corner-l dark:bg-hover",
				className,
			)}
		>
			<span className="flex h-6 items-center px-m text-ink-4">Errors</span>
			<ul aria-label="Errors" className="flex min-w-0 items-center gap-xxs">
				{shown.map((tone) => (
					<li key={tone} className="flex h-6 items-center gap-s px-m">
						<span
							aria-hidden="true"
							className={cn(
								"size-2.5 shrink-0 corner-xs edge-m corner-squircle",
								markGlow(tone),
							)}
						/>
						{MARK_LABEL[tone]}
					</li>
				))}
			</ul>
		</div>
	);
}

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
	// design-escape-ok(base): data paint; a category colour from the opal sheen
	later: "text-color-4",
	// design-escape-ok(base): data paint; a category colour from the opal sheen
	minor: "text-color-2",
	never: "text-error",
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
								"absolute inset-0 corner-xs edge-m corner-squircle squircle:corner-xs",
								mark ? markGlow(mark) : "border-current opacity-20",
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
