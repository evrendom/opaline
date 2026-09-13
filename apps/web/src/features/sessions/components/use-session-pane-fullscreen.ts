import { spring as createSpring } from "motion";
import { animate } from "motion/mini";
import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { spring } from "@/lib/springs";
import {
	getSessionMotionPanes,
	showOverviewBehindMovingPane,
} from "./session-pane-motion";

export function useSessionPaneFullscreen() {
	const [isFullscreen, setIsFullscreen] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);
	const pendingResizeRef = useRef<(() => void) | null>(null);

	useLayoutEffect(() => () => pendingResizeRef.current?.(), []);

	function toggleFullscreen() {
		const detailPane = contentRef.current?.closest<HTMLElement>(
			'[data-slot="session-detail-pane"]',
		);
		if (!detailPane || detailPane.hasAttribute("data-session-pane-closing")) {
			return;
		}

		const panes = getSessionMotionPanes(detailPane);
		const previousWidths = panes.map(
			(pane) => pane.getBoundingClientRect().width,
		);
		pendingResizeRef.current?.();
		const nextFullscreen = !isFullscreen;
		// Measure the actual destination, including the saved split width and
		// responsive layout, before making the same panes temporarily overlay it.
		flushSync(() => setIsFullscreen(nextFullscreen));
		const targetWidths = panes.map(
			(pane) => pane.getBoundingClientRect().width,
		);
		const restoreOverview = showOverviewBehindMovingPane(panes);
		const reduceMotion = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;

		const animations = panes.map((pane, index) => {
			pane.dataset.sessionPaneResizing = "";
			pane.style.setProperty(
				"--session-pane-resize-width",
				`${targetWidths[index]}px`,
			);
			// Animate the real width so text never stretches and there is no
			// snapshot/second surface. Explicitly reduce this layout animation.
			return reduceMotion
				? animate(
						pane,
						{ opacity: [0.85, 1] },
						{
							duration: nextFullscreen
								? spring.slow.duration
								: spring.slow.exit.duration,
							ease: "easeOut",
						},
					)
				: animate(
						pane,
						{
							width: [`${previousWidths[index]}px`, `${targetWidths[index]}px`],
						},
						nextFullscreen
							? { ...spring.slow, type: createSpring }
							: { ...spring.slow.exit, ease: "easeOut" },
					);
		});

		const cleanup = () => {
			for (const animation of animations) animation.cancel();
			for (const pane of panes) {
				delete pane.dataset.sessionPaneResizing;
				pane.style.removeProperty("--session-pane-resize-width");
				pane.style.removeProperty("width");
				pane.style.removeProperty("opacity");
			}
			restoreOverview();
		};
		pendingResizeRef.current = cleanup;
		void Promise.allSettled(animations).then(() => {
			if (pendingResizeRef.current !== cleanup) return;
			cleanup();
			pendingResizeRef.current = null;
		});
	}

	return { contentRef, isFullscreen, toggleFullscreen };
}
