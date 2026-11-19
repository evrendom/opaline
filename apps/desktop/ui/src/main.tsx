import { lazy, StrictMode, Suspense, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { takeFirstOpenIntro } from "@/app/first-open";
import { AppProviders } from "@/app/providers/AppProviders";
import { BonesProvider } from "@/app/ui/bones";
import { currentHandoffPage, mayHandOff } from "@/features/desktop/app-handoff";
import {
	SelfHostContext,
	type SelfHostInfo,
	whenSelfHostInfoKnown,
} from "@/features/self-hosted/self-host-info";
import App from "./App.tsx";
import { useMountEffect } from "./app/hooks/useMountEffect";
import "./index.css";
import { initProductAnalytics } from "./lib/product-analytics";

const DevTools = import.meta.env.DEV
	? lazy(async () => {
			const module = await import("./DevTools.tsx");
			return {
				default: module.DevTools,
			};
		})
	: null;

function GlobalLumaScope() {
	useMountEffect(() => {
		document.body.classList.add("style-luma");

		// Temporary sticky-header diagnostics: append ?debug=colors to any URL
		// to paint the code-card layers (see the DEBUG COLORS block in
		// code-block.css). Load without the param for the normal view.
		if (new URLSearchParams(window.location.search).get("debug") === "colors") {
			document.documentElement.dataset.debugStickyColors = "";
		}

		return () => {
			document.body.classList.remove("style-luma");
		};
	});

	return null;
}

function DevControls() {
	return (
		<>
			{DevTools ? (
				<Suspense fallback={null}>
					<DevTools />
				</Suspense>
			) : null}
		</>
	);
}

function deferProductAnalyticsInit() {
	if (typeof window === "undefined") {
		return;
	}

	if ("requestIdleCallback" in window) {
		window.requestIdleCallback(() => {
			initProductAnalytics();
		});
		return;
	}

	setTimeout(() => {
		initProductAnalytics();
	}, 0);
}

const isStandaloneDevRoute =
	import.meta.env.DEV &&
	(window.location.pathname === "/dev/trace-tree-fixture" ||
		window.location.pathname === "/dev/session-detail-fast-integration" ||
		window.location.pathname === "/dev/transcript-mask");

function BootDone() {
	useLayoutEffect(() => {
		document.documentElement.removeAttribute("data-boot");
	}, []);
	return null;
}

takeFirstOpenIntro();

// biome-ignore lint/style/noNonNullAssertion: root element always exists
const root = createRoot(document.getElementById("root")!);

function renderApp(selfHost: SelfHostInfo | null) {
	root.render(
		<StrictMode>
			<SelfHostContext value={selfHost}>
				<BonesProvider>
					<BootDone />
					{isStandaloneDevRoute ? (
						<BrowserRouter>
							<GlobalLumaScope />
							<div className="h-full">
								<App />
							</div>
						</BrowserRouter>
					) : (
						<AppProviders>
							<GlobalLumaScope />
							<div className="h-full">
								<App />
								{import.meta.env.DEV ? <DevControls /> : null}
							</div>
						</AppProviders>
					)}
				</BonesProvider>
			</SelfHostContext>
		</StrictMode>,
	);

	if (!isStandaloneDevRoute) {
		deferProductAnalyticsInit();
	}
}

function renderOrHandOff(selfHost: SelfHostInfo | null) {
	if (!selfHost || !mayHandOff(currentHandoffPage())) {
		renderApp(selfHost);
		return;
	}
	const proceed = () => renderApp(selfHost);
	void import("@/features/desktop/AppHandoff").then(
		({ handOffToDesktopApp }) => handOffToDesktopApp(root, proceed),
		proceed,
	);
}

whenSelfHostInfoKnown(renderOrHandOff);
