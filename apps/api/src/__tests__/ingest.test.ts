import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
	claudeCodeAdapter,
	codexAdapter,
	InvalidTranscriptTimestampError,
	toClickHouseDateTime,
} from "@rudel/agent-adapters";

describe("extractTimestamps", () => {
	test("returns min/max timestamps from user and assistant lines", () => {
		const content = [
			'{"type":"user","timestamp":"2026-02-15T10:00:00Z","message":"hello"}',
			'{"type":"assistant","timestamp":"2026-02-15T10:05:00Z","message":"hi"}',
			'{"type":"user","timestamp":"2026-02-15T10:10:00Z","message":"bye"}',
		].join("\n");

		const result = claudeCodeAdapter.extractTimestamps(content);

		expect(result).toEqual({
			sessionDate: "2026-02-15T10:00:00.000Z",
			lastInteractionDate: "2026-02-15T10:10:00.000Z",
		});
	});

	test("uses only timestamps consumed by Claude analytics", () => {
		const content = [
			'{"type":"system","timestamp":"2026-02-15T09:00:00Z"}',
			'{"type":"user","timestamp":"2026-02-15T10:00:00Z","message":"hello"}',
			'{"type":"progress","timestamp":"2026-02-15T10:30:00Z"}',
		].join("\n");

		const result = claudeCodeAdapter.extractTimestamps(content);

		expect(result).toEqual({
			sessionDate: "2026-02-15T10:00:00.000Z",
			lastInteractionDate: "2026-02-15T10:00:00.000Z",
		});
	});

	test("returns null when no valid timestamps are found", () => {
		expect(claudeCodeAdapter.extractTimestamps("not json")).toBeNull();
		expect(claudeCodeAdapter.extractTimestamps("")).toBeNull();
		expect(claudeCodeAdapter.extractTimestamps('{"type":"user"}')).toBeNull();
		expect(
			claudeCodeAdapter.extractTimestamps(
				'{"type":"system","timestamp":"not-a-date"}',
			),
		).toBeNull();
		expect(
			claudeCodeAdapter.extractTimestamps(
				'{"type":"system","timestamp":"2026-02-15T09:00:00Z"}',
			),
		).toBeNull();
	});

	test("skips lines without a valid timestamp", () => {
		const content = [
			'{"type":"user","message":"no timestamp"}',
			'{"type":"system","timestamp":"not-a-date"}',
			'{"type":"assistant","timestamp":"2026-02-15T10:05:00Z","message":"hi"}',
		].join("\n");

		const result = claudeCodeAdapter.extractTimestamps(content);

		expect(result).toEqual({
			sessionDate: "2026-02-15T10:05:00.000Z",
			lastInteractionDate: "2026-02-15T10:05:00.000Z",
		});
	});

	test("Codex rejects invalid timestamp values", () => {
		expect(() =>
			codexAdapter.extractTimestamps(
				'{"type":"session_meta","timestamp":"not-a-date"}',
			),
		).toThrow(InvalidTranscriptTimestampError);
	});

	test.each([
		{ adapter: claudeCodeAdapter, type: "user" },
		{ adapter: codexAdapter, type: "event_msg" },
	])("rejects Unix-seconds strings for $adapter.name", ({ adapter, type }) => {
		expect(() =>
			adapter.extractTimestamps(
				JSON.stringify({ timestamp: "2147483647", type }),
			),
		).toThrow(InvalidTranscriptTimestampError);
	});

	test.each([
		{ adapter: claudeCodeAdapter, type: "user" },
		{ adapter: codexAdapter, type: "event_msg" },
	])("rejects unzoned timestamps for $adapter.name", ({ adapter, type }) => {
		expect(() =>
			adapter.extractTimestamps(
				JSON.stringify({ timestamp: "2026-02-15T10:00:00", type }),
			),
		).toThrow(InvalidTranscriptTimestampError);
	});

	test.each([
		{ adapter: claudeCodeAdapter, type: "user" },
		{ adapter: codexAdapter, type: "event_msg" },
	])("rejects mixed-validity timestamps for $adapter.name", ({
		adapter,
		type,
	}) => {
		const content = [
			JSON.stringify({ timestamp: "2026-02-15T10:00:00Z", type }),
			JSON.stringify({ timestamp: "2147483647", type }),
		].join("\n");

		expect(() => adapter.extractTimestamps(content)).toThrow(
			InvalidTranscriptTimestampError,
		);
	});

	test("is invariant in a non-UTC process timezone", async () => {
		const fixturePath = fileURLToPath(
			new URL("./fixtures/strict-timestamp-timezone.ts", import.meta.url),
		);
		const subprocess = Bun.spawn([process.execPath, fixturePath], {
			env: { ...process.env, TZ: "America/New_York" },
			stderr: "pipe",
			stdout: "pipe",
		});
		const [exitCode, stderr, stdout] = await Promise.all([
			subprocess.exited,
			new Response(subprocess.stderr).text(),
			new Response(subprocess.stdout).text(),
		]);

		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		expect(JSON.parse(stdout)).toEqual({
			lastInteractionDate: "2026-02-15T15:05:00.000Z",
			sessionDate: "2026-02-15T15:00:00.000Z",
		});
	});

	test.each([
		{ adapter: claudeCodeAdapter, name: "Claude Code" },
		{ adapter: codexAdapter, name: "Codex" },
	])("$name orders timestamps by instant, not ISO string", ({ adapter }) => {
		const content = [
			'{"type":"user","timestamp":"2026-02-15T09:00:00-05:00"}',
			'{"type":"assistant","timestamp":"2026-02-15T12:00:00Z"}',
		].join("\n");

		expect(adapter.extractTimestamps(content)).toEqual({
			sessionDate: "2026-02-15T12:00:00.000Z",
			lastInteractionDate: "2026-02-15T14:00:00.000Z",
		});
	});

	test("normalizes offsets before formatting ClickHouse dates", () => {
		expect(toClickHouseDateTime("2026-02-15T13:00:00+02:00")).toBe(
			"2026-02-15 11:00:00.000",
		);
	});

	test.each([
		{ adapter: claudeCodeAdapter, name: "Claude Code" },
		{ adapter: codexAdapter, name: "Codex" },
	])("$name ingestion reuses timestamps supplied by the API", async ({
		adapter,
	}) => {
		let insertedRows: Record<string, unknown>[] = [];
		const ingestor = {
			async insert({
				values,
			}: {
				table: string;
				values: Record<string, unknown>[];
			}) {
				insertedRows = values;
			},
		};

		await adapter.ingest(
			ingestor,
			{
				source: adapter.source,
				sessionId: "precomputed-timestamps",
				projectPath: "/test/project",
				content: "not parsed again",
			},
			{
				ingestedAt: new Date("2026-02-15T12:00:00.000Z"),
				organizationId: "test-organization",
				revision: "1",
				userId: "test-user",
				timestamps: {
					sessionDate: "2026-02-15T10:00:00.000Z",
					lastInteractionDate: "2026-02-15T11:00:00.000Z",
				},
			},
		);

		expect(insertedRows[0]).toMatchObject({
			session_date: "2026-02-15 10:00:00.000",
			last_interaction_date: "2026-02-15 11:00:00.000",
		});
	});
});
