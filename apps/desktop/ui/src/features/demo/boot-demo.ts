import "../../index.css";
import "@/app/app-surface.css";
import "@/features/dashboard/dashboard-theme.css";
import { usesSafariDemoMotion } from "../../site/scripts/demo-browser";
import { readDemoViewportHeight } from "../../site/scripts/demo-viewport";
import { scheduleProductDemoPreparation } from "../../site/scripts/prepare-product-demo";
import "./demo-webkit.css";
import {
	getDemoActive,
	setDemoActive,
	subscribeDemoActive,
} from "./demo-activation";
import { installDemoBackend } from "./demo-backend";
import { installDemoClock } from "./demo-clock";

installDemoClock();
installDemoBackend();

if (usesSafariDemoMotion(navigator.userAgent)) {
	document.documentElement.setAttribute("data-demo-webkit", "");
}

// Only this listener runs during landing-page load. The parent prepares React
// after its load/paint/idle boundary; activation still needs Explore.
const parentOrigin = document.referrer
	? new URL(document.referrer).origin
	: window.location.origin;
let started = false;
async function prepare() {
	if (started) return;
	started = true;
	const status = document.getElementById("demo-boot-error");
	if (status) status.hidden = true;
	try {
		const { hydrateDemo } = await import("./hydrate-demo");
		// The download may finish while the visitor is using the landing page.
		// Give that work priority too; a click bypasses the background idle wait.
		await waitForHydrationOpportunity();
		await hydrateDemo();
	} catch (error) {
		started = false;
		console.error("Unable to start product demo", error);
		if (status) status.hidden = !getDemoActive();
	}
}

function waitForHydrationOpportunity() {
	if (getDemoActive()) return Promise.resolve();
	return new Promise<void>((resolve) => {
		const finish = () => {
			cancelIdle();
			unsubscribe();
			resolve();
		};
		const cancelIdle = scheduleProductDemoPreparation(finish);
		const unsubscribe = subscribeDemoActive(() => {
			if (getDemoActive()) finish();
		});
	});
}
window.addEventListener("message", (event: MessageEvent<unknown>) => {
	if (event.source !== window.parent || event.origin !== parentOrigin) return;
	if (event.data === "opaline:prepare-demo") void prepare();
	if (event.data === "opaline:activate-demo") {
		setDemoActive(true);
		void prepare();
	}
	if (event.data === "opaline:deactivate-demo") setDemoActive(false);
	const viewportHeight = readDemoViewportHeight(event.data);
	if (viewportHeight !== null)
		document.documentElement.style.setProperty(
			"--cost-viewport-height",
			`${viewportHeight}px`,
		);
});
window.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && !event.defaultPrevented) {
		window.parent.postMessage("opaline:exit-demo", parentOrigin);
	}
});
document
	.getElementById("demo-boot-retry")
	?.addEventListener("click", () => void prepare());
