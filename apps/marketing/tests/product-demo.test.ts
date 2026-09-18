import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";
import { openDemoPreview } from "./demo-preview";

const LANDING = `http://localhost:${process.env.PREVIEW_PORT ?? 4600}/home`;
const FRAME = "[data-instant-v2-product-iframe]";

test("CLI copy never writes a command without a connection code when pairing fails", async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const context = await browser.newContext({
			permissions: ["clipboard-read", "clipboard-write"],
		});
		const page = await context.newPage();
		await openDemoPreview(page, `${LANDING}#demo`);
		await page
			.locator('[data-instant-v2-demo-bar][data-stage="visible"]')
			.waitFor();
		await page.evaluate(() =>
			navigator.clipboard.writeText("keep my clipboard"),
		);
		await context.setOffline(true);
		for (let attempt = 0; attempt < 2; attempt++) {
			await page.locator(".instant-v2-demo-command").click();
			await page
				.getByText(
					"Could not create your connection code. Check your connection and try again.",
					{ exact: false },
				)
				.waitFor();
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
				"keep my clipboard",
			);
			expect(await page.locator("[data-cli-command-fallback]").count()).toBe(0);
			expect(
				await page
					.getByRole("button", { name: "Copied — paste into your terminal" })
					.count(),
			).toBe(0);
		}
		expect(new URL(page.url()).pathname).toBe("/");
	} finally {
		await browser.close();
	}
}, 20_000);

test("CLI copy retains its code across connection loss and clipboard denial", async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const context = await browser.newContext({
			permissions: ["clipboard-read", "clipboard-write"],
		});
		const page = await context.newPage();
		await openDemoPreview(page, `${LANDING}#demo`);
		await page
			.locator('[data-instant-v2-demo-bar][data-stage="visible"]')
			.waitFor();
		let pairings = 0;
		page.on("request", (request) => {
			if (
				request.method() === "POST" &&
				new URL(request.url()).pathname === "/api/cli/connections"
			)
				pairings++;
		});
		const pairing = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" &&
				new URL(response.url()).pathname === "/api/cli/connections",
		);
		await page.locator(".instant-v2-demo-command").click();
		expect((await pairing).ok()).toBe(true);
		await page
			.getByRole("button", {
				name: "Copied — paste into your terminal",
				exact: true,
			})
			.waitFor();
		const command = await page.evaluate(() => navigator.clipboard.readText());
		expect(command).toContain(`--api-base ${new URL(LANDING).origin}`);
		expect(command).toMatch(/ --code \S+/);
		expect(
			await page.locator(".instant-v2-demo-connection-error").count(),
		).toBe(0);
		await context.setOffline(true);
		for (let attempt = 0; attempt < 3; attempt++) {
			await page.evaluate(() => navigator.clipboard.writeText(""));
			await page.locator(".instant-v2-demo-command").click();
			await page.waitForFunction(
				async (expected) => (await navigator.clipboard.readText()) === expected,
				command,
			);
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
				command,
			);
		}
		expect(pairings).toBe(1);

		await page.evaluate(() =>
			navigator.clipboard.writeText("keep my clipboard"),
		);
		const cdp = await context.newCDPSession(page);
		const { targetInfo } = await cdp.send("Target.getTargetInfo");
		await cdp.send("Browser.setPermission", {
			permission: { name: "clipboard-write" },
			setting: "denied",
			origin: new URL(LANDING).origin,
			browserContextId: targetInfo.browserContextId,
		});
		await page.locator(".instant-v2-demo-command").click();
		expect(
			await page
				.getByRole("button", { name: "Copied — paste into your terminal" })
				.count(),
		).toBe(0);
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
			"keep my clipboard",
		);
		expect(await page.locator("[data-cli-command-fallback]").count()).toBe(0);
		expect(
			await page.getByRole("textbox", { name: "CLI command to copy" }).count(),
		).toBe(0);
		await cdp.send("Browser.setPermission", {
			permission: { name: "clipboard-write" },
			setting: "granted",
			origin: new URL(LANDING).origin,
			browserContextId: targetInfo.browserContextId,
		});
		await page.locator(".instant-v2-demo-command").click();
		await page.waitForFunction(
			async (expected) => (await navigator.clipboard.readText()) === expected,
			command,
		);
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
			command,
		);
		expect(pairings).toBe(1);
		expect(new URL(page.url()).pathname).toBe("/");
	} finally {
		await browser.close();
	}
}, 20_000);

