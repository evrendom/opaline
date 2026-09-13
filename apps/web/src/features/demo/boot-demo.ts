import "../../index.css";
import "@/app/app-surface.css";
import "@/features/dashboard/dashboard-theme.css";
import { usesSafariDemoMotion } from "../../../../marketing/src/scripts/demo-browser";
import "./demo-webkit.css";

if (usesSafariDemoMotion(navigator.userAgent)) {
	document.documentElement.setAttribute("data-demo-webkit", "");
}

// This tiny listener is the only product JavaScript executed before Explore.
// It does not import React, authenticate, fetch data, or hydrate on hover/idle.
const parentOrigin = document.referrer
	? new URL(document.referrer).origin
	: window.location.origin;
let started = false;
async function activate() {
	if (started) return;
	started = true;
	const status = document.getElementById("demo-boot-error");
	if (status) status.hidden = true;
	try {
		const { hydrateDemo } = await import("./hydrate-demo");
		await hydrateDemo();
	} catch (error) {
		started = false;
		console.error("Unable to start product demo", error);
		if (status) status.hidden = false;
	}
}
window.addEventListener("message", (event: MessageEvent<unknown>) => {
	if (event.source !== window.parent || event.origin !== parentOrigin) return;
	if (event.data === "opaline:activate-demo") void activate();
	if (event.data === "opaline:focus-demo") {
		document
			.querySelector<HTMLElement>(
				'[data-slot="sessions-overview-scroll-container"]',
			)
			?.focus({ preventScroll: true });
	}
});
window.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && !event.defaultPrevented) {
		window.parent.postMessage("opaline:exit-demo", parentOrigin);
	}
});
document
	.getElementById("demo-boot-retry")
	?.addEventListener("click", () => void activate());
