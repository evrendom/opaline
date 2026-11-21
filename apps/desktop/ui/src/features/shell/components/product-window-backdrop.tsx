import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { getCanonicalAppPath } from "@/app/routes";
import { CLI_SETUP_PATH } from "@/features/cli-onboarding/cli-authorization";
import { initializeHeroCanvas } from "../../../site/scripts/hero-canvas";
import "../product-window-chrome.css";

export function ProductWindowBackdropProvider({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<>
			<ProductWindowBackdrop />
			{children}
		</>
	);
}

function ProductWindowBackdrop() {
	const canvas = useRef<HTMLCanvasElement>(null);
	const { pathname } = useLocation();
	const visible = getCanonicalAppPath(pathname) === CLI_SETUP_PATH;
	useEffect(() => {
		if (visible && canvas.current) return initializeHeroCanvas(canvas.current);
	}, [visible]);
	if (!visible) return null;
	return createPortal(
		<div
			className="product-window-backdrop"
			data-product-window-backdrop
			data-hero-canvas-stage
			data-hero-canvas-palette="pending"
			data-hero-canvas-opacity="0.3"
			aria-hidden="true"
		>
			<canvas ref={canvas} />
		</div>,
		document.body,
	);
}
