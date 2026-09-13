import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import seed from "../src/features/demo/seed.json";
import { parseSessionOverviewRows } from "../src/features/sessions/session-overview-response";

test("Explore replaces the initial preview with every live session without an overview error", async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 1500, height: 853 },
		});
		await page.goto("http://localhost:4600/home");
		await page
			.locator(
				'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
			)
			.waitFor();
		const frame = page.frameLocator("[data-instant-v2-product-iframe]");
		const rows = frame.locator('[data-dashboard-grid-row-scope="session"]');
		await rows.nth(seed.sessions.length - 1).waitFor();
		expect(await rows.count()).toBe(seed.sessions.length);

		const responsePromise = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === "/rpc/analytics/sessions/list" &&
				response.ok(),
		);
		await page.locator("[data-instant-v2-dashboard-demo]").click();
		const response = await responsePromise;
		expect(response.headers()["x-opaline-preview-data"]).not.toBe(
			"local-snapshot",
		);
		const payload: unknown = await response.json();
		assert(
			typeof payload === "object" && payload !== null && "json" in payload,
		);
		const liveRows = parseSessionOverviewRows(payload.json);
		expect(liveRows).toHaveLength(seed.totalSessionCount);
		await frame.locator("html[data-demo-live]").waitFor();
		// The real table mounts 50 rows at a time; scrolling reveals the next batch.
		await rows.nth(seed.sessions.length).waitFor();
		await rows.last().scrollIntoViewIfNeeded();
		await rows.nth(liveRows.length - 1).waitFor({ timeout: 30_000 });
		expect(await rows.count()).toBe(liveRows.length);
		expect(
			await frame
				.getByText("We couldn't load the session overview for this range.", {
					exact: true,
				})
				.count(),
		).toBe(0);
		const hrefs = await rows.evaluateAll((elements) =>
			elements.map((element) => element.getAttribute("href")),
		);
		for (const row of liveRows) {
			expect(hrefs.some((href) => href?.includes(row.session_id))).toBe(true);
		}
	} finally {
		await browser.close();
	}
}, 90_000);
