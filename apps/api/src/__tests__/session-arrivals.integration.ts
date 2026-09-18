import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import assert from "node:assert/strict";
import { SessionArrivalsPageSchema } from "@rudel/api-routes";
import { z } from "zod";
import { sqlClient } from "../db.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

setDefaultTimeout(60_000);
let server: ApiTestServer;
const users: { id: string; token: string }[] = [];
const run = crypto.randomUUID();

beforeAll(async () => {
	assert(process.env.PG_CONNECTION_STRING);
	assert(
		["localhost", "127.0.0.1"].includes(
			new URL(process.env.PG_CONNECTION_STRING).hostname,
		),
	);
	server = await startApiTestServer();
	for (const name of ["owner", "member", "outsider"]) {
		const response = await fetch(`${server.baseUrl}/api/auth/sign-up/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name,
				email: `${name}-${run}@example.test`,
				password: `test-${run}`,
			}),
		});
		expect(response.status).toBe(200);
		const result = z
			.object({ token: z.string(), user: z.object({ id: z.string() }) })
			.parse(await response.json());
		users.push({ id: result.user.id, token: result.token });
	}
});

afterAll(async () => {
	await server?.stop();
	for (const user of users) {
		await sqlClient`DELETE FROM organization WHERE id = ${user.id}`;
		await sqlClient`DELETE FROM "user" WHERE id = ${user.id}`;
	}
	await sqlClient.end();
});

function request(
	input: { organizationId?: string; since?: string; after?: string },
	token?: string,
) {
	return fetch(`${server.baseUrl}/rpc/analytics/sessions/arrivals`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({ json: { organizationId: users[0]?.id, ...input } }),
	});
}

async function arrivals(
	input: { organizationId?: string; since?: string; after?: string },
	token: string,
) {
	const response = await request(input, token);
	expect(response.status, server.readOutput()).toBe(200);
	return z
		.object({ json: SessionArrivalsPageSchema })
		.parse(await response.json()).json;
}

test("workspace feed waits for completed uploads, ignores history, and enforces detail permissions", async () => {
	const [owner, member, outsider] = users;
	assert(owner && member && outsider);
	expect((await request({})).status).toBe(401);
	await sqlClient`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (${crypto.randomUUID()}, ${owner.id}, ${member.id}, 'member', now())`;
	await sqlClient`UPDATE session SET active_organization_id = ${owner.id} WHERE user_id = ${member.id}`;
	await sqlClient`INSERT INTO session_ownership (organization_id, session_id, user_id, created_at, last_ingested_at) VALUES (${owner.id}, 'historical', ${owner.id}, now() - interval '1 day', now())`;
	const baseline = await arrivals({}, owner.token);
	expect(baseline.sessions).toEqual([]);
	await sqlClient`INSERT INTO session_ownership (organization_id, session_id, user_id, created_at, last_ingested_at, last_session_date) VALUES
		(${owner.id}, 'ready', ${owner.id}, now(), now(), now() - interval '1 year'),
		(${owner.id}, 'pending', ${member.id}, now(), null, now()),
		(${outsider.id}, 'other-workspace', ${outsider.id}, now(), now(), now())`;
	expect(
		(await arrivals({ since: baseline.since }, owner.token)).sessions,
	).toEqual([{ sessionId: "ready", userName: "owner" }]);
	expect(
		(await arrivals({ since: baseline.since }, member.token)).sessions,
	).toEqual([]);
	await sqlClient`UPDATE session_ownership SET last_ingested_at = now() WHERE organization_id = ${owner.id} AND session_id IN ('pending', 'historical')`;
	expect(
		(await arrivals({ since: baseline.since }, member.token)).sessions,
	).toEqual([{ sessionId: "pending", userName: "member" }]);
	expect(
		(await arrivals({ since: baseline.since }, owner.token)).sessions.map(
			(row) => row.sessionId,
		),
	).toEqual(["pending", "ready"]);
	expect(
		(await request({ since: baseline.since }, outsider.token)).status,
	).toBe(403);
	const outsiderSessions = await arrivals(
		{ since: baseline.since, organizationId: outsider.id },
		outsider.token,
	);
	expect(outsiderSessions.sessions.map((row) => row.sessionId)).toEqual([
		"other-workspace",
	]);
});

test("paginates bulk arrivals without dropping or repeating sessions", async () => {
	const owner = users[0];
	assert(owner);
	const baseline = await arrivals({}, owner.token);
	await sqlClient`INSERT INTO session_ownership (organization_id, session_id, user_id, created_at, last_ingested_at)
		SELECT ${owner.id}, 'bulk-' || lpad(n::text, 3, '0'), ${owner.id}, now(), now() FROM generate_series(1, 205) AS n`;
	const ids: string[] = [];
	let after: string | undefined;
	do {
		const page = await arrivals({ since: baseline.since, after }, owner.token);
		expect(page.sessions.length).toBeLessThanOrEqual(100);
		ids.push(...page.sessions.map((row) => row.sessionId));
		after = page.nextCursor ?? undefined;
	} while (after);
	expect(ids).toHaveLength(205);
	expect(new Set(ids).size).toBe(205);
});
