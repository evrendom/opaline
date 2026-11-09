import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PG_CONNECTION_STRING ??= "postgres://unused@127.0.0.1:1/unused";
const { handleSitePageRequest, readSessionToken, withWorkspaceMeta } =
	await import("./site-page-http.js");

let siteDirectory = "";
const app = "<html><head><title>Opaline</title></head><body></body></html>";

beforeAll(async () => {
	siteDirectory = await mkdtemp(join(tmpdir(), "site-page-"));
	await mkdir(join(siteDirectory, "410"));
	await writeFile(join(siteDirectory, "app.html"), app);
	await writeFile(
		join(siteDirectory, "404.html"),
		"<html><head></head></html>",
	);
	await writeFile(
		join(siteDirectory, "410", "index.html"),
		"<html><head></head></html>",
	);
});

afterAll(async () => {
	await rm(siteDirectory, { recursive: true, force: true });
});

function page(
	path: string,
	cookie = "__Secure-better-auth.session_token=member-token.sig%3D",
) {
	return handleSitePageRequest(
		new Request(`https://opaline.test${path}`, { headers: { Cookie: cookie } }),
		siteDirectory,
		async (slug, token) =>
			slug === "acme"
				? {
						exists: true,
						workspace:
							token === "member-token" ? { id: "org-acme", slug } : null,
					}
				: { exists: false, workspace: null },
	);
}

describe("app page workspace", () => {
	test("a workspace page carries the workspace id and slug for the app to start with", async () => {
		const response = await page("/acme/sessions");
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await response.text()).toBe(
			'<html><head><title>Opaline</title><meta name="opaline-workspace" content="acme" data-id="org-acme"></head><body></body></html>',
		);
	});

	test("a visitor who is not a member gets the page without the workspace id", async () => {
		for (const cookie of ["", "better-auth.session_token=other-token.sig"]) {
			const response = await page("/acme/sessions", cookie);
			expect(response.status).toBe(200);
			expect(await response.text()).toBe(app);
		}
	});

	test("reads the session token from either cookie name", () => {
		const read = (cookie: string) =>
			readSessionToken(
				new Request("https://opaline.test/", { headers: { Cookie: cookie } }),
			);
		expect(read("a=1; better-auth.session_token=tok.sig%2F%3D")).toBe("tok");
		expect(read("__Secure-better-auth.session_token=tok2.sig")).toBe("tok2");
		expect(read("a=1")).toBeNull();
		expect(read("better-auth.session_token=%E0%A4%A")).toBeNull();
	});

	test("other pages are served unchanged", async () => {
		expect(await (await page("/login")).text()).toBe(app);
		const missing = await page("/nobody/sessions");
		expect(missing.status).toBe(404);
		expect(await missing.text()).not.toContain("opaline-workspace");
	});

	test("escapes the values it writes into the page", () => {
		expect(
			withWorkspaceMeta("<head></head>", { id: `a"b<c>&'`, slug: "acme" }),
		).toBe(
			'<head><meta name="opaline-workspace" content="acme" data-id="a&quot;b&lt;c&gt;&amp;&#39;"></head>',
		);
	});
});
