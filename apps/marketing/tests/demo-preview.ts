import type { Page } from "@playwright/test";

export async function openDemoPreview(page: Page, url: string) {
	// The shared preview can rebuild while a transition is under test. Keep
	// its development-only reload poller from navigating away mid-assertion.
	await page.route("**/__preview/reload.js", (route) =>
		route.fulfill({ contentType: "text/javascript", body: "" }),
	);
	await page.goto(url);
}
