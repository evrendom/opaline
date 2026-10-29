import { IconArrowUpRight } from "@tabler/icons-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { getFileLanguage } from "../files/session-reader-file-tag";
import { squarify } from "../summary/session-reader-breakdown";
import { tileGlyph, tileLook } from "./session-reader-context-bar";
import type { ContextItem, ContextPart } from "./session-reader-context-map";
import {
	type BoxProblems,
	ProblemMark,
	type Tone,
} from "./session-reader-context-problems";
import { markOf } from "./session-reader-context-subtiles";

const GAP = 4;
const MIN_CELL = 40;

const TEXT: Record<Tone, string> = {
	later: "text-opal-4",
	minor: "",
	never: "text-rose-600",
};

const nameOf = (label: string, files: boolean) =>
	files ? (label.split("/").pop() ?? label) : label;

export type ZoomOpen = {
	detail: () => void;
	file: (path: string) => void;
	setup: (setupFile: string) => void;
	mcpSetupFile?: (server: string) => string | null;
	skillSetupFile?: (name: string) => string | null;
};

const isSetupBox = (part: Pick<ContextPart, "key">) => {
	const key = part.key.replace(/^(?:compacted|earlier):/u, "");
	return key === "mcp" || key === "skills";
};

const isFiles = (part: Pick<ContextPart, "key">) =>
	part.key.replace(/^(?:compacted|earlier):/u, "").startsWith("files:");

export function thingOpen(
	part: Pick<ContextPart, "key">,
	label: string,
	onOpen: ZoomOpen,
): { go: () => void; words: string } {
	const ownKey = part.key.replace(/^(?:compacted|earlier):/u, "");
	if (isFiles(part)) return { go: () => onOpen.file(label), words: "Files" };
	if (ownKey.startsWith("setup:"))
		return {
			go: () => onOpen.setup(ownKey.slice("setup:".length)),
			words: "Setup",
		};
	if (ownKey === "mcp" || ownKey === "skills") {
		const at = label.lastIndexOf(":");
		const setupFile =
			ownKey === "mcp"
				? onOpen.mcpSetupFile?.(at > 0 ? label.slice(0, at) : label)
				: onOpen.skillSetupFile?.(label);
		return { go: () => onOpen.setup(setupFile ?? ""), words: "Setup" };
	}
	return { go: onOpen.detail, words: "Detail" };
}

export function thingGlyph(part: ContextPart, label: string) {
	return isFiles(part)
		? getFileLanguage(nameOf(label, true)).Icon
		: tileGlyph(part);
}

export const thingName = (part: Pick<ContextPart, "key">, label: string) =>
	nameOf(label, isFiles(part));