test("demo visits ignore saved CLI setup and cross-tab connection changes", async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const context = await browser.newContext();
		await context.addInitScript(() => {
			if (window !== window.top || location.origin === "null") return;
			const id = "275bcbd1-ff3c-48cc-9cd3-e20bcad554d7";
			localStorage.setItem("opaline.cli-connection", id);
			localStorage.setItem("opaline.cli-personal-view", id);
			localStorage.setItem(
				"opaline.cli-authorization",
				JSON.stringify({ id, userCode: "ABCD1234" }),
			);
		});
		const page = await context.newPage();
		const connectionRequests: string[] = [];
		page.on("request", (request) => {
			if (new URL(request.url()).pathname.startsWith("/api/cli/connections"))
				connectionRequests.push(request.url());
		});
		await openDemoPreview(
			page,
			`${LANDING}?connect=275bcbd1-ff3c-48cc-9cd3-e20bcad554d7&user_code=ABCD1234#demo`,
		);
		await page
			.locator('[data-instant-v2-demo-bar][data-stage="visible"]')
			.waitFor();
		expect(new URL(page.url()).pathname).toBe("/");
		expect(await page.locator(FRAME).count()).toBe(1);
		expect(await page.locator(".instant-v2-demo-command").isEnabled()).toBe(
			true,
		);
		expect(connectionRequests).toEqual([]);

		const other = await context.newPage();
		await other.goto(LANDING);
		const storageChanged = page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					window.addEventListener("storage", function changed(event) {
						if (event.key !== "opaline.cli-connection") return;
						window.removeEventListener("storage", changed);
						requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
					});
				}),
		);
		await other.evaluate(() => {
			const id = "fd84ca1c-7e1d-4f92-a713-ef12bc0719fe";
			localStorage.setItem("opaline.cli-connection", id);
			localStorage.setItem("opaline.cli-personal-view", id);
			localStorage.setItem(
				"opaline.cli-authorization",
				JSON.stringify({ id, userCode: "XYZ98765" }),
			);
		});
		await storageChanged;
		expect(new URL(page.url()).pathname).toBe("/");
		expect(connectionRequests).toEqual([]);
		await page.reload();
		await page
			.locator('[data-instant-v2-demo-bar][data-stage="visible"]')
			.waitFor();
		expect(new URL(page.url()).pathname).toBe("/");
		expect(connectionRequests).toEqual([]);
	} finally {
		await browser.close();
	}
}, 20_000);

