// Run from the repository root after bun run build:site, against local Postgres.
import { afterAll, beforeAll, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sqlClient } from "../db.js";
import { handleSitePageRequest } from "../handlers/site-page-http.js";

const id = randomUUID();
const slug = `seo-${id}`;
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: (request) => handleSitePageRequest(request),
});
beforeAll(async () => {
	assert(process.env.PG_CONNECTION_STRING);
	assert(
		["localhost", "127.0.0.1"].includes(
			new URL(process.env.PG_CONNECTION_STRING).hostname,
		),
	);
	await sqlClient`INSERT INTO organization (id, name, slug, created_at) VALUES (${id}, 'SEO route test', ${slug}, NOW())`;
});
afterAll(async () => {
	server.stop(true);
	await sqlClient`DELETE FROM organization WHERE id = ${id}`;
});

test("GET and HEAD return real status codes and never index private or missing pages", async () => {
	const cases: [string, number][] = [
		["/pricing", 404],
		["/legal/missing", 404],
		[`/missing-${id}`, 404],
		[`/missing-${id}/sessions`, 404],
		[`/${slug}/unknown`, 404],
		["/wrapped/report/123", 410],
		["/dev/wrapped", 410],
		["/resume/123", 410],
		["/login", 200],
		["/welcome?code=ABCD", 200],
		["/device?user_code=ABCD", 200],
		[`/${slug}`, 200],
		[`/${slug}/sessions`, 200],
		[`/${slug}/settings/members`, 200],
	];
	for (const [path, status] of cases) {
		for (const method of ["GET", "HEAD"]) {
			const response = await fetch(new URL(path, server.url), { method });
			expect(response.status).toBe(status);
			expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
			expect(response.headers.get("Cache-Control")).toBe("private, no-store");
			const body = await response.text();
			if (method === "HEAD") expect(body).toBe("");
			else {
				expect(body).toContain('name="robots" content="noindex, nofollow"');
				expect(body).toContain(
					status === 200
						? 'id="root"'
						: status === 410
							? "This page has been retired"
							: "404 page not found",
				);
			}
		}
	}
});

test("page routes reject writes", async () => {
	const response = await fetch(new URL("/welcome", server.url), {
		method: "POST",
	});
	expect(response.status).toBe(405);
	expect(response.headers.get("Allow")).toBe("GET, HEAD");
});
