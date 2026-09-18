import { expect, test } from "bun:test";
import { chromium, webkit } from "@playwright/test";
import { CliConnectionCreateResponseSchema } from "../../../packages/api-routes/src/cli-connection";
import { openDemoPreview } from "./demo-preview";

for (const engine of ["chrome", "webkit"]) {
	test(`${engine}: the first Copy click preserves the command label and copies its complete pairing command`, async () => {
		const browser =
			engine === "chrome"
				? await chromium.launch({ channel: "chrome", headless: true })
				: await webkit.launch({ headless: true });
		try {
			// No clipboard permission pre-grant: the real click must authorize writing.
			const context = await browser.newContext();
			const page = await context.newPage();
			const origin = `http://localhost:${process.env.PREVIEW_PORT ?? 4600}`;
			await openDemoPreview(page, `${origin}/#demo`);
			await page
				.locator('[data-instant-v2-demo-bar][data-stage="visible"]')
				.waitFor();
			let pairings = 0;
			// Delay forwarding to the real API to cover cold starts and lost transient
			// activation. The response and persisted pairing still come from Postgres.
			await page.route("**/api/cli/connections", async (route) => {
				pairings++;
				await new Promise((resolve) => setTimeout(resolve, 5500));
				await route.continue();
			});
			const response = page.waitForResponse(
				(response) =>
					new URL(response.url()).pathname === "/api/cli/connections" &&
					response.request().method() === "POST",
			);
			const button = page.locator(".instant-v2-demo-command");
			const label = await button.innerText();
			await button.click();
			await page
				.getByRole("button", { name: "Copying setup command…" })
				.waitFor();
			expect(await button.getAttribute("aria-busy")).toBe("true");
			expect(await button.innerText()).toBe(label);
			expect(await button.isDisabled()).toBe(true);
			const pairing = await response;
			expect(pairing.status()).toBe(200);
			const { code } = CliConnectionCreateResponseSchema.parse(
				await pairing.json(),
			);
			await page
				.getByRole("button", {
					name: "Copied — paste into your terminal",
					exact: true,
				})
				.waitFor();
			expect(await button.innerText()).toBe(label);
			expect(await button.getAttribute("data-copied")).toBe("true");
			expect(pairings).toBe(1);
			let command: string;
			if (engine === "chrome") {
				await context.grantPermissions(["clipboard-read"]);
				command = await page.evaluate(() => navigator.clipboard.readText());
			} else {
				await page.evaluate(() => {
					const field = document.createElement("textarea");
					field.id = "clipboard-verification";
					document.body.append(field);
					field.focus();
				});
				await page.keyboard.press("Meta+V");
				command = await page.locator("#clipboard-verification").inputValue();
			}
			expect(command).toBe(
				`npx opaline@latest --code ${code} --api-base ${origin}`,
			);
		} finally {
			await browser.close();
		}
	}, 30_000);
}
