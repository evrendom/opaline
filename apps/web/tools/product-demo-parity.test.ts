import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { CostDashboardSchema } from "@rudel/api-routes";
import { DemoSeedSchema } from "../src/features/demo/demo-runtime";

test("Explore preserves the seeded dashboard totals while loading real data", async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 1500, height: 853 },
		});
		const requests: string[] = [];
		page.on("request", (request) => {
			if (/^\/(api|rpc)\//.test(new URL(request.url()).pathname))
				requests.push(request.url());
		});
		await page.goto("http://localhost:4600/home");
		await page
			.locator(
				'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
			)
			.waitFor({ state: "attached" });
		const frame = page.frameLocator("[data-instant-v2-product-iframe]");
		const previewText = await frame.locator("#demo-seed").textContent();
		assert(previewText);
		const preview = DemoSeedSchema.parse(JSON.parse(previewText));
		const metrics = frame.locator(".cost-metrics");
		await metrics.waitFor();
		const previewMetrics = await metrics.innerText();
		expect(await metrics.locator(".cost-metric").count()).toBe(4);
		expect(requests).toEqual([]);
		const responsePromise = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname ===
					"/api/demo/rpc/analytics/overview/costs" && response.ok(),
		);
		await page.locator("[data-instant-v2-dashboard-demo]").click();
		const response = await responsePromise;
		expect(response.headers()["x-opaline-preview-data"]).not.toBe(
			"local-snapshot",
		);
		const payload = await response.json();
		expect(CostDashboardSchema.parse(payload.json)).toEqual(
			preview.dashboard.data,
		);
		await frame.locator('.cost-page[aria-busy="false"]').waitFor();
		expect(await metrics.innerText()).toBe(previewMetrics);
		expect(await frame.locator("html[data-demo-hydration-error]").count()).toBe(
			0,
		);
		expect(await frame.locator(".recharts-area-curve").count()).toBe(1);
	} finally {
		await browser.close();
	}
}, 30_000);
