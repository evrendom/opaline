import { useEffect, useState } from "react";

export type StarStatus = { show: boolean; count: number | null };
export type StarResult = { via: "gh" | "browser" } | null;

declare global {
	interface OpalineDesktop {
		starStatus?: () => Promise<StarStatus>;
		star?: () => Promise<StarResult>;
		dismissStar?: () => void;
	}
}

const RECHECK_MS = 60_000;
// Development only: `localStorage["opaline:star-card-preview"] = "1"` shows the
// card in the browser build, so it can be worked on without the Mac app.
const PREVIEW_KEY = "opaline:star-card-preview";

function preview(): boolean {
	if (!import.meta.env.DEV) return false;
	try {
		return localStorage.getItem(PREVIEW_KEY) === "1";
	} catch {
		return false;
	}
}

export type StarPrompt = {
	count: number | null;
	star: () => void;
	dismiss: () => void;
};

/**
 * Asks the Mac app whether the star card is due: after an hour of active use,
 * never again once starred or dismissed. The app does the counting and the
 * starring (gh, or the repository opened in the background), so nothing here
 * navigates away from Opaline.
 */
export function useStarPrompt(): StarPrompt | null {
	const [count, setCount] = useState<number | null>(null);
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		if (preview()) {
			setCount(307);
			setVisible(true);
			return;
		}
		const desktop = window.opalineDesktop;
		if (!desktop?.starStatus) return;
		let cancelled = false;
		let timer = 0;
		const check = () => {
			desktop
				.starStatus?.()
				.then((status) => {
					if (cancelled) return;
					if (status.show && status.count !== null) {
						setCount(status.count);
						setVisible(true);
					} else timer = window.setTimeout(check, RECHECK_MS);
				})
				.catch(() => {
					if (!cancelled) timer = window.setTimeout(check, RECHECK_MS);
				});
		};
		check();
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, []);

	if (!visible) return null;
	return {
		count,
		star: () => void window.opalineDesktop?.star?.().catch(() => null),
		dismiss: () => window.opalineDesktop?.dismissStar?.(),
	};
}