test("gradient stretch keeps its drawing buffer stable in Chrome and Safari", async () => {
	for (const engine of ["chrome", "webkit"]) {
		const browser =
			engine === "chrome"
				? await chromium.launch({ channel: "chrome", headless: true })
				: await webkit.launch({ headless: true });
		try {
			const page = await browser.newPage({
				viewport: { width: 2048, height: 1152 },
				deviceScaleFactor: 2,
			});
			await openDemoPreview(page, LANDING);
			await page
				.locator("[data-hero-canvas-stage][data-canvas-ready]")
				.waitFor({ state: "attached" });
			await page
				.locator(
					'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
				)
				.waitFor({ state: "attached" });
			await page.waitForFunction(() => document.querySelector(".lenis"));
			await page.mouse.move(600, 300);
			const distance = await page.evaluate(() => {
				const scroll =
					document.querySelector<HTMLElement>(
						"html[data-instant-v2-safari-scroll] [data-instant-v2-scroll]",
					) ?? document.documentElement;
				return scroll.scrollHeight - scroll.clientHeight;
			});
			for (const direction of ["down", "up"]) {
				const capture = page.evaluate(async () => {
					const canvas = document.querySelector<HTMLCanvasElement>(
						"[data-hero-canvas-stage] canvas",
					);
					const product = document.querySelector<HTMLElement>(
						"[data-instant-v2-product-window]",
					);
					if (!canvas || !product) throw new Error("Missing gradient");
					const started = performance.now();
					const samples = [];
					do {
						await new Promise(requestAnimationFrame);
						samples.push({
							width: canvas.width,
							height: canvas.height,
							layoutWidth: canvas.clientWidth,
							layoutHeight: canvas.clientHeight,
							stretch:
								canvas.getBoundingClientRect().height / canvas.clientHeight,
							progress: Number(
								product.style.getPropertyValue(
									"--instant-v2-gradient-reveal-progress",
								),
							),
						});
					} while (performance.now() - started < 1200);
					return samples;
				});
				if (direction === "up") {
					// Sample the reveal band before a large reverse wheel delta can skip it.
					await page.mouse.wheel(0, -90);
					await page.waitForFunction(() => {
						const canvas = document.querySelector<HTMLCanvasElement>(
							"[data-hero-canvas-stage] canvas",
						);
						return (
							canvas &&
							canvas.getBoundingClientRect().height / canvas.clientHeight > 1.06
						);
					});
				}
				await page.mouse.wheel(0, distance * (direction === "down" ? 2 : -2));
				const samples = await capture;
				expect(new Set(samples.map((sample) => sample.layoutWidth)).size).toBe(
					1,
				);
				expect(new Set(samples.map((sample) => sample.layoutHeight)).size).toBe(
					1,
				);
				expect(
					new Set(samples.map((sample) => sample.width)).size,
					`${engine} ${direction} buffer width`,
				).toBe(1);
				expect(
					new Set(samples.map((sample) => sample.height)).size,
					`${engine} ${direction} buffer height`,
				).toBe(1);
				expect(
					Math.max(...samples.map((sample) => sample.stretch)),
					`${engine} ${direction} visual stretch`,
				).toBeGreaterThan(1.06);
				expect(samples.at(-1)?.progress).toBe(direction === "down" ? 1 : 0);
			}
			const beforeResize = await page
				.locator("[data-hero-canvas-stage] canvas")
				.evaluate((node: HTMLCanvasElement) => ({
					height: node.height,
					ratio: node.height / node.clientHeight,
				}));
			await page.setViewportSize({ width: 1280, height: 900 });
			await page.waitForFunction((before) => {
				const canvas = document.querySelector<HTMLCanvasElement>(
					"[data-hero-canvas-stage] canvas",
				);
				// A real resize must update both dimensions while preserving the
				// renderer's chosen resolution, which can be below device DPR.
				return (
					canvas &&
					canvas.height !== before.height &&
					Math.abs(canvas.height - canvas.clientHeight * before.ratio) <= 1 &&
					Math.abs(canvas.width - canvas.clientWidth * before.ratio) <= 1
				);
			}, beforeResize);
			await page.close();
		} finally {
			await browser.close();
		}
	}
}, 30_000);

