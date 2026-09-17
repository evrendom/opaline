import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
	CliConnectionCreateResponseSchema,
	CliConnectionSnapshotSchema,
	type CliConnectionUpdate,
} from "@rudel/api-routes";
import postgres from "postgres";
import { z } from "zod";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

const connectionString = process.env.PG_CONNECTION_STRING;
assert(connectionString);
const sqlClient = postgres(connectionString, { max: 2, prepare: false });
const origin = "http://localhost";
const servers: ApiTestServer[] = [];
const aborts: AbortController[] = [];
const connectionIds: string[] = [];
const userIds: string[] = [];
const organizationIds: string[] = [];
const secret = () => randomBytes(32).toString("base64url");

beforeAll(async () => {
	const pgUrl = new URL(process.env.PG_CONNECTION_STRING ?? "");
	expect(["127.0.0.1", "localhost"]).toContain(pgUrl.hostname);
	servers.push(
		...(await Promise.all([
			startApiTestServer({ POSTHOG_ENABLED: "false" }),
			startApiTestServer({ POSTHOG_ENABLED: "false" }),
		])),
	);
});

afterAll(async () => {
	for (const abort of aborts) abort.abort();
	await Promise.all(servers.map((server) => server.stop()));
	if (connectionIds.length)
		await sqlClient`delete from cli_connection where id in ${sqlClient(connectionIds)}`;
	if (organizationIds.length)
		await sqlClient`delete from organization where id in ${sqlClient(organizationIds)}`;
	if (userIds.length)
		await sqlClient`delete from "user" where id in ${sqlClient(userIds)}`;
	await sqlClient.end();
});