export function ContextZoom({
	onOpen,
	onPick,
	part,
	picked,
	problems,
}: {
	onPick: (label: string | null, more?: boolean) => void;
	picked: ReadonlySet<string>;
	onOpen: ZoomOpen;
	part: ContextPart;
	problems: BoxProblems | undefined;
}) {
	const [size, setSize] = useState({ h: 0, w: 0 });
	const measure = (element: HTMLDivElement | null) => {
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			if (!entry) return;
			const { height, width } = entry.contentRect;
			setSize((had) =>
				had.w === Math.round(width) && had.h === Math.round(height)
					? had
					: { h: Math.round(height), w: Math.round(width) },
			);
		});
		observer.observe(element);
		return () => observer.disconnect();
	};
	const files = part.key
		.replace(/^(?:compacted|earlier):/u, "")
		.startsWith("files:");
	const items = [...(part.items ?? [])]
		.filter((item) => item.tokens > 0)
		.sort((a, b) => b.tokens - a.tokens);
	const all =
		items.length > 0
			? items
			: [{ count: part.count, label: part.label, tokens: part.tokens }];
	const room = (MIN_CELL + GAP) ** 2;
	const fits = Math.max(1, Math.floor((size.w * size.h * 0.8) / room));
	const marked = (label: string) =>
		markOf(problems?.items, label) !== undefined;
	const kept =
		all.length <= fits
			? all
			: [
					...all.slice(0, fits - 1),
					...all.slice(fits - 1).filter((item) => marked(item.label)),
				];
	const keptSet = new Set(kept);
	const rest = all.filter((item) => !keptSet.has(item));
	const things: (ContextItem & { more?: number })[] =
		rest.length > 0
			? [
					...kept,
					{
						count: rest.length,
						label: `${rest.length} more`,
						more: rest.length,
						tokens: rest.reduce((sum, item) => sum + item.tokens, 0),
					},
				]
			: kept;
	const values = (() => {
		const area = size.w * size.h;
		let out = things.map((item) => item.tokens);
		for (let round = 0; round < 4 && area > 0; round += 1) {
			const total = out.reduce((sum, value) => sum + value, 0);
			const least = (total * room) / area;
			out = things.map((item, index) =>
				Math.max(item.tokens, least, out[index] ?? 0),
			);
		}
		return out;
	})();
	const cells =
		size.w > 0 && size.h > 0
			? squarify(
					things.map((_, index) => ({
						color: "",
						label: String(index),
						value: values[index] ?? 0,
					})),
					size.w,
					size.h,
				)
			: [];
	const BoxGlyph = tileGlyph(part);
	const openOf = (label: string) => thingOpen(part, label, onOpen);
	const boxLook = tileLook(part.kind);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div
				ref={measure}
				className={cn(
					"relative min-h-0 flex-1 rounded-md border p-0 corner-squircle squircle:rounded-xl",
					boxLook.className,
				)}
				style={boxLook.style}
			>
				{cells.map((cell) => {
					const item = things[Number(cell.part.label)];
					if (!item) return null;
					const mark = markOf(problems?.items, item.label);
					const ofRun = part.nested?.find((each) => each.label === item.label);
					const Mark = files
						? getFileLanguage(nameOf(item.label, true)).Icon
						: ofRun
							? tileGlyph({ key: ofRun.key, kind: ofRun.kind } as ContextPart)
							: BoxGlyph;
					const w = Math.max(0, cell.width - GAP);
					const h = Math.max(0, cell.height - GAP);
					const showName = w >= 70 && h >= 22;
					const open = item.more
						? files
							? { go: () => onOpen.file(""), words: "Files" }
							: isSetupBox(part)
								? { go: () => onOpen.setup(""), words: "Setup" }
								: { go: onOpen.detail, words: "Detail" }
						: openOf(item.label);
					return (
						<div
							key={cell.part.label}
							title={item.label}
							className={cn(
								"group/thing absolute flex flex-col items-start gap-0.5 overflow-hidden rounded-md border bg-card p-1.5 text-[12px] leading-4 transition-opacity corner-squircle squircle:rounded-xl",
								"border-current/20",
								picked.size > 0 && !picked.has(item.label) && "opacity-40",
								picked.has(item.label) &&
									"shadow-[0_2px_10px_-2px_color-mix(in_oklab,var(--tint)_55%,transparent)] ring-2 ring-[color-mix(in_oklab,var(--tint)_55%,transparent)]",
							)}
							style={{
								height: h,
								left: cell.left + GAP / 2,
								top: cell.top + GAP / 2,
								width: w,
							}}
						>
							<button
								type="button"
								data-context-pick=""
								aria-pressed={picked.has(item.label)}
								aria-label={
									item.more
										? `Open the ${item.more} more in ${open.words}`
										: `Pick ${nameOf(item.label, files)}`
								}
								onClick={(event) =>
									item.more ? open.go() : onPick(item.label, event.shiftKey)
								}
								className="absolute inset-0 cursor-pointer rounded-[calc(var(--radius-md)-1px)] corner-squircle outline-none transition-colors hover:bg-black/[0.03] squircle:rounded-[calc(var(--radius-xl)-1px)] dark:hover:bg-white/[0.04]"
							/>
							<span
								className={cn(
									"pointer-events-none relative flex min-w-0 max-w-full items-center gap-1.5",
									!showName && "m-auto",
								)}
							>
								{item.more ? (
									<span className="font-medium text-muted-foreground tabular-nums">
										+{item.more}
									</span>
								) : w >= 16 && h >= 16 ? (
									<Mark
										className={cn(
											"size-3.5 shrink-0",
											mark ? TEXT[mark] : "opacity-60",
										)}
									/>
								) : null}
								{showName && !item.more ? (
									<span className="truncate font-medium">
										{nameOf(item.label, files)}
									</span>
								) : null}
							</span>
							{mark && w >= 22 && h >= 22 ? (
								<span className="pointer-events-none absolute top-2 right-2 flex">
									<ProblemMark tone={mark} />
								</span>
							) : null}
							{!item.more && w >= 90 && h >= 56 ? (
								<button
									type="button"
									data-context-pick=""
									onClick={open.go}
									aria-label={`Open ${nameOf(item.label, files)} in ${open.words}`}
									className="absolute right-1.5 bottom-1.5 inline-flex h-6 cursor-pointer items-center gap-0.5 rounded-md bg-muted/70 pr-1 pl-2 text-[12px] font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground"
								>
									{open.words}
									<IconArrowUpRight aria-hidden="true" className="size-3" />
								</button>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}
