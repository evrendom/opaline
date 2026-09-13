import { spring as createSpring } from "motion";
import type { CSSProperties } from "react";
import { spring } from "@/lib/springs";

interface SessionPaneMotionStyle extends CSSProperties {
	"--session-pane-enter": string;
	"--session-pane-exit": string;
	"--session-pane-fade-enter": string;
}

// Generate the CSS spring once from the same tokens as the fluid controls.
// CSS owns playback, so the transcript doesn't rerender on animation frames.
export const sessionPaneMotionStyle: SessionPaneMotionStyle = {
	"--session-pane-enter": String(
		createSpring({
			keyframes: [0, 1],
			duration: spring.slow.duration * 1000,
			bounce: spring.slow.bounce,
		}),
	),
	"--session-pane-exit": `${spring.slow.exit.duration}s ease-out`,
	"--session-pane-fade-enter": `${spring.slow.duration}s ease-out`,
};

export function getSessionMotionPanes(detailPane: HTMLElement) {
	const headerPane = detailPane
		.closest(".dashboard-01-window")
		?.querySelector<HTMLElement>('[data-slot="session-detail-header-pane"]');
	return headerPane ? [detailPane, headerPane] : [detailPane];
}

export function showOverviewBehindMovingPane(panes: HTMLElement[]) {
	const hosts = panes.flatMap((pane) => {
		const host = pane.closest<HTMLElement>(
			'[data-slot="session-workspace"], [data-slot="dashboard-header"]',
		);
		return host ? [host] : [];
	});
	const motionId = crypto.randomUUID();
	for (const host of hosts) {
		host.dataset.sessionPaneMoving = motionId;
	}
	return () => {
		for (const host of hosts) {
			// A closing animation can take over before the entrance has finished.
			if (host.dataset.sessionPaneMoving === motionId) {
				delete host.dataset.sessionPaneMoving;
			}
		}
	};
}
