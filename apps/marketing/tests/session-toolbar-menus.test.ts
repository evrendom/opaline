import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { expect as browserExpect, chromium, webkit } from "@playwright/test";
import { openDemoPreview } from "./demo-preview";

for (const engine of ["chrome", "webkit"]) {
	test(`${engine}: session filter flyouts and sort choices`, async () => {
		const browser =
			engine === "chrome"
				? await chromium.launch({
						channel: "chrome",
						headless: true,
						args: ["--force-device-scale-factor=2"],
					})
				: await webkit.launch({ headless: true });
		try {
			const page = await browser.newPage({
				viewport: { width: 1316, height: 853 },
				reducedMotion: "reduce",
				deviceScaleFactor: 2,
			});
			page.setDefaultTimeout(10_000);
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await openDemoPreview(page, "http://localhost:4600/home#demo");
			await page
				.locator('[data-instant-v2-demo-bar][data-stage="visible"]')
				.waitFor();
			const demo = page.frameLocator("[data-instant-v2-product-iframe]");
			await demo.locator("html[data-demo-live]").waitFor({ state: "attached" });
			const filter = demo.getByRole("button", {
				name: "Filter sessions",
				exact: true,
			});
			await filter.click();
			const root = demo.getByRole("dialog", {
				name: "Session filters",
				exact: true,
			});
			await demo
				.getByRole("button", { name: "Configure Model filter" })
				.hover();
			const models = demo.getByRole("dialog", {
				name: "Model filter",
				exact: true,
			});
			await browserExpect(models).toBeVisible();
			const rootBounds = await root
				.locator(".session-menu-parent")
				.boundingBox();
			const flyoutBounds = await models.boundingBox();
			assert(rootBounds && flyoutBounds);
			expect(flyoutBounds.x).toBeGreaterThanOrEqual(
				rootBounds.x + rootBounds.width - 2.5,
			);
			expect(flyoutBounds.x + flyoutBounds.width).toBeLessThanOrEqual(1316);
			// These dimensions come from the captured reference, not our CSS.
			const geometry = await root
				.locator(".session-menu-parent")
				.evaluate((surface) => {
					const row = surface.querySelector("button");
					if (!row) throw new Error("Missing menu content");
					const style = getComputedStyle(surface);
					const rowStyle = getComputedStyle(row);
					const highlight = getComputedStyle(row, "::before");
					return {
						width: surface.getBoundingClientRect().width,
						border: style.borderTopWidth,
						radius: style.borderRadius,
						rowHeight: row.getBoundingClientRect().height,
						rowPadding: [rowStyle.paddingLeft, rowStyle.paddingRight],
						fontSize: rowStyle.fontSize,
						fontWeight: rowStyle.fontWeight,
						highlightInset: highlight.left,
						highlightRadius: highlight.borderRadius,
					};
				});
			expect(geometry).toEqual({
				width: 207,
				border: "0.5px",
				radius: "12px",
				rowHeight: 32,
				rowPadding: ["14px", "18px"],
				fontSize: "13px",
				fontWeight: "450",
				highlightInset: "6px",
				highlightRadius: "8px",
			});
			const checkboxSize = await models
				.locator(".session-menu-checkbox")
				.first()
				.boundingBox();
			assert(checkboxSize);
			expect(checkboxSize.width).toBe(14);
			expect(checkboxSize.height).toBe(14);
			const categoryBounds = await root
				.getByRole("button", { name: "Configure Model filter" })
				.boundingBox();
			const optionBounds = await models
				.locator("label:has(input[type=checkbox])")
				.first()
				.boundingBox();
			assert(categoryBounds && optionBounds);
			expect(Math.abs(categoryBounds.y - optionBounds.y)).toBeLessThan(1);
			await page.screenshot({
				path: `.context/session-model-menu-${engine}.png`,
			});
			const model = models.getByRole("checkbox").first();
			await models.locator("label:has(input[type=checkbox])").first().click();
			await browserExpect(model).not.toBeChecked();
			await browserExpect(
				root.getByRole("searchbox", { name: "Add Filter…" }),
			).toHaveCount(0);
			await browserExpect(
				demo.getByRole("button", { name: "Filter sessions, 1 active" }),
			).toBeVisible();
			await root.getByRole("button", { name: "Clear all filters" }).click();
			await browserExpect(filter).toBeVisible();
			await demo
				.getByRole("button", { name: "Configure Tokens filter" })
				.click();
			const tokens = demo.getByRole("dialog", {
				name: "Tokens filter",
				exact: true,
			});
			await browserExpect(tokens.getByRole("slider")).toHaveCount(4);
			await browserExpect(
				root.getByRole("button", { name: "Configure Model filter" }),
			).toBeVisible();
			await page.screenshot({ path: `.context/session-filter-${engine}.png` });
			const strip = tokens.locator(".slider-range-input-strip").first();
			const stripBounds = await strip.boundingBox();
			assert(stripBounds);
			await page.mouse.move(
				stripBounds.x + stripBounds.width - 2,
				stripBounds.y + stripBounds.height / 2,
			);
			await page.mouse.down();
			await page.mouse.move(
				stripBounds.x + stripBounds.width + 120,
				stripBounds.y - 55,
				{ steps: 12 },
			);
			await page.waitForTimeout(350);
			await browserExpect(tokens).toBeVisible();
			await browserExpect(tokens).toHaveCSS("overflow", "visible");
			const stretchedBounds = await strip.boundingBox();
			assert(stretchedBounds);
			expect(stretchedBounds.width).toBeGreaterThan(stripBounds.width + 5);
			await page.mouse.up();
			// Releasing outside must allow the spring to settle without dismissing.
			await page.waitForTimeout(1200);
			await browserExpect(tokens).toBeVisible();
			const settledBounds = await strip.boundingBox();
			assert(settledBounds);
			expect(settledBounds.width).toBeCloseTo(stripBounds.width, 0);
			// Returning to the submenu restores the ordinary leave grace period.
			await tokens.getByText("Tokens", { exact: true }).hover();
			await page.mouse.move(
				stripBounds.x + stripBounds.width + 120,
				stripBounds.y - 55,
			);
			await page.waitForTimeout(100);
			await browserExpect(tokens).toBeVisible();
			await browserExpect(tokens).not.toBeVisible();
			await root
				.getByRole("button", { name: "Configure Tokens filter" })
				.hover();
			await browserExpect(tokens).toBeVisible();
			await tokens.getByRole("slider").first().press("Escape");
			await browserExpect(root).not.toBeVisible();
			await browserExpect(
				page.locator('[data-instant-v2-demo-bar][data-stage="visible"]'),
			).toBeVisible();

			await filter.click();
			await root.press("ArrowDown");
			await browserExpect(
				root.getByRole("button", { name: "Configure Repository filter" }),
			).toBeFocused();
			await page.keyboard.press("ArrowRight");
			const repositories = demo.getByRole("dialog", {
				name: "Repository filter",
				exact: true,
			});
			await browserExpect(repositories.getByRole("searchbox")).toHaveCount(0);
			await browserExpect(
				repositories.getByRole("checkbox").first(),
			).toBeFocused();
			await page.keyboard.press("ArrowDown");
			await page.keyboard.press("ArrowUp");
			await browserExpect(
				repositories.getByRole("checkbox").first(),
			).toBeFocused();
			await page.keyboard.press("ArrowLeft");
			await browserExpect(repositories).not.toBeVisible();
			await browserExpect(
				root.getByRole("button", { name: "Configure Repository filter" }),
			).toBeFocused();
			await page.keyboard.press("Escape");

			const sort = demo.getByRole("button", { name: /^Sort sessions,/ });
			for (const label of [
				"Time",
				"Cost",
				"Tokens",
				"Skills",
				"Errors",
				"Length",
				"Messages",
				"Language signals",
			]) {
				await sort.click();
				await browserExpect(demo.getByRole("menuitemradio")).toHaveCount(10);
				await demo
					.getByRole("menuitemradio", { name: label, exact: true })
					.click();
				await browserExpect(sort).toHaveAccessibleName(
					`Sort sessions, ${label}, descending`,
				);
				await sort.click();
				await browserExpect(
					demo.getByRole("menuitemradio", { name: label, exact: true }),
				).toBeChecked();
				await demo
					.getByRole("menuitemradio", { name: "Ascending", exact: true })
					.click();
				await browserExpect(sort).toHaveAccessibleName(
					`Sort sessions, ${label}, ascending`,
				);
			}
			await sort.focus();
			await sort.press("ArrowDown");
			await browserExpect(
				demo.getByRole("menu", { name: "Sort sessions" }),
			).toBeVisible();
			await page.screenshot({ path: `.context/session-sort-${engine}.png` });
			await page.keyboard.press("Escape");
			await browserExpect(sort).toBeFocused();
			expect(errors).toEqual([]);
			expect(
				await demo.locator("html[data-demo-hydration-error]").count(),
			).toBe(0);
		} finally {
			await browser.close();
		}
	}, 60_000);
}

