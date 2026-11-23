import type { SessionBoxContext } from "@rudel/api-routes";
import {
	tileGlyph,
	tileLook,
} from "@/features/sessions/reader/context/session-reader-context-bar";
import { fitting } from "@/features/sessions/reader/context/session-reader-context-fit";
import { squarify } from "@/features/sessions/reader/summary/session-reader-breakdown";
import { cn } from "@/lib/utils";

const INSET = 4;
const PART_MIN = 10;
const PART_ICON_ROOM = 16;
const LEAST_AREA = { h: 16, w: 24 } as const;

export function ContextPartTiles({
	context,
	h,
	top,
	w,
}: {
	context: SessionBoxContext;
	h: number;
	top: number;
	w: number;
}) {
	const area = { h: h - top - INSET, w: w - 2 * INSET };
	if (area.w < LEAST_AREA.w || area.h < LEAST_AREA.h) return null;
	const parts = context.parts
		.filter((part) => part.tokens > 0)
		.sort((a, b) => b.tokens - a.tokens);
	if (parts.length === 0) return null;
	const shown = fitting(parts, (part) => part.tokens, area.w, area.h, PART_MIN);
	const cells = squarify(
		shown.map((part, index) => ({
			color: "",
			label: String(index),
			value: part.tokens,
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
				const part = shown[Number(cell.part.label)];
				if (!part) return null;
				const look = tileLook(part.kind, true);
				const Glyph = tileGlyph({ count: 1, ...part });
				const width = Math.max(0, cell.width - 2);
				const height = Math.max(0, cell.height - 2);
				return (
					<span
						key={part.key}
						className={cn(
							"absolute flex items-center justify-center overflow-hidden",
							"corner-xs edge-m corner-squircle",
							"squircle:corner-xs",
							look.className,
						)}
						style={{
							...look.style,
							height,
							left: cell.left,
							top: cell.top,
							width,
						}}
					>
						{width >= PART_ICON_ROOM && height >= PART_ICON_ROOM ? (
							<Glyph className="size-3 shrink-0" />
						) : null}
					</span>
				);
			})}
		</span>
	);
}
