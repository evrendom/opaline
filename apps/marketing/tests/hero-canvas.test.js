import { expect, test } from "bun:test";
import { chromium, webkit } from "@playwright/test";

// Exercise the same exported initializer and DOM contract used by ProductWindowBackdrop.
const bundled = await Bun.build({
	entrypoints: [
		new URL("../src/scripts/hero-canvas.ts", import.meta.url).pathname,
	],
	target: "browser",
});
if (!bundled.success)
	throw new Error(
		`Renderer fixture failed to bundle: ${bundled.logs.join("\n")}`,
	);
const rendererSource = await bundled.outputs[0].text();

for (const [name, engine] of [
	["Chromium", chromium],
	["WebKit", webkit],
]) {
	test(`${name}: product palettes repaint with reduced motion and dispose all renderer resources`, async () => {
		const browser = await engine.launch(
			name === "Chromium" ? { channel: "chrome" } : {},
		);
		try {
			const page = await browser.newPage({
				viewport: { width: 500, height: 300 },
				reducedMotion: "reduce",
			});
			const errors = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await page.setContent(
				'<div data-hero-canvas-stage data-hero-canvas-palette="pending" data-hero-canvas-opacity="0.3"><canvas style="width:400px;height:250px"></canvas></div>',
			);
			await page.evaluate(async (source) => {
				const url = URL.createObjectURL(
					new Blob([source], { type: "text/javascript" }),
				);
				const { initializeHeroCanvas } = await import(url);
				URL.revokeObjectURL(url);
				const canvas = document.querySelector("canvas");
				const gl = canvas.getContext("webgl2", { alpha: false });
				window.__productProbe = {
					draws: 0,
					textures: 0,
					deletedBuffers: 0,
					deletedPrograms: 0,
					pixels: [],
					error: 0,
				};
				const draw = gl.drawElements.bind(gl);
				gl.drawElements = (...args) => {
					draw(...args);
					const pixels = new Uint8Array(4);
					gl.readPixels(
						Math.floor(canvas.width / 2),
						Math.floor(canvas.height / 2),
						1,
						1,
						gl.RGBA,
						gl.UNSIGNED_BYTE,
						pixels,
					);
					window.__productProbe.pixels = Array.from(pixels);
					window.__productProbe.draws++;
					window.__productProbe.error = gl.getError();
				};
				const texture = gl.createTexture.bind(gl);
				gl.createTexture = () => {
					window.__productProbe.textures++;
					return texture();
				};
				const buffer = gl.deleteBuffer.bind(gl);
				gl.deleteBuffer = (resource) => {
					window.__productProbe.deletedBuffers++;
					buffer(resource);
				};
				const program = gl.deleteProgram.bind(gl);
				gl.deleteProgram = (resource) => {
					window.__productProbe.deletedPrograms++;
					program(resource);
				};
				window.__disposeProductCanvas = initializeHeroCanvas(canvas);
			}, rendererSource);
			await page.locator("[data-canvas-ready]").waitFor({ state: "attached" });
			const colors = [];
			for (const palette of [
				"pending",
				"connected",
				"interrupted",
				"default",
			]) {
				const before = await page.evaluate(() => window.__productProbe.draws);
				await page
					.locator("[data-hero-canvas-stage]")
					.evaluate((stage, palette) => {
						stage.dataset.heroCanvasPalette = palette;
					}, palette);
				await page.waitForFunction(
					(before) => window.__productProbe.draws > before,
					before,
				);
				colors.push(await page.evaluate(() => window.__productProbe.pixels));
			}
			expect(new Set(colors.map((color) => color.join(","))).size).toBe(4);
			const beforeIdle = await page.evaluate(() => window.__productProbe.draws);
			await page.waitForTimeout(150);
			expect(await page.evaluate(() => window.__productProbe.draws)).toBe(
				beforeIdle,
			);
			await page.evaluate(() => window.__disposeProductCanvas());
			const disposed = await page.evaluate(() => window.__productProbe);
			expect(disposed.textures).toBe(0);
			expect(disposed.deletedBuffers).toBe(2);
			expect(disposed.deletedPrograms).toBe(1);
			expect(disposed.error).toBe(0);
			await page.locator("[data-hero-canvas-stage]").evaluate((stage) => {
				stage.dataset.heroCanvasPalette = "pending";
			});
			await page.setViewportSize({ width: 550, height: 350 });
			await page.waitForTimeout(150);
			expect(await page.evaluate(() => window.__productProbe.draws)).toBe(
				disposed.draws,
			);
			expect(errors).toEqual([]);
		} finally {
			await browser.close();
		}
	}, 15000);
}
