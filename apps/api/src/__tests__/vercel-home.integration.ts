// Run from the repository root after bun run build:site, against local Postgres.
import { afterAll, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sqlClient } from "../db.js";
import { handleVercelRpcRequest as handleVercelRequest } from "../vercel-rpc-handler.js";

assert(process.env.PG_CONNECTION_STRING);
assert(
	["localhost", "127.0.0.1"].includes(
		new URL(process.env.PG_CONNECTION_STRING).hostname,
	),
);
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: (request) => handleVercelRequest(request),
});
let userId = "";
afterAll(async () => {
	server.stop(true);
	await sqlClient`DELETE FROM organization WHERE id IN (SELECT organization_id FROM member WHERE user_id = ${userId})`;
	await sqlClient`DELETE FROM "user" WHERE id = ${userId}`;
});

async function openPage(cookie = "", method = "GET", path = "/api/home") {
	return fetch(new URL(`/api/rpc?__opaline_path=${path}`, server.url), {
		method,
		headers: { Cookie: cookie },
		redirect: "manual",
	});
}

async function expectMarketing(cookie: string, path = "/api/home") {
	for (const method of ["GET", "HEAD"]) {
		const response = await openPage(cookie, method, path);
		expect(response.status).toBe(200);
		expect(response.headers.get("Location")).toBeNull();
		expect(response.headers.get("X-Robots-Tag")).toBeNull();
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		const html = await response.text();
		if (method === "HEAD") expect(html).toBe("");
		else {
			expect(html).not.toMatch(/http-equiv=["']refresh/iu);
			expect(html).toContain(
				'rel="canonical" href="https://evren.opaline.so/"',
			);
			expect(html).toContain(
				'property="og:image" content="https://evren.opaline.so/images/opaline-social.png"',
			);
		}
	}
}

test("missing and invalid cookies serve indexable marketing at the root without redirecting", async () => {
	await expectMarketing("");
	await expectMarketing("better-auth.session_token=invalid");
});

async function expectPublicHomeRedirect(cookie: string) {
	for (const method of ["GET", "HEAD"]) {
		const response = await openPage(cookie, method, "/api/public-home");
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("/");
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		expect(response.headers.get("Vary")).toBe("Cookie");
		expect(await response.text()).toBe("");
	}
}

test("signed-out /home visits redirect to the public root without a redirect HTML page", async () => {
	await expectPublicHomeRedirect("");
	await expectPublicHomeRedirect("better-auth.session_token=invalid");
	const response = await fetch(
		new URL(
			"/api/rpc?__opaline_path=/api/public-home&utm_source=qa",
			server.url,
		),
		{ redirect: "manual" },
	);
	expect(response.status).toBe(302);
	expect(response.headers.get("Location")).toBe("/?utm_source=qa");
	const authQuery = await fetch(
		new URL(
			"/api/rpc?__opaline_path=/api/public-home&user_code=ABCD&redirect=signup&error=old&utm_source=qa",
			server.url,
		),
		{ redirect: "manual" },
	);
	expect(authQuery.status).toBe(302);
	expect(authQuery.headers.get("Location")).toBe("/?utm_source=qa");
});

test("public homepage routes reject writes", async () => {
	const response = await openPage("", "POST", "/api/public-home");
	expect(response.status).toBe(405);
	expect(response.headers.get("Allow")).toBe("GET, HEAD");
});

test("signed-in users stay on /home, while root visits follow setup progress and expired sessions return to /", async () => {
	const signup = await fetch(new URL("/api/auth/sign-up/email", server.url), {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost" },
		body: JSON.stringify({
			name: "SEO homepage QA",
			email: `seo-home-${randomUUID()}@example.test`,
			password: "seo-home-local-password-42",
		}),
	});
	expect(signup.status).toBe(200);
	userId = z
		.object({ user: z.object({ id: z.string() }) })
		.parse(await signup.json()).user.id;
	const cookie = signup.headers
		.getSetCookie()
		.map((entry) => entry.split(";")[0])
		.join("; ");
	expect(cookie).toContain("better-auth.session_token=");
	const [workspace] = await sqlClient<
		{ slug: string }[]
	>`SELECT o.slug FROM organization o INNER JOIN member m ON m.organization_id = o.id WHERE m.user_id = ${userId} LIMIT 1`;
	assert(workspace);
	const signedIn = await openPage(cookie);
	expect(signedIn.status).toBe(302);
	expect(signedIn.headers.get("Location")).toBe("/welcome");
	await sqlClient`INSERT INTO session_ownership (organization_id, session_id, user_id, last_ingested_at)
		VALUES (${userId}, ${`vercel-home-${randomUUID()}`}, ${userId}, NOW())`;
	expect((await openPage(cookie)).headers.get("Location")).toBe(
		`/${workspace.slug}/sessions`,
	);
	expect(signedIn.headers.get("Cache-Control")).toBe("private, no-store");
	await expectMarketing(cookie, "/api/public-home");
	await sqlClient`UPDATE session SET expires_at = NOW() - INTERVAL '1 hour' WHERE user_id = ${userId}`;
	await expectPublicHomeRedirect(cookie);
	await expectMarketing(cookie);
});
