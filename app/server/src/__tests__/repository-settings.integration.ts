import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import assert from "node:assert/strict";
import {
	CliApiKeyCreateResponseSchema,
	RepositorySettingsSchema,
	type RepositoryUploadReport,
} from "@rudel/api-routes";
import { z } from "zod";
import { getClickhouse } from "../clickhouse.js";
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
	assert(process.env.CLICKHOUSE_URL);
	assert(
		["localhost", "127.0.0.1"].includes(
			new URL(process.env.CLICKHOUSE_URL).hostname,
		),
	);
	server = await startApiTestServer();
	for (const name of ["owner", "teammate"]) {
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
		await getClickhouse().execute({
			query:
				"DELETE FROM rudel.session_analytics WHERE organization_id = {organizationId:String}",
			query_params: { organizationId: user.id },
		});
		await sqlClient`DELETE FROM organization WHERE id = ${user.id}`;
		await sqlClient`DELETE FROM "user" WHERE id = ${user.id}`;
	}
});

test("CLI reports persist, replace saved choices, and remain isolated by account, machine, and workspace", async () => {
	const [owner, teammate] = users;
	assert(owner && teammate);
	const installationId = crypto.randomUUID();
	const secondComputer = crypto.randomUUID();
	const keyResponse = await fetch(`${server.baseUrl}/api/auth/api-key/create`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${owner.token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ name: "settings-test", expiresIn: null }),
	});
	expect(keyResponse.status).toBe(200);
	const apiKey = CliApiKeyCreateResponseSchema.parse(
		await keyResponse.json(),
	).key;
	const payload: RepositoryUploadReport = {
		installationId,
		workspaces: [
			{
				organizationId: owner.id,
				repositories: [
					{
						key: "remote:github.com/test/repo",
						name: "test/repo",
						state: "enabled",
					},
				],
			},
		],
	};
	const report = (
		input: RepositoryUploadReport,
		headers = { "x-api-key": apiKey },
	) => rpc("report", input, headers);
	const list = async (token: string) => {
		const response = await rpc("list", undefined, {
			Authorization: `Bearer ${token}`,
		});
		expect(response.status, server.readOutput()).toBe(200);
		return z
			.object({ json: RepositorySettingsSchema })
			.parse(await response.json()).json.repositories;
	};
	const anonymous = await rpc("report", payload);
	expect(anonymous.status).toBe(401);
	expect((await rpc("list")).status).toBe(401);
	expect((await report(payload)).status).toBe(200);
	let rows = await list(owner.token);
	expect(rows[0]?.sessionCount).toBe(0);
	expect(rows[0]?.reports).toMatchObject([
		{ state: "enabled", installationId },
	]);
	await sqlClient`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (${crypto.randomUUID()}, ${owner.id}, ${teammate.id}, 'member', now())`;
	await sqlClient`UPDATE session SET active_organization_id = ${owner.id} WHERE user_id = ${teammate.id}`;
	expect(await list(teammate.token)).toEqual([]);
	const forbidden = await report({
		...payload,
		workspaces: [{ organizationId: teammate.id, repositories: [] }],
	});
	expect(forbidden.status).toBe(403);
	expect((await list(owner.token))[0]?.reports[0]?.state).toBe("enabled");
	const workspace = payload.workspaces[0];
	assert(workspace);
	const disabled = {
		...workspace,
		repositories: workspace.repositories.map((repo) => ({
			...repo,
			state: "disabled" as const,
		})),
	};
	expect(
		(await report({ installationId, workspaces: [disabled] })).status,
	).toBe(200);
	expect((await list(owner.token))[0]?.reports).toMatchObject([
		{ state: "disabled", installationId },
	]);
	expect(
		(await report({ ...payload, installationId: secondComputer })).status,
	).toBe(200);
	rows = await list(owner.token);
	expect(rows[0]?.reports.map((row) => row.state).sort()).toEqual([
		"disabled",
		"enabled",
	]);
	expect((await report({ installationId, workspaces: [] })).status).toBe(200);
	expect((await list(owner.token))[0]?.reports).toMatchObject([
		{ state: "enabled", installationId: secondComputer },
	]);
	// An ingest key can report settings, but cannot read browser-only workspace settings.
	expect((await rpc("list", undefined, { "x-api-key": apiKey })).status).toBe(
		401,
	);
});

test("repository counts include unreported sessions without exposing another member's computer settings", async () => {
	const [owner, teammate] = users;
	assert(owner && teammate);
	await getClickhouse().insert({
		table: "rudel.session_analytics",
		values: [
			{
				organization_id: owner.id,
				user_id: owner.id,
				source: "claude_code",
				session_id: crypto.randomUUID(),
				project_path: "/test/conductor/workspaces/reported/topic",
				git_remote: "",
			},
			{
				organization_id: owner.id,
				user_id: teammate.id,
				source: "codex",
				session_id: crypto.randomUUID(),
				project_path: "/test/unreported",
				git_remote: "github.com/test/unreported",
			},
			{
				organization_id: teammate.id,
				user_id: teammate.id,
				source: "codex",
				session_id: crypto.randomUUID(),
				project_path: "/test/other-workspace",
				git_remote: "github.com/test/other-workspace",
			},
		],
	});
	const report = await rpc(
		"report",
		{
			installationId: crypto.randomUUID(),
			workspaces: [
				{
					organizationId: owner.id,
					repositories: [
						{
							key: "remote:github.com/test/reported",
							name: "reported",
							aliases: ["path:reported"],
							state: "disabled",
						},
					],
				},
			],
		},
		{ Authorization: `Bearer ${owner.token}` },
	);
	expect(report.status).toBe(200);
	const response = await rpc("list", undefined, {
		Authorization: `Bearer ${owner.token}`,
	});
	expect(response.status).toBe(200);
	const { json } = z
		.object({ json: RepositorySettingsSchema })
		.parse(await response.json());
	expect(
		json.repositories.find((repo) => repo.name === "reported"),
	).toMatchObject({
		sessionCount: 1,
		reports: [{ state: "disabled" }],
	});
	expect(
		json.repositories.find(
			(repo) => repo.key === "remote:github.com/test/unreported",
		),
	).toMatchObject({ sessionCount: 1, reports: [] });
	expect(
		json.repositories.some((repo) => repo.key.includes("other-workspace")),
	).toBe(false);
	const teammateResponse = await rpc("list", undefined, {
		Authorization: `Bearer ${teammate.token}`,
	});
	expect(teammateResponse.status).toBe(200);
	const teammateSettings = z
		.object({ json: RepositorySettingsSchema })
		.parse(await teammateResponse.json());
	expect(teammateSettings.json.repositories).toHaveLength(2);
	expect(
		teammateSettings.json.repositories.every(
			(repo) => repo.reports.length === 0,
		),
	).toBe(true);
});

function rpc(
	method: string,
	input?: RepositoryUploadReport,
	headers: Record<string, string> = {},
) {
	return fetch(`${server.baseUrl}/rpc/repositorySettings/${method}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({ json: input }),
	});
}
