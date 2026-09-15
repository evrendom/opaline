import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import assert from "node:assert/strict";
import {
	CLI_SESSION_UPLOAD_STATUS_MAX_IDS,
	CliApiKeyCreateResponseSchema,
	CliSessionUploadStatusOutputSchema,
	CliSetupStatusSchema,
} from "@rudel/api-routes";
import { sqlClient } from "../db.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

setDefaultTimeout(30_000);

interface TestUser {
	id: string;
	token: string;
}

const runId = `cli-status-${crypto.randomUUID()}`;
const createdUsers: TestUser[] = [];
let server: ApiTestServer;
let owner: TestUser;
let teammate: TestUser;
let apiKey: string;

beforeAll(async () => {
	server = await startApiTestServer();
	owner = await createUser("owner");
	teammate = await createUser("teammate");
	await sqlClient`
		INSERT INTO member (id, organization_id, user_id, role, created_at)
		VALUES (${crypto.randomUUID()}, ${owner.id}, ${teammate.id}, 'member', NOW())
	`;
	await sqlClient`
		INSERT INTO session_ownership
			(organization_id, session_id, user_id, last_ingested_at)
		VALUES
			(${owner.id}, 'uploaded', ${owner.id}, NOW()),
			(${owner.id}, 'pending', ${owner.id}, NULL),
			(${owner.id}, 'teammate-session', ${teammate.id}, NOW()),
			(${teammate.id}, 'other-org-session', ${teammate.id}, NOW())
	`;
	const response = await fetch(`${server.baseUrl}/api/auth/api-key/create`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${owner.token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ name: "cli-status-test", expiresIn: null }),
	});
	expect(response.status).toBe(200);
	apiKey = CliApiKeyCreateResponseSchema.parse(await response.json()).key;
});

afterAll(async () => {
	await server?.stop();
	for (const user of createdUsers) {
		await sqlClient`DELETE FROM organization WHERE id = ${user.id}`;
		await sqlClient`DELETE FROM "user" WHERE id = ${user.id}`;
	}
});

test("an ingest API key resolves the personal workspace and returns only its completed uploads", async () => {
	const response = await lookup(
		{ sessionIds: ["uploaded", "pending", "teammate-session", "unknown"] },
		{ "x-api-key": apiKey },
	);
	expect(response.status).toBe(200);
	const body = await readStatus(response);
	expect(body).toEqual({
		organizationId: owner.id,
		uploadedSessionIds: ["uploaded"],
	});
});

test("a teammate can check only their own sessions in a shared organization", async () => {
	const response = await lookup(
		{
			organizationId: owner.id,
			sessionIds: ["uploaded", "teammate-session", "other-org-session"],
		},
		{ Authorization: `Bearer ${teammate.token}` },
	);
	expect(response.status).toBe(200);
	expect(await readStatus(response)).toEqual({
		organizationId: owner.id,
		uploadedSessionIds: ["teammate-session"],
	});
});

test("rejects an organization the caller does not belong to", async () => {
	const response = await lookup(
		{ organizationId: teammate.id, sessionIds: ["other-org-session"] },
		{ "x-api-key": apiKey },
	);
	expect(response.status).toBe(403);
});

test("requires authentication", async () => {
	const response = await lookup({ sessionIds: ["uploaded"] });
	expect(response.status).toBe(401);
});

test("setup status accepts CLI ingest keys and reports the account's previous uploads", async () => {
	const response = await fetch(`${server.baseUrl}/rpc/cli/setupStatus`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-api-key": apiKey },
		body: "{}",
	});
	expect(response.status).toBe(200);
	expect(await readSetupStatus(response)).toEqual({
		hasCliLogin: false,
		hasUploadedSessions: true,
	});
});