describe("CLI/browser connection over real HTTP and PostgreSQL", () => {
	test("pairs once, pushes selection across instances, binds the approved account, and persists completion", async () => {
		const fixture = await createConnection();
		const streamA = await observe(fixture, 0);
		const streamB = await observe(fixture, 1);
		expect((await streamA.next()).state).toBe("waiting");
		expect((await streamB.next()).state).toBe("waiting");
		const paired = await post("/redeem", {
			code: fixture.code,
			writerToken: fixture.writerToken,
		});
		expect(paired.status).toBe(200);
		expect((await streamA.next()).state).toBe("scanning");
		expect((await streamB.next()).state).toBe("scanning");
		// A real Bun server closes idle responses after ten seconds; keepalives must preserve the stream.
		await Bun.sleep(11_000);
		expect(
			(await post("/redeem", { code: fixture.code, writerToken: secret() }))
				.status,
		).toBe(409);
		const repositories: z.infer<
			typeof CliConnectionSnapshotSchema
		>["repositories"] = [
			{
				id: randomUUID(),
				name: "selected-repo",
				sessionCount: 12,
				enabled: true,
				sources: ["claude_code"],
			},
			{
				id: randomUUID(),
				name: "disabled-repo",
				sessionCount: 4,
				enabled: false,
				sources: ["codex"],
			},
		];
		const selection = {
			writerToken: fixture.writerToken,
			sequence: 1,
			update: { kind: "selection", repositories },
		};
		expect((await post(`/${fixture.id}/update`, selection)).status).toBe(200);
		const selected = await streamB.next();
		expect(selected.state).toBe("awaiting_login");
		expect(selected.repositories).toEqual(repositories);
		expect(
			CliConnectionSnapshotSchema.parse(
				await (await post(`/${fixture.id}/update`, selection)).json(),
			).revision,
		).toBe(selected.revision);
		expect(
			(
				await post(`/${fixture.id}/update`, {
					...selection,
					writerToken: secret(),
				})
			).status,
		).toBe(404);
		expect(
			(await post(`/${fixture.id}/update`, { ...selection, sequence: 3 }))
				.status,
		).toBe(409);
		expect(
			(await update(fixture, 2, { kind: "bind", organizationId: "unapproved" }))
				.status,
		).toBe(403);
		expect(
			(
				await update(fixture, 2, {
					kind: "status",
					state: "completed",
					totals: { uploaded: 12, skipped: 0, failed: 0 },
				})
			).status,
		).toBe(409);

		const account = await signUp();
		const createdOrganization = await fetch(
			`${base()}/api/auth/organization/create`,
			{
				method: "POST",
				headers: {
					cookie: account.cookie,
					origin,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					name: "Selected workspace",
					slug: `cli-selected-${randomUUID()}`,
				}),
			},
		);
		expect(createdOrganization.status).toBe(200);
		const selectedOrganization = z
			.object({ id: z.string() })
			.parse(await createdOrganization.json());
		organizationIds.push(selectedOrganization.id);

		const deviceResponse = await fetch(`${base()}/api/auth/device/code`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ client_id: "rudel-cli", scope: "ingest:write" }),
		});
		expect(deviceResponse.status).toBe(200);
		const device = z
			.object({ device_code: z.string(), user_code: z.string() })
			.parse(await deviceResponse.json());
		expect(
			(
				await update(fixture, 2, {
					kind: "device",
					deviceCode: device.device_code,
				})
			).status,
		).toBe(200);
		const authorizePath = `/${fixture.id}/authorize`;
		expect(
			(
				await post(
					authorizePath,
					{
						userCode: device.user_code,
						organizationId: selectedOrganization.id,
					},
					{ cookie: account.cookie, origin },
				)
			).status,
		).toBe(404);
		expect(
			(
				await post(
					authorizePath,
					{ userCode: device.user_code, organizationId: "not-a-membership" },
					{ cookie: `${fixture.cookie}; ${account.cookie}`, origin },
				)
			).status,
		).toBe(403);
		const authorize = await post(
			authorizePath,
			{ userCode: device.user_code, organizationId: selectedOrganization.id },
			{ cookie: `${fixture.cookie}; ${account.cookie}`, origin },
		);
		expect(authorize.status).toBe(200);
		expect(await authorize.json()).toEqual({
			returnUrl: `http://localhost/welcome?connect=${fixture.id}`,
		});
		const approved = await fetch(`${base()}/api/auth/device/approve`, {
			method: "POST",
			headers: {
				cookie: account.cookie,
				origin,
				"content-type": "application/json",
			},
			body: JSON.stringify({ userCode: device.user_code }),
		});
		expect(approved.status).toBe(200);
		const tokenResponse = await fetch(`${base()}/api/auth/device/token`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				client_id: "rudel-cli",
				device_code: device.device_code,
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			}),
		});
		expect(tokenResponse.status).toBe(200);
		const token = z
			.object({ access_token: z.string() })
			.parse(await tokenResponse.json()).access_token;
		const organizationsResponse = await fetch(
			`${base()}/rpc/listMyOrganizations`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: "{}",
			},
		);
		expect(organizationsResponse.status).toBe(200);
		const organizations = z
			.object({ json: z.array(z.object({ id: z.string() })) })
			.parse(await organizationsResponse.json());
		const organizationId = organizations.json.find(
			(organization) => organization.id === selectedOrganization.id,
		)?.id;
		assert(organizationId);
		// The account also owns its personal workspace, but the CLI must not
		// silently fall back to it after a different browser destination was approved.
		expect(
			(
				await update(
					fixture,
					3,
					{ kind: "bind", organizationId: account.id },
					{ authorization: `Bearer ${token}` },
				)
			).status,
		).toBe(403);
		const otherAccount = await signUp();
		expect(
			(
				await update(
					fixture,
					3,
					{ kind: "bind", organizationId },
					{
						cookie: otherAccount.cookie,
						origin,
					},
				)
			).status,
		).toBe(403);
		expect(
			(
				await update(
					fixture,
					3,
					{ kind: "bind", organizationId },
					{ authorization: `Bearer ${token}` },
				)
			).status,
		).toBe(200);
		expect(
			(await update(fixture, 4, { kind: "status", state: "uploading" })).status,
		).toBe(200);
		expect(
			(
				await update(fixture, 5, {
					kind: "status",
					state: "completed",
					totals: { uploaded: 0, skipped: 0, failed: 12 },
				})
			).status,
		).toBe(400);
		expect(
			(
				await update(fixture, 5, {
					kind: "status",
					state: "completed",
					totals: { uploaded: 5, skipped: 7, failed: 2 },
				})
			).status,
		).toBe(200);
		const finished = await streamB.until("completed");
		expect(finished.organizationId).toBe(organizationId);
		expect(finished.totals).toEqual({ uploaded: 5, skipped: 7, failed: 2 });
		const reloaded = await fetch(
			`${base(1)}/api/cli/connections/${fixture.id}`,
			{ headers: { cookie: fixture.cookie, origin } },
		);
		expect(CliConnectionSnapshotSchema.parse(await reloaded.json())).toEqual(
			finished,
		);
	}, 30_000);

	test("rejects other browsers, oversized manifests, invalid origins, and expired codes", async () => {
		expect(
			(await post("", {}, { origin: "https://untrusted.example" })).status,
		).toBe(403);
		const fixture = await createConnection();
		expect(
			(
				await fetch(`${base()}/api/cli/connections/${fixture.id}`, {
					headers: { origin },
				})
			).status,
		).toBe(404);
		expect(
			(await post(`/${fixture.id}/update`, { padding: "x".repeat(384_001) }))
				.status,
		).toBe(413);
		const [row] = await sqlClient<
			Array<{ pairing_hash: string; browser_hash: string }>
		>`select pairing_hash, browser_hash from cli_connection where id = ${fixture.id}`;
		expect(row?.pairing_hash).not.toBe(fixture.code);
		expect(row?.browser_hash).not.toBe(fixture.cookie.split("=")[1]);
		await sqlClient`update cli_connection set code_expires_at = now() - interval '1 second', expires_at = now() - interval '1 second' where id = ${fixture.id}`;
		expect(
			(
				await post("/redeem", {
					code: fixture.code,
					writerToken: fixture.writerToken,
				})
			).status,
		).toBe(404);
		const expired = await fetch(`${base()}/api/cli/connections/${fixture.id}`, {
			headers: { cookie: fixture.cookie, origin },
		});
		expect(CliConnectionSnapshotSchema.parse(await expired.json()).state).toBe(
			"expired",
		);
	});
});

