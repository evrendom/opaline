import { afterAll, beforeAll, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sqlClient } from "../db.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

let server: ApiTestServer;
let cookie = "";
let userId = "";

beforeAll(async () => {
	assert(process.env.PG_CONNECTION_STRING);
	assert(
		["localhost", "127.0.0.1"].includes(
			new URL(process.env.PG_CONNECTION_STRING).hostname,
		),
	);
	server = await startApiTestServer();
	const response = await fetch(`${server.baseUrl}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost" },
		body: JSON.stringify({
			name: "Title QA",
			email: `title-${randomUUID()}@example.test`,
			password: "title-local-qa-password-42",
		}),
	});
	expect(response.status).toBe(200);
	cookie = response.headers
		.getSetCookie()
		.map((entry) => entry.split(";")[0])
		.join("; ");
	userId = z
		.object({ user: z.object({ id: z.string() }) })
		.parse(await response.json()).user.id;
});

afterAll(async () => {
	await server?.stop();
	if (userId) {
		await sqlClient`DELETE FROM organization WHERE id = ${userId}`;
		await sqlClient`DELETE FROM "user" WHERE id = ${userId}`;
	}
});

test("profile title persists, survives older clients, validates length, and can be cleared", async () => {
	const saved = await updateProfile({
		name: "Title QA",
		image: null,
		jobTitle: "  Software engineer  ",
	});
	expect(saved.status).toBe(200);
	expect(
		z
			.object({ json: z.object({ jobTitle: z.string() }) })
			.parse(await saved.json()).json.jobTitle,
	).toBe("Software engineer");
	expect(await readTitle()).toBe("Software engineer");
	const legacy = await updateProfile({ name: "Renamed QA", image: null });
	expect(legacy.status).toBe(200);
	expect(await readTitle()).toBe("Software engineer");
	const invalid = await updateProfile({
		name: "Title QA",
		image: null,
		jobTitle: "x".repeat(101),
	});
	expect(invalid.status).toBe(400);
	expect(await readTitle()).toBe("Software engineer");
	const cleared = await updateProfile({
		name: "Title QA",
		image: null,
		jobTitle: null,
	});
	expect(cleared.status).toBe(200);
	expect(await readTitle()).toBeNull();
});

function updateProfile(input: {
	name: string;
	image: null;
	jobTitle?: string | null;
}) {
	return fetch(`${server.baseUrl}/rpc/profile/updateMine`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: "http://localhost",
			Cookie: cookie,
		},
		body: JSON.stringify({ json: input }),
	});
}

async function readTitle() {
	const response = await fetch(`${server.baseUrl}/api/auth/get-session`, {
		headers: { Cookie: cookie },
	});
	expect(response.status).toBe(200);
	return z
		.object({ user: z.object({ jobTitle: z.string().nullable() }) })
		.parse(await response.json()).user.jobTitle;
}
