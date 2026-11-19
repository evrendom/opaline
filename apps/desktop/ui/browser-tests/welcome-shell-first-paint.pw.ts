import { expect, test } from "@playwright/test";

test("welcome owns its layout before the lazy route styles load", async ({
	page,
}) => {
	let releaseStyles = () => {};
	const stylesReleased = new Promise<void>((resolve) => {
		releaseStyles = resolve;
	});
	let markStylesRequested = () => {};
	const stylesRequested = new Promise<void>((resolve) => {
		markStylesRequested = resolve;
	});

	await page.route("**/api/**", async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		await route.fulfill({
			contentType: "application/json",
			body: pathname.endsWith("/organization/list") ? "[]" : "null",
		});
	});
	await page.route(
		"**/src/features/cli-onboarding/welcome.css*",
		async (route) => {
			markStylesRequested();
			await stylesReleased;
			await route.continue();
		},
	);

	const navigation = page.goto("/welcome");
	await stylesRequested;
	const shell = page.locator(".cli-welcome-shell");
	await shell.waitFor();
	const displayBeforeRouteStyles = await shell.evaluate(
		(element) => getComputedStyle(element).display,
	);

	releaseStyles();
	await navigation;
	expect(displayBeforeRouteStyles).toBe("grid");
});
