import { describe, expect, test } from "bun:test";

describe("shared API handler runtime boundary", () => {
	test("keeps Bun file APIs in the resident-server static fallback", async () => {
		const [handlerSource, staticSiteSource] = await Promise.all([
			Bun.file(new URL("../handler.ts", import.meta.url)).text(),
			Bun.file(new URL("../static-site.ts", import.meta.url)).text(),
		]);

		expect(handlerSource).not.toContain("Bun.file");
		expect(handlerSource).not.toContain("Bun.BunFile");
		expect(staticSiteSource).toContain("Bun.file");
	});
});
