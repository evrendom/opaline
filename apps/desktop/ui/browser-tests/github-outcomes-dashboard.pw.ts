import { expect, type Locator, test } from "@playwright/test";
import { CostDashboardInputSchema } from "@rudel/api-routes";
import { githubOutcomesDashboardFixture } from "../src/features/costs/github-outcomes-dashboard.fixture";

test("stage-1 GitHub dashboard happy path", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.route("**/rpc/analytics/overview/costs", async (route) => {
		const request = route.request().postDataJSON();
		const input = CostDashboardInputSchema.parse(request.json);
		await route.fulfill({
			json: { json: githubOutcomesDashboardFixture(input) },
		});
	});
	await page.goto("/browser-tests/github-outcomes-dashboard.html");
	await expect(
		page.getByRole("button", { name: "Merged PRs", exact: true }),
	).toBeVisible();
	const spoken = (flows: Locator) =>
		flows.evaluateAll((all) =>
			all
				.map(
					(flow: Element & { _internals?: ElementInternals }) =>
						flow._internals?.ariaLabel,
				)
				.join(""),
		);
	await expect
		.poll(() =>
			spoken(
				page
					.locator(".cost-metric")
					.filter({
						has: page.getByRole("button", {
							name: "PRs & CI",
							exact: true,
						}),
					})
					.locator(".cost-metric-value number-flow-react"),
			),
		)
		.toBe("3");
	await expect
		.poll(() =>
			spoken(
				page
					.getByRole("button", { name: "CI failures per PR" })
					.locator("number-flow-react"),
			),
		)
		.toBe("2");
	await expect(
		page.getByText("CI history from Sep 1, 2026 · 1 PR excluded"),
	).toBeVisible();
	await page.getByText("Weekly", { exact: true }).first().click();
	// The interval now reads in the date range button.
	await expect(page.getByRole("button", { name: / · Weekly$/ })).toBeVisible();
	await page.getByRole("button", { name: "CI failures per PR" }).click();
	await page.screenshot({
		path: testInfo.outputPath("s2-merged-prs.png"),
	});
	await page.getByRole("button", { name: "CI failures per PR" }).click();
	await page.screenshot({
		path: testInfo.outputPath("s2-ci-failures.png"),
	});
	await page.getByRole("button", { name: "CI runs", exact: true }).click();
	await page.getByRole("region", { name: "Conclusion", exact: true }).hover();
	await page
		.getByRole("region", { name: "Conclusion", exact: true })
		.getByRole("button", { name: "Split by conclusion" })
		.click();
	await expect(page.locator(".cost-chart-legend")).toContainText("Failure");
	await page.screenshot({
		path: testInfo.outputPath("s2-ci-runs.png"),
	});
	const chip = page.getByRole("button", {
		name: "Remove member filter alice (not applied to CI runs)",
		exact: true,
	});
	await page.keyboard.press("Tab");
	await chip.focus();
	await expect(page.getByRole("tooltip")).toContainText(
		"member and model filters don't apply here yet",
	);
	await chip.press("Enter");
	await expect(chip).toHaveCount(0);
});
