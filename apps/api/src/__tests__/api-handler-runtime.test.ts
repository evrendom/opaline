import { describe, expect, test } from "bun:test";

describe("shared API handler runtime boundary", () => {
	test("keeps Bun file APIs in the Fly-only static fallback", async () => {
		const [handlerSource, flyStaticSource] = await Promise.all([
			Bun.file(new URL("../handler.ts", import.meta.url)).text(),
			Bun.file(new URL("../fly-static.ts", import.meta.url)).text(),
		]);

		expect(handlerSource).not.toContain("Bun.file");
		expect(handlerSource).not.toContain("Bun.BunFile");
		expect(flyStaticSource).toContain("Bun.file");
	});
});
