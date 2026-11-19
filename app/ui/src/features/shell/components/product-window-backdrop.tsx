import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { getCanonicalAppPath } from "@/app/routes";
import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";
import { initializeHeroCanvas } from "../../../site/scripts/hero-canvas";
import type { CliConnectionTone } from "../../cli-onboarding/cli-connection-state";
import { useDesktop } from "../../desktop/desktop-bridge";
import "../product-window-chrome.css";

const ConnectionToneContext = createContext<
	((tone: CliConnectionTone) => void) | null
>(null);

export function ProductWindowBackdropProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [tone, setTone] = useState<CliConnectionTone>("pending");
	return (
		<ConnectionToneContext.Provider value={setTone}>
			<ProductWindowBackdrop setupTone={tone} />
			{children}
		</ConnectionToneContext.Provider>
	);
}

export function useProductWindowConnectionTone(tone: CliConnectionTone) {
	const setTone = useContext(ConnectionToneContext);
	useLayoutEffect(() => {
		setTone?.(tone);
		return () => setTone?.("pending");
	}, [tone, setTone]);
}

function ProductWindowBackdrop({
	setupTone,
}: {
	setupTone: CliConnectionTone;
}) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const { pathname } = useLocation();
	const canonicalPath = getCanonicalAppPath(pathname);
	const desktop = useDesktop();
	const visible = canonicalPath === CLI_SETUP_PATH && !desktop;
	const tone = setupTone;
	useEffect(() => {
		if (visible && canvas.current) return initializeHeroCanvas(canvas.current);
	}, [visible]);
	if (!visible) return null;
	return createPortal(
		<div
			className="product-window-backdrop"
			data-product-window-backdrop
			data-hero-canvas-stage
			data-hero-canvas-palette={tone}
			data-hero-canvas-opacity="0.3"
			aria-hidden="true"
		>
			<canvas ref={canvas} />
		</div>,
		document.body,
	);
}
