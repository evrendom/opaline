import { expect, test } from "bun:test";
import { chromium, webkit } from "@playwright/test";

const preview = `http://127.0.0.1:${process.env.PREVIEW_PORT ?? 4600}/home`;
for (const engine of ["chromium", "webkit"]) {
	test(`${engine}: canvas blur keeps soft alpha, live colors and reusable buffers during scroll`, async () => {
		const browser =
			engine === "webkit"
				? await webkit.launch()
				: await chromium.launch({ channel: "chrome" });
		try {
			const page = await browser.newPage({
				viewport: { width: 390, height: 844 },
				deviceScaleFactor: 3,
				isMobile: true,
				hasTouch: true,
			});
			const errors = [],
				missing = [];
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("console", (message) => {
				if (message.type() === "error") errors.push(message.text());
			});
			page.on("response", (response) => {
				if (
					response.url().startsWith(new URL(preview).origin) &&
					response.status() >= 400
				)
					missing.push(response.url());
			});
			await page.addInitScript(() => {
				window.__blurAllocations = 0;
				window.__blurDraws = 0;
				const allocate = WebGL2RenderingContext.prototype.texImage2D;
				WebGL2RenderingContext.prototype.texImage2D = function (...args) {
					if (this.canvas.closest(".instant-v2-hero-gradient"))
						window.__blurAllocations++;
					return allocate.apply(this, args);
				};
				const draw = WebGL2RenderingContext.prototype.drawArrays;
				WebGL2RenderingContext.prototype.drawArrays = function (...args) {
					const result = draw.apply(this, args);
					if (this.canvas.closest(".instant-v2-hero-gradient")) {
						window.__blurDraws++;
						if (
							window.__sampleBlur &&
							this.getParameter(this.FRAMEBUFFER_BINDING) === null
						) {
							const pixel = new Uint8Array(4);
							const samples = [];
							// Bottom straight edge lies 50 CSS px inside the padded phone canvas.
							const ratio = this.canvas.width / this.canvas.clientWidth;
							for (const y of [
								0,
								50 - 16.6667,
								50,
								50 + 16.6667,
								this.canvas.clientHeight / 2,
							]) {
								this.readPixels(
									Math.floor(this.canvas.width / 2),
									Math.round(y * ratio),
									1,
									1,
									this.RGBA,
									this.UNSIGNED_BYTE,
									pixel,
								);
								samples.push(Array.from(pixel));
							}
							window.__blurPixels = samples;
							window.__sampleBlur = false;
						}
					}
					return result;
				};
			});
			await page.goto(preview);
			await page.evaluate(() => document.fonts.ready);
			await page
				.locator(".instant-v2-hero-gradient [data-canvas-ready]")
				.waitFor();
			await page
				.frameLocator("[data-instant-v2-product-iframe]")
				.getByText("Sessions", { exact: true })
				.first()
				.waitFor();
			const state = () =>
				page.evaluate(() => {
					const canvas = document.querySelector(
						".instant-v2-hero-gradient canvas",
					);
					return {
						buffer: [canvas.width, canvas.height],
						allocations: window.__blurAllocations,
						filter: getComputedStyle(
							document.querySelector(".instant-v2-hero-gradient-surface"),
						).filter,
						error: canvas.getContext("webgl2").getError(),
					};
				});
			const before = await state();
			expect(before.filter).toBe("none");
			expect(before.error).toBe(0);
			expect(before.allocations).toBe(2);
			const capture = async () => {
				await page.evaluate(() => {
					window.__sampleBlur = true;
				});
				await page.waitForFunction(() => !window.__sampleBlur);
				return page.evaluate(() => window.__blurPixels);
			};
			const pixels = await capture();
			expect(pixels[0][3]).toBeLessThan(3);
			expect(pixels[1][3]).toBeGreaterThan(20);
			expect(pixels[1][3]).toBeLessThan(70);
			expect(pixels[2][3]).toBeGreaterThan(105);
			expect(pixels[2][3]).toBeLessThan(150);
			expect(pixels[3][3]).toBeGreaterThan(185);
			expect(pixels[3][3]).toBeLessThan(235);
			expect(pixels[4][3]).toBeGreaterThan(245);
			for (const y of [110, 250, 500, 250, 0]) {
				await page.evaluate((y) => {
					const scroller =
						document.querySelector(
							"html[data-instant-v2-safari-scroll] [data-instant-v2-scroll]",
						) ?? document.scrollingElement;
					scroller.scrollTop = y;
				}, y);
				await page.waitForTimeout(y === 110 ? 350 : 150);
				expect(await state()).toEqual(before);
			}
			const laterPixels = await capture();
			expect(laterPixels[4].slice(0, 3)).not.toEqual(pixels[4].slice(0, 3));
			expect(await page.evaluate(() => window.__blurDraws)).toBeGreaterThan(10);
			await page.setViewportSize({ width: 390, height: 760 });
			await page.waitForTimeout(250);
			expect(await state()).toEqual(before);
			await page.setViewportSize({ width: 844, height: 430 });
			await page.waitForTimeout(300);
			const rotated = await state();
			expect(rotated.error).toBe(0);
			expect(rotated.filter).toBe("none");
			expect(rotated.buffer).not.toEqual(before.buffer);
			expect(errors).toEqual([]);
			expect(missing).toEqual([]);
		} finally {
			await browser.close();
		}
	}, 30000);
}
