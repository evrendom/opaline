import { expect, test } from "bun:test";
import type { IngestSessionInput } from "@rudel/api-routes";
import {
	claudeTranscript,
	type MemoryStores,
	memoryStores,
} from "../../__tests__/helpers/session-import-memory-stores.js";

process.env.PG_CONNECTION_STRING ??= "postgres://unused@127.0.0.1:1/unused";
const { createBackgroundIngestErrorFactories, processIngestSession } =
	await import("./index.js");

function upload(content: string): IngestSessionInput {
	return {
		source: "claude_code",
		sessionId: "session-1",
		projectPath: "/repo",
		content,
		organizationId: "org",
	};
}

function importInto(stores: MemoryStores, input: IngestSessionInput) {
	return processIngestSession(
		{
			awaitLanguageSignals: true,
			context: { apiKeyId: null, session: null, user: { id: "user" } },
			enforceRateLimits: false,
			errorFactories: createBackgroundIngestErrorFactories(),
			input,
		},
		stores.dependencies,
	);
}

test("a new transcript is filtered, claimed and stored raw before its derived facts and receipt", async () => {
	const stores = memoryStores();
	const result = await importInto(stores, upload(claudeTranscript(2)));
	expect(result.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
	expect(stores.calls.filter((call) => call !== "run_index")).toEqual([
		"filter",
		"organization",
		"claim",
		"agent_metadata",
		"revision",
		"insert rudel.claude_sessions",
		"content",
		"cli_version",
		"language_signals",
		"records",
		"git_observations",
		"usage_generation",
		"extract",
		"skills",
		"usage",
		"content_and_usage_receipt",
		"search_index",
	]);
});

test("an identical re-import leaves before the raw insert and only retries derived evidence", async () => {
	const stores = memoryStores();
	const content = claudeTranscript(2);
	const first = await importInto(stores, upload(content));
	stores.calls.length = 0;
	const again = await importInto(stores, upload(content));
	expect(again.contentSha256).toBe(first.contentSha256);
	expect(stores.rawRows).toHaveLength(1);
	expect(stores.calls).toEqual([
		"filter",
		"organization",
		"claim",
		"agent_metadata",
		"raw_exists",
		"skill_receipt",
		"records_current",
		"git_observations",
		"search_index",
	]);
});

test("an identical re-import whose records are stale is stored again", async () => {
	const stores = memoryStores();
	const content = claudeTranscript(2);
	await importInto(stores, upload(content));
	stores.recordsCurrent = false;
	stores.calls.length = 0;
	await importInto(stores, upload(content));
	expect(stores.rawRows).toHaveLength(2);
	expect(stores.calls).toContain("insert rudel.claude_sessions");
	expect(stores.calls.indexOf("records_current")).toBeLessThan(
		stores.calls.indexOf("revision"),
	);
});

test("a grown transcript is stored as a new revision", async () => {
	const stores = memoryStores();
	await importInto(stores, upload(claudeTranscript(2)));
	await importInto(stores, upload(claudeTranscript(3)));
	expect(stores.rawRows).toHaveLength(2);
	expect(stores.calls.filter((call) => call === "revision")).toHaveLength(2);
});

test("stored records queue the session's run index once, whatever their git observations did", async () => {
	for (const gitObservations of ["written", "skipped", "failed"] as const) {
		const stores = memoryStores();
		stores.gitObservationsResult = gitObservations;
		await importInto(stores, upload(claudeTranscript(2)));
		expect(stores.runIndex).toEqual([
			{
				organizationId: "org",
				userId: "user",
				source: "claude_code",
				sessionId: "session-1",
			},
		]);
		expect(stores.calls.indexOf("run_index")).toBeGreaterThan(
			stores.calls.indexOf("git_observations"),
		);
	}
});

test("records that were not stored queue no run index", async () => {
	for (const records of ["skipped", "failed"] as const) {
		const stores = memoryStores();
		stores.recordsResult = records;
		await importInto(stores, upload(claudeTranscript(2)));
		expect(stores.runIndex).toEqual([]);
	}
});

test("an identical re-import queues the run index only when it writes missing git observations", async () => {
	for (const gitObservations of ["written", "skipped"] as const) {
		const stores = memoryStores();
		const content = claudeTranscript(2);
		await importInto(stores, upload(content));
		stores.runIndex.length = 0;
		stores.gitObservationsResult = gitObservations;
		await importInto(stores, upload(content));
		expect(stores.runIndex).toHaveLength(gitObservations === "written" ? 1 : 0);
	}
});