function base(index = 0): string {
	const server = servers[index];
	assert(server);
	return server.baseUrl;
}
function post(
	path: string,
	body: unknown,
	headers: Record<string, string> = {},
) {
	return fetch(`${base()}/api/cli/connections${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}
async function createConnection() {
	const response = await post("", {}, { origin });
	expect(response.status).toBe(200);
	const result = CliConnectionCreateResponseSchema.parse(await response.json());
	const cookie = response.headers.getSetCookie()[0]?.split(";")[0];
	assert(cookie);
	expect(response.headers.get("set-cookie")).toContain("HttpOnly");
	connectionIds.push(result.connection.id);
	return {
		id: result.connection.id,
		code: result.code,
		cookie,
		writerToken: secret(),
	};
}
function update(
	fixture: { id: string; writerToken: string },
	sequence: number,
	update: CliConnectionUpdate["update"],
	headers: Record<string, string> = {},
) {
	return post(
		`/${fixture.id}/update`,
		{ writerToken: fixture.writerToken, sequence, update },
		headers,
	);
}
async function observe(fixture: { id: string; cookie: string }, index: number) {
	const abort = new AbortController();
	aborts.push(abort);
	const response = await fetch(
		`${base(index)}/api/cli/connections/${fixture.id}/events`,
		{ headers: { cookie: fixture.cookie, origin }, signal: abort.signal },
	);
	expect(response.status).toBe(200);
	expect(response.headers.get("content-type")).toContain("text/event-stream");
	assert(response.body);
	const reader = response.body.getReader();
	let buffer = "";
	const decoder = new TextDecoder();
	async function next() {
		for (;;) {
			const end = buffer.indexOf("\n\n");
			if (end >= 0) {
				const event = buffer.slice(0, end);
				buffer = buffer.slice(end + 2);
				const data = event
					.split("\n")
					.find((line) => line.startsWith("data: "));
				if (data)
					return CliConnectionSnapshotSchema.parse(JSON.parse(data.slice(6)));
				continue;
			}
			const chunk = await reader.read();
			assert(!chunk.done, "Stream closed before the expected update");
			buffer += decoder.decode(chunk.value, { stream: true });
		}
	}
	return {
		next,
		async until(state: string) {
			for (;;) {
				const snapshot = await next();
				if (snapshot.state === state) return snapshot;
			}
		},
	};
}
async function signUp() {
	const response = await fetch(`${base()}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { origin, "content-type": "application/json" },
		body: JSON.stringify({
			email: `cli-${randomUUID()}@example.test`,
			password: "test-connection-password-12345",
			name: "CLI connection test",
		}),
	});
	expect(response.status).toBe(200);
	const body = z
		.object({ user: z.object({ id: z.string() }) })
		.parse(await response.json());
	userIds.push(body.user.id);
	const cookie = response.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");
	expect(cookie).toContain("session_token=");
	return { id: body.user.id, cookie };
}