test("demo resizes continuously while the prepared product stays interactive", async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		for (const viewport of [
			{ width: 1512, height: 982 },
			{ width: 2048, height: 1152 },
		]) {
			const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
			const appRequests: string[] = [];
			page.on("request", (request) => {
				if (
					request.url().includes("/assets/hydrate-demo-") ||
					isLiveRequest(request.url())
				)
					appRequests.push(request.url());
			});
			await openDemoPreview(page, LANDING);
			await page
				.locator(
					'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
				)
				.waitFor({ state: "attached" });
			const product = page.frameLocator(FRAME);
			const originalRow = await product
				.getByRole("list", { name: "Recent sessions" })
				.locator("li")
				.first()
				.elementHandle();
			assert(originalRow);
			const initialStylesheets = await product
				.locator('link[rel="stylesheet"]')
				.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
			expect(initialStylesheets).toHaveLength(1);
			expect(appRequests.filter(isLiveRequest)).toEqual([]);
			await page.evaluate(() =>
				window.scrollTo(0, document.documentElement.scrollHeight),
			);
			for (let cycle = 0; cycle < 2; cycle++) {
				for (const direction of ["enter", "exit"]) {
					await page
						.locator(
							direction === "enter"
								? "[data-instant-v2-dashboard-demo]"
								: "[data-instant-v2-demo-exit]",
						)
						.evaluate((button) => {
							if (!(button instanceof HTMLButtonElement))
								throw new Error("Missing transition trigger");
							button.click();
							const animation = document
								.querySelector("[data-instant-v2-window]")
								?.getAnimations()[0];
							if (!animation) throw new Error("Expected entry/exit animation");
							// Pause in the click task so a busy browser cannot finish the
							// transition between the trigger and the geometry samples.
							animation.pause();
						});
					if (cycle === 0 && direction === "enter") {
						await page.evaluate(async () => {
							const animation = document
								.querySelector("[data-instant-v2-window]")
								?.getAnimations()[0];
							if (!animation) throw new Error("Expected entry animation");
							animation.pause();
							await animation.ready;
						});
						// Product controls must work even while geometry is paused.
						await page.waitForTimeout(1300);
						await product.locator("[data-demo-surface]:not([inert])").waitFor();
						expect(
							await product.locator("html[data-demo-hydrated]").count(),
						).toBe(1);
					}
					const samples = await page.evaluate(
						async (cancel) => {
							const frame = document.querySelector<HTMLIFrameElement>(
								"[data-instant-v2-product-iframe]",
							);
							const dashboard = document.querySelector<HTMLElement>(
								"[data-instant-v2-window]",
							);
							const animation = dashboard?.getAnimations()[0];
							if (!frame?.contentWindow || !dashboard || !animation)
								throw new Error("Expected an animated live product window");
							animation.pause();
							await animation.ready;
							const widths = [];
							// Sample the actual nested viewport while seeking the outer motion.
							for (const time of [0, 180, 260, 400, 600, 790]) {
								animation.currentTime = time;
								await new Promise(requestAnimationFrame);
								widths.push({
									product: frame.contentWindow.innerWidth,
									window: dashboard.getBoundingClientRect().width,
								});
							}
							if (cancel) animation.cancel();
							else animation.finish();
							return widths;
						},
						cycle === 1 && direction === "exit",
					);
					expect(
						new Set(samples.map((sample) => sample.product)).size,
					).toBeGreaterThan(3);
					for (const sample of samples) {
						expect(Math.abs(sample.product - sample.window)).toBeLessThan(2);
					}
					const first = samples[0];
					const last = samples.at(-1);
					assert(first && last);
					expect(Math.abs(first.window - last.window)).toBeGreaterThan(10);
					await page.waitForFunction((entering) => {
						const bar = document.querySelector(".instant-v2-demo-bar");
						const enter = document.querySelector<HTMLButtonElement>(
							"[data-instant-v2-dashboard-demo]",
						);
						return entering
							? bar?.getAttribute("data-stage") === "visible"
							: !bar && enter && !enter.disabled;
					}, direction === "enter");
					if (direction === "enter") {
						expect(
							await originalRow.evaluate(
								(node) =>
									node ===
									document.querySelector('[aria-label="Recent sessions"] li'),
							),
						).toBe(true);
						expect(
							await product
								.locator('link[rel="stylesheet"]')
								.evaluateAll((links) =>
									links.map((link) => link.getAttribute("href")),
								),
						).toEqual(initialStylesheets);
						expect(
							await product.locator("html[data-demo-hydration-error]").count(),
						).toBe(0);
					}
					// A completed transition must not leave a pixel width behind.
					await page.setViewportSize({
						width: viewport.width - 80,
						height: viewport.height,
					});
					await page.waitForFunction(() => {
						const frame = document.querySelector<HTMLIFrameElement>(
							"[data-instant-v2-product-iframe]",
						);
						return (
							frame?.parentElement &&
							Math.abs(frame.clientWidth - frame.parentElement.clientWidth) <= 1
						);
					});
					await page.setViewportSize(viewport);
				}
			}
			await page.close();
		}
	} finally {
		await browser.close();
	}
}, 45_000);

