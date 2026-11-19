import { afterAll, beforeAll, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { z } from "zod";
import { sqlClient } from "../db.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

const origin = "https://opaline.so";
const workspaceName = 'Research & <Partners> "Studio"';
const workspaceSlug = `invite-preview-${randomUUID()}`;
let server: ApiTestServer;
let staticDirectory: string;
let cookie = "";
let userId = "";
let organizationId = "";

beforeAll(async () => {
	assert(process.env.PG_CONNECTION_STRING);
	assert(
		["localhost", "127.0.0.1"].includes(
			new URL(process.env.PG_CONNECTION_STRING).hostname,
		),
	);
	staticDirectory = await mkdtemp(join(tmpdir(), "opaline-invite-page-"));
	await writeFile(
		join(staticDirectory, "index.html"),
		'<!doctype html><html><head><title>Opaline</title><meta name="description" content="Generic"><meta property="og:title" content="Old preview"><link rel="canonical" href="https://opaline.so/"></head><body><div id="root"></div></body></html>',
	);
	server = await startApiTestServer({
		ALLOWED_ORIGIN: origin,
		APP_URL: origin,
		STATIC_DIR: relative(join(import.meta.dir, "..", ".."), staticDirectory),
	});
	const signup = await post("/api/auth/sign-up/email", {
		name: "Invite preview QA",
		email: `invite-preview-${randomUUID()}@example.test`,
		password: "invite-preview-local-qa-42",
	});
	cookie = signup.headers
		.getSetCookie()
		.map((entry) => entry.split(";")[0])
		.join("; ");
	userId = z
		.object({ user: z.object({ id: z.string() }) })
		.parse(await signup.json()).user.id;
	const organization = await post("/api/auth/organization/create", {
		name: workspaceName,
		slug: workspaceSlug,
	});
	organizationId = z
		.object({ id: z.string() })
		.parse(await organization.json()).id;
});

afterAll(async () => {
	await server?.stop();
	if (organizationId)
		await sqlClient`DELETE FROM organization WHERE id = ${organizationId}`;
	if (userId) {
		await sqlClient`DELETE FROM organization WHERE id = ${userId}`;
		await sqlClient`DELETE FROM "user" WHERE id = ${userId}`;
	}
	if (staticDirectory) await rm(staticDirectory, { recursive: true });
});

test("generates workspace join URLs and serves escaped social metadata without sign-in", async () => {
	const invite = await createInvite();
	expect(invite.origin).toBe(origin);
	expect(invite.pathname).toMatch(
		new RegExp(`^/${workspaceSlug}/join/[A-Za-z0-9_-]{43}$`),
	);
	const response = await fetch(`${server.baseUrl}${invite.pathname}`, {
		headers: { "User-Agent": "facebookexternalhit/1.1" },
	});
	expect(response.status).toBe(200);
	const html = await response.text();
	expect(html).toContain(
		'<meta property="og:title" content="Join Research &amp; &lt;Partners&gt; &quot;Studio&quot; | Opaline"',
	);
	expect(html).toContain(
		"Join Research &amp; &lt;Partners&gt; &quot;Studio&quot; and start learning from your agent sessions",
	);
	expect(html).toContain(
		`<meta property="og:image" content="${invite}/og.png"`,
	);
	expect(html).toContain(
		`<meta property="og:image:secure_url" content="${invite}/og.png"`,
	);
	expect(html).toContain(
		'<meta name="twitter:card" content="summary_large_image"',
	);
	expect(html).toContain('property="og:image:width" content="2400"');
	expect(html).toContain('property="og:image:height" content="1260"');
	expect(html).toContain('name="robots" content="noindex"');
	expect(html).toContain(`<link rel="canonical" href="${invite}"`);
	expect(html.match(/property="og:title"/gu)).toHaveLength(1);
	expect(html.match(/rel="canonical"/gu)).toHaveLength(1);
	expect(html).not.toContain("Old preview");
	expect(html).not.toContain("<Partners>");
	expect(response.headers.get("set-cookie")).toBeNull();
});

test("serves a complete PNG for crawlers and supports HEAD without joining", async () => {
	const invite = await createInvite();
	const imageUrl = `${server.baseUrl}${invite.pathname}/og.png`;
	const image = await fetch(imageUrl);
	expect(image.status).toBe(200);
	expect(image.headers.get("content-type")).toBe("image/png");
	const bytes = new Uint8Array(await image.arrayBuffer());
	expect(Array.from(bytes.slice(0, 8))).toEqual([
		137, 80, 78, 71, 13, 10, 26, 10,
	]);
	const view = new DataView(bytes.buffer);
	expect(view.getUint32(16)).toBe(2400);
	expect(view.getUint32(20)).toBe(1260);
	expect(bytes.length).toBeGreaterThan(10_000);
	const head = await fetch(imageUrl, { method: "HEAD" });
	expect(head.status).toBe(200);
	expect(head.headers.get("content-type")).toBe("image/png");
	expect(await head.text()).toBe("");
	const pageHead = await fetch(`${server.baseUrl}${invite.pathname}`, {
		method: "HEAD",
	});
	expect(pageHead.status).toBe(200);
	expect(await pageHead.text()).toBe("");
	const [members] = await sqlClient<
		Array<{ count: number }>
	>`SELECT count(*)::int AS count FROM member WHERE organization_id = ${organizationId}`;
	expect(members?.count).toBe(1);
});

test("old invitation URLs retain their token and share the canonical workspace preview", async () => {
	const invite = await createInvite();
	const token = invite.pathname.split("/").at(-1);
	const legacy = await fetch(`${server.baseUrl}/team/invite/${token}`);
	expect(legacy.status).toBe(200);
	expect(await legacy.text()).toContain(
		`<meta property="og:url" content="${invite}"`,
	);
});

test("revoked and expired links no longer expose workspace metadata or an image", async () => {
	const revoked = await createInvite();
	const active = await createInvite();
	const revokedPage = await fetch(`${server.baseUrl}${revoked.pathname}`);
	expect(revokedPage.status).toBe(404);
	expect(await revokedPage.text()).not.toContain("Research");
	expect(
		(await fetch(`${server.baseUrl}${revoked.pathname}/og.png`)).status,
	).toBe(404);
	await sqlClient`UPDATE team_invite_link SET expires_at = now() - interval '1 second' WHERE organization_id = ${organizationId}`;
	expect(
		(await fetch(`${server.baseUrl}${active.pathname}/og.png`)).status,
	).toBe(404);
	expect(
		(await fetch(`${server.baseUrl}/missing/join/invalid/og.png`)).status,
	).toBe(404);
});

async function createInvite(): Promise<URL> {
	const response = await post("/rpc/teamInviteLink/create", {
		json: { organizationId },
	});
	const link = z
		.object({ json: z.object({ invite_url: z.string().url() }) })
		.parse(await response.json());
	return new URL(link.json.invite_url);
}

async function post(path: string, data: unknown): Promise<Response> {
	const response = await fetch(`${server.baseUrl}${path}`, {
		method: "POST",
		headers: {
			Origin: origin,
			"Content-Type": "application/json",
			Cookie: cookie,
		},
		body: JSON.stringify(data),
	});
	expect(response.status).toBe(200);
	return response;
}