for (const engine of ["chrome", "webkit"]) {
	test(`${engine}: menu motion and viewport collision`, async () => {
		const browser =
			engine === "chrome"
				? await chromium.launch({
						channel: "chrome",
						headless: true,
						args: ["--force-device-scale-factor=2"],
					})
				: await webkit.launch({ headless: true });
		try {
			const page = await browser.newPage({
				viewport: { width: 1500, height: 895 },
				deviceScaleFactor: 2,
				reducedMotion: "no-preference",
			});
			await openDemoPreview(page, "http://localhost:4600/home#demo");
			await page
				.locator('[data-instant-v2-demo-bar][data-stage="visible"]')
				.waitFor();
			const demo = page.frameLocator("[data-instant-v2-product-iframe]");
			await demo.locator("html[data-demo-live]").waitFor({ state: "attached" });
			const trigger = demo.getByRole("button", {
				name: "Filter sessions",
				exact: true,
			});
			await trigger.click();
			const root = demo.getByRole("dialog", {
				name: "Session filters",
				exact: true,
			});
			const motion = await root.evaluate(async (popup) => {
				const frames: { width: number; opacity: number }[] = [];
				const started = performance.now();
				while (performance.now() - started < 250) {
					await new Promise(requestAnimationFrame);
					const surface = popup.querySelector(".session-menu-parent");
					if (!surface) throw new Error("Menu disappeared during opening");
					frames.push({
						width: surface.getBoundingClientRect().width,
						opacity: Number(getComputedStyle(popup).opacity),
					});
				}
				return frames;
			});
			expect(motion.length).toBeGreaterThan(2);
			expect(motion.at(-1)?.width).toBeCloseTo(207, 1);
			expect(motion.at(-1)?.opacity).toBe(1);
			expect(
				Math.min(...motion.map((frame) => frame.width)),
			).toBeGreaterThanOrEqual(202.8);
			expect(
				Math.max(...motion.map((frame) => frame.width)),
			).toBeLessThanOrEqual(207.1);
			const repository = root.getByRole("button", {
				name: "Configure Repository filter",
			});
			const model = root.getByRole("button", {
				name: "Configure Model filter",
			});
			await repository.hover();
			const highlight = root.locator(
				".session-menu-parent > .session-menu-list [data-slot=fluid-hover-highlight]",
			);
			await browserExpect(highlight).toBeVisible();
			const hoverFrames = root
				.locator(".session-menu-parent > .session-menu-list")
				.evaluate(async (list) => {
					const frames: number[] = [];
					const started = performance.now();
					while (performance.now() - started < 350) {
						await new Promise(requestAnimationFrame);
						const fill = list.querySelector(
							"[data-slot=fluid-hover-highlight]",
						);
						if (fill) frames.push(fill.getBoundingClientRect().top);
					}
					return frames;
				});
			await model.hover();
			const travel = await hoverFrames;
			const low = Math.min(...travel);
			const high = Math.max(...travel);
			expect(high - low).toBeGreaterThan(40);
			expect(travel.some((top) => top > low + 5 && top < high - 5)).toBe(true);
			const highlightShape = await highlight.evaluate((fill) => {
				const style = getComputedStyle(fill, "::before");
				return {
					left: style.left,
					right: style.right,
					radius: style.borderRadius,
				};
			});
			expect(highlightShape).toEqual({
				left: "6px",
				right: "6px",
				radius: "8px",
			});
			await page.keyboard.press("Escape");
			await browserExpect(root).not.toBeVisible();
			await page.setViewportSize({ width: 640, height: 600 });
			await trigger.click();
			await root
				.getByRole("button", { name: "Configure Model filter" })
				.hover();
			const models = demo.getByRole("dialog", {
				name: "Model filter",
				exact: true,
			});
			await browserExpect(models).toBeVisible();
			// Let the opening fade finish before checking the edge overlap.
			await models.evaluate(async (popup) => {
				await Promise.all(
					popup.getAnimations().map((animation) => animation.finished),
				);
			});
			const parentBounds = await root
				.locator(".session-menu-parent")
				.boundingBox();
			const childBounds = await models.boundingBox();
			assert(parentBounds && childBounds);
			expect(childBounds.x).toBeGreaterThanOrEqual(11.5);
			expect(childBounds.x + childBounds.width).toBeLessThanOrEqual(628.5);
			expect(childBounds.y).toBeGreaterThanOrEqual(11.5);
			expect(childBounds.y + childBounds.height).toBeLessThanOrEqual(588.5);
			expect(
				Math.abs(childBounds.x + childBounds.width - parentBounds.x - 2),
			).toBeLessThan(1);
			await page.screenshot({
				path: `.context/session-menu-collision-${engine}.png`,
			});
		} finally {
			await browser.close();
		}
	}, 60_000);
}
