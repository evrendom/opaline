import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

// Generates the pixel-snapped small wordmark for the 42px navbar from the
// master asset. The master's 2635x583 grid puts the baseline and x-height on
// fractional pixels at nav size; this variant rescales the content so the
// baseline and ascender line land on integer pixel rows of a 64x16 CSS-pixel
// box (integer rows at 2x as well). Re-run after editing the master.
const assetsDir = path.resolve(import.meta.dirname, "../src/assets");
const masterPath = path.join(assetsDir, "opaline-wordmark-nav.svg");
const outputPath = path.join(assetsDir, "opaline-wordmark-nav-small.svg");

const BOX_WIDTH = 64;
const BOX_HEIGHT = 16;
const BASELINE_Y = 12; // integer pixel row the letter feet snap to
const ASCENDER_PX = 11; // ascender-to-baseline height, integer by construction

const master = await readFile(masterPath, "utf8");

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.setContent(`<!doctype html><body style="margin:0">${master}</body>`);
const metrics = await page.evaluate(() => {
	const boxes = [...document.querySelectorAll("svg path")].map((p) => {
		const b = p.getBBox();
		return {
			x: b.x,
			y: b.y,
			maxX: b.x + b.width,
			maxY: b.y + b.height,
			w: b.width,
			h: b.height,
		};
	});
	// Baseline: the modal maxY among glyphs (flat feet agree within ~0.2 units;
	// round glyphs overshoot by ~10 units and are excluded by the tolerance).
	const feet = boxes.map((b) => b.maxY).sort((a, b) => a - b);
	const clusters = [];
	for (const y of feet) {
		const c = clusters.find((cl) => Math.abs(cl.mean - y) < 2);
		if (c) {
			c.values.push(y);
			c.mean = c.values.reduce((s, v) => s + v, 0) / c.values.length;
		} else {
			clusters.push({ mean: y, values: [y] });
		}
	}
	const baseline = clusters.reduce((a, b) =>
		b.values.length > a.values.length ? b : a,
	).mean;
	// Ascender top: the tallest path whose foot sits on the baseline.
	const ascenderTop = Math.min(
		...boxes.filter((b) => Math.abs(b.maxY - baseline) < 2).map((b) => b.y),
	);
	return { baseline, ascenderTop, boxes };
});
await browser.close();

const scale = ASCENDER_PX / (metrics.baseline - metrics.ascenderTop);
const translateY = BASELINE_Y - metrics.baseline * scale;

// Horizontal snapping: isolated narrow stems ('l', 'i') straddle vertical
// pixel boundaries at nav size, turning the whole stem gray. Cluster paths by
// x-overlap; when a cluster's tallest path is a stem (< 3px wide at nav
// size), nudge the whole cluster so the stem's left edge lands on an integer
// pixel column. Companions in the cluster (the i-dot) move with their stem.
// Wide clusters (bowl glyphs) are left alone to preserve letterspacing.
const clusters = [];
for (const [i, b] of metrics.boxes.entries()) {
	const c = clusters.find((cl) => b.x < cl.maxX && b.maxX > cl.x);
	if (c) {
		c.paths.push(i);
		c.x = Math.min(c.x, b.x);
		c.maxX = Math.max(c.maxX, b.maxX);
	} else {
		clusters.push({ paths: [i], x: b.x, maxX: b.maxX });
	}
}
const nudges = new Map();
for (const c of clusters) {
	const anchor = c.paths.reduce((a, i) =>
		metrics.boxes[i].h > metrics.boxes[a].h ? i : a,
	);
	const { x, w } = metrics.boxes[anchor];
	if (w * scale >= 3) continue;
	const dxPx = Math.round(x * scale) - x * scale;
	for (const i of c.paths) nudges.set(i, dxPx / scale);
}

const inner = master
	.replace(/^[\s\S]*?<svg[^>]*>/, "")
	.replace(/<\/svg>\s*$/, "");
let pathIndex = -1;
const snapped = inner.trim().replace(/<path[\s\S]*?\/>/g, (m) => {
	pathIndex++;
	const dx = nudges.get(pathIndex);
	if (!dx) return m;
	return `<g transform="translate(${dx.toFixed(3)} 0)">${m}</g>`;
});

const svg = `<svg width="${BOX_WIDTH}" height="${BOX_HEIGHT}" viewBox="0 0 ${BOX_WIDTH} ${BOX_HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg">
<g transform="translate(0 ${translateY.toFixed(5)}) scale(${scale.toFixed(7)})">
${snapped}
</g>
</svg>
`;

await writeFile(outputPath, svg);
console.log(
	`wrote ${path.relative(process.cwd(), outputPath)} (baseline ${metrics.baseline.toFixed(2)} -> y=${BASELINE_Y}, scale ${scale.toFixed(7)})`,
);
