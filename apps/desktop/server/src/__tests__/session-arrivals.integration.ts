import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import assert from "node:assert/strict";
import {
	SESSION_ARRIVALS_PATH,
	SessionArrivalsPageSchema,
} from "@rudel/api-routes";
import { z } from "zod";
import { sqlClient } from "../db.js";
import { sessionArrivalChannel } from "../services/session-arrival-channel.js";
import {
	notifyPendingSessionArrival,
	recordSessionIngestContent,
} from "../services/session-ownership.service.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

setDefaultTimeout(20_000);
let server: ApiTestServer;
const users: { id: string; token: string }[] = [];
const streams: AbortController[] = [];
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
	for (const controller of streams) controller.abort();
	await server?.stop();
	for (const user of users) {
		await sqlClient`DELETE FROM organization WHERE id = ${user.id}`;
		await sqlClient`DELETE FROM "user" WHERE id = ${user.id}`;
	}
});

function request(organizationId: string, token?: string, since?: string) {
	const controller = new AbortController();
	streams.push(controller);
	return {
		controller,
		response: fetch(
			`${server.baseUrl}${SESSION_ARRIVALS_PATH}?${new URLSearchParams({ organizationId })}`,
			{
				signal: controller.signal,
				headers: {
					...(token ? { Authorization: `Bearer ${token}` } : {}),
					...(since ? { "Last-Event-ID": since } : {}),
				},
			},
		),
	};
}

async function connect(organizationId: string, token: string, since?: string) {
	const connection = request(organizationId, token, since);
	const response = await connection.response;
	expect(response.status, server.readOutput()).toBe(200);
	expect(response.headers.get("Content-Type")).toContain("text/event-stream");
	assert(response.body);
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	async function next() {
		for (;;) {
			const boundary = buffer.indexOf("\n\n");
			if (boundary !== -1) {
				const event = buffer.slice(0, boundary);
				buffer = buffer.slice(boundary + 2);
				const data = event
					.split("\n")
					.find((line) => line.startsWith("data: "));
				if (data)
					return SessionArrivalsPageSchema.parse(JSON.parse(data.slice(6)));
				continue;
			}
			const chunk = await reader.read();
			assert(!chunk.done, "Stream closed before the expected event");
			buffer += decoder.decode(chunk.value, { stream: true });
		}
	}
	const baseline = await next();
	expect(baseline.sessions).toEqual([]);
	return {
		next,
		since: baseline.since,
		close: () => connection.controller.abort(),
	};
}

async function complete(
	organizationId: string,
	sessionId: string,
	withReceipt = true,
	deferArrivalNotification = false,
) {
	await recordSessionIngestContent(
		organizationId,
		sessionId,
		"a".repeat(64),
		{
			version: 1,
			assistantLineCount: 1,
			contentBytes: 10,
			main: { assistantLineCount: 1, contentBytes: 10 },
			subagents: {},
		},
		1,
		new Date(),
		new Date(),
		"1",
		withReceipt
			? {
					checksum: "b".repeat(64),
					diagnostics: "{}",
					eventCount: 1,
					extractionVersion: 1,
					eventIdentityVersion: 1,
					generation: "0",
					modelRateCardVersion: "test",
				}
			: undefined,
		{ deferArrivalNotification },
	);
}

