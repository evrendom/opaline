import { expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

mock.module("../db.js", () => ({
	sqlClient: () => {
		throw new Error("Postgres is not used here");
	},
	db: {},
}));

const { createStaticFallback } = await import("../static-site.js");

function site() {
	const root = mkdtempSync(join(tmpdir(), "opaline-static-"));
	const web = join(root, "dist");
	mkdirSync(join(web, "assets"), { recursive: true });
	writeFileSync(join(web, "index.html"), "<!doctype html><title>app</title>");
	writeFileSync(join(web, "assets", "app-1234.js"), "console.log(1)");
	writeFileSync(join(root, "secret.txt"), "outside");
	return { root, web };
}

const ask = (
	fallback: ReturnType<typeof createStaticFallback>,
	path: string,
) => {
	const url = new URL(`http://localhost${path}`);
	return fallback({
		cors: {},
		request: new Request(url.toString()),
		requestId: "r",
		url,
		publicLookupSource: "test",
	});
};

test("files are served, other routes get the app, excluded prefixes and escapes get nothing", async () => {
	const { web } = site();
	const fallback = createStaticFallback({
		directory: web,
		spaExcludedPrefixes: ["/api/", "/rpc"],
	});
	expect(await (await ask(fallback, "/assets/app-1234.js"))?.text()).toBe(
		"console.log(1)",
	);
	expect(await (await ask(fallback, "/acme/sessions"))?.text()).toContain(
		"<title>app</title>",
	);
	expect(await (await ask(fallback, "/"))?.text()).toContain(
		"<title>app</title>",
	);
	expect(await ask(fallback, "/api/unknown")).toBeNull();
	expect(await ask(fallback, "/rpc/unknown")).toBeNull();
	expect(await (await ask(fallback, "/%2e%2e/secret.txt"))?.text()).not.toBe(
		"outside",
	);
});

test("without an index.html there is no app to fall back to", async () => {
	const root = mkdtempSync(join(tmpdir(), "opaline-static-empty-"));
	expect(
		await ask(createStaticFallback({ directory: root }), "/acme"),
	).toBeNull();
});
