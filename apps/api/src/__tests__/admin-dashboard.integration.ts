import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import assert from "node:assert/strict";
import { CostDashboardSchema } from "@rudel/api-routes";
import { z } from "zod";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

setDefaultTimeout(60_000);
let signupServer: ApiTestServer;
let legacyServer: ApiTestServer;
let eventServer: ApiTestServer;
const users: { id: string; token: string }[] = [];
const run = crypto.randomUUID();
// The anonymous view cannot filter by member, so isolate this run by a random
// past day inside the ingest window that other suites do not write to.
const day = new Date(
	Date.now() - (7 + Math.floor(Math.random() * 294)) * 86_400_000,
)
	.toISOString()
	.slice(0, 10);
const start = Date.parse(`${day}T00:00:00Z`);
const ch = getClickhouse();

beforeAll(async () => {
	signupServer = await startApiTestServer();
	for (const name of ["admin", "customer"]) {
		const response = await fetch(
			`${signupServer.baseUrl}/api/auth/sign-up/email`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name,
					email: `${name}-${run}@example.test`,
					password: `test-${run}`,
				}),
			},
		);
		expect(response.status, signupServer.readOutput()).toBe(200);
		const result = z
			.object({ token: z.string(), user: z.object({ id: z.string() }) })
			.parse(await response.json());
		users.push({ id: result.user.id, token: result.token });
	}
	const admin = users[0];
	assert(admin);
	// Sign-up creates a personal workspace keyed by the user ID, owned by them.
	legacyServer = await startApiTestServer({
		USAGE_EVENT_ANALYTICS_CUTOVER_MODE: "off",
		VITE_ADMIN_ORGANIZATION_ID: admin.id,
	});
	eventServer = await startApiTestServer({
		USAGE_EVENT_ANALYTICS_CUTOVER_MODE: "all",
		VITE_ADMIN_ORGANIZATION_ID: admin.id,
	});
	for (const [index, user] of users.entries())
		await ingest(user.token, `admin-dashboard-${run}-${index}`, index);
});

afterAll(async () => {
	await signupServer?.stop();
	await legacyServer?.stop();
	await eventServer?.stop();
	for (const user of users) {
		for (const table of [
			"claude_sessions",
			"session_analytics",
			"usage_events",
		])
			await ch.execute({
				query: `ALTER TABLE rudel.${table} DELETE WHERE organization_id = {org:String}`,
				query_params: { org: user.id },
			});
		await sqlClient`DELETE FROM organization WHERE id = ${user.id}`;
		await sqlClient`DELETE FROM "user" WHERE id = ${user.id}`;
	}
});

async function ingest(token: string, sessionId: string, index: number) {
	const content = [
		{
			type: "user",
			uuid: "u1",
			sessionId,
			timestamp: new Date(start + index * 1000).toISOString(),
			message: { role: "user", content: "Implement the task" },
		},
		{
			type: "assistant",
			uuid: "a1",
			sessionId,
			timestamp: new Date(start + index * 1000 + 60_000).toISOString(),
			message: {
				role: "assistant",
				id: "m1",
				model: "claude-sonnet-4-5",
				usage: { input_tokens: 10, output_tokens: 5 },
				content: [{ type: "text", text: "Done" }],
			},
		},
	]
		.map((line) => JSON.stringify(line))
		.join("\n");
	const response = await fetch(`${signupServer.baseUrl}/rpc/ingestSession`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			json: {
				content,
				sessionId,
				projectPath: `/secret/customer-repo-${run}-${index}`,
				gitRemote: `git@github.com:customer-${run}/private-${index}.git`,
				source: "claude_code",
			},
		}),
	});
	expect(response.status, await response.clone().text()).toBe(200);
}

function request(
	endpoint: ApiTestServer,
	token: string,
	input: Record<string, unknown>,
) {
	return fetch(`${endpoint.baseUrl}/rpc/admin/dashboard`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			json: {
				startDate: day,
				endDate: day,
				requestedMetric: "sessions",
				...input,
			},
		}),
	});
}

test("admin dashboard aggregates every tenant anonymously", async () => {
	const admin = users[0];
	assert(admin);
	for (const endpoint of [legacyServer, eventServer]) {
		const response = await request(endpoint, admin.token, {});
		const body = await response.text();
		expect(response.status, `${body}\n${endpoint.readOutput()}`).toBe(200);
		const { metrics } = z
			.object({ json: CostDashboardSchema })
			.parse(JSON.parse(body)).json;

		expect(metrics.sessions.total).toBe(2);
		expect(
			metrics.sessions.trend.reduce((sum, point) => sum + point.total, 0),
		).toBe(2);
		expect(metrics.sessions.breakdowns.models.length).toBeGreaterThan(0);
		for (const metric of [metrics.sessions, metrics.cost]) {
			expect(metric.breakdowns.members).toEqual([]);
			expect(metric.breakdowns.repositories).toEqual([]);
		}
		expect(body).not.toContain(`customer-repo-${run}`);
		expect(body).not.toContain(`customer-${run}`);
		expect(body).not.toContain(`@example.test`);
		for (const user of users) expect(body).not.toContain(user.id);
	}
});

test("admin dashboard rejects member and repository filters and splits", async () => {
	const admin = users[0];
	assert(admin);
	const customer = users[1];
	assert(customer);
	for (const input of [
		{ repositories: [`/secret/customer-repo-${run}-1`] },
		{ splitBy: "repositories" },
		{ members: [customer.id] },
		{ splitBy: "members" },
	]) {
		const response = await request(legacyServer, admin.token, input);
		expect(response.status).toBe(400);
	}
});

test("admin dashboard is forbidden outside the admin organization", async () => {
	const customer = users[1];
	assert(customer);
	const response = await request(legacyServer, customer.token, {});
	expect(response.status).toBe(403);
});
