import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractUsageEvents } from "@rudel/usage-events";
import { readAppendedUsage } from "./usage-tail.js";

let directory: string;
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "usage-tail-"));
});
afterEach(() => rm(directory, { recursive: true, force: true }));

const owner = { organizationId: "org", userId: "user" };

function request(id: string, minute: number, outputTokens = 20) {
	return `${JSON.stringify({
		type: "assistant",
		timestamp: `2026-11-28T10:0${minute}:00.000Z`,
		requestId: `req_${id}`,
		message: {
			id: `msg_${id}`,
			model: "claude-opus-5-5",
			content: [{ type: "text", text: id }],
			usage: {
				input_tokens: 10,
				output_tokens: outputTokens,
				cache_read_input_tokens: 1_000,
				cache_creation_input_tokens: 0,
			},
		},
	})}\n`;
}

test("reads the requests after the last import, as the import identifies them, and prices them", async () => {
	const main = join(directory, "s.jsonl");
	const agent = join(directory, "agent-a1.jsonl");
	const imported = request("a", 1);
	await writeFile(
		main,
		`${imported}${request("b", 2)}${request("c", 3).slice(0, 40)}`,
	);
	await writeFile(agent, request("d", 4));
	const rows = await readAppendedUsage(
		{
			sessionId: "s",
			source: "claude_code",
			files: [
				{ path: main, fromByte: Buffer.byteLength(imported), agentId: null },
				{ path: agent, fromByte: 0, agentId: "a1" },
			],
		},
		owner,
		new Date("2026-11-28T10:10:00.000Z"),
	);
	// The import's own extraction of the whole session, for the event IDs.
	const full = extractUsageEvents({
		organizationId: "org",
		userId: "user",
		sessionId: "s",
		source: "claude_code",
		content: imported + request("b", 2),
		subagents: { a1: request("d", 4) },
	});
	if (full.status !== "complete") throw new Error("incomplete");
	const ids = new Map(
		full.events.map((event) => [event.eventId, event.agentId]),
	);
	// The partial line ("c") waits for its newline.
	expect(rows).toHaveLength(2);
	for (const row of rows) {
		expect(ids.get(String(row.event_id))).toBe(String(row.agent_id));
		expect(row.estimated_cost).toBeGreaterThan(0);
		expect(row.pricing_model).toBe("claude-opus-5-5");
		expect(row.observed_at).toBe("2026-11-28 10:10:00.000");
	}
	expect(rows.map((row) => row.agent_id).sort()).toEqual(["a1", "main"]);
});

test("a file that did not grow or no longer exists adds nothing", async () => {
	const main = join(directory, "s.jsonl");
	const text = request("a", 1);
	await writeFile(main, text);
	expect(
		await readAppendedUsage(
			{
				sessionId: "s",
				source: "claude_code",
				files: [
					{ path: main, fromByte: Buffer.byteLength(text), agentId: null },
					{ path: join(directory, "gone.jsonl"), fromByte: 0, agentId: "x" },
				],
			},
			owner,
		),
	).toEqual([]);
});
