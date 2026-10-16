import { expect, test } from "bun:test";
import { chromium, type Page, webkit } from "@playwright/test";

const LANDING = `http://127.0.0.1:${process.env.PREVIEW_PORT ?? 4600}/home`;
const FRAME = "[data-instant-v2-product-iframe]";

async function controlIdle(page: Page) {
	await page.addInitScript(() => {
		if (window.parent !== window) return;
		const callbacks = new Map<number, IdleRequestCallback>();
		let nextId = 0;
		window.requestIdleCallback = (callback) => {
			callbacks.set(++nextId, callback);
			return nextId;
		};
		window.cancelIdleCallback = (id) => {
			callbacks.delete(id);
		};
		Reflect.set(window, "releaseDemoIdle", () => {
			for (const [id, callback] of callbacks) {
				callbacks.delete(id);
				// Idle periods at 120Hz are shorter than a frame (8.3ms).
				callback({ didTimeout: false, timeRemaining: () => 6 });
			}
		});
		Reflect.set(window, "demoIdlePending", () => callbacks.size > 0);
	});
}

async function releaseIdle(page: Page) {
	await page.waitForFunction(() => Reflect.get(window, "demoIdlePending")());
	await page.evaluate(() => Reflect.get(window, "releaseDemoIdle")());
}

for (const engine of [chromium, webkit]) {
	test(`${engine.name()}: demo preparation waits for load and idle, stays inert, and makes no live requests`, async () => {
		const browser = await engine.launch({
			headless: true,
			...(engine === chromium ? { channel: "chrome" } : {}),
		});
		try {
			const page = await browser.newPage({
				viewport: { width: 1440, height: 1000 },
			});
			await controlIdle(page);
			const liveRequests: string[] = [];
			const productScripts: string[] = [];
			page.on("request", (request) => {
				if (
					request.url().includes("/product-demo/") &&
					request.resourceType() === "script"
				)
					productScripts.push(request.url());
				if (new URL(request.url()).pathname.startsWith("/api/demo/"))
					liveRequests.push(request.url());
			});
			await page.goto(LANDING);
			const product = page.frameLocator(FRAME);
			await page.waitForFunction(() =>
				Reflect.get(window, "demoIdlePending")(),
			);
			expect(await product.locator("html[data-demo-hydrated]").count()).toBe(0);
			expect(productScripts.some((url) => url.includes("hydrate-demo"))).toBe(
				false,
			);
			expect(await product.locator("[data-demo-surface][inert]").count()).toBe(
				1,
			);
			await releaseIdle(page);
			await product.locator("html[data-demo-hydrated]").waitFor();
			await page.evaluate(() => new Promise(requestAnimationFrame));
			expect(await product.locator("[data-demo-surface][inert]").count()).toBe(
				1,
			);
			expect(await page.locator(FRAME).getAttribute("tabindex")).toBe("-1");
			expect(liveRequests).toEqual([]);
			const timing = await page.evaluate(() => {
				const frame = document.querySelector<HTMLIFrameElement>(
					"[data-instant-v2-product-iframe]",
				);
				if (!frame?.contentWindow) throw new Error("Missing product frame");
				const resource = frame.contentWindow.performance
					.getEntriesByType("resource")
					.find((entry) => entry.name.includes("hydrate-demo"));
				const navigation = performance.getEntriesByType("navigation")[0];
				if (!resource || !(navigation instanceof PerformanceNavigationTiming))
					throw new Error("Missing startup timings");
				return {
					start:
						resource.startTime +
						frame.contentWindow.performance.timeOrigin -
						performance.timeOrigin,
					loaded: navigation.loadEventEnd,
				};
			});
			expect(timing.start).toBeGreaterThan(timing.loaded);
		} finally {
			await browser.close();
		}
	}, 30_000);

	test(`${engine.name()}: prepared controls work during entry, without the window ring or a connection response`, async () => {
		const browser = await engine.launch({
			headless: true,
			...(engine === chromium ? { channel: "chrome" } : {}),
		});
		try {
			const page = await browser.newPage({
				viewport: { width: 1440, height: 1000 },
			});
			await controlIdle(page);
			// Delay the real response; no fabricated auth or analytics data.
			await page.route("**/api/demo/auth/get-session", async (route) => {
				await new Promise((resolve) => setTimeout(resolve, 1_500));
				await route.continue();
			});
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await page.goto(LANDING);
			await releaseIdle(page);
			const product = page.frameLocator(FRAME);
			await product.locator("html[data-demo-hydrated]").waitFor();
			await page.locator("[data-instant-v2-dashboard-demo]").click();
			await page.evaluate(() => {
				const animation = document
					.querySelector("[data-instant-v2-window]")
					?.getAnimations()[0];
				if (!animation) throw new Error("Missing entry motion");
				animation.pause();
				animation.currentTime = 500;
			});
			await product.locator("[data-demo-surface]:not([inert])").waitFor();
			expect(await product.locator("html[data-demo-live]").count()).toBe(0);
			const scroll = product.locator(
				'[data-slot="sessions-overview-scroll-container"]',
			);
			expect(
				await scroll.evaluate((element) => document.activeElement === element),
			).toBe(true);
			expect(
				await scroll.evaluate(
					(element) => getComputedStyle(element).outlineStyle,
				),
			).toBe("none");
			const sort = product.getByRole("button", { name: /^Sort sessions,/ });
			await sort.click();
			await product
				.locator('[role="menu"][aria-label="Sort sessions"]')
				.waitFor();
			expect(
				await page
					.locator('[data-instant-v2-demo-bar][data-stage="entering"]')
					.count(),
			).toBe(1);
			await page.evaluate(() =>
				document
					.querySelector("[data-instant-v2-window]")
					?.getAnimations()
					.forEach((animation) => {
						animation.play();
					}),
			);
			await page
				.locator('[data-instant-v2-demo-bar][data-stage="visible"]')
				.waitFor();
			expect(
				await scroll.evaluate((element) => document.activeElement === element),
			).toBe(false);
			await page.keyboard.press("Escape");
			await page.locator("[data-instant-v2-demo-exit]").click();
			await page.locator("html:not([data-instant-v2-demo])").waitFor();
			await product.locator("[data-demo-surface][inert]").waitFor();
			expect(errors).toEqual([]);
			expect(
				await product.locator("html[data-demo-hydration-error]").count(),
			).toBe(0);
		} finally {
			await browser.close();
		}
	}, 30_000);

	test(`${engine.name()}: a cold Explore click starts loading before the animation finishes`, async () => {
		const browser = await engine.launch({
			headless: true,
			...(engine === chromium ? { channel: "chrome" } : {}),
		});
		try {
			const page = await browser.newPage({
				viewport: { width: 1440, height: 1000 },
			});
			await controlIdle(page);
			await page.goto(LANDING);
			const loading = page.waitForRequest((request) =>
				request.url().includes("/hydrate-demo-"),
			);
			await page.locator("[data-instant-v2-dashboard-demo]").click();
			await loading;
			await page
				.locator('[data-instant-v2-demo-bar][data-stage="entering"]')
				.waitFor();
			expect(
				await page
					.locator('[data-instant-v2-demo-bar][data-stage="entering"]')
					.count(),
			).toBe(1);
			await page
				.frameLocator(FRAME)
				.locator("[data-demo-surface]:not([inert])")
				.waitFor();
			expect(
				await page
					.frameLocator(FRAME)
					.locator("html[data-demo-hydration-error]")
					.count(),
			).toBe(0);
		} finally {
			await browser.close();
		}
	}, 30_000);
}
