import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { expect as browserExpect, chromium, webkit } from "@playwright/test";
import { openDemoPreview } from "./demo-preview";

for (const engine of ["chrome", "webkit"]) {
	test(`${engine}: customized date menu preserves date selection`, async () => {
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
				deviceScaleFactor: 2,
				reducedMotion: "no-preference",
				locale: "en-US",
				timezoneId: "UTC",
			});
			await page.clock.setFixedTime(new Date("2026-09-13T12:00:00Z"));
			page.setDefaultTimeout(10_000);
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await openDemoPreview(page, "http://localhost:4600/home#demo");
			await page
				.locator('[data-instant-v2-demo-bar][data-stage="visible"]')
				.waitFor();
			const demo = page.frameLocator("[data-instant-v2-product-iframe]");
			await demo.locator("html[data-demo-live]").waitFor({ state: "attached" });
			const trigger = demo
				.locator('[data-slot="popover-trigger"]')
				.filter({ hasText: /2026/ })
				.first();
			const originalLabel = await trigger.innerText();
			await trigger.click();
			const picker = demo.getByRole("dialog", {
				name: "Date range",
				exact: true,
			});
			await browserExpect(picker).toBeVisible();
			await picker.evaluate((el) =>
				Promise.all(el.getAnimations().map((animation) => animation.finished)),
			);
			const surface = await picker.evaluate((el) => {
				const style = getComputedStyle(el);
				return {
					border: style.borderTopWidth,
					radius: style.borderRadius,
					background: style.backgroundColor,
					shadow: style.boxShadow,
				};
			});
			expect(surface.border).toBe("0.5px");
			expect(surface.radius).toBe("12px");
			const preset = picker.getByRole("button", {
				name: "Last 7 days",
				exact: true,
			});
			const presetBounds = await preset.boundingBox();
			assert(presetBounds);
			expect(presetBounds.height).toBe(32);
			expect(
				await picker
					.locator(".session-menu-check-slot, .session-menu-checkbox")
					.count(),
			).toBe(0);
			const hoverDay = picker.locator('button[data-day="9/5/2026"]').first();
			await hoverDay.hover();
			await browserExpect(hoverDay).toHaveAttribute(
				"data-fluid-hover-active",
				"",
			);
			const dayHighlight = picker.locator(
				".session-date-picker-calendar .fluid-menu-hover-fill",
			);
			await browserExpect(dayHighlight).toBeVisible();
			expect(
				await dayHighlight.evaluate(
					(el) => getComputedStyle(el, "::before").maskImage,
				),
			).toContain("opaline-trace-fill.svg");
			expect(
				await dayHighlight.evaluate(
					(el) => getComputedStyle(el, "::before").inset,
				),
			).toBe("0px");
			await browserExpect(
				picker.locator(".session-date-picker-weekday").first(),
			).toHaveText("Su");
			await browserExpect(
				picker.locator('button[data-day="7/26/2026"]'),
			).toBeVisible();
			await browserExpect(
				picker.locator('button[data-day="9/30/2026"]').first(),
			).toBeDisabled();
			const chooseRange = async () => {
				// Clear the current range using DayPicker's existing selection behavior.
				await picker.locator('button[data-day="8/1/2026"]').first().click();
				await picker.locator('button[data-day="8/1/2026"]').first().click();
				await browserExpect(
					picker.getByRole("button", { name: "Apply", exact: true }),
				).toBeDisabled();
				await picker.locator('button[data-day="8/5/2026"]').first().click();
				await picker.locator('button[data-day="8/12/2026"]').first().click();
			};
			await chooseRange();
			const selectedDay = picker.locator('button[data-day="8/5/2026"]').first();
			expect(
				await selectedDay.evaluate(
					(el) => getComputedStyle(el, "::before").maskImage,
				),
			).toContain("opaline-trace-fill.svg");
			expect(await selectedDay.locator("svg").count()).toBe(0);
			await browserExpect(picker).toBeVisible();
			await browserExpect(trigger).toHaveText(originalLabel);
			await picker.getByRole("button", { name: "Cancel", exact: true }).click();
			await browserExpect(picker).not.toBeVisible();
			await trigger.click();
			await browserExpect(
				picker.locator('button[data-day="8/1/2026"]').first(),
			).toHaveAttribute("data-range-start", "true");
			await browserExpect(
				picker.locator('button[data-day="8/31/2026"]').first(),
			).toHaveAttribute("data-range-end", "true");
			await chooseRange();
			await picker.getByRole("button", { name: "Apply", exact: true }).click();
			await browserExpect(picker).not.toBeVisible();
			await browserExpect(trigger).toHaveText("Aug 5 - Aug 12, 2026");
			await trigger.click();
			await picker
				.getByRole("button", { name: "Go to the Next Month", exact: true })
				.click();
			await browserExpect(
				picker.getByText("October 2026", { exact: true }),
			).toBeVisible();
			await picker
				.getByRole("button", { name: "Go to the Previous Month", exact: true })
				.click();
			await browserExpect(
				picker.getByText("August 2026", { exact: true }),
			).toBeVisible();
			expect(
				await picker.evaluate((el) => {
					const wheel = new WheelEvent("wheel", {
						deltaY: 80,
						bubbles: true,
						cancelable: true,
					});
					el.dispatchEvent(wheel);
					return wheel.defaultPrevented;
				}),
			).toBe(true);
			await page.screenshot({ path: `.context/date-picker-${engine}.png` });
			await page.keyboard.press("Escape");
			await browserExpect(picker).not.toBeVisible();
			await browserExpect(trigger).toBeFocused();

			await demo
				.getByRole("button", { name: "Filter sessions", exact: true })
				.click();
			const filterSurface = demo.locator(".session-menu-parent");
			expect(
				await filterSurface.evaluate((el) => {
					const style = getComputedStyle(el);
					return {
						border: style.borderTopWidth,
						radius: style.borderRadius,
						background: style.backgroundColor,
						shadow: style.boxShadow,
					};
				}),
			).toEqual(surface);
			await page.keyboard.press("Escape");
			await trigger.click();
			await picker
				.getByRole("button", { name: "This month", exact: true })
				.click();
			await browserExpect(picker).not.toBeVisible();
			await browserExpect(trigger).not.toHaveText("Aug 5 - Aug 12, 2026");
			await trigger.click();
			const active = picker.getByRole("button", {
				name: "This month",
				exact: true,
			});
			await browserExpect(active).toHaveAttribute("aria-pressed", "true");
			expect(await active.locator(".session-menu-checkbox, svg").count()).toBe(
				0,
			);
			await page.keyboard.press("Escape");
			await trigger.click();
			await picker.evaluate((el) =>
				Promise.all(el.getAnimations().map((animation) => animation.finished)),
			);
			await preset.hover();
			const presetList = picker.locator(".session-date-picker-presets");
			await browserExpect(
				presetList.locator("[data-slot=fluid-hover-highlight]"),
			).toHaveCount(1);
			const hoverFrames = presetList.evaluate(async (list) => {
				const frames: number[] = [];
				const started = performance.now();
				while (performance.now() - started < 600) {
					await new Promise(requestAnimationFrame);
					const fill = list.querySelector("[data-slot=fluid-hover-highlight]");
					if (fill) frames.push(fill.getBoundingClientRect().top);
				}
				return frames;
			});
			const nextPreset = await picker
				.getByRole("button", { name: "Last 90 days", exact: true })
				.boundingBox();
			assert(nextPreset);
			await page.mouse.move(
				nextPreset.x + nextPreset.width / 2,
				nextPreset.y + nextPreset.height / 2,
			);
			const travel = await hoverFrames;
			const low = Math.min(...travel);
			const high = Math.max(...travel);
			expect(high - low).toBeGreaterThan(40);
			expect(travel.some((top) => top > low + 5 && top < high - 5)).toBe(true);
			await page.keyboard.press("Escape");
			expect(errors).toEqual([]);
			expect(
				await demo.locator("html[data-demo-hydration-error]").count(),
			).toBe(0);
		} finally {
			await browser.close();
		}
	}, 60_000);
}
