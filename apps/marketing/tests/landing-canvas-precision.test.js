import { expect, test } from "bun:test";
import { chromium, webkit } from "@playwright/test";

const preview = `http://127.0.0.1:${process.env.PREVIEW_PORT ?? 4600}/home`;

for (const engine of ["chromium", "webkit"]) {
	test(`${engine}: blur retains sub-8-bit color precision and stationary final dithering`, async () => {
		const browser =
			engine === "webkit"
				? await webkit.launch()
				: await chromium.launch({ channel: "chrome" });
		try {
			{
				const page = await browser.newPage({
					viewport: { width: 390, height: 844 },
					deviceScaleFactor: 3,
					isMobile: true,
					hasTouch: true,
				});
				const errors = [];
				page.on("pageerror", (error) => errors.push(error.message));
				page.on("console", (message) => {
					if (message.type() === "error") errors.push(message.text());
				});
				await page.addInitScript(() => {
					const draw = WebGL2RenderingContext.prototype.drawArrays;
					WebGL2RenderingContext.prototype.drawArrays = function (...args) {
						const result = draw.apply(this, args);
						if (this.canvas.closest(".instant-v2-hero-gradient")) {
							const target = this.getParameter(this.FRAMEBUFFER_BINDING);
							if (target && !window.__precisionSample) {
								const type = this.getFramebufferAttachmentParameter(
									this.FRAMEBUFFER,
									this.COLOR_ATTACHMENT0,
									this.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE,
								);
								const floating = type === this.FLOAT;
								const values = floating
									? new Float32Array(32 * 4)
									: new Uint8Array(32 * 4);
								this.readPixels(
									50,
									45,
									32,
									1,
									this.RGBA,
									floating ? this.FLOAT : this.UNSIGNED_BYTE,
									values,
								);
								const red = Array.from({ length: 32 }, (_, i) =>
									floating ? values[i * 4] : values[i * 4] / 255,
								);
								window.__precisionSample = {
									floating,
									red,
									error: this.getError(),
								};
							}
							if (!target && window.__captureDither) {
								const values = new Uint8Array(16 * 16 * 4);
								this.readPixels(
									Math.floor(this.canvas.width / 2),
									Math.floor(this.canvas.height / 2),
									16,
									16,
									this.RGBA,
									this.UNSIGNED_BYTE,
									values,
								);
								window.__ditherPixels = Array.from(values);
								window.__captureDither = false;
							}
						}
						return result;
					};
				});
				await page.goto(`${preview}?opaline-canvas-time=0`);
				await page
					.locator(".instant-v2-hero-gradient [data-canvas-ready]")
					.waitFor();
				const sample = await page.evaluate(() => window.__precisionSample);
				expect(sample.error).toBe(0);
				expect(sample.floating).toBe(true);
				expect(
					sample.red.filter(
						(value) => Math.abs(value * 255 - Math.round(value * 255)) > 0.03,
					).length,
				).toBeGreaterThan(24);
				const frames = [];
				for (let i = 0; i < 2; i++) {
					await page.evaluate(() => {
						window.__captureDither = true;
						document
							.querySelector("[data-hero-canvas-stage]")
							.setAttribute("data-hero-canvas-palette", "default");
					});
					await page.waitForFunction(() => !window.__captureDither);
					frames.push(await page.evaluate(() => window.__ditherPixels));
				}
				expect(frames[1]).toEqual(frames[0]);
				expect(errors).toEqual([]);
				await page.close();
			}
		} finally {
			await browser.close();
		}
	}, 30000);
}

test("WebKit: quality preview renders when floating-point color targets are unavailable", async () => {
	const browser = await webkit.launch();
	try {
		const page = await browser.newPage({
			viewport: { width: 390, height: 844 },
			isMobile: true,
			hasTouch: true,
		});
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});
		await page.addInitScript(() => {
			const get = WebGL2RenderingContext.prototype.getExtension;
			WebGL2RenderingContext.prototype.getExtension = function (name) {
				if (
					name === "EXT_color_buffer_float" ||
					name === "EXT_color_buffer_half_float"
				)
					return null;
				return get.call(this, name);
			};
		});
		await page.goto(preview);
		await page
			.locator(".instant-v2-hero-gradient [data-canvas-ready]")
			.waitFor();
		expect(
			await page
				.locator(".instant-v2-hero-gradient canvas")
				.evaluate((canvas) => canvas.getContext("webgl2").getError()),
		).toBe(0);
		expect(errors).toEqual([]);
	} finally {
		await browser.close();
	}
}, 15000);
