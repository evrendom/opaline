import { afterAll, beforeAll, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { z } from "zod";
import { createDemoHandler } from "../handlers/demo-http.js";
import { createVercelFunctionHandler } from "../lib/vercel-function-handler.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

const sql = postgres(process.env.PG_CONNECTION_STRING ?? "", { max: 1 });
let server: ApiTestServer;
let handler: ReturnType<typeof createDemoHandler>;
let userId: string;
let token: string;
let demoId: string;
let otherId: string;
const email = `showcase-${randomUUID()}@example.test`;
const password = `test-${randomUUID()}`;
async function auth(path: string, data: unknown) {
	const response = await fetch(`${server.baseUrl}/api/auth/${path}`, {
		method: "POST",
		headers: {
			origin: "http://localhost",
			"content-type": "application/json",
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify(data),
	});
	assert.equal(response.status, 200, path);
	return response.json();
}
beforeAll(async () => {
	server = await startApiTestServer({ POSTHOG_ENABLED: "false" });
	const account = z
		.object({ user: z.object({ id: z.string() }), token: z.string() })
		.parse(
			await auth("sign-up/email", { email, password, name: "Showcase test" }),
		);
	userId = account.user.id;
	token = account.token;
	const organizationSchema = z.object({ id: z.string() });
	demoId = organizationSchema.parse(
		await auth("organization/create", {
			name: "Showcase",
			slug: `showcase-${randomUUID()}`,
		}),
	).id;
	otherId = organizationSchema.parse(
		await auth("organization/create", {
			name: "Private",
			slug: `private-${randomUUID()}`,
		}),
	).id;
	handler = createDemoHandler(
		async (request) =>
			fetch(
				new URL(
					new URL(request.url).pathname + new URL(request.url).search,
					server.baseUrl,
				).href,
				{
					method: request.method,
					headers: request.headers,
					body:
						request.method === "POST" ? await request.arrayBuffer() : undefined,
				},
			),
		{
			APP_URL: "http://localhost",
			DEMO_ACCOUNT_EMAIL: email,
			DEMO_ACCOUNT_PASSWORD: password,
			DEMO_ORGANIZATION_ID: demoId,
		},
	);
});
afterAll(async () => {
	await server?.stop();
	if (userId) {
		await sql`DELETE FROM organization WHERE id IN (${demoId}, ${otherId})`;
		await sql`DELETE FROM "user" WHERE id = ${userId}`;
	}
	await sql.end();
});
test("demo reads use an isolated showcase session and never expose credentials", async () => {
	const response = await handler(
		new Request("http://localhost/api/demo/auth/get-session", {
			headers: {
				authorization: "Bearer unrelated-visitor-token",
				cookie: "better-auth.session_token=visitor-session",
			},
		}),
	);
	expect(response.status).toBe(200);
	expect(response.headers.get("set-cookie")).toBeNull();
	expect(response.headers.get("set-auth-token")).toBeNull();
	const data = z
		.object({
			session: z.object({ activeOrganizationId: z.string() }).passthrough(),
		})
		.parse(await response.json());
	expect(data.session.activeOrganizationId).toBe(demoId);
	expect(data.session.token).toBeUndefined();
	expect(data.session.ipAddress).toBeUndefined();
	expect(data.session.userAgent).toBeUndefined();
});
test("demo RPC bodies survive the Vercel response boundary", async () => {
	const vercelHandler = createVercelFunctionHandler({
		fetch: handler,
		functionGroup: "demo",
	});
	const response = await vercelHandler(
		new Request("http://localhost/api/demo/rpc/me", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ json: {} }),
		}),
	);
	expect(response.status).toBe(200);
	const body = await response.text();
	expect(body.length).toBeGreaterThan(0);
	expect(Number(response.headers.get("content-length"))).toBe(
		new TextEncoder().encode(body).byteLength,
	);
	expect(JSON.parse(body)).toMatchObject({ json: { id: userId } });
});
test("demo reads its GitHub connection status, so repo pages know whether to show CI and pull requests", async () => {
	const response = await handler(
		new Request(
			"http://localhost/api/demo/rpc/githubRepositoryEvidence/status",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ json: {} }),
			},
		),
	);
	expect(response.status).not.toBe(403);
});
test("demo cannot enumerate or select the account's other workspaces", async () => {
	for (const path of ["/auth/organization/list", "/rpc/listMyOrganizations"]) {
		const response = await handler(
			new Request(
				`http://localhost/api/demo${path}`,
				path.startsWith("/rpc")
					? { method: "POST", body: JSON.stringify({ json: {} }) }
					: {},
			),
		);
		expect(response.status).toBe(200);
		const organizations = z.array(z.object({ id: z.string() }));
		const payload = z
			.union([organizations, z.object({ json: organizations })])
			.parse(await response.json());
		expect(
			(Array.isArray(payload) ? payload : payload.json).map(
				(organization: { id: string }) => organization.id,
			),
		).toEqual([demoId]);
	}
	for (const path of [
		`/auth/organization/get-full-organization?organizationId=${otherId}`,
		"/auth/organization/set-active",
		"/rpc/deleteOrganization",
		"/rpc/ingestSession",
	]) {
		const response = await handler(
			new Request(
				`http://localhost/api/demo${path}`,
				path.includes("?")
					? {}
					: {
							method: "POST",
							body: JSON.stringify({ json: { organizationId: otherId } }),
						},
			),
		);
		expect(response.status).toBe(403);
	}
	const response = await handler(
		new Request("http://localhost/api/demo/rpc/getOrganizationSessionCount", {
			method: "POST",
			body: JSON.stringify({ json: { organizationId: otherId } }),
		}),
	);
	expect(response.status).toBe(403);
});
