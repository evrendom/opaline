import { expect, test } from "bun:test";
import { type Page, webkit } from "@playwright/test";
import { usesSafariDemoMotion } from "../src/scripts/demo-browser";
import { openDemoPreview } from "./demo-preview";

async function scrollSafariLandingTo(page: Page, top: number | "end") {
	await page
		.locator("[data-instant-v2-scroll]")
		.evaluate((element, position) => {
			element.scrollTo({
				top: position === "end" ? element.scrollHeight : position,
				behavior: "instant",
			});
		}, top);
}

test("Safari overlaps the sweep and resize on entry and exit", async () => {
	const browser = await webkit.launch({ headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 2048, height: 1152 },
			deviceScaleFactor: 2,
		});
		await openDemoPreview(
			page,
			`http://localhost:${process.env.PREVIEW_PORT ?? 4600}/home`,
		);
		await page
			.locator(
				'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
			)
			.waitFor({ state: "attached" });
		await page.frameLocator("iframe").locator(".dashboard-01-window").waitFor();
		await scrollSafariLandingTo(page, "end");
		for (const direction of ["enter", "exit", "enter", "exit"]) {
			if (direction === "enter") {
				await page.waitForFunction(() => {
					const button = document.querySelector<HTMLButtonElement>(
						"[data-instant-v2-dashboard-demo]",
					);
					return button && !button.disabled && !button.inert;
				});
			}
			const result = await page.evaluate(async (direction) => {
				const trigger = document.querySelector<HTMLButtonElement>(
					direction === "enter"
						? "[data-instant-v2-dashboard-demo]"
						: "[data-instant-v2-demo-exit]",
				);
				if (!trigger) throw new Error("Missing demo trigger");
				trigger.click();
				const motion = document
					.querySelector("[data-instant-v2-window]")
					?.getAnimations()[0];
				if (!motion?.effect) throw new Error("Missing resize");
				await motion.ready;
				await new Promise(requestAnimationFrame);
				const sweep =
					document
						.querySelector("[data-instant-v2-demo-sweep]")
						?.getAnimations() ?? [];
				const controls = Array.from(
					document.querySelectorAll(
						".instant-v2-demo-bar > *, .instant-v2-dashboard-fade, .instant-v2-dashboard-demo-cta",
					),
				)
					.flatMap((element) => element.getAnimations())
					.filter(
						(animation) => animation.effect?.getTiming().duration === 620,
					);
				return {
					delay: motion.effect.getTiming().delay,
					duration: motion.effect.getTiming().duration,
					sweepOffsets: sweep.map((item) =>
						Math.abs(Number(item.startTime) - Number(motion.startTime)),
					),
					controlOffsets: controls.map((item) =>
						Math.abs(Number(item.startTime) - Number(motion.startTime)),
					),
				};
			}, direction);
			expect(result.delay).toBe(180);
			expect(result.duration).toBe(620);
			expect(result.sweepOffsets.length).toBe(2);
			for (const offset of result.sweepOffsets) expect(offset).toBeLessThan(1);
			expect(result.controlOffsets.length).toBeGreaterThan(0);
			for (const offset of result.controlOffsets)
				expect(offset).toBeLessThan(1);
			await page.waitForFunction(
				(entering) =>
					entering
						? document.querySelector(
								'.instant-v2-demo-bar[data-stage="visible"]',
							) !== null
						: document.querySelector(".instant-v2-demo-bar") === null,
				direction === "enter",
			);
		}
	} finally {
		await browser.close();
	}
}, 30_000);

