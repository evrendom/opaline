import { spring as createSpring } from "motion";
import type { CSSProperties } from "react";
import { spring } from "@/lib/springs";

interface SessionPaneMotionStyle extends CSSProperties {
	"--session-pane-enter": string;
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
	"--session-pane-fade-enter": `${spring.slow.duration}s var(--motion-easing)`,
};