test("new accounts stay new through pending uploads and become returning across workspaces after ingest", async () => {
	const fresh = await createUser("first-upload");
	await sqlClient`INSERT INTO member (id, organization_id, user_id, role, created_at)
		VALUES (${crypto.randomUUID()}, ${owner.id}, ${fresh.id}, 'member', NOW())`;
	const lookupSetup = () =>
		fetch(`${server.baseUrl}/rpc/cli/setupStatus`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${fresh.token}`,
			},
			body: "{}",
		});
	const before = await lookupSetup();
	expect(before.status).toBe(200);
	expect(await readSetupStatus(before)).toEqual({
		hasCliLogin: false,
		hasUploadedSessions: false,
	});
	await sqlClient`INSERT INTO session_ownership (organization_id, session_id, user_id, last_ingested_at)
		VALUES (${owner.id}, ${`${runId}-first-upload`}, ${fresh.id}, NULL)`;
	const pending = await lookupSetup();
	expect(pending.status).toBe(200);
	expect((await readSetupStatus(pending)).hasUploadedSessions).toBe(false);
	await sqlClient`UPDATE session_ownership SET last_ingested_at = NOW()
		WHERE organization_id = ${owner.id} AND session_id = ${`${runId}-first-upload`}`;
	const complete = await lookupSetup();
	expect(complete.status).toBe(200);
	expect((await readSetupStatus(complete)).hasUploadedSessions).toBe(true);
});

test("setup status requires authentication", async () => {
	const response = await fetch(`${server.baseUrl}/rpc/cli/setupStatus`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: "{}",
	});
	expect(response.status).toBe(401);
});

test("returns an empty list for sessions that have never completed ingest", async () => {
	const response = await lookup(
		{ sessionIds: ["pending", "unknown"] },
		{ "x-api-key": apiKey },
	);
	expect(response.status).toBe(200);
	expect((await readStatus(response)).uploadedSessionIds).toEqual([]);
});

test("accepts a full batch from the published CLI", async () => {
	const response = await lookup(
		{
			sessionIds: Array.from(
				{ length: CLI_SESSION_UPLOAD_STATUS_MAX_IDS },
				(_, index) => `unknown-${index}`,
			),
		},
		{ "x-api-key": apiKey },
	);
	expect(response.status).toBe(200);
	expect((await readStatus(response)).uploadedSessionIds).toEqual([]);
});

test.each([
	{ sessionIds: [] },
	{ sessionIds: ["uploaded", "uploaded"] },
	{ sessionIds: [""] },
	{ sessionIds: ["a".repeat(201)] },
	{ organizationId: "", sessionIds: ["uploaded"] },
	{
		sessionIds: Array.from(
			{ length: CLI_SESSION_UPLOAD_STATUS_MAX_IDS + 1 },
			(_, index) => `unknown-${index}`,
		),
	},
])("rejects malformed or oversized lookups: %j", async (input) => {
	const response = await lookup(input, { "x-api-key": apiKey });
	expect(response.status).toBe(400);
});

async function lookup(input: unknown, headers: Record<string, string> = {}) {
	return fetch(`${server.baseUrl}/rpc/cli/sessionUploadStatus`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({ json: input }),
	});
}

async function readStatus(response: Response) {
	const body: unknown = await response.json();
	assert(typeof body === "object" && body !== null && "json" in body);
	return CliSessionUploadStatusOutputSchema.parse(body.json);
}

async function readSetupStatus(response: Response) {
	const body: unknown = await response.json();
	assert(typeof body === "object" && body !== null && "json" in body);
	return CliSetupStatusSchema.parse(body.json);
}

async function createUser(label: string): Promise<TestUser> {
	const response = await fetch(`${server.baseUrl}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			email: `${runId}-${label}@example.com`,
			name: "CLI Status Test",
			password: "cli-status-integration-password",
		}),
	});
	expect(response.status).toBe(200);
	const body: unknown = await response.json();
	assert(typeof body === "object" && body !== null);
	assert("token" in body && typeof body.token === "string");
	assert("user" in body && typeof body.user === "object" && body.user !== null);
	assert("id" in body.user && typeof body.user.id === "string");
	const user = { id: body.user.id, token: body.token };
	createdUsers.push(user);
	return user;
}