test("Safari keeps the root stationary through landing scroll and demo restoration", async () => {
	const browser = await webkit.launch({ headless: true });
	try {
		for (const viewport of [
			{ width: 2048, height: 1152 },
			{ width: 1512, height: 982 },
		]) {
			const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
			page.setDefaultTimeout(10_000);
			await openDemoPreview(
				page,
				`http://localhost:${process.env.PREVIEW_PORT ?? 4600}/home`,
			);
			await page
				.locator(
					'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
				)
				.waitFor({ state: "attached" });
			await page.mouse.move(viewport.width / 2, 300);
			await page.mouse.wheel(0, 100);
			await page.waitForFunction(
				() =>
					Number(
						document.documentElement.style.getPropertyValue(
							"--instant-v2-hero-recede-progress",
						),
					) > 0.1,
			);
			expect(await page.evaluate(() => window.scrollY)).toBe(0);
			const scroller = page.locator("[data-instant-v2-scroll]");
			await page.waitForFunction(
				() => !document.querySelector(".lenis-scrolling"),
			);
			expect(
				await scroller.evaluate((element) => element.scrollTop),
			).toBeCloseTo(100, 0);
			expect(
				await page
					.locator("[data-instant-v2-hero-content]")
					.evaluate((element) => Number(getComputedStyle(element).opacity)),
			).toBeCloseTo(1 - 80 / 180, 1);

			// Enter through the shared request while the landing is only partly
			// scrolled. Exit must refresh the gradient even if the offset stays put.
			await page.evaluate(() =>
				window.dispatchEvent(new CustomEvent("instant-v2:demo-enter")),
			);
			await page
				.locator('.instant-v2-demo-bar[data-stage="visible"]')
				.waitFor();
			await page.getByRole("button", { name: "Exit demo" }).click();
			await page.locator(".instant-v2-demo-bar").waitFor({ state: "detached" });
			expect(await scroller.evaluate((element) => element.scrollTop)).toBe(100);
			expect(
				await page
					.locator(".instant-v2-hero-gradient")
					.evaluate((element) => Number(getComputedStyle(element).opacity)),
			).toBe(0);

			await page.mouse.wheel(0, 2000);
			await page.waitForFunction(
				() =>
					document
						.querySelector("[data-instant-v2-product-window]")
						?.getBoundingClientRect().top === 42,
			);
			await page.waitForFunction(
				() => !document.querySelector(".lenis-scrolling"),
			);
			expect(
				await page
					.locator(".instant-v2-hero-gradient")
					.evaluate((element) => Number(getComputedStyle(element).opacity)),
			).toBe(1);
			expect(
				await page
					.locator("[data-instant-v2-nav]")
					.evaluate((element) => element.getBoundingClientRect().top),
			).toBe(0);
			const savedScroll = await scroller.evaluate(
				(element) => element.scrollTop,
			);
			expect(savedScroll).toBeGreaterThan(100);
			for (const exit of ["button", "history"]) {
				await page.locator("[data-instant-v2-dashboard-demo]").click();
				await page
					.locator('.instant-v2-demo-bar[data-stage="visible"]')
					.waitFor();
				expect(await page.evaluate(() => window.scrollY)).toBe(0);
				expect(await scroller.evaluate((element) => element.scrollTop)).toBe(
					savedScroll,
				);
				if (exit === "button")
					await page.getByRole("button", { name: "Exit demo" }).click();
				else await page.goBack();
				await page
					.locator(".instant-v2-demo-bar")
					.waitFor({ state: "detached" });
				expect(await page.evaluate(() => window.scrollY)).toBe(0);
				expect(await scroller.evaluate((element) => element.scrollTop)).toBe(
					savedScroll,
				);
				expect(
					await page
						.locator("[data-instant-v2-product-window]")
						.evaluate((element) => element.getBoundingClientRect().top),
				).toBe(42);
			}

			await page.emulateMedia({ reducedMotion: "reduce" });
			await page.waitForFunction(() => !document.querySelector(".lenis"));
			await page.mouse.move(viewport.width / 2, 100);
			await page.mouse.wheel(0, -2000);
			await page.waitForFunction(
				() =>
					document.querySelector("[data-instant-v2-scroll]")?.scrollTop === 0,
			);
			expect(await page.evaluate(() => window.scrollY)).toBe(0);
			await page.close();
		}
	} finally {
		await browser.close();
	}
}, 40_000);

