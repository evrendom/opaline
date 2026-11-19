import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { parseSessionOverviewRows } from "../src/features/sessions/session-overview-response";

test("Explore opens the metrics dashboard and Sessions still loads live session data", async () => {
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
			.waitFor({ state: "attached" });
		const frame = page.frameLocator("[data-instant-v2-product-iframe]");
		const rows = frame.locator('[data-dashboard-grid-row-scope="session"]');
		await frame.locator(".cost-metrics").waitFor();
		expect(await frame.locator(".cost-metric").count()).toBe(4);
		expect(await rows.count()).toBe(0);
		await page.locator("[data-instant-v2-dashboard-demo]").click();
		await frame.locator("html[data-demo-live]").waitFor();

		const responsePromise = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname ===
					"/api/demo/rpc/analytics/sessions/list" && response.ok(),
		);
		await frame.getByRole("link", { name: "Sessions", exact: true }).click();
		const response = await responsePromise;
		expect(response.headers()["x-opaline-preview-data"]).not.toBe(
			"local-snapshot",
		);
		const payload: unknown = await response.json();
		assert(
			typeof payload === "object" && payload !== null && "json" in payload,
		);
		const liveRows = parseSessionOverviewRows(payload.json);
		expect(liveRows).toHaveLength(50);
		await rows.first().waitFor();
		const hrefs = await rows.evaluateAll((elements) =>
			elements.map((element) => element.getAttribute("href")),
		);
		expect(hrefs.length).toBeGreaterThan(0);
		for (const href of hrefs) {
			expect(liveRows.some((row) => href?.includes(row.session_id))).toBe(true);
		}
		expect(
			await frame
				.getByText("We couldn't load the session overview for this range.", {
					exact: true,
				})
				.count(),
		).toBe(0);
	} finally {
		await browser.close();
	}
}, 90_000);
