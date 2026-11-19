import { expect, test } from "bun:test";
import { chromium, type Locator, webkit } from "@playwright/test";
import seed from "../src/features/demo/seed.json";

const WORKSPACE = '[data-slot="session-workspace"]';
const SCROLLER = '[data-slot="sessions-overview-scroll-container"]';
const ROW = '[data-dashboard-grid-row-scope="session"]';
const compactWholeNumberFormatter = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 0,
});

async function readTooltipStyle(tooltip: Locator) {
	return tooltip.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			background: style.backgroundColor,
			border: style.border,
			color: style.color,
			fontSize: style.fontSize,
			padding: style.padding,
			radius: style.borderRadius,
			shadow: style.boxShadow,
			side: element.getAttribute("data-side"),
		};
	});
}

async function readLayout(workspace: Locator) {
	return workspace.evaluate((element) => {
		const scroller = element.querySelector(
			'[data-slot="sessions-overview-scroll-container"]',
		);
		const row = element.querySelector(
			'[data-dashboard-grid-row-scope="session"]',
		);
		if (!scroller || !row) throw new Error("Missing the real overview table");
		return {
			workspaceWidth: element.clientWidth,
			viewportWidth: scroller.clientWidth,
			rowWidth: row.clientWidth,
			grid: getComputedStyle(row).gridTemplateColumns,
			skills: Array.from(
				element.querySelectorAll('[data-dashboard-grid-row-scope="session"]'),
			)
				.slice(0, 30)
				.map((session) =>
					Array.from(
						session.querySelectorAll("[data-session-overview-skill-tag]"),
					)
						.filter((tag) => getComputedStyle(tag).display !== "none")
						.map((tag) => tag.textContent),
				),
		};
	});
}

async function sampleTransition(workspace: Locator) {
	return workspace.evaluate(async (element) => {
		const frames: { moving: boolean; grid: string; rowWidth: number }[] = [];
		const start = performance.now();
		while (performance.now() - start < 900) {
			const row = element.querySelector(
				'[data-dashboard-grid-row-scope="session"]',
			);
			if (!row)
				throw new Error("The overview disappeared during the transition");
			frames.push({
				moving: element.hasAttribute("data-session-pane-moving"),
				grid: getComputedStyle(row).gridTemplateColumns,
				rowWidth: row.clientWidth,
			});
			await new Promise(requestAnimationFrame);
		}
		return frames;
	});
}