test("pushes successful ingestion commits, checks access, and catches up after reconnect", async () => {
	const [owner, member, outsider] = users;
	assert(owner && member && outsider);
	expect((await request(owner.id).response).status).toBe(401);
	expect((await request(owner.id, outsider.token).response).status).toBe(403);
	expect(
		(await request(owner.id, owner.token, "invalid").response).status,
	).toBe(400);
	await sqlClient`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (${crypto.randomUUID()}, ${owner.id}, ${member.id}, 'member', now())`;
	await sqlClient`INSERT INTO session_ownership (organization_id, session_id, user_id, created_at, last_ingested_at, last_usage_completed_at)
		VALUES (${owner.id}, 'historical', ${owner.id}, now() - interval '1 day', now(), now())`;
	const ownerStream = await connect(owner.id, owner.token);
	const memberStream = await connect(owner.id, member.token);
	const notifications: string[] = [];
	const subscription = await sqlClient.listen(
		sessionArrivalChannel(owner.id),
		(payload) => {
			notifications.push(payload);
		},
	);
	await sqlClient`INSERT INTO session_ownership (organization_id, session_id, user_id, created_at) VALUES
		(${owner.id}, 'ready', ${owner.id}, now()), (${owner.id}, 'pending', ${member.id}, now())`;
	await complete(owner.id, "ready", false);
	await Bun.sleep(50);
	expect(notifications).toEqual([]);
	await sqlClient`UPDATE session_ownership SET usage_extraction_generation = 1 WHERE organization_id = ${owner.id} AND session_id = 'ready'`;
	await expect(complete(owner.id, "ready")).rejects.toThrow();
	expect(notifications).toEqual([]);
	await sqlClient`UPDATE session_ownership SET usage_extraction_generation = 0 WHERE organization_id = ${owner.id} AND session_id = 'ready'`;
	await complete(owner.id, "ready");
	expect((await ownerStream.next()).sessions).toEqual([
		{ sessionId: "ready", userName: "owner" },
	]);
	// Every member sees every member's arrivals.
	expect((await memberStream.next()).sessions).toEqual([
		{ sessionId: "ready", userName: "owner" },
	]);
	await complete(owner.id, "ready");
	await complete(owner.id, "historical");
	await complete(owner.id, "pending");
	expect((await memberStream.next()).sessions).toEqual([
		{ sessionId: "pending", userName: "member" },
	]);
	expect((await ownerStream.next()).sessions).toEqual([
		{ sessionId: "pending", userName: "member" },
	]);
	expect(notifications).toHaveLength(2);
	ownerStream.close();
	memberStream.close();
	await sqlClient`INSERT INTO session_ownership (organization_id, session_id, user_id) VALUES (${owner.id}, 'offline', ${owner.id})`;
	await complete(owner.id, "offline");
	const reconnected = await connect(owner.id, owner.token, ownerStream.since);
	expect(
		(await reconnected.next()).sessions.map((row) => row.sessionId),
	).toEqual(["offline", "pending", "ready"]);
	reconnected.close();
	// With the own-sessions option on, a member catches up on their own only.
	await sqlClient`UPDATE organization SET own_sessions_only = true WHERE id = ${owner.id}`;
	const ownOnly = await connect(owner.id, member.token, memberStream.since);
	expect((await ownOnly.next()).sessions).toEqual([
		{ sessionId: "pending", userName: "member" },
	]);
	ownOnly.close();
	await sqlClient`UPDATE organization SET own_sessions_only = false WHERE id = ${owner.id}`;
	await subscription.unlisten();
});

test("delivers a bulk import over one stream with bounded pages", async () => {
	const owner = users[0];
	assert(owner);
	const stream = await connect(owner.id, owner.token);
	await sqlClient.begin(async (transaction) => {
		await transaction.unsafe(
			`INSERT INTO session_ownership (organization_id, session_id, user_id, created_at, last_ingested_at, last_usage_completed_at) SELECT $1, 'bulk-' || lpad(n::text, 3, '0'), $1, now(), now(), now() FROM generate_series(1, 205) AS n`,
			[owner.id],
		);
		await transaction.unsafe("SELECT pg_notify($1, '')", [
			sessionArrivalChannel(owner.id),
		]);
	});
	const ids: string[] = [];
	for (let i = 0; i < 3; i++) {
		const page = await stream.next();
		expect(page.sessions.length).toBeLessThanOrEqual(100);
		ids.push(...page.sessions.map((row) => row.sessionId));
	}
	expect(ids).toHaveLength(205);
	expect(new Set(ids).size).toBe(205);
	stream.close();
});

test("suppresses native child toasts while still delivering cache refresh events", async () => {
	const owner = users[0];
	assert(owner);
	const stream = await connect(owner.id, owner.token);
	const parentId = `native-parent-${run}`;
	const childId = `native-child-${run}`;
	await sqlClient`
		INSERT INTO session_ownership (
			organization_id,
			session_id,
			user_id,
			agent_source,
			native_parent_session_id
		) VALUES
			(${owner.id}, ${parentId}, ${owner.id}, 'codex', NULL),
			(${owner.id}, ${childId}, ${owner.id}, 'codex', ${parentId})
	`;
	const notifications: string[] = [];
	const subscription = await sqlClient.listen(
		sessionArrivalChannel(owner.id),
		(payload) => notifications.push(payload),
	);
	await complete(owner.id, childId, true, true);
	expect(await notifyPendingSessionArrival(owner.id, childId, owner.id)).toBe(
		true,
	);
	expect((await stream.next()).sessions).toEqual([]);
	expect(await notifyPendingSessionArrival(owner.id, childId, owner.id)).toBe(
		false,
	);

	await complete(owner.id, parentId, true, true);
	expect(await notifyPendingSessionArrival(owner.id, parentId, owner.id)).toBe(
		true,
	);
	expect((await stream.next()).sessions).toEqual([
		{ sessionId: parentId, userName: "owner" },
	]);
	expect(await notifyPendingSessionArrival(owner.id, parentId, owner.id)).toBe(
		false,
	);
	await Bun.sleep(25);
	expect(notifications).toEqual(["lineage-refresh", ""]);
	await subscription.unlisten();
	stream.close();
});
