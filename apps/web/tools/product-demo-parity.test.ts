import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { SessionOverviewAnalyticsSchema } from "@rudel/api-routes";
import { DemoSeedSchema } from "../src/features/demo/demo-runtime";
import seed from "../src/features/demo/seed.json";

test("Explore preserves preview rows exactly while loading the complete live overview", async () => {
	const browser = await chromium.launch({ channel: "chrome", headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 1500, height: 853 },
		});
		await page.goto("http://localhost:4600/home");
		await page
			.locator(
				'astro-island[component-export="InstantV2DemoExperience"]:not([ssr])',
			)
			.waitFor();
		const frame = page.frameLocator("[data-instant-v2-product-iframe]");
		const previewText = await frame.locator("#demo-seed").textContent();
		assert(previewText, "The served preview must contain its actual seed");
		const preview = DemoSeedSchema.parse(JSON.parse(previewText));
		expect(preview.sessions).toHaveLength(seed.sessions.length);
		const readRenderedRows = () =>
			frame
				.locator('[data-dashboard-grid-row-scope="session"]')
				.evaluateAll((elements) =>
					elements.map((element) => ({
						href: element.getAttribute("href"),
						text: element.textContent,
						titles: Array.from(element.querySelectorAll("[title]"), (node) =>
							node.getAttribute("title"),
						),
						charts: Array.from(
							element.querySelectorAll('[role="progressbar"]'),
							(node) => ({
								label: node.getAttribute("aria-label"),
								value: node.getAttribute("aria-valuenow"),
								arcs: Array.from(
									node.querySelectorAll("[stroke-dasharray]"),
									(arc) => arc.getAttribute("stroke-dasharray"),
								),
							}),
						),
					})),
				);
		const previewRenderedRows = await readRenderedRows();
		expect(previewRenderedRows).toHaveLength(preview.sessions.length);
		const responsePromise = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === "/rpc/analytics/sessions/list" &&
				response.ok(),
		);
		await page.locator("[data-instant-v2-dashboard-demo]").click();
		const response = await responsePromise;
		expect(response.headers()["x-opaline-preview-data"]).not.toBe(
			"local-snapshot",
		);
		const payload: unknown = await response.json();
		const parsed = SessionOverviewAnalyticsSchema.array()
			.min(1)
			.safeParse(
				typeof payload === "object" && payload && "json" in payload
					? payload.json
					: undefined,
			);
		assert(
			parsed.success,
			`Deployed sessions.list is missing the current overview contract: ${parsed.success ? "" : [...new Set(parsed.error.issues.map((issue) => issue.path.slice(1).join(".")))].join(", ")}`,
		);
		const rows = parsed.data;
		expect(rows).toHaveLength(seed.totalSessionCount);
		expect(preview.totalSessionCount).toBe(rows.length);
		for (const previewRow of preview.sessions) {
			const liveRow = rows.find(
				(row) => row.session_id === previewRow.session_id,
			);
			assert(
				liveRow,
				`Preview session ${previewRow.session_id} is missing from the live cohort`,
			);
			expect(previewRow).toEqual(liveRow);
		}
		expect(preview.maxima.input).toBe(
			Math.max(...rows.map((row) => row.input_tokens)),
		);
		expect(preview.maxima.output).toBe(
			Math.max(...rows.map((row) => row.output_tokens)),
		);
		expect(preview.maxima.tokens).toBe(
			Math.max(...rows.map((row) => row.input_tokens + row.output_tokens)),
		);
		expect(rows.every((row) => row.estimated_cost !== undefined)).toBe(true);
		expect(preview.maxima.cost).toBe(
			Math.max(...rows.map((row) => row.estimated_cost ?? 0)),
		);
		expect(rows.reduce((total, row) => total + row.error_count, 0)).toBe(621);
		expect(
			rows.reduce(
				(total, row) =>
					total +
					row.member_swears +
					row.member_apologies +
					row.member_positive +
					row.model_swears +
					row.model_apologies +
					row.model_positive,
				0,
			),
		).toBe(527);
		expect(rows.reduce((total, row) => total + row.subagent_count, 0)).toBe(12);
		expect(
			rows.some(
				(row) =>
					row.member_positive_matches.length > 0 ||
					row.member_swear_matches.length > 0 ||
					row.model_apology_matches.length > 0,
			),
		).toBe(true);
		await frame.locator("html[data-demo-live]").waitFor();
		await frame
			.locator('[data-dashboard-grid-row-scope="session"]')
			.nth(preview.sessions.length)
			.waitFor();
		const liveRenderedRows = await readRenderedRows();
		for (const previewRow of previewRenderedRows) {
			expect(
				liveRenderedRows.find((row) => row.href === previewRow.href),
			).toEqual(previewRow);
		}
		await frame
			.locator("[data-session-overview-language-signal]")
			.first()
			.waitFor();
		expect(
			await frame.locator("[data-session-overview-language-signal]").count(),
		).toBeGreaterThan(0);
		const errorTags = frame.locator("[data-session-overview-error-tag]");
		await errorTags.first().waitFor();
		expect(await errorTags.count()).toBeGreaterThan(0);
		expect(await errorTags.filter({ hasText: "—" }).count()).toBe(0);
		const renderedRows = await frame
			.locator('[data-dashboard-grid-row-scope="session"]')
			.evaluateAll((elements) =>
				elements.map((element) => ({
					href: element.getAttribute("href"),
					error:
						element
							.querySelector("[data-session-overview-error-tag]")
							?.textContent?.trim() ?? null,
				})),
			);
		for (const rendered of renderedRows) {
			const session = rows.find((row) =>
				rendered.href?.includes(row.session_id),
			);
			assert(
				session,
				"Every rendered row must come from the actual API response",
			);
			expect(rendered.error).toBe(
				session.error_count === 0 ? null : String(session.error_count),
			);
		}
	} finally {
		await browser.close();
	}
}, 60_000);