for (const { name, browserType, channel } of [
	{ name: "Chrome", browserType: chromium, channel: "chrome" },
	{ name: "WebKit", browserType: webkit, channel: undefined },
]) {
	test(`${name}: details preserve overview columns while window resizing still adapts them`, async () => {
		const browser = await browserType.launch({
			channel,
			headless: true,
			timeout: 15_000,
		});
		try {
			const page = await browser.newPage({
				viewport: { width: 2036, height: 1056 },
			});
			await page.goto("http://localhost:4600/home");
			await page
				.locator(
					'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
				)
				.waitFor({ state: "attached" });
			await page.locator("[data-instant-v2-dashboard-demo]").click();
			const frame = page.frameLocator("[data-instant-v2-product-iframe]");
			await frame.locator("html[data-demo-live]").waitFor();
			await frame.locator(ROW).nth(49).waitFor();
			const workspace = frame.locator(WORKSPACE);
			const before = await readLayout(workspace);
			const firstRow = frame.locator(ROW).first();
			const date = firstRow.locator("time");
			await date.hover();
			const dateTooltip = frame.locator("[data-session-overview-date-tooltip]");
			await dateTooltip.waitFor();
			const dateTooltipStyle = await readTooltipStyle(dateTooltip);
			expect(dateTooltipStyle.side).toBe("left");
			// Dismiss the date popup before testing the cost hover on the other side.
			await page.mouse.move(0, 0);
			await dateTooltip.waitFor({ state: "hidden" });
			expect(
				await firstRow.locator("[data-session-overview-metric-tag]").count(),
			).toBe(0);
			expect(
				await firstRow
					.locator('[data-session-overview-column="tokens"]')
					.count(),
			).toBe(0);
			const cost = firstRow.locator(
				'[data-session-overview-column="cost"] [data-session-overview-metric-value="cost"]',
			);
			expect(await cost.textContent()).toMatch(/^(?:\$[\d,.]+|[\d,]+¢)$/);
			expect(await cost.locator('[role="progressbar"]').count()).toBe(0);
			const chart = firstRow.locator(
				'[data-session-overview-column="model"] [data-session-model-progress]',
			);
			expect(await chart.count()).toBe(1);
			expect(
				await chart.getAttribute("data-session-model-background"),
			).not.toBeNull();
			expect(
				await chart.evaluate(
					(element) => element.getBoundingClientRect().width,
				),
			).toBeCloseTo(28, 1);
			expect(await chart.evaluate((element) => element.children.length)).toBe(
				1,
			);
			expect(
				await chart.evaluate(
					(element) => element.parentElement?.children.length,
				),
			).toBe(2);
			expect(await chart.locator("path").getAttribute("stroke-linecap")).toBe(
				"round",
			);
			expect(await chart.locator("path").getAttribute("stroke-width")).toBe(
				"3",
			);
			expect(await cost.locator("[title]").count()).toBe(0);
			const metadataPlacement = await firstRow.evaluate((element) => {
				const date = element.querySelector("time");
				const cost = element.querySelector(
					'[data-session-overview-metric-value="cost"]',
				);
				const avatar = element.querySelector(
					'[data-slot="session-member-profile-trigger"]',
				);
				if (!date || !cost || !avatar)
					throw new Error("Missing session metadata");
				return {
					costFirst: cost.parentElement === element.firstElementChild,
					dateLast: date.parentElement === element.lastElementChild,
					dateAfterAvatar:
						date.getBoundingClientRect().left >
						avatar.getBoundingClientRect().right,
					separatorCount: element.querySelectorAll(
						"[data-session-overview-date-cost-separator]",
					).length,
				};
			});
			expect(metadataPlacement).toEqual({
				costFirst: true,
				dateLast: true,
				dateAfterAvatar: true,
				separatorCount: 0,
			});
			for (const property of [
				"font-family",
				"font-size",
				"font-weight",
				"line-height",
				"letter-spacing",
				"color",
			]) {
				expect(
					await cost.evaluate(
						(element, key) => getComputedStyle(element).getPropertyValue(key),
						property,
					),
				).toBe(
					await date.evaluate(
						(element, key) => getComputedStyle(element).getPropertyValue(key),
						property,
					),
				);
			}
			await cost.hover();
			const tokenTooltip = frame.locator(
				"[data-session-overview-token-tooltip]",
			);
			await tokenTooltip.waitFor();
			expect(await readTooltipStyle(tokenTooltip)).toEqual({
				...dateTooltipStyle,
				side: "right",
			});
			const href = await firstRow.getAttribute("href");
			const session = seed.sessions.find((item) =>
				href?.includes(item.session_id),
			);
			if (!session)
				throw new Error("The hovered session is missing from the demo seed");
			expect(await tokenTooltip.textContent()).toBe(
				`Input: ${compactWholeNumberFormatter.format(session.input_tokens)} / Output: ${compactWholeNumberFormatter.format(session.output_tokens)}`,
			);
			expect(
				await frame.locator('[data-slot="session-detail-pane"]').count(),
			).toBe(0);
			expect(await readLayout(workspace)).toEqual(before);
			const opening = sampleTransition(workspace);
			await cost.click();
			await frame.locator('[data-slot="session-detail-pane"]').waitFor();
			const openingFrames = await opening;
			expect(openingFrames.some((snapshot) => snapshot.moving)).toBe(true);
			for (const snapshot of openingFrames) {
				expect(snapshot.grid).toBe(before.grid);
				expect(snapshot.rowWidth).toBe(before.rowWidth);
			}
			const opened = await readLayout(workspace);
			expect(opened.viewportWidth).toBeLessThan(before.viewportWidth);
			expect(opened.grid).toBe(before.grid);
			expect(opened.skills).toEqual(before.skills);

			// The reduced pane remains a genuine horizontal scroll viewport.
			const scrolling = await frame.locator(SCROLLER).evaluate((element) => {
				element.scrollLeft = 160;
				const position = element.scrollLeft;
				element.scrollLeft = 0;
				return position;
			});
			expect(scrolling).toBe(160);

			// Resizing the divider must not resize the underlying columns either.
			const handle = frame.getByRole("separator", {
				name: "Resize sessions overview and detail panes",
			});
			await handle.focus();
			await handle.press("ArrowRight");
			const resizedPane = await readLayout(workspace);
			expect(resizedPane.viewportWidth).toBeGreaterThan(opened.viewportWidth);
			expect(resizedPane.grid).toBe(before.grid);

			for (const width of [1512, 2560, 2036]) {
				await page.setViewportSize({ width, height: 1056 });
				const resized = await readLayout(workspace);
				expect(resized.rowWidth).toBe(resized.workspaceWidth);
				const columns = resized.grid.split(" ").map(Number.parseFloat);
				expect(columns).toHaveLength(6);
				expect(columns[0]).toBe(56);
				expect(columns[4]).toBe(56);
				expect(columns[1]).toBeCloseTo(
					Math.min(
						960,
						460 + Math.max(0, resized.workspaceWidth - 1112) * 0.55,
					),
					1,
				);
				expect(columns[3]).toBe(240);
				expect(columns[2]).toBeCloseTo(
					resized.workspaceWidth - 112 - columns[1] - 240 - 16,
					1,
				);
				if (width !== 2036) expect(resized.grid).not.toBe(before.grid);
			}
			const beforeClose = await readLayout(workspace);
			expect(beforeClose.grid).toBe(before.grid);
			const closing = sampleTransition(workspace);
			await frame
				.getByRole("button", { name: "Close session", exact: true })
				.click();
			await frame
				.locator('[data-slot="session-detail-pane"]')
				.waitFor({ state: "detached" });
			for (const snapshot of await closing) {
				expect(snapshot.grid).toBe(before.grid);
				expect(snapshot.rowWidth).toBe(before.rowWidth);
			}
			expect(await readLayout(workspace)).toEqual(before);
		} finally {
			await browser.close();
		}
	}, 60_000);
}
