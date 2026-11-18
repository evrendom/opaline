import { expect, test } from "bun:test";
import { chromium, webkit } from "@playwright/test";

const preview = `http://127.0.0.1:${process.env.PREVIEW_PORT ?? 4600}/home`;

async function scrollTo(page, y) {
	await page.evaluate((y) => {
		const scroller =
			document.querySelector(
				"html[data-instant-v2-safari-scroll] [data-instant-v2-scroll]",
			) ?? document.scrollingElement;
		scroller.scrollTop = y;
	}, y);
	await page.waitForTimeout(150);
	await page.waitForFunction(() => !document.querySelector(".lenis-scrolling"));
}

async function motionState(page) {
	return page.evaluate(() => {
		const nav = document.querySelector("[data-instant-v2-nav]");
		const hero = document.querySelector("[data-instant-v2-hero-content]");
		const style = (selector) =>
			getComputedStyle(document.querySelector(selector));
		const scroller =
			document.querySelector(
				"html[data-instant-v2-safari-scroll] [data-instant-v2-scroll]",
			) ?? document.scrollingElement;
		return {
			native: document.documentElement.hasAttribute(
				"data-instant-v2-native-motion",
			),
			hero: Number(getComputedStyle(hero).opacity),
			heroScale: new DOMMatrixReadOnly(getComputedStyle(hero).transform).a,
			nav: Number(style(".instant-v2-nav-inner").opacity),
			gradient: Number(style(".instant-v2-hero-gradient").opacity),
			hiddenControlsInert: [
				...nav.querySelectorAll(
					".instant-v2-nav-label, .instant-v2-nav-link, [data-instant-v2-install]",
				),
			].every((control) => control.inert),
			legacyVariables: [
				hero.style.getPropertyValue("--instant-v2-hero-recede-progress"),
				nav.style.getPropertyValue("--instant-v2-nav-outgoing-opacity"),
			],
			footerBottom: document
				.querySelector(".company-strip")
				.getBoundingClientRect().bottom,
			footerLayer: Number(style(".company-strip").zIndex),
			productLayer: Number(style(".instant-v2-product-window").zIndex),
			width: scroller.scrollWidth,
		};
	});
}

for (const [name, engine] of [
	["Chromium", chromium],
	["WebKit", webkit],
]) {
	test(`${name}: native scrolling owns the reveal, preserves footer and restores controls`, async () => {
		const browser = await engine.launch(
			name === "Chromium" ? { channel: "chrome" } : {},
		);
		try {
			const page = await browser.newPage({
				viewport: { width: 390, height: 844 },
				isMobile: true,
				hasTouch: true,
			});
			await page.goto(preview);
			await page
				.locator(".instant-v2-hero-gradient [data-canvas-ready]")
				.waitFor();
			await page.evaluate(() => document.fonts.ready);
			await page
				.locator(
					'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
				)
				.waitFor({ state: "attached" });
			expect(
				await page.evaluate(() =>
					document.cookie.includes("opaline_blur_source="),
				),
			).toBe(false);
			expect(
				await page
					.locator("[data-instant-v2-blur-source-monitor], [data-agent-phrase]")
					.count(),
			).toBe(0);
			expect(
				await page.evaluate(() => Reflect.has(window, "__staccatoFlags")),
			).toBe(false);
			await scrollTo(page, 110);
			const middle = await motionState(page);
			expect(middle.native).toBe(true);
			expect(middle.hero).toBeCloseTo(0.5, 2);
			expect(middle.legacyVariables).toEqual(["", ""]);
			await scrollTo(page, 250);
			const reveal = await motionState(page);
			expect(reveal.gradient).toBeGreaterThan(0.1);
			expect(reveal.gradient).toBeLessThan(0.9);
			expect(reveal.nav + reveal.gradient).toBeCloseTo(1, 3);
			await scrollTo(page, 10000);
			const end = await motionState(page);
			expect(end.hero).toBe(0);
			expect(end.nav).toBe(0);
			expect(end.gradient).toBe(1);
			expect(end.hiddenControlsInert).toBe(true);
			expect(Math.abs(end.footerBottom - 844)).toBeLessThan(1);
			expect(end.footerLayer).toBeLessThan(end.productLayer);
			expect(end.width).toBe(390);
			await scrollTo(page, 0);
			const start = await motionState(page);
			expect(start.hero).toBe(1);
			expect(start.nav).toBe(1);
			expect(start.gradient).toBe(0);
			expect(start.hiddenControlsInert).toBe(false);
			await page.emulateMedia({ reducedMotion: "reduce" });
			await scrollTo(page, 250);
			const reduced = await motionState(page);
			expect(reduced.native).toBe(false);
			expect(reduced.hero).toBe(1);
			await page.emulateMedia({ reducedMotion: "no-preference" });
			await scrollTo(page, 0);
			expect((await motionState(page)).native).toBe(true);
		} finally {
			await browser.close();
		}
	}, 20000);

	test(`${name}: desktop and unsupported-timeline fallback retain scroll behavior`, async () => {
		const browser = await engine.launch(
			name === "Chromium" ? { channel: "chrome" } : {},
		);
		try {
			for (const width of [1440, 390]) {
				const page = await browser.newPage({
					viewport: { width, height: 844 },
					hasTouch: width === 390,
				});
				if (width === 390)
					await page.addInitScript(() => {
						const supports = CSS.supports.bind(CSS);
						CSS.supports = (...args) =>
							args[0] === "animation-timeline" ? false : supports(...args);
					});
				await page.goto(preview);
				await page.evaluate(() => document.fonts.ready);
				await scrollTo(page, 110);
				const middle = await motionState(page);
				expect(middle.native).toBe(false);
				expect(middle.hero).toBeCloseTo(0.5, 2);
				expect(middle.heroScale).toBeCloseTo(0.95, 3);
				if (name === "WebKit" && width === 1440)
					expect(middle.legacyVariables[0]).toBe("");
				else expect(middle.legacyVariables[0]).toBe("0.5000");
				await scrollTo(page, 200);
				const faded = await motionState(page);
				expect(faded.hero).toBe(0);
				expect(faded.heroScale).toBeCloseTo(0.9, 3);
				await scrollTo(page, 20);
				const restored = await motionState(page);
				expect(restored.hero).toBe(1);
				expect(restored.heroScale).toBe(1);
				await page.emulateMedia({ reducedMotion: "reduce" });
				await scrollTo(page, 110);
				const reduced = await motionState(page);
				expect(reduced.hero).toBe(1);
				expect(reduced.heroScale).toBe(1);
				await page.emulateMedia({ reducedMotion: "no-preference" });
				await scrollTo(page, 110);
				expect((await motionState(page)).hero).toBeCloseTo(0.5, 2);
				await scrollTo(page, 10000);
				const end = await motionState(page);
				expect(end.nav).toBe(0);
				expect(end.gradient).toBe(1);
				expect(end.hiddenControlsInert).toBe(true);
				await page.close();
			}
		} finally {
			await browser.close();
		}
	}, 20000);
}