test("Safari keeps phone scrolling and keyboard navigation inside the landing container", async () => {
	const browser = await webkit.launch({ headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 390, height: 844 },
			deviceScaleFactor: 2,
		});
		await openDemoPreview(
			page,
			`http://localhost:${process.env.PREVIEW_PORT ?? 4600}/home`,
		);
		await page
			.locator("[data-instant-v2-scroll].lenis")
			.waitFor({ state: "attached" });
		const scroller = page.locator("[data-instant-v2-scroll]");
		await page.mouse.move(195, 300);
		await page.mouse.wheel(0, 100);
		await page.waitForFunction(
			() =>
				(document.querySelector("[data-instant-v2-scroll]")?.scrollTop ?? 0) >
				50,
		);
		expect(await page.evaluate(() => window.scrollY)).toBe(0);
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.waitForFunction(() => !document.querySelector(".lenis"));
		await scroller.focus();
		await page.keyboard.press("End");
		await page.waitForFunction(
			() =>
				document
					.querySelector("[data-instant-v2-product-window]")
					?.getBoundingClientRect().top === 42,
		);
		await page.waitForFunction(() => {
			const gradient = document.querySelector(".instant-v2-hero-gradient");
			return gradient && getComputedStyle(gradient).opacity === "1";
		});
		expect(await page.evaluate(() => window.scrollY)).toBe(0);
		expect(
			await page
				.locator(".instant-v2-hero-gradient")
				.evaluate((element) => Number(getComputedStyle(element).opacity)),
		).toBe(1);
		await page.setViewportSize({ width: 844, height: 390 });
		expect(await scroller.evaluate((element) => element.clientHeight)).toBe(
			390,
		);
		await page.keyboard.press("Home");
		await page.waitForFunction(
			() => document.querySelector("[data-instant-v2-scroll]")?.scrollTop === 0,
		);
		expect(
			await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })),
		).toEqual({ x: 0, y: 0 });
		await page.close();
	} finally {
		await browser.close();
	}
}, 30_000);

test("selects the WebKit workaround without misclassifying desktop Chromium", () => {
	for (const ua of [
		"Mozilla/5.0 AppleWebKit/605.1.15 Version/26.5 Safari/605.1.15",
		"Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/145.0 Mobile Safari/604.1",
	]) {
		expect(usesSafariDemoMotion(ua)).toBe(true);
	}
	for (const ua of [
		"Mozilla/5.0 AppleWebKit/537.36 Chrome/145.0 Safari/537.36",
		"Mozilla/5.0 AppleWebKit/537.36 Chrome/145.0 Safari/537.36 Edg/145.0",
		"Mozilla/5.0 AppleWebKit/537.36 Chromium/145.0 Safari/537.36",
		"Mozilla/5.0 Gecko/20100101 Firefox/145.0",
	]) {
		expect(usesSafariDemoMotion(ua)).toBe(false);
	}
});

test("Safari keeps landing wheel input over the preview and releases it inside the demo", async () => {
	const browser = await webkit.launch({ headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 2048, height: 1152 },
			deviceScaleFactor: 2,
		});
		await openDemoPreview(
			page,
			`http://localhost:${process.env.PREVIEW_PORT ?? 4600}/home`,
		);
		await page
			.locator(
				'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
			)
			.waitFor({ state: "attached" });
		await page.locator("[data-canvas-ready]").waitFor({ state: "attached" });
		await page.evaluate(() => {
			Reflect.set(window, "landingWheelCount", 0);
			// Register only in the parent. An iframe wheel listener changes WebKit's routing.
			window.addEventListener(
				"wheel",
				() => {
					Reflect.set(
						window,
						"landingWheelCount",
						Reflect.get(window, "landingWheelCount") + 1,
					);
				},
				{ passive: true },
			);
		});
		const checkLandingScroll = async () => {
			await page.waitForFunction(() =>
				document.querySelector("[data-instant-v2-scroll].lenis"),
			);
			await scrollSafariLandingTo(page, 0);
			await page.waitForFunction(
				() =>
					scrollY === 0 &&
					document.querySelector("[data-instant-v2-scroll]")?.scrollTop === 0 &&
					!document.querySelector(".lenis-scrolling"),
			);
			await page.mouse.move(80, 600);
			await page.evaluate(() => Reflect.set(window, "landingWheelCount", 0));
			for (const direction of [1, -1]) {
				for (let step = 0; step < 10; step++) {
					await page.mouse.wheel(0, 60 * direction);
					await page.waitForTimeout(70);
				}
				await page.waitForTimeout(500);
				if (direction === 1) {
					expect(
						await page
							.locator("[data-instant-v2-scroll]")
							.evaluate((element) => element.scrollTop),
					).toBeGreaterThan(300);
				}
			}
			expect(
				await page.evaluate(() => Reflect.get(window, "landingWheelCount")),
			).toBe(20);
			expect(await page.evaluate(() => scrollY)).toBe(0);
			expect(
				await page
					.locator("[data-instant-v2-scroll]")
					.evaluate((element) => element.scrollTop),
			).toBe(0);
		};
		await checkLandingScroll();
		await page.locator("[data-instant-v2-dashboard-demo]").click();
		await page.locator(".instant-v2-demo-bar[data-stage='visible']").waitFor();
		const frame = page.frameLocator("[data-instant-v2-product-iframe]");
		await frame
			.locator("html[data-demo-hydrated]")
			.waitFor({ state: "attached" });
		const scroll = frame.locator(
			'[data-slot="sessions-overview-scroll-container"]',
		);
		await scroll.hover({ position: { x: 400, y: 240 } });
		await page.mouse.wheel(0, 100);
		await page.waitForTimeout(250);
		expect(await scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
		await page.getByRole("button", { name: "Exit demo" }).click();
		await page.locator(".instant-v2-demo-bar").waitFor({ state: "detached" });
		await checkLandingScroll();
		await page.close();
	} finally {
		await browser.close();
	}
}, 30_000);