test("primary navigation only exposes released working destinations", async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 1440, height: 1000 },
		});
		await openDemoPreview(page, LANDING);
		await page
			.locator(
				'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
			)
			.waitFor({ state: "attached" });
		await page.locator("[data-instant-v2-dashboard-demo]").click();
		const frame = page.frameLocator(FRAME);
		await frame.locator("html[data-demo-live]").waitFor();
		await page.locator("html[data-instant-v2-demo-layout-settled]").waitFor();
		const primaryNavigation = frame.getByRole("navigation", {
			name: "Primary",
			exact: true,
		});
		for (const label of ["Dashboard", "Skills"]) {
			expect(
				await primaryNavigation.getByLabel(label, { exact: true }).count(),
			).toBe(0);
		}
		const releasedDestinations = [
			["Sessions", "/session"],
			["Team", "/team"],
			["Settings", "/settings"],
		] satisfies readonly (readonly [string, string])[];
		for (const [label, href] of releasedDestinations) {
			const tab = primaryNavigation.getByLabel(label, { exact: true });
			expect(await tab.getAttribute("href")).toBe(href);
			expect(await tab.getAttribute("aria-disabled")).toBeNull();
			expect(await tab.getAttribute("tabindex")).toBeNull();
			await tab.hover();
			const tooltip = frame.locator('[data-slot="tooltip-content"][data-open]');
			await tooltip.waitFor({ timeout: 3000 });
			expect(await tooltip.textContent()).not.toContain("Coming soon");
			expect(await tooltip.locator('[data-slot="kbd"]').count()).toBe(1);
		}

		await primaryNavigation.getByLabel("Team", { exact: true }).click();
		await frame.locator('[aria-label="Team"][aria-current="page"]').waitFor();
		await frame.getByLabel("Settings", { exact: true }).click();
		const settingsSections = frame.getByRole("navigation", {
			name: "Settings sections",
			exact: true,
		});
		await settingsSections.waitFor();
		expect(
			await frame
				.getByRole("link", { name: "Back to app", exact: true })
				.count(),
		).toBe(0);
		expect(
			await primaryNavigation
				.getByLabel("Settings", { exact: true })
				.getAttribute("aria-current"),
		).toBe("page");
		await settingsSections
			.getByRole("link", { name: "Account", exact: true })
			.click();
		await primaryNavigation.getByLabel("Sessions", { exact: true }).click();
		await frame.getByRole("list", { name: "Recent sessions" }).waitFor();

		const product = await browser.newPage();
		// /home belongs to marketing here; the legacy product alias reaches
		// the same dashboard gate through client-side routing.
		for (const path of ["/dashboard", "/skills"]) {
			const response = await product.goto(`http://localhost:4600${path}`);
			expect(response?.status()).toBe(200);
			await product.waitForURL("**/session", { timeout: 10000 });
			const productNavigation = product.getByRole("navigation", {
				name: "Primary",
				exact: true,
			});
			await productNavigation.getByLabel("Sessions", { exact: true }).waitFor();
			expect(
				await productNavigation.locator('[aria-disabled="true"]').count(),
			).toBe(0);
		}
	} finally {
		await browser.close();
	}
}, 60_000);
function isLiveRequest(url: string) {
	return /^\/(api|rpc)\//.test(new URL(url).pathname);
}

test("Explore enables scrolling without another click inside the product", async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 1440, height: 1000 },
		});
		await openDemoPreview(page, LANDING);
		await page
			.locator(
				'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
			)
			.waitFor({ state: "attached" });
		const frame = page.frameLocator(FRAME);
		await page.locator("[data-instant-v2-dashboard-demo]").click();
		await page.locator("html[data-instant-v2-demo-layout-settled]").waitFor();
		await frame.locator("html[data-demo-live]").waitFor();
		const scroll = frame.locator(
			'[data-slot="sessions-overview-scroll-container"]',
		);
		await scroll.hover({ position: { x: 400, y: 240 } });
		// Leave room for PageDown with the smaller local showcase dataset too.
		await page.mouse.wheel(0, 100);
		await page.waitForTimeout(250);
		expect(await scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
		const afterWheel = await scroll.evaluate((node) => node.scrollTop);
		await page.keyboard.press("PageDown");
		await page.waitForTimeout(250);
		expect(await scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(
			afterWheel,
		);
		expect(
			await page
				.locator(FRAME)
				.evaluate((node) => document.activeElement === node),
		).toBe(true);
		await page.getByRole("button", { name: "Exit demo" }).waitFor();
		await page.keyboard.press("Escape");
		await page
			.locator("html[data-instant-v2-demo]")
			.waitFor({ state: "detached" });
	} finally {
		await browser.close();
	}
}, 45_000);

