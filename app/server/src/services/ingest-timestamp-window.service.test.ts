import { describe, expect, test } from "bun:test";
import {
	assertIngestTimestampWindow,
	IngestTimestampWindowError,
	MAX_INGEST_EVENT_AGE_MS,
	MAX_INGEST_EVENT_FUTURE_SKEW_MS,
} from "./ingest-timestamp-window.service.js";

const NOW = new Date("2026-08-25T12:00:00.000Z");

describe("assertIngestTimestampWindow", () => {
	test("accepts timestamps at the historical and future boundaries", () => {
		expect(() =>
			assertIngestTimestampWindow(
				{
					lastInteractionDate: new Date(
						NOW.getTime() + MAX_INGEST_EVENT_FUTURE_SKEW_MS,
					).toISOString(),
					sessionDate: new Date(
						NOW.getTime() - MAX_INGEST_EVENT_AGE_MS,
					).toISOString(),
				},
				NOW,
			),
		).not.toThrow();
	});

	test("rejects timestamps older than the bounded retention window", () => {
		expect(() =>
			assertIngestTimestampWindow(
				{
					lastInteractionDate: NOW.toISOString(),
					sessionDate: new Date(
						NOW.getTime() - MAX_INGEST_EVENT_AGE_MS - 1,
					).toISOString(),
				},
				NOW,
			),
		).toThrow(IngestTimestampWindowError);
	});

	test("rejects timestamps beyond the bounded future skew", () => {
		const future = new Date(
			NOW.getTime() + MAX_INGEST_EVENT_FUTURE_SKEW_MS + 1,
		).toISOString();
		expect(() =>
			assertIngestTimestampWindow(
				{ lastInteractionDate: future, sessionDate: future },
				NOW,
			),
		).toThrow(IngestTimestampWindowError);
	});

	test("rejects inverted timestamp ranges", () => {
		expect(() =>
			assertIngestTimestampWindow(
				{
					lastInteractionDate: "2026-08-25T10:00:00.000Z",
					sessionDate: "2026-08-25T11:00:00.000Z",
				},
				NOW,
			),
		).toThrow(IngestTimestampWindowError);
	});
});
