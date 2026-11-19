import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	deriveSessionDetail,
	type SessionDetailRawSnapshot,
} from "../services/session-detail-derivation.service.js";
import {
	SessionDetailDerivationThread,
	SessionDetailDerivationWorkerError,
} from "../services/session-detail-derivation-thread.js";

const FIXTURES = new URL(
	"../../../../../packages/api-routes/src/session-transcript/__fixtures__/l1-facts/",
	import.meta.url,
);

function fixture(name: string): string {
	return readFileSync(new URL(name, FIXTURES), "utf8");
}

function snapshot(
	content: string,
	source: SessionDetailRawSnapshot["source"],
	subagents: Record<string, string> = {},
): SessionDetailRawSnapshot {
	return {
		content,
		durationMinutes: 12,
		gitBranch: "main",
		gitRemote: "github.com/acme/widget",
		gitSha: "abc",
		inputTokens: 100,
		lastInteractionDate: "2026-10-01T10:00:00.000Z",
		modelUsed: "",
		organizationId: "org-1",
		outputTokens: 20,
		ownerId: "owner-1",
		packageName: "widget",
		projectPath: "/repo",
		revision: "117158864486400000",
		sessionDate: "2026-10-01T09:00:00.000Z",
		sessionId: "session-1",
		skills: [],
		slashCommands: [],
		source,
		subagents,
		totalTokens: 120,
	};
}

function longAssistantTurn(characters: number): string {
	const words = "the agent read the file and ran the tests".split(" ");
	const text = Array.from(
		{ length: Math.ceil(characters / 5) },
		(_, index) => words[index % words.length],
	).join(" ");
	return [
		{
			type: "user",
			uuid: "u1",
			sessionId: "session-1",
			timestamp: "2026-10-01T09:00:00.000Z",
			message: { role: "user", content: "summarize" },
		},
		{
			type: "assistant",
			uuid: "a1",
			parentUuid: "u1",
			sessionId: "session-1",
			timestamp: "2026-10-01T09:00:01.000Z",
			message: {
				id: "msg_1",
				role: "assistant",
				model: "claude-opus-5-5",
				content: [{ type: "text", text }],
				usage: { input_tokens: 10, output_tokens: 20 },
			},
		},
	]
		.map((record) => JSON.stringify(record))
		.join("\n");
}

function crashingWorker(): Worker {
	return new Worker(
		new URL("./fixtures/crashing-ingest-worker.ts", import.meta.url).href,
	);
}

describe("session detail derivation on a worker thread", () => {
	test("derives what the request thread derives, bodies included", async () => {
		const thread = new SessionDetailDerivationThread();
		try {
			for (const input of [
				snapshot(fixture("claude-capture-2.1.jsonl"), "claude_code", {
					"agent-1": fixture("claude-subagent-2.1.jsonl"),
				}),
				snapshot(fixture("codex-capture-0.162.jsonl"), "codex"),
				snapshot(fixture("claude-images.jsonl"), "claude_code"),
			]) {
				const local = deriveSessionDetail(input);
				const derived = await thread.derive(input);
				expect(derived.byteSize).toBe(local.byteSize);
				expect(derived.revision).toBe(local.revision);
				expect(derived.overviewBase).toEqual(local.overviewBase);
				expect(derived.spine).toEqual(local.spine);
				expect(derived.turnSummaries).toEqual(local.turnSummaries);
				expect(derived.rawSubagents).toBe(input.subagents);
				expect([...derived.turnBodies]).toEqual([...local.turnBodies]);
				expect(local.turnSummaries.length).toBeGreaterThan(0);
			}
		} finally {
			thread.close();
		}
	}, 30_000);

	test("timers keep firing while a slow transcript is derived", async () => {
		const thread = new SessionDetailDerivationThread();
		const input = snapshot(longAssistantTurn(1_500_000), "claude_code");
		let ticks = 0;
		const timer = setInterval(() => {
			ticks++;
		}, 25);
		try {
			const startedAt = performance.now();
			await thread.derive(input);
			const elapsed = performance.now() - startedAt;
			expect(elapsed).toBeGreaterThan(250);
			expect(ticks).toBeGreaterThanOrEqual(Math.floor(elapsed / 25 / 4));
		} finally {
			clearInterval(timer);
			thread.close();
		}
	}, 30_000);

	test("a crashed worker fails its request and the next one starts a new worker", async () => {
		const workers = [crashingWorker, undefined];
		let created = 0;
		const thread = new SessionDetailDerivationThread(() => {
			const make = workers[created++];
			return make
				? make()
				: new Worker(
						new URL(
							"../services/session-detail-derivation.worker.ts",
							import.meta.url,
						).href,
					);
		});
		const input = snapshot(fixture("codex-0.156.jsonl"), "codex");
		try {
			await expect(thread.derive(input)).rejects.toBeInstanceOf(
				SessionDetailDerivationWorkerError,
			);
			const derived = await thread.derive(input);
			expect(derived.turnSummaries).toEqual(
				deriveSessionDetail(input).turnSummaries,
			);
			expect(created).toBe(2);
		} finally {
			thread.close();
		}
	}, 30_000);

	test("a closed thread refuses new work and fails what is pending", async () => {
		const thread = new SessionDetailDerivationThread();
		const pending = thread.derive(
			snapshot(longAssistantTurn(1_500_000), "claude_code"),
		);
		thread.close();
		await expect(pending).rejects.toThrow("shutting down");
		await expect(
			thread.derive(snapshot(fixture("codex-0.156.jsonl"), "codex")),
		).rejects.toThrow("shutting down");
	});
});