test("connection failure preserves the preview and can be retried in place", async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 1440, height: 1000 },
		});
		let failConnection = true;
		let listRequests = 0;
		page.on("request", (request) => {
			if (request.url().includes("/rpc/analytics/sessions/list"))
				listRequests++;
		});
		await page.route("**/api/auth/organization/set-active", (route) =>
			failConnection
				? route.fulfill({
						status: 503,
						contentType: "application/json",
						body: "{}",
					})
				: route.continue(),
		);
		await openDemoPreview(page, LANDING);
		await page
			.locator(
				'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
			)
			.waitFor({ state: "attached" });
		const frame = page.frameLocator(FRAME);
		const list = frame.getByRole("list", { name: "Recent sessions" });
		await list.waitFor();
		const originalList = await list.elementHandle();
		assert(originalList);
		await page.locator("[data-instant-v2-dashboard-demo]").click();
		await frame
			.getByRole("alert")
			.filter({ hasText: "could not connect" })
			.waitFor();
		expect(listRequests).toBe(0);
		expect(await list.locator("li").count()).toBe(30);
		expect(await originalList.evaluate((node) => node.isConnected)).toBe(true);
		failConnection = false;
		await frame.getByRole("button", { name: "Try again" }).click();
		await frame.locator("html[data-demo-live]").waitFor();
		await list.locator("li").nth(49).waitFor();
		expect(await originalList.evaluate((node) => node.isConnected)).toBe(true);
		expect(await frame.locator("html[data-demo-hydration-error]").count()).toBe(
			0,
		);
	} finally {
		await browser.close();
	}
}, 45_000);

test("first paint is real product DOM and avatars, even without JavaScript", async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		for (const viewport of [
			{ width: 1440, height: 1000 },
			{ width: 390, height: 844 },
		]) {
			const page = await browser.newPage({
				viewport,
				javaScriptEnabled: false,
			});
			const requests: string[] = [];
			page.on("request", (request) => {
				if (isLiveRequest(request.url())) requests.push(request.url());
			});
			await openDemoPreview(page, LANDING);
			const frame = page.frameLocator(FRAME);
			const rows = frame
				.getByRole("list", { name: "Recent sessions" })
				.locator("li");
			await rows.first().waitFor();
			expect(await rows.count()).toBe(30);
			expect(
				await frame
					.locator('[data-slot="sessions-overview-controls"]')
					.isVisible(),
			).toBe(true);
			expect(
				await frame.locator('img[src^="/product-demo/demo-avatars/"]').count(),
			).toBeGreaterThanOrEqual(30);
			expect(
				await frame
					.locator("img")
					.evaluateAll((images) =>
						images.every((image) => image.complete && image.naturalWidth > 0),
					),
			).toBe(true);
			expect(await frame.getByText("Loading the product demo…").count()).toBe(
				0,
			);
			expect(
				await page.locator("[data-instant-v2-product-preview]").count(),
			).toBe(0);
			expect(requests).toEqual([]);
			await page.close();
		}
	} finally {
		await browser.close();
	}
}, 30_000);

