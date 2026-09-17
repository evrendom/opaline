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
	fetch: handleVercelRequest,
});
let userId = "";
afterAll(async () => {
	server.stop(true);
	await sqlClient`DELETE FROM organization WHERE id IN (SELECT organization_id FROM member WHERE user_id = ${userId})`;
	await sqlClient`DELETE FROM "user" WHERE id = ${userId}`;
});

async function openRoot(cookie = "", method = "GET") {
	return fetch(new URL("/api/rpc?__opaline_path=/api/home", server.url), {
		method,
		headers: { Cookie: cookie },
		redirect: "manual",
	});
}

async function expectMarketing(cookie: string) {
	for (const method of ["GET", "HEAD"]) {
		const response = await openRoot(cookie, method);
		expect(response.status).toBe(200);
		expect(response.headers.get("Location")).toBeNull();
		expect(response.headers.get("X-Robots-Tag")).toBeNull();
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		const html = await response.text();
		if (method === "HEAD") expect(html).toBe("");
		else {
			expect(html).toContain('rel="canonical" href="https://opaline.so/"');
			expect(html).toContain(
				'property="og:image" content="https://opaline.so/images/opaline-social.png"',
			);
		}
	}
}

test("missing and invalid cookies serve indexable marketing at the root without redirecting", async () => {
	await expectMarketing("");
	await expectMarketing("better-auth.session_token=invalid");
});

test("valid root sessions open their workspace; expired sessions stay on the public root", async () => {
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
	const signedIn = await openRoot(cookie);
	expect(signedIn.status).toBe(302);
	expect(signedIn.headers.get("Location")).toBe(`/${workspace.slug}/sessions`);
	expect(signedIn.headers.get("Cache-Control")).toBe("private, no-store");
	await sqlClient`UPDATE session SET expires_at = NOW() - INTERVAL '1 hour' WHERE user_id = ${userId}`;
	await expectMarketing(cookie);
});
