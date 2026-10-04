import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { trendsUsageSchema } from "@rudel/api-routes/trends-usage";
import { z } from "zod";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { trendsWindow } from "../services/trends-usage.service.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

setDefaultTimeout(120_000);
// A model no other suite ingests, so the shared test database cannot add runs.
const RAW_MODEL = "claude-opus-4-6";
const MODEL = "claude-opus-4-6";
const run = crypto.randomUUID();
const window = trendsWindow(new Date());
// Two sessions inside the harness balance's days, one well before them: all
// time counts all three.
const currentDay =
	Date.parse(`${window.harnessStart}T00:00:00Z`) + 14 * 86_400_000;
const earlierDay =
	Date.parse(`${window.harnessStart}T00:00:00Z`) - 30 * 86_400_000;
const ch = getClickhouse();
const users: { id: string; token: string }[] = [];
const sessions: { userId: string; sessionId: string }[] = [];
let server: ApiTestServer;

beforeAll(async () => {
	server = await startApiTestServer({
		TRENDS_MIN_RUNS: "1",
		TRENDS_MIN_DEVELOPERS: "1",
		TRENDS_MIN_WORKSPACES: "1",
	});
	for (const name of ["first", "second"]) {
		const response = await fetch(`${server.baseUrl}/api/auth/sign-up/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name,
				email: `trends-${name}-${run}@example.test`,
				password: `test-${run}`,
			}),
		});
		expect(response.status, server.readOutput()).toBe(200);
		const result = z
			.object({ token: z.string(), user: z.object({ id: z.string() }) })
			.parse(await response.json());
		users.push({ id: result.user.id, token: result.token });
	}
	const [first, second] = users;
	if (!first || !second) throw new Error("Expected two users");
	await ingest(first, `trends-${run}-current-1`, currentDay);
	await ingest(second, `trends-${run}-current-2`, currentDay + 3_600_000);
	await ingest(first, `trends-${run}-earlier`, earlierDay);
	await waitForIndexes();
});

afterAll(async () => {
	await server?.stop();
	for (const user of users) {
		for (const table of [
			"claude_sessions",
			"session_analytics",
			"session_language_signals",
			"usage_events",
			"transcript_records",
		])
			await ch.execute({
				query: `ALTER TABLE rudel.${table} DELETE WHERE organization_id = {org:String}`,
				query_params: { org: user.id },
			});
		await sqlClient`DELETE FROM organization WHERE id = ${user.id}`;
		await sqlClient`DELETE FROM "user" WHERE id = ${user.id}`;
	}
});

/**
 * Two runs: the first calls a tool that fails, apologizes, and gets a
 * negative, swearing reply that starts the second run.
 */
function transcript(sessionId: string, begin: number) {
	const at = (seconds: number) =>
		new Date(begin + seconds * 1000).toISOString();
	const assistant = (
		id: string,
		seconds: number,
		output: number,
		content: unknown[],
	) => ({
		type: "assistant",
		uuid: `a-${id}`,
		sessionId,
		timestamp: at(seconds),
		message: {
			role: "assistant",
			id: `m-${id}`,
			model: RAW_MODEL,
			usage: { input_tokens: 10, output_tokens: output },
			content,
		},
	});
	return [
		{
			type: "user",
			uuid: "u1",
			sessionId,
			timestamp: at(0),
			message: { role: "user", content: "Implement the task" },
		},
		assistant("tool", 1, 40, [
			{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
		]),
		{
			type: "user",
			uuid: "u-result",
			sessionId,
			timestamp: at(2),
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "t1",
						content: "command failed",
						is_error: true,
					},
				],
			},
		},
		assistant("sorry", 30, 60, [
			{ type: "text", text: "Sorry, the command failed. Fixed it." },
		]),
		{
			type: "user",
			uuid: "u2",
			sessionId,
			timestamp: at(40),
			message: { role: "user", content: "fuck, this did not work" },
		},
		assistant("done", 70, 10, [{ type: "text", text: "Done" }]),
	]
		.map((line) => JSON.stringify(line))
		.join("\n");
}

async function ingest(
	user: { id: string; token: string },
	sessionId: string,
	begin: number,
) {
	const response = await fetch(`${server.baseUrl}/rpc/ingestSession`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${user.token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			json: {
				content: transcript(sessionId, begin),
				sessionId,
				projectPath: `/trends/${run}`,
				source: "claude_code",
			},
		}),
	});
	expect(response.status, await response.clone().text()).toBe(200);
	sessions.push({ userId: user.id, sessionId });
}

/** Signals, usage events and transcript records are written off the request. */
async function waitForIndexes() {
	const ids = sessions.map((session) => session.sessionId);
	for (let attempt = 0; attempt < 120; attempt++) {
		const [row] = await ch.query<{
			signals: string;
			usage: string;
			records: string;
		}>({
			query: `SELECT
				(SELECT uniqExact(session_id) FROM rudel.session_language_signals
					WHERE session_id IN {ids:Array(String)} AND scan_version >= 6) AS signals,
				(SELECT uniqExact(session_id) FROM rudel.usage_events
					WHERE session_id IN {ids:Array(String)} AND record_kind = 'receipt') AS usage,
				(SELECT uniqExact(session_id) FROM rudel.transcript_records
					WHERE session_id IN {ids:Array(String)} AND kind = 'receipt') AS records`,
			query_params: { ids },
		});
		if (
			Number(row?.signals) === ids.length &&
			Number(row?.usage) === ids.length &&
			Number(row?.records) === ids.length
		)
			return;
		await Bun.sleep(500);
	}
	throw new Error(`Indexes did not finish: ${server.readOutput()}`);
}

test("publishes every source aggregated per model, without identities", async () => {
	const response = await fetch(`${server.baseUrl}/api/trends/usage`);
	expect(response.status, server.readOutput()).toBe(200);
	expect(response.headers.get("cache-control")).toContain("public");
	const text = await response.text();
	for (const user of users) expect(text).not.toContain(user.id);
	for (const session of sessions) expect(text).not.toContain(session.sessionId);
	const usage = trendsUsageSchema.parse(JSON.parse(text));
	expect(usage.scope).toBe("all_time");
	expect(usage.periodEndExclusive).toBe(window.periodEndExclusive);
	expect(
		usage.periodStart <= new Date(earlierDay).toISOString().slice(0, 10),
	).toBe(true);
	const model = usage.models.find((entry) => entry.familyId === MODEL);
	expect(model, text).toBeDefined();
	if (!model) return;
	expect(model).toMatchObject({
		runs: 10, // Six runs, rounded to the nearest ten.
		sessions: 0, // Three sessions, rounded to the nearest ten.
		developers: 2,
		workspaces: 2,
		firstUsedAt: new Date(earlierDay).toISOString().slice(0, 10),
		topApology: expect.any(String),
	});
	// All time: three sessions of 110 output tokens each.
	expect(model.totalOutputTokens).toBe(330);
	const { current, previous } = model;
	expect(current.runs).toBe(6);
	expect(current.replyRate).toBe(0.5);
	expect(current.reactions?.negative).toBe(1);
	expect(current.apologiesPer100Runs).toBe(50);
	expect(current.swearsPer1kPrompts).toBe(500);
	expect(current.toolFailureRate).toBe(1);
	expect(current.runSeconds?.p99).toBe(30);
	// Run one owns the tool call and the apology (100 output tokens), run two
	// the final message (10).
	expect(current.outputTokensPerRun?.p99).toBe(100);
	expect([10, 100]).toContain(current.outputTokensPerRun?.p50 ?? -1);
	expect(current.costPerRunUsd?.p99).toBeCloseTo((20 * 5 + 100 * 25) / 1e6, 9);
	// All time has no prior period.
	expect(previous).toBeNull();
	const sessionDay = new Date(currentDay).toISOString().slice(0, 10);
	expect(
		usage.harnessDays.find((day) => day.day === sessionDay)?.runs[
			"claude-code"
		],
	).toBeGreaterThanOrEqual(4);
});