test("Explore activates prepared nodes, loads real data and retains navigation on re-entry", async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 1440, height: 1000 },
			timezoneId: "America/Los_Angeles",
		});
		const requests: string[] = [];
		const errors: string[] = [];
		page.on("request", (request) => requests.push(request.url()));
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});
		page.on("response", (response) => {
			if (response.status() >= 400)
				errors.push(`${response.status()} ${response.url()}`);
		});
		await openDemoPreview(page, LANDING);
		const frame = page.frameLocator(FRAME);
		const list = frame.getByRole("list", { name: "Recent sessions" });
		await list.waitFor();
		const originalList = await list.elementHandle();
		const originalRow = await list.locator("li").first().elementHandle();
		const originalShell = await frame
			.locator('[data-slot="session-workspace"]')
			.elementHandle();
		assert(originalList && originalRow && originalShell);
		const originalMagnitudes = await list
			.locator("li")
			.first()
			.getByRole("progressbar")
			.evaluateAll((nodes) =>
				nodes.map((node) => node.getAttribute("aria-valuenow")),
			);
		await page
			.locator(
				'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
			)
			.waitFor({ state: "attached" });
		const enter = page.locator("[data-instant-v2-dashboard-demo]");
		await enter.scrollIntoViewIfNeeded();
		await enter.hover();
		await page.waitForTimeout(750);
		expect(requests.filter(isLiveRequest)).toEqual([]);
		const scripts = requests.filter(
			(url) =>
				new URL(url).pathname.startsWith("/product-demo/") &&
				url.endsWith(".js"),
		);
		expect(scripts.some((url) => url.includes("/assets/demo-"))).toBe(true);
		await frame.locator("html[data-demo-hydrated]").waitFor();
		expect(await frame.locator("[data-demo-surface][inert]").count()).toBe(1);
		const responsePromise = page.waitForResponse((response) =>
			response.url().includes("/rpc/analytics/sessions/list"),
		);
		await enter.click();
		const response = await responsePromise;
		expect(response.status()).toBe(200);
		expect((await response.json()).json).toHaveLength(93);
		await frame.locator("html[data-demo-live]").waitFor();
		await list.locator("li").nth(49).waitFor();
		expect(
			await originalList.evaluate(
				(node) =>
					node === document.querySelector('[aria-label="Recent sessions"]'),
			),
		).toBe(true);
		expect(
			await originalRow.evaluate(
				(node) =>
					node === document.querySelector('[aria-label="Recent sessions"] li'),
			),
		).toBe(true);
		expect(await originalShell.evaluate((node) => node.isConnected)).toBe(true);
		expect(
			await list
				.locator("li")
				.first()
				.getByRole("progressbar")
				.evaluateAll((nodes) =>
					nodes.map((node) => node.getAttribute("aria-valuenow")),
				),
		).toEqual(originalMagnitudes);
		expect(await frame.locator("html[data-demo-hydration-error]").count()).toBe(
			0,
		);
		const detailResponse = page.waitForResponse((response) =>
			/\/detail(Window|Turn)$/.test(new URL(response.url()).pathname),
		);
		await list.locator("li").first().click();
		expect((await detailResponse).status()).toBe(200);
		const detail = frame.locator('[aria-label="Selected session detail"]');
		await detail.waitFor();
		await frame
			.getByText("Loading selected turn", { exact: true })
			.waitFor({ state: "hidden" });
		expect(
			await frame.getByText("Unexpected Session Data", { exact: true }).count(),
		).toBe(0);
		const originalDetail = await detail.elementHandle();
		assert(originalDetail);
		await page.getByRole("button", { name: "Exit demo" }).click();
		await page
			.locator("html[data-instant-v2-demo]")
			.waitFor({ state: "detached" });
		await enter.click();
		await page.locator("html[data-instant-v2-demo-layout-settled]").waitFor();
		expect(await originalDetail.evaluate((node) => node.isConnected)).toBe(
			true,
		);
		expect(
			requests.filter(
				(url) => new URL(url).pathname === "/product-demo/demo.html",
			),
		).toHaveLength(1);
		expect(errors).toEqual([]);
	} finally {
		await browser.close();
	}
}, 60_000);

test("keyboard activation works with reduced motion across locales and timezones", async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		for (const locale of ["de-DE", "ar-EG"]) {
			const page = await browser.newPage({
				viewport: { width: 1440, height: 1000 },
				reducedMotion: "reduce",
				timezoneId: "Asia/Tokyo",
				locale,
			});
			const errors: string[] = [];
			page.on("console", (message) => {
				if (message.type() === "error") errors.push(message.text());
			});
			await openDemoPreview(page, LANDING);
			await page
				.locator(
					'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
				)
				.waitFor({ state: "attached" });
			const frame = page.frameLocator(FRAME);
			await frame.getByRole("list", { name: "Recent sessions" }).waitFor();
			expect(await frame.locator("[data-demo-surface][inert]").count()).toBe(1);
			const button = page.locator("[data-instant-v2-dashboard-demo]");
			await button.focus();
			await button.press("Enter");
			await frame.locator("html[data-demo-live]").waitFor();
			expect(
				await frame.locator("html[data-demo-hydration-error]").count(),
			).toBe(0);
			await page.getByRole("button", { name: "Exit demo" }).click();
			await page
				.locator("html[data-instant-v2-demo]")
				.waitFor({ state: "detached" });
			expect(await page.locator(FRAME).isVisible()).toBe(true);
			expect(errors).toEqual([]);
			await page.close();
		}
	} finally {
		await browser.close();
	}
}, 45_000);
