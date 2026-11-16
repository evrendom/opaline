import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	claudeHookInput,
	codexHookInput,
	notifyLocalServer,
} from "../src/hook.js";
import { createSecrets, saveServerState } from "../src/server-state.js";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "opaline-hook-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the hook ping", () => {
	test("Claude Code hooks send the transcript, final at session end", () => {
		expect(
			claudeHookInput(
				JSON.stringify({
					transcript_path: "/t/a.jsonl",
					hook_event_name: "SessionEnd",
				}),
			),
		).toEqual({ paths: ["/t/a.jsonl"], final: true });
		expect(
			claudeHookInput(
				JSON.stringify({
					transcript_path: "/t/a.jsonl",
					hook_event_name: "Stop",
				}),
			),
		).toEqual({ paths: ["/t/a.jsonl"], final: false });
		expect(claudeHookInput("not json")).toBeNull();
	});

	test("Codex turn notifications find the rollout of their thread", () => {
		const now = new Date(2026, 10, 15, 12);
		const day = join(root, "sessions", "2026", "11", "14");
		mkdirSync(day, { recursive: true });
		const file = join(day, "rollout-2026-11-14T10-00-00-abc-123.jsonl");
		writeFileSync(file, "{}\n");
		expect(
			codexHookInput(JSON.stringify({ "thread-id": "abc-123" }), root, now),
		).toEqual({
			paths: [file],
			final: false,
		});
		expect(
			codexHookInput(JSON.stringify({ "thread-id": "../x" }), root, now),
		).toBeNull();
	});

	test("Codex hooks send their transcript, final at session end, or find it by session", () => {
		const now = new Date(2026, 10, 15, 12);
		const day = join(root, "sessions", "2026", "11", "15");
		mkdirSync(day, { recursive: true });
		const file = join(day, "rollout-2026-11-15T09-00-00-def-456.jsonl");
		writeFileSync(file, "{}\n");
		expect(
			codexHookInput(
				JSON.stringify({
					session_id: "def-456",
					transcript_path: "/c/rollout.jsonl",
					hook_event_name: "Stop",
					turn_id: "t1",
				}),
				root,
				now,
			),
		).toEqual({ paths: ["/c/rollout.jsonl"], final: false });
		expect(
			codexHookInput(
				JSON.stringify({
					session_id: "def-456",
					transcript_path: "/c/rollout.jsonl",
					hook_event_name: "SessionEnd",
					reason: "other",
				}),
				root,
				now,
			),
		).toEqual({ paths: ["/c/rollout.jsonl"], final: true });
		expect(
			codexHookInput(
				JSON.stringify({
					session_id: "def-456",
					transcript_path: null,
					hook_event_name: "SessionEnd",
				}),
				root,
				now,
			),
		).toEqual({ paths: [file], final: true });
		expect(codexHookInput("", root, now)).toBeNull();
		expect(codexHookInput("null", root, now)).toBeNull();
	});

	test("posts to this Mac's server with its key, and stays quiet without one", async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		const fetchImpl = (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return new Response(null, { status: 202 });
		}) as unknown as typeof fetch;
		expect(
			await notifyLocalServer(
				{ paths: ["/t/a.jsonl"], final: true },
				{ dataDir: root, fetchImpl },
			),
		).toBe(false);
		const now = new Date().toISOString();
		saveServerState(root, {
			version: 1,
			createdAt: now,
			updatedAt: now,
			port: 4100,
			host: "127.0.0.1",
			publicUrl: "http://localhost:4100",
			secrets: createSecrets(),
			clickhouse: {
				mode: "local",
				httpPort: 1,
				tcpPort: 2,
				user: "u",
				password: "p",
			},
			postgres: { port: 3, user: "u", password: "p", database: "d" },
			setup: {
				email: "me@x.dev",
				name: "Me",
				userId: "u",
				organizationId: "o",
				organizationSlug: "me",
				organizationName: "Me",
				apiKey: "key-1",
				completedAt: now,
			},
		});
		expect(
			await notifyLocalServer(
				{ paths: ["/t/a.jsonl"], final: true },
				{ dataDir: root, fetchImpl },
			),
		).toBe(true);
		expect(calls[0]?.url).toBe(
			"http://127.0.0.1:4100/api/selfhost/ingest/notify",
		);
		expect(
			(calls[0]?.init.headers as Record<string, string>)["x-api-key"],
		).toBe("key-1");
		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
			paths: ["/t/a.jsonl"],
			final: true,
		});
	});
});
