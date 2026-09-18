import { expect, type Page, test } from "@playwright/test";
import {
	MAX_FORMATTED_MESSAGE_PARTS,
	MAX_HIGHLIGHTED_CODE_BLOCKS,
} from "../src/components/conversation/message-content-parser";

// DOM size is the hard resource bound. Time is only a generous smoke check
// because shared CI runners vary substantially in speed.
const MAX_BROWSER_RENDER_MS = 5_000;
const MAX_BROWSER_DOM_NODES = 20_000;

test("collapsed model text wraps long tokens within its reading width", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(
		"/browser-tests/message-content.html?scenario=collapsed-model",
	);
	const preview = page.locator("[data-trace-text-preview]");
	await expect(preview).toBeVisible();
	const bounds = await preview.evaluate((element) => {
		const leading = element.querySelector("[data-trace-text-preview-leading]");
		if (!leading) throw new Error("Collapsed preview text is missing");
		const range = document.createRange();
		range.selectNodeContents(leading);
		return {
			limit: Number.parseFloat(getComputedStyle(element).maxWidth),
			textWidth: Math.max(
				...Array.from(range.getClientRects(), (r) => r.width),
			),
		};
	});
	expect(bounds.limit).toBeGreaterThan(0);
	expect(bounds.textWidth).toBeLessThanOrEqual(bounds.limit + 1);
	await expect(page.locator("[data-trace-text-preview-leading]")).toHaveText(
		"x".repeat(1_500),
	);
	await page.locator("[data-trace-content-disclosure]").click();
	await expect(page.locator("[data-trace-expanded-content]")).toContainText(
		`${"x".repeat(2_000)} end of model message`,
	);
});

for (const scenario of ["array", "code", "large-code", "xml"]) {
	test(`bounds maximum-size adversarial ${scenario} rendering`, async ({
		page,
	}) => {
		await page.goto(`/browser-tests/message-content.html?scenario=${scenario}`);

		const renderResult = page.locator("#render-result");
		await expect(renderResult).toHaveAttribute("data-complete", "true");

		if (scenario !== "large-code") {
			await expect(page.getByTestId("message-content-notice")).toBeVisible();
		}
		if (scenario === "array") {
			await expect(page.getByText(/array-tail-visible/)).toBeVisible();
		}

		const {
			durationMs,
			domNodes,
			codeBlocks,
			highlightedCodeBlocks,
			xmlBlocks,
		} = await readRenderMetrics(page);

		expect(durationMs).toBeLessThan(MAX_BROWSER_RENDER_MS);
		expect(domNodes).toBeLessThan(MAX_BROWSER_DOM_NODES);
		expect(highlightedCodeBlocks).toBeLessThanOrEqual(
			MAX_HIGHLIGHTED_CODE_BLOCKS,
		);

		if (scenario === "array" || scenario === "code") {
			expect(codeBlocks).toBe(MAX_FORMATTED_MESSAGE_PARTS);
			expect(xmlBlocks).toBe(0);
		} else if (scenario === "xml") {
			expect(codeBlocks).toBe(0);
			expect(xmlBlocks).toBe(Math.floor(MAX_FORMATTED_MESSAGE_PARTS / 2));
		} else {
			expect(codeBlocks).toBe(MAX_HIGHLIGHTED_CODE_BLOCKS + 1);
			expect(highlightedCodeBlocks).toBe(MAX_HIGHLIGHTED_CODE_BLOCKS);
			expect(xmlBlocks).toBe(0);
		}
	});
}

test("reads completed metrics when the fixture reloads after its readiness check", async ({
	page,
}) => {
	await page.goto("/browser-tests/message-content.html?scenario=code");
	await expect(page.locator("#render-result")).toHaveAttribute(
		"data-complete",
		"true",
	);
	await page.route("**/message-content-harness.tsx", async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 500));
		await route.continue();
	});
	await page.reload({ waitUntil: "commit" });
	const metrics = await readRenderMetrics(page);
	expect(metrics.codeBlocks).toBe(MAX_FORMATTED_MESSAGE_PARTS);
	expect(metrics.domNodes).toBeGreaterThan(0);
	expect(metrics.durationMs).toBeGreaterThan(0);
});

test("caps the outer message block loop", async ({ page }) => {
	await page.goto("/browser-tests/message-content.html?scenario=blocks");

	const renderResult = page.locator("#render-result");
	await expect(renderResult).toHaveAttribute("data-complete", "true");
	await expect(page.getByTestId("message-block-limit-notice")).toHaveText(
		"Additional content not shown (1 block omitted).",
	);

	const { textBlocks, maxMessageBlocks } = await readRenderMetrics(page);

	expect(textBlocks).toBe(maxMessageBlocks);
});

test("renders repeated XML fields without duplicate React keys", async ({
	page,
}) => {
	const duplicateKeyErrors: string[] = [];
	page.on("console", (message) => {
		if (
			message.type() === "error" &&
			/same key|unique "key"/i.test(message.text())
		) {
			duplicateKeyErrors.push(message.text());
		}
	});

	await page.goto("/browser-tests/message-content.html?scenario=duplicate-xml");
	await expect(page.locator("#render-result")).toHaveAttribute(
		"data-complete",
		"true",
	);

	expect(duplicateKeyErrors).toEqual([]);
});

async function readRenderMetrics(page: Page) {
	// Vite can reload after a readiness assertion. Resolve a completed result
	// again and read every measurement in the same browser task.
	return page
		.locator('#render-result[data-complete="true"]')
		.evaluate((result) => {
			function readMetric(name: string) {
				const raw = result.getAttribute(name);
				if (
					raw === null ||
					raw.trim() === "" ||
					!Number.isFinite(Number(raw))
				) {
					throw new Error(`Missing or invalid render metric: ${name}`);
				}
				return Number(raw);
			}

			return {
				durationMs: readMetric("data-duration-ms"),
				domNodes: readMetric("data-dom-nodes"),
				codeBlocks: readMetric("data-code-blocks"),
				highlightedCodeBlocks: readMetric("data-highlighted-code-blocks"),
				xmlBlocks: readMetric("data-xml-blocks"),
				textBlocks: readMetric("data-text-blocks"),
				maxMessageBlocks: readMetric("data-max-message-blocks"),
			};
		});
}
