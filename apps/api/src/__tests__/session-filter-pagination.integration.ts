import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import assert from "node:assert/strict";
import {
	SessionFilterCatalogSchema,
	type SessionListFilters,
	SessionOverviewAnalyticsSchema,
} from "@rudel/api-routes";
import { z } from "zod";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

setDefaultTimeout(120_000);
let server: ApiTestServer;
let token = "";
let orgId = "";
const run = crypto.randomUUID();
const range = { startDate: "2026-09-01", endDate: "2026-09-15", limit: 50 };
const emptyFilters: SessionListFilters = {
	excluded: { model: [], repository: [], skills: [], user: [] },
	ranges: {
		cost: { minimum: null, maximum: null },
		duration: { minimum: null, maximum: null },
		errors: { minimum: null, maximum: null },
		input: { minimum: null, maximum: null },
		output: { minimum: null, maximum: null },
		subagents: { minimum: null, maximum: null },
	},
};

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
	const signup = await fetch(`${server.baseUrl}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			email: `filter-${run}@example.test`,
			name: "Filter QA",
			password: `local-${run}`,
		}),
	});
	expect(signup.status).toBe(200);
	const identity = z
		.object({ token: z.string(), user: z.object({ id: z.string() }) })
		.parse(await signup.json());
	token = identity.token;
	orgId = identity.user.id;
	// Real analytics rows put the only older model/repository/skill beyond the old 1,000-row limit.
	await getClickhouse().insert({
		table: "rudel.session_analytics",
		values: Array.from({ length: 1125 }, (_, i) => ({
			organization_id: orgId,
			user_id: orgId,
			session_id: `${run}-${i}`,
			source: "claude_code",
			session_date: `2026-09-${i < 1110 ? "14" : "02"} 12:00:${String(i % 60).padStart(2, "0")}.000`,
			last_interaction_date: "2026-09-14 12:01:00.000",
			project_path: i < 1110 ? "/repo/recent" : "/repo/older",
			git_remote:
				i < 1110
					? "https://github.com/test/recent.git"
					: "git@github.com:test/older.git",
			model_used: i < 1110 ? "claude-sonnet-4-5" : "gpt-5",
			skills: i < 1110 ? [] : ["older-skill"],
			input_tokens: i < 1110 ? 10 : 10000,
			output_tokens: 5,
			actual_duration_min: i < 1110 ? 1 : 60,
			error_count: i < 1110 ? 0 : 4,
			revision: "1",
		})),
	});
});

afterAll(async () => {
	await server?.stop();
	if (orgId) {
		await getClickhouse().execute({
			query:
				"DELETE FROM rudel.session_analytics WHERE organization_id = {orgId:String}",
			query_params: { orgId },
		});
		await sqlClient`DELETE FROM organization WHERE id = ${orgId}`;
		await sqlClient`DELETE FROM "user" WHERE id = ${orgId}`;
	}
});

test("catalog and filters cover older sessions before they have been paged into the browser", async () => {
	const first = await list({});
	expect(first).toHaveLength(50);
	expect(first.every((row) => row.model_used === "claude-sonnet-4-5")).toBe(
		true,
	);
	const response = await rpc("filterCatalog", range);
	expect(response.status).toBe(200);
	const catalog = z
		.object({ json: SessionFilterCatalogSchema })
		.parse(await response.json()).json;
	expect(catalog.sessionCount).toBe(1125);
	expect(catalog.models).toContain("gpt-5");
	expect(catalog.skills).toContain("older-skill");
	expect(
		catalog.repositories.some(
			(repo) => repo.repoKey === "remote:github.com/test/older",
		),
	).toBe(true);
	expect(catalog.ranges.input.maximum).toBe(10000);
	for (const filters of [
		{
			...emptyFilters,
			excluded: { ...emptyFilters.excluded, model: ["claude-sonnet-4-5"] },
		},
		{
			...emptyFilters,
			excluded: {
				...emptyFilters.excluded,
				repository: ["remote:github.com/test/recent"],
			},
		},
		{
			...emptyFilters,
			excluded: { ...emptyFilters.excluded, skills: ["__no_skills_used__"] },
		},
		{
			...emptyFilters,
			ranges: {
				...emptyFilters.ranges,
				input: { minimum: 1000, maximum: null },
			},
		},
	]) {
		const rows = await list({ filters });
		expect(rows).toHaveLength(15);
		expect(rows.every((row) => row.model_used === "gpt-5")).toBe(true);
	}
	const second = await list({ offset: 50 });
	expect(second).toHaveLength(50);
	expect(new Set([...first, ...second].map((row) => row.session_id)).size).toBe(
		100,
	);
});

test("catalog rejects unauthenticated reads and does not trust a caller organization id", async () => {
	const anonymous = await fetch(
		`${server.baseUrl}/rpc/analytics/sessions/filterCatalog`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ json: range }),
		},
	);
	expect(anonymous.status).toBe(401);
	const response = await rpc("filterCatalog", {
		...range,
		organizationId: "another-workspace",
	});
	expect(response.status).toBe(200);
	expect(
		z.object({ json: SessionFilterCatalogSchema }).parse(await response.json())
			.json.sessionCount,
	).toBe(1125);
});

async function list(input: Record<string, unknown>) {
	const response = await rpc("list", { ...range, ...input });
	expect(response.status).toBe(200);
	return z
		.object({ json: z.array(SessionOverviewAnalyticsSchema) })
		.parse(await response.json()).json;
}
function rpc(method: string, input: unknown) {
	return fetch(`${server.baseUrl}/rpc/analytics/sessions/${method}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ json: input }),
	});
}
