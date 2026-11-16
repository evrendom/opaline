import { describe, expect, test } from "bun:test";
import {
	type LanguageSignalCounts,
	type LanguageSignalSummary,
	SCAN_VERSION,
} from "@rudel/language-signals";
import type { ClickHouseExecutor } from "../clickhouse.js";
import { SessionLanguageSignalScannerOperationalError } from "./ingest-worker-operational.error.js";
import {
	buildSessionLanguageSignalRow,
	buildSessionLanguageSignalVersion,
	insertSessionLanguageSignalRows,
	persistSessionLanguageSignalsBestEffort,
} from "./session-language-signal-persistence.service.js";

const ZERO_COUNTS: LanguageSignalCounts = {
	member_apologies: 0,
	member_positive: 0,
	member_negative: 0,
	member_swears: 0,
	model_apologies: 0,
	model_positive: 0,
	model_swears: 0,
};

const ZERO_SUMMARY: LanguageSignalSummary = {
	...ZERO_COUNTS,
	model_apology_counts: {},
	member_negative_counts: {},
	member_positive_counts: {},
	member_apology_matches: [],
	member_positive_matches: [],
	member_swear_matches: [],
	model_apology_matches: [],
	model_positive_matches: [],
	model_swear_matches: [],
};

const scanInput = {
	content: "transcript",
	organizationId: "org-1",
	rawIngestedAt: "2026-08-19T12:00:01.123Z",
	rawRevision: "115807295561596928",
	sessionDate: "2026-08-19T12:00:00.000Z",
	sessionId: "session-1",
	source: "codex" as const,
	userId: "user-1",
};

describe("session language-signal ingest persistence", () => {
	test("builds the persisted row with the current scan version", () => {
		expect(
			buildSessionLanguageSignalRow(
				scanInput,
				{
					...ZERO_SUMMARY,
					member_swear_matches: ["fuck", "shit"],
					member_negative: 0,
					member_swears: 2,
				},
				"2026-08-19T12:00:02.456Z",
			),
		).toEqual({
			agent_runs: [],
			member_apologies: 0,
			member_apology_matches: [],
			member_positive: 0,
			member_positive_matches: [],
			member_negative: 0,
			member_swears: 2,
			member_swear_matches: ["fuck", "shit"],
			model_apologies: 0,
			model_apology_matches: [],
			model_positive: 0,
			model_positive_matches: [],
			model_swears: 0,
			model_swear_matches: [],
			organization_id: "org-1",
			raw_ingested_at: "2026-08-19 12:00:01.123",
			raw_revision: "115807295561596928",
			scan_version: SCAN_VERSION,
			model_apology_counts: {},
			member_negative_counts: {},
			member_positive_counts: {},
			scanned_at: "2026-08-19 12:00:02.456",
			signal_version: buildSessionLanguageSignalVersion(
				"115807295561596928",
				SCAN_VERSION,
				"2026-08-19T12:00:02.456Z",
			),
			session_date: "2026-08-19 12:00:00.000",
			session_id: "session-1",
			source: "codex",
			user_id: "user-1",
		});
	});

	test("orders the same scan timestamp by raw revision first", () => {
		const scannedAt = "2026-08-19T12:00:02.456Z";
		const lower = buildSessionLanguageSignalVersion(
			"9007199254740992",
			1,
			scannedAt,
		);
		const higher = buildSessionLanguageSignalVersion(
			"9007199254740993",
			1,
			scannedAt,
		);

		expect(BigInt(higher)).toBeGreaterThan(BigInt(lower));
	});

	test("does not reject ingest when the scanner has an operational failure", async () => {
		let insertCalls = 0;

		await expect(
			persistSessionLanguageSignalsBestEffort(scanInput, {
				insertRows: async () => {
					insertCalls += 1;
				},
				now: () => new Date("2026-08-19T12:00:02.456Z"),
				scan: async () => {
					throw new SessionLanguageSignalScannerOperationalError(
						"scanner unavailable",
					);
				},
			}),
		).resolves.toBeUndefined();
		expect(insertCalls).toBe(0);
	});

	test("does not reject the upload hook when the signal insert throws", async () => {
		await expect(
			persistSessionLanguageSignalsBestEffort(scanInput, {
				insertRows: async () => {
					throw new Error("ClickHouse unavailable");
				},
				now: () => new Date("2026-08-19T12:00:02.456Z"),
				scan: async () => ZERO_COUNTS,
			}),
		).resolves.toBeUndefined();
	});

	test("uses the executor's acknowledged async-insert default", async () => {
		let inserted: Parameters<ClickHouseExecutor["insert"]>[0] | undefined;
		const executor: ClickHouseExecutor = {
			close: async () => {},
			execute: async () => {},
			insert: async (params) => {
				inserted = params;
			},
			query: async () => [],
		};
		await insertSessionLanguageSignalRows(executor, [
			buildSessionLanguageSignalRow(
				scanInput,
				ZERO_COUNTS,
				"2026-08-19T12:00:02.456Z",
			),
		]);
		expect(inserted).toMatchObject({
			table: "rudel.session_language_signals",
		});
		expect(inserted?.asyncInsert).toBeUndefined();
	});
});
