import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const previews = path.join(here, "..", "onboarding-window", "previews");
const target = new URL(process.argv[2] ?? "http://localhost:4633/dashboard");
const login = process.argv[3];
const cookiesFile =
	process.env.OPALINE_PREVIEW_COOKIES ??
	path.join(os.homedir(), ".cache", "athena-preview", "cookies.json");
const { chromium } = await import(
	process.env.PLAYWRIGHT_CORE
		? pathToFileURL(process.env.PLAYWRIGHT_CORE).href
		: "playwright-core"
);
const clip = { x: 0, y: 0, width: 380, height: 243 };
const WIDTH = 624;

const stored = fs.existsSync(cookiesFile)
	? JSON.parse(fs.readFileSync(cookiesFile, "utf8"))
			.filter(
				(cookie) =>
					cookie.name.includes("better-auth") ||
					cookie.name === "sidebar_state",
			)
			.map(({ expires, ...cookie }) => ({
				...cookie,
				domain: target.hostname,
				path: "/",
				...(expires > 0 ? { expires } : {}),
			}))
	: [];

const browser = await chromium.launch({ channel: "chrome" });
const cookies = login ? await signIn(login) : stored;

async function signIn(link) {
	const context = await browser.newContext();
	await context
		.newPage()
		.then((page) =>
			page.goto(link, { waitUntil: "networkidle", timeout: 60000 }),
		);
	const signedIn = await context.cookies();
	await context.close();
	return signedIn;
}

for (const theme of ["dark", "light"]) {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 800 },
		deviceScaleFactor: 3,
		colorScheme: theme,
	});
	await context.addCookies(cookies);
	await context.addInitScript(
		(value) => localStorage.setItem("theme", value),
		theme,
	);
	const page = await context.newPage();
	await page
		.goto(target.toString(), { waitUntil: "networkidle", timeout: 60000 })
		.catch((error) => console.log("goto", error.message));
	await page.waitForTimeout(5000);
	console.log(theme, page.url());
	if (await page.locator('input[type="password"]').count()) {
		console.error(
			`${target} shows a sign-in page. Pass a sign-in link as the second argument (opaline server open --json).`,
		);
		process.exit(1);
	}
	await page.evaluate((clip) => {
		const bars = [];
		const metrics = document.createElement("canvas").getContext("2d");
		const walker = document.createTreeWalker(
			document.body,
			NodeFilter.SHOW_TEXT,
		);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (!node.textContent.trim()) continue;
			const parent = node.parentElement;
			if (
				!parent ||
				!parent.checkVisibility({
					checkOpacity: true,
					checkVisibilityCSS: true,
				})
			)
				continue;
			const range = document.createRange();
			range.selectNodeContents(node);
			const color = getComputedStyle(parent).color;
			const clips = [];
			for (let up = parent; up && up !== document.body; up = up.parentElement) {
				const style = getComputedStyle(up);
				if (
					style.overflowX !== "visible" ||
					style.overflowY !== "visible" ||
					style.clipPath !== "none"
				)
					clips.push(up.getBoundingClientRect());
			}
			const visible = (rect) =>
				clips.reduce(
					(box, clip) =>
						box && {
							left: Math.max(box.left, clip.left),
							right: Math.min(box.right, clip.right),
							top: Math.max(box.top, clip.top),
							bottom: Math.min(box.bottom, clip.bottom),
						},
					{
						left: rect.left,
						right: rect.right,
						top: rect.top,
						bottom: rect.bottom,
					},
				);
			for (const raw of range.getClientRects()) {
				const cut = visible(raw);
				if (
					!cut ||
					cut.right - cut.left < 2 ||
					cut.bottom - cut.top < raw.height * 0.6
				)
					continue;
				const rect = {
					left: cut.left,
					right: cut.right,
					top: raw.top,
					height: raw.height,
					width: cut.right - cut.left,
					bottom: raw.bottom,
				};
				if (
					rect.width < 1 ||
					rect.right < clip.x ||
					rect.left > clip.x + clip.width ||
					rect.bottom < clip.y ||
					rect.top > clip.y + clip.height
				)
					continue;
				const style = getComputedStyle(parent);
				metrics.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
				const ascent = metrics.measureText("H").fontBoundingBoxAscent;
				const cap = metrics.measureText("H").actualBoundingBoxAscent;
				bars.push({
					rect,
					color,
					size: parseFloat(style.fontSize),
					center: raw.top + ascent - cap / 2,
					cap,
				});
			}
			const hide = document.createElement("span");
			hide.style.color = "transparent";
			node.replaceWith(hide);
			hide.append(node);
		}
		bars.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
		const merged = [];
		for (const bar of bars) {
			const last = merged.at(-1);
			const mid = bar.center;
			if (
				last &&
				last.color === bar.color &&
				Math.abs(last.mid - mid) < bar.size * 0.4 &&
				bar.rect.left - last.right < bar.size * 0.6
			) {
				last.right = Math.max(last.right, bar.rect.right);
				continue;
			}
			merged.push({
				left: bar.rect.left,
				right: bar.rect.right,
				mid,
				color: bar.color,
				size: bar.size,
			});
		}
		for (const { left, right, mid, size } of merged) {
			const bar = document.createElement("div");
			const height = Math.max(6, size * 0.8);
			bar.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;left:${left}px;top:${mid - height / 2}px;width:${right - left}px;height:${height}px;border-radius:0.25rem;corner-shape:squircle;background:var(--bone)`;
			document.body.append(bar);
		}
	}, clip);
	await page.waitForTimeout(300);
	const full = path.join(os.tmpdir(), `opaline-preview-${theme}.png`);
	await page.screenshot({ path: full, clip });
	execFileSync(
		"/usr/bin/sips",
		["-Z", String(WIDTH), full, "--out", path.join(previews, `${theme}.png`)],
		{ stdio: "ignore" },
	);
	fs.rmSync(full, { force: true });
	await context.close();
}
await browser.close();
