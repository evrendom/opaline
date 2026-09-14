import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sqlClient } from "../db.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

let server: ApiTestServer;
const userIds: string[] = [];
const organizationIds: string[] = [];

beforeAll(async () => {
	server = await startApiTestServer();
});

afterAll(async () => {
	await server?.stop();
	for (const id of organizationIds) {
		await sqlClient`DELETE FROM organization WHERE id = ${id}`;
	}
	for (const id of userIds) {
		await sqlClient`DELETE FROM organization WHERE id = ${id}`;
		await sqlClient`DELETE FROM "user" WHERE id = ${id}`;
	}
});

test("missing and invalid sessions return to marketing without caching a personal redirect", async () => {
	for (const cookie of ["", "better-auth.session_token=invalid"]) {
		for (const method of ["GET", "HEAD"]) {
			const response = await openHome(cookie, method);
			expect(response.status).toBe(302);
			expect(response.headers.get("Location")).toBe("/home");
			expect(response.headers.get("Cache-Control")).toBe("private, no-store");
			expect(response.headers.get("Vary")).toContain("Cookie");
		}
	}
});

test("opens the active workspace, falls back to a membership, and handles no workspace", async () => {
	const { cookie, userId } = await createUser();
	await sqlClient`DELETE FROM organization WHERE id = ${userId}`;
	expect((await openHome(cookie)).headers.get("Location")).toBe(
		"/settings/workspace",
	);

	const organizations = [];
	for (const name of ["First", "Second"]) {
		const response = await authPost(
			"organization/create",
			{
				name,
				slug: `home-${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
			},
			cookie,
		);
		expect(response.status).toBe(200);
		const organization = z
			.object({ id: z.string(), slug: z.string() })
			.parse(await response.json());
		organizationIds.push(organization.id);
		organizations.push(organization);
	}
	const second = organizations[1];
	expect(second).toBeDefined();
	const activated = await authPost(
		"organization/set-active",
		{ organizationId: second?.id },
		cookie,
	);
	expect(activated.status).toBe(200);
	const active = await openHome(cookie);
	expect(active.status).toBe(302);
	expect(active.headers.get("Location")).toBe(`/${second?.slug}/sessions`);

	const cleared = await authPost(
		"organization/set-active",
		{ organizationId: null },
		cookie,
	);
	expect(cleared.status).toBe(200);
	const listed = await fetch(`${server.baseUrl}/api/auth/organization/list`, {
		headers: { Cookie: cookie },
	});
	expect(listed.status).toBe(200);
	const memberships = z
		.array(z.object({ slug: z.string() }))
		.parse(await listed.json());
	expect(memberships).toHaveLength(2);
	expect((await openHome(cookie)).headers.get("Location")).toBe(
		`/${memberships[0]?.slug}/sessions`,
	);
});

test("an expired but correctly signed cookie does not open a workspace", async () => {
	const { cookie, userId } = await createUser();
	await sqlClient`UPDATE session SET expires_at = NOW() - INTERVAL '1 hour' WHERE user_id = ${userId}`;
	const response = await openHome(cookie);
	expect(response.status).toBe(302);
	expect(response.headers.get("Location")).toBe("/home");
});

function openHome(cookie: string, method = "GET") {
	return fetch(`${server.baseUrl}/api/home`, {
		method,
		headers: { Cookie: cookie },
		redirect: "manual",
	});
}

function authPost(path: string, body: unknown, cookie = "") {
	return fetch(`${server.baseUrl}/api/auth/${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: "http://localhost",
			Cookie: cookie,
		},
		body: JSON.stringify(body),
	});
}

async function createUser() {
	const response = await authPost("sign-up/email", {
		name: "Home redirect QA",
		email: `home-${randomUUID()}@example.test`,
		password: "home-local-qa-password-42",
	});
	expect(response.status).toBe(200);
	const { user } = z
		.object({ user: z.object({ id: z.string() }) })
		.parse(await response.json());
	userIds.push(user.id);
	const cookie = response.headers
		.getSetCookie()
		.map((entry) => entry.split(";")[0])
		.join("; ");
	expect(cookie).toContain("better-auth.session_token=");
	return { cookie, userId: user.id };
}
