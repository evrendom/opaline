import { expect, test } from "bun:test";
import { chromium } from "@playwright/test";

const TERMS = `http://127.0.0.1:${process.env.PREVIEW_PORT ?? 4600}/legal/terms-of-service`;

test("desktop legal TOC keeps the clicked destination active during smooth scrolling", async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 1440, height: 900 },
			reducedMotion: "no-preference",
		});
		await page.goto(TERMS, { waitUntil: "networkidle" });

		const observedSections = await page.evaluate(async () => {
			window.scrollTo(0, 0);
			await new Promise((resolve) => window.setTimeout(resolve, 100));
			const list = document.querySelector("[data-legal-toc-list]");
			const destination = list?.querySelector<HTMLButtonElement>(
				'[data-legal-toc-button="contact"]',
			);
			if (!list || !destination) throw new Error("Missing desktop legal TOC");

			const observed: string[] = [];
			const readCurrent = () => {
				const current = list
					.querySelector('[aria-current="location"]')
					?.getAttribute("data-legal-toc-button");
				if (current && observed.at(-1) !== current) observed.push(current);
			};
			const observer = new MutationObserver(readCurrent);
			observer.observe(list, {
				attributeFilter: ["aria-current"],
				attributes: true,
				subtree: true,
			});

			destination.click();
			readCurrent();
			await new Promise((resolve) => window.setTimeout(resolve, 1_800));
			observer.disconnect();
			return observed;
		});

		expect(observedSections).toEqual(["contact"]);

		await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
		await page.waitForTimeout(200);
		expect(
			await page
				.locator('[data-legal-toc-list] [aria-current="location"]')
				.getAttribute("data-legal-toc-button"),
		).toBe("agreement-and-eligibility");
	} finally {
		await browser.close();
	}
}, 10_000);