test("Safari moves the window without stretching text and releases every transition", async () => {
	const browser = await webkit.launch({ headless: true });
	try {
		for (const viewport of [
			{ width: 1512, height: 982 },
			{ width: 2048, height: 1152 },
		]) {
			const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
			await openDemoPreview(
				page,
				`http://localhost:${process.env.PREVIEW_PORT ?? 4600}/home`,
			);
			await page
				.locator(
					'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
				)
				.waitFor({ state: "attached" });
			await scrollSafariLandingTo(page, "end");
			expect(
				await page
					.frameLocator("iframe")
					.locator('[class*="mask:"]')
					.first()
					.evaluate((node) => getComputedStyle(node).willChange),
			).toBe("transform");
			for (let cycle = 0; cycle < 2; cycle++) {
				for (const direction of ["enter", "exit"]) {
					const originalPositions =
						cycle === 0 && direction === "enter"
							? await page.evaluate(() => {
									const frame = document.querySelector<HTMLIFrameElement>(
										"[data-instant-v2-product-iframe]",
									);
									const origin = frame?.getBoundingClientRect();
									const row = frame?.contentDocument?.querySelector(
										'[data-dashboard-grid-row-scope="session"]',
									);
									if (!origin || !row) throw new Error("Expected preview text");
									return Array.from(row.children, (node) => {
										const rect = node.getBoundingClientRect();
										return {
											x: origin.x + rect.x,
											y: origin.y + rect.y,
											width: rect.width,
										};
									});
								})
							: null;
					await page
						.locator(
							direction === "enter"
								? "[data-instant-v2-dashboard-demo]"
								: "[data-instant-v2-demo-exit]",
						)
						.click();
					const samples = await page.evaluate(
						async (cancel) => {
							const dashboard = document.querySelector<HTMLElement>(
								"[data-instant-v2-window]",
							);
							const frame = document.querySelector<HTMLIFrameElement>(
								"[data-instant-v2-product-iframe]",
							);
							if (!dashboard || !frame?.contentDocument || !frame.contentWindow)
								throw new Error("Expected product iframe");
							const animation = dashboard.getAnimations()[0];
							if (!animation) throw new Error("Expected window animation");
							if (
								!(animation.effect instanceof KeyframeEffect) ||
								!animation.effect
									.getKeyframes()
									.some((keyframe) => "transform" in keyframe)
							)
								throw new Error("Expected Safari's transform path");
							const contentAnimations = [
								...frame.getAnimations(),
								...frame.contentDocument.getAnimations(),
							];
							const allAnimations = [animation, ...contentAnimations];
							for (const item of allAnimations) item.pause();
							await Promise.all(allAnimations.map((item) => item.ready));
							const samples = [];
							const { delay, duration } = animation.effect.getTiming();
							if (typeof duration !== "number")
								throw new Error("Expected finite resize duration");
							for (const time of [
								0,
								delay,
								delay + duration * 0.1,
								delay + duration * 0.35,
								delay + duration * 0.7,
								delay + duration * 0.98,
							]) {
								for (const item of allAnimations) item.currentTime = time;
								await new Promise(requestAnimationFrame);
								const frameBounds = frame.getBoundingClientRect();
								const row = frame.contentDocument.querySelector(
									'[data-dashboard-grid-row-scope="session"]',
								);
								samples.push({
									width: dashboard.getBoundingClientRect().width,
									height: dashboard.getBoundingClientRect().height,
									viewport: frame.contentWindow.innerWidth,
									frameWidth: frameBounds.width,
									frameHeight: frameBounds.height,
									positions: Array.from(row?.children ?? [], (node) => {
										const rect = node.getBoundingClientRect();
										return {
											width:
												(rect.width * frameBounds.width) / frame.clientWidth,
											x:
												frameBounds.x +
												(rect.x * frameBounds.width) / frame.clientWidth,
											y:
												frameBounds.y +
												(rect.y * frameBounds.height) / frame.clientHeight,
										};
									}),
								});
							}
							if (cancel) animation.cancel();
							else animation.finish();
							return samples;
						},
						cycle === 1 && direction === "exit",
					);
					if (originalPositions) {
						const positions = samples[0]?.positions;
						expect(positions?.length).toBe(originalPositions.length);
						for (const [index, original] of originalPositions.entries()) {
							const current = positions?.[index];
							if (!current) throw new Error("Missing animated text");
							expect(Math.abs(current.x - original.x)).toBeLessThan(0.75);
							expect(Math.abs(current.y - original.y)).toBeLessThan(0.75);
							expect(Math.abs(current.width - original.width)).toBeLessThan(
								0.75,
							);
						}
					}
					expect(
						new Set(samples.map((sample) => Math.round(sample.width))).size,
					).toBeGreaterThan(3);
					expect(new Set(samples.map((sample) => sample.viewport)).size).toBe(
						1,
					);
					for (const sample of samples) {
						// The iframe's paint viewport must cover the moving window,
						// including the larger starting bounds during exit.
						expect(Math.abs(sample.frameWidth - sample.width)).toBeLessThan(
							0.01,
						);
						expect(Math.abs(sample.frameHeight - sample.height)).toBeLessThan(
							0.01,
						);
						// Column edges must travel together even when the product
						// changes which metrics are grouped into each column.
						const columns = sample.positions.filter(
							(column) => column.width > 0,
						);
						expect(columns.length).toBeGreaterThan(1);
						for (const [index, column] of columns.slice(1).entries()) {
							const previous = columns[index];
							if (!previous) throw new Error("Expected preceding column");
							expect(
								Math.abs(previous.x + previous.width - column.x),
							).toBeLessThan(0.75);
						}
					}
					await page.waitForFunction((entering) => {
						const bar = document.querySelector(".instant-v2-demo-bar");
						const enter = document.querySelector<HTMLButtonElement>(
							"[data-instant-v2-dashboard-demo]",
						);
						return entering
							? bar?.getAttribute("data-stage") === "visible"
							: !bar && enter && !enter.disabled;
					}, direction === "enter");
					expect(
						await page.locator("[data-instant-v2-demo-sweep]").count(),
					).toBe(0);
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
							Math.abs(frame.clientWidth - frame.parentElement.clientWidth) <=
								1 &&
							frame.style.transformOrigin === ""
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
}, 60_000);

test("Safari keeps the inner window and scroll boundaries attached to the resizing outer window", async () => {
	const browser = await webkit.launch({ headless: true });
	try {
		for (const viewport of [
			{ width: 1512, height: 982 },
			{ width: 2048, height: 1152 },
			{ width: 2560, height: 1440 },
		]) {
			const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
			await openDemoPreview(
				page,
				`http://localhost:${process.env.PREVIEW_PORT ?? 4600}/home`,
			);
			await page
				.locator(
					'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
				)
				.waitFor({ state: "attached" });
			await page
				.frameLocator("iframe")
				.locator(".dashboard-01-window")
				.waitFor();
			await scrollSafariLandingTo(page, "end");
			for (const direction of ["enter", "exit"]) {
				const result = await page.evaluate(async (direction) => {
					const outer = document.querySelector<HTMLElement>(
						"[data-instant-v2-window]",
					);
					const frame = document.querySelector<HTMLIFrameElement>(
						"[data-instant-v2-product-iframe]",
					);
					const doc = frame?.contentDocument;
					if (!outer || !frame || !doc)
						throw new Error("Expected product window");
					const surfaces = [
						{
							selector: ".dashboard-01-chrome-frame",
							fixedWidth: false,
							fixedHeight: false,
						},
						{
							selector: ".dashboard-01-window",
							fixedWidth: false,
							fixedHeight: false,
						},
						{
							selector: '[data-slot="sessions-overview-scroll-container"]',
							fixedWidth: false,
							fixedHeight: false,
						},
						{
							selector: '[data-slot="sidebar-container"]',
							fixedWidth: true,
							fixedHeight: false,
						},
						{
							selector: '[data-slot="sidebar-inner"]',
							fixedWidth: true,
							fixedHeight: false,
						},
						{
							selector:
								'[data-slot="sidebar-inner"] > [data-slot="sidebar-inner"]',
							fixedWidth: true,
							fixedHeight: false,
						},
						{
							selector: '[data-slot="sessions-overview-header"]',
							fixedWidth: false,
							fixedHeight: true,
						},
					];
					const originalElements = surfaces.map(({ selector }) =>
						doc.querySelector(selector),
					);
					function measure() {
						if (!outer || !frame || !doc)
							throw new Error("Product window disappeared");
						const windowBounds = outer.getBoundingClientRect();
						const frameBounds = frame.getBoundingClientRect();
						const scaleX = frameBounds.width / frame.clientWidth;
						const scaleY = frameBounds.height / frame.clientHeight;
						return [
							{
								selector: "iframe paint viewport",
								edges: [
									frameBounds.left - windowBounds.left,
									frameBounds.top - windowBounds.top,
									windowBounds.right - frameBounds.right,
									windowBounds.bottom - frameBounds.bottom,
								],
							},
							...surfaces.map(
								({ selector, fixedWidth, fixedHeight }, index) => {
									const element = doc.querySelector(selector);
									if (!element) throw new Error(`Missing ${selector}`);
									if (element !== originalElements[index])
										throw new Error(`${selector} was replaced during motion`);
									const bounds = element.getBoundingClientRect();
									return {
										selector,
										edges: [
											frameBounds.left +
												bounds.left * scaleX -
												windowBounds.left,
											frameBounds.top + bounds.top * scaleY - windowBounds.top,
											fixedWidth
												? bounds.width * scaleX
												: windowBounds.right -
													frameBounds.left -
													bounds.right * scaleX,
											fixedHeight
												? bounds.height * scaleY
												: windowBounds.bottom -
													frameBounds.top -
													bounds.bottom * scaleY,
										],
									};
								},
							),
						];
					}
					const before = measure();
					const trigger = document.querySelector<HTMLButtonElement>(
						direction === "enter"
							? "[data-instant-v2-dashboard-demo]"
							: "[data-instant-v2-demo-exit]",
					);
					if (!trigger) throw new Error("Missing transition control");
					trigger.click();
					const samples = [
						{ time: "immediately after click", surfaces: measure() },
					];
					const motion = outer.getAnimations()[0];
					if (!motion?.effect) throw new Error("Missing resize animation");
					const animations = [
						motion,
						...frame.getAnimations(),
						...doc.getAnimations(),
					];
					for (const animation of animations) animation.pause();
					await Promise.all(animations.map((animation) => animation.ready));
					const { delay, duration } = motion.effect.getTiming();
					if (typeof duration !== "number")
						throw new Error("Expected numeric duration");
					for (const time of [
						0,
						delay,
						delay + duration * 0.1,
						delay + duration * 0.35,
						delay + duration * 0.7,
						delay + duration * 0.98,
					]) {
						for (const animation of animations) animation.currentTime = time;
						await new Promise(requestAnimationFrame);
						samples.push({ time: String(time), surfaces: measure() });
					}
					motion.finish();
					return { before, samples };
				}, direction);
				for (const sample of result.samples) {
					for (const [index, surface] of sample.surfaces.entries()) {
						const original = result.before[index];
						if (!original) throw new Error("Missing original surface");
						for (const [edge, value] of surface.edges.entries()) {
							const originalValue = original.edges[edge];
							if (originalValue === undefined)
								throw new Error("Missing original edge");
							expect(
								Math.abs(value - originalValue),
								`${viewport.width}px ${direction}: ${surface.selector}, edge ${edge}, ${sample.time}`,
							).toBeLessThan(0.75);
						}
					}
				}
				await page.waitForFunction(
					(entering) =>
						entering
							? document
									.querySelector(".instant-v2-demo-bar")
									?.getAttribute("data-stage") === "visible"
							: !document.querySelector(".instant-v2-demo-bar"),
					direction === "enter",
				);
			}
			await page.waitForFunction(() =>
				document
					.querySelector<HTMLIFrameElement>("iframe")
					?.contentDocument?.documentElement.hasAttribute("data-demo-hydrated"),
			);
			expect(
				await page
					.frameLocator("iframe")
					.locator("html")
					.evaluate((root) => root.hasAttribute("data-demo-hydration-error")),
			).toBe(false);
			expect(
				await page
					.frameLocator("iframe")
					.locator("html")
					.evaluate((root) => root.hasAttribute("data-safari-demo-motion")),
			).toBe(false);
			await page.close();
		}
	} finally {
		await browser.close();
	}
}, 60_000);

test("Safari keeps glyphs unscaled while narrow labels change and cleans up cancellation", async () => {
	const browser = await webkit.launch({ headless: true });
	try {
		for (const cancel of [false, true]) {
			const page = await browser.newPage({
				viewport: { width: 1380, height: 982 },
				deviceScaleFactor: 2,
			});
			await openDemoPreview(
				page,
				`http://localhost:${process.env.PREVIEW_PORT ?? 4600}/home`,
			);
			await page
				.locator(
					'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
				)
				.waitFor({ state: "attached" });
			await scrollSafariLandingTo(page, "end");
			const result = await page.evaluate(async (cancel) => {
				const frame = document.querySelector<HTMLIFrameElement>(
					"[data-instant-v2-product-iframe]",
				);
				const dashboard = document.querySelector("[data-instant-v2-window]");
				const enter = document.querySelector<HTMLButtonElement>(
					"[data-instant-v2-dashboard-demo]",
				);
				if (
					!frame?.contentDocument ||
					!frame.contentWindow ||
					!dashboard ||
					!enter
				)
					throw new Error("Expected demo");
				const doc = frame.contentDocument;
				await doc.fonts.ready;
				const model = doc.querySelector("[data-session-overview-model-label]");
				if (!model) throw new Error("Expected model text");
				const glyphWidth = (element: Element) => {
					const range = doc.createRange();
					range.selectNodeContents(element);
					return (
						(range.getBoundingClientRect().width *
							frame.getBoundingClientRect().width) /
						frame.clientWidth
					);
				};
				const originalGlyphWidth = glyphWidth(model);
				enter.click();
				const master = dashboard.getAnimations()[0];
				if (!master?.effect) throw new Error("Expected window motion");
				await master.ready;
				await new Promise(requestAnimationFrame);
				const { delay, duration } = master.effect.getTiming();
				if (typeof duration !== "number")
					throw new Error("Expected numeric duration");
				const inner = doc
					.getAnimations()
					.filter((animation) => animation.effect?.getTiming().delay === delay);
				const contentOrigin = frame.contentWindow.performance.timeOrigin;
				const clockOffsets = inner.map((animation) =>
					Math.abs(
						Number(animation.startTime) +
							contentOrigin -
							Number(master.startTime) -
							performance.timeOrigin,
					),
				);
				const all = [master, ...frame.getAnimations(), ...inner];
				for (const animation of all) animation.pause();
				await Promise.all(all.map((animation) => animation.ready));
				const copies = Array.from(
					doc.querySelectorAll<HTMLElement>("[data-safari-demo-text-copy]"),
				);
				const hosts = Array.from(
					new Set(copies.map((copy) => copy.parentElement)),
				);
				const samples = [];
				for (const time of [
					0,
					delay,
					delay + duration * 0.13,
					delay + duration * 0.4,
					delay + duration * 0.73,
					delay + duration * 0.999,
				]) {
					for (const animation of all) animation.currentTime = time;
					await new Promise(requestAnimationFrame);
					samples.push({
						glyphWidth: glyphWidth(model),
						copies: copies.map((copy) => ({
							width: glyphWidth(copy),
							opacity: Number(doc.defaultView?.getComputedStyle(copy).opacity),
							hidden: copy.getAttribute("aria-hidden"),
						})),
					});
				}
				const liveHost = hosts[0];
				if (!liveHost) throw new Error("Expected changing label");
				for (const animation of all)
					animation.currentTime = delay + duration * 0.4;
				liveHost.textContent = "Updated during motion";
				await new Promise(requestAnimationFrame);
				const liveTextVisible =
					liveHost.style.webkitTextFillColor !== "transparent" &&
					liveHost.querySelectorAll("[data-safari-demo-text-copy]").length ===
						0;
				if (cancel) master.cancel();
				else master.finish();
				await new Promise(requestAnimationFrame);
				return {
					liveTextVisible,
					originalGlyphWidth,
					clockOffsets,
					samples,
					remainingCopies: doc.querySelectorAll("[data-safari-demo-text-copy]")
						.length,
					restored: hosts.every(
						(host) =>
							host?.style.webkitTextFillColor !== "transparent" &&
							host?.style.transformOrigin === "",
					),
				};
			}, cancel);
			expect(result.clockOffsets.length).toBeGreaterThan(0);
			for (const offset of result.clockOffsets) expect(offset).toBeLessThan(1);
			const firstCopies = result.samples[0]?.copies;
			if (!firstCopies) throw new Error("Expected label samples");
			expect(firstCopies.length).toBeGreaterThan(0);
			for (const sample of result.samples) {
				expect(
					Math.abs(sample.glyphWidth - result.originalGlyphWidth),
				).toBeLessThan(0.5);
				for (const [index, copy] of sample.copies.entries()) {
					const first = firstCopies[index];
					if (!first) throw new Error("Expected matching label");
					expect(Math.abs(copy.width - first.width)).toBeLessThan(0.5);
					expect(copy.hidden).toBe("true");
				}
			}
			expect(firstCopies[0]?.opacity).toBe(1);
			expect(firstCopies[1]?.opacity).toBe(0);
			expect(result.samples.at(-1)?.copies[0]?.opacity).toBeLessThan(0.01);
			expect(result.samples.at(-1)?.copies[1]?.opacity).toBeGreaterThan(0.99);
			expect(result.remainingCopies).toBe(0);
			expect(result.restored).toBe(true);
			expect(result.liveTextVisible).toBe(true);
			await page.close();
		}
	} finally {
		await browser.close();
	}
}, 30_000);

test("Safari reduced motion skips the sweep and still supports Escape", async () => {
	const browser = await webkit.launch({ headless: true });
	try {
		const page = await browser.newPage({ reducedMotion: "reduce" });
		await openDemoPreview(
			page,
			`http://localhost:${process.env.PREVIEW_PORT ?? 4600}/home`,
		);
		await page
			.locator(
				'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
			)
			.waitFor({ state: "attached" });
		await page.locator("[data-instant-v2-dashboard-demo]").click();
		await page.locator('.instant-v2-demo-bar[data-stage="visible"]').waitFor();
		expect(await page.locator("[data-instant-v2-demo-sweep]").count()).toBe(0);
		expect(
			await page.locator("[data-instant-v2-window]").evaluate((element) =>
				// Existing reduced-motion CSS keeps 0.01ms corner transitions.
				element
					.getAnimations()
					.every(
						(animation) =>
							(animation.effect?.getComputedTiming().endTime ?? Infinity) <= 1,
					),
			),
		).toBe(true);
		await page.keyboard.press("Escape");
		await page
			.locator("html[data-instant-v2-demo]")
			.waitFor({ state: "detached" });
		expect(
			await page.locator("[data-instant-v2-product-iframe]").isVisible(),
		).toBe(true);
	} finally {
		await browser.close();
	}
}, 30_000);
