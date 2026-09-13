import { useEffect, useState } from "react";
import styles from "./instant-v2-agent-morph.module.css";

const AGENT_PHRASES: readonly string[] = [
	"Codex sessions.",
	"Claude Code sessions.",
];
const MORPH_INTERVAL_MS = 4_000;
const BLUR_PAUSE_CHANGE_EVENT = "instant-v2:blur-pause-change";

export function InstantV2AgentMorph() {
	const [activeIndex, setActiveIndex] = useState(0);
	const activePhrase = AGENT_PHRASES[activeIndex] ?? AGENT_PHRASES[0];

	useEffect(() => {
		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
		let intervalId: number | undefined;

		const syncAnimation = () => {
			if (intervalId !== undefined) {
				window.clearInterval(intervalId);
				intervalId = undefined;
			}

			if (reducedMotion.matches) {
				setActiveIndex(0);
				return;
			}

			if (
				document.documentElement.hasAttribute("data-instant-v2-blur-paused")
			) {
				return;
			}

			intervalId = window.setInterval(() => {
				setActiveIndex(
					(currentIndex) => (currentIndex + 1) % AGENT_PHRASES.length,
				);
			}, MORPH_INTERVAL_MS);
		};

		syncAnimation();
		reducedMotion.addEventListener("change", syncAnimation);
		window.addEventListener(BLUR_PAUSE_CHANGE_EVENT, syncAnimation);

		return () => {
			reducedMotion.removeEventListener("change", syncAnimation);
			window.removeEventListener(BLUR_PAUSE_CHANGE_EVENT, syncAnimation);
			if (intervalId !== undefined) window.clearInterval(intervalId);
		};
	}, []);

	return (
		<span className={styles.host} data-instant-v2-agent-morph>
			<span className={styles.screenReader}>{activePhrase}</span>
			<span aria-hidden="true" className={styles.root} key={activePhrase}>
				<span
					className={styles.banner}
					data-active="true"
					data-agent-phrase={activePhrase}
				>
					{activePhrase}
				</span>
				<span className={styles.effects} data-agent-morph-effects>
					<span
						aria-hidden="true"
						className={styles.blur}
						data-agent-morph-blur
					/>
				</span>
			</span>
		</span>
	);
}
