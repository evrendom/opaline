import { type MouseEvent as ReactMouseEvent, useRef } from "react";
import { formatTimeOfDay } from "@/lib/format";
import { formatSpanDuration } from "./session-reader-waterfall-chips";

export function useWaterfallCursor(total: number, startMs: number) {
	const trackOverlayRef = useRef<HTMLDivElement>(null);
	const cursorRef = useRef<HTMLDivElement>(null);
	const cursorLabelRef = useRef<HTMLSpanElement>(null);
	const moveCursor = (event: ReactMouseEvent<HTMLDivElement>) => {
		const overlay = trackOverlayRef.current;
		const cursor = cursorRef.current;
		const label = cursorLabelRef.current;
		if (!overlay || !cursor || !label) return;
		const rect = overlay.getBoundingClientRect();
		const frac = (event.clientX - rect.left) / Math.max(rect.width, 1);
		if (frac < 0 || frac > 1) {
			cursor.style.display = "none";
			label.style.display = "none";
			return;
		}
		const offsetMs = frac * total;
		cursor.style.display = "block";
		cursor.style.left = `${frac * 100}%`;
		label.textContent = `${formatSpanDuration(offsetMs)} · ${formatTimeOfDay(
			startMs + offsetMs,
		)}`;
		const flip = frac > 0.75;
		label.style.display = "block";
		label.style.left = flip ? "auto" : `calc(${frac * 100}% + 6px)`;
		label.style.right = flip ? `calc(${(1 - frac) * 100}% + 6px)` : "auto";
	};
	const hideCursor = () => {
		if (cursorRef.current) cursorRef.current.style.display = "none";
		if (cursorLabelRef.current) cursorLabelRef.current.style.display = "none";
	};
	return { cursorLabelRef, cursorRef, hideCursor, moveCursor, trackOverlayRef };
}
