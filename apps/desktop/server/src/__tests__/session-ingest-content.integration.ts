import {
	afterAll,
	beforeAll,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	type IngestSessionInput,
	SESSION_UPLOAD_SHRINK_REJECTED_CODE,
} from "@rudel/api-routes";
import {
	SESSION_INGEST_FILTER_VERSION,
	slimTranscriptText,
} from "@rudel/api-routes/transcript-slim";
import {
	extractUsageEvents,
	USAGE_EVENT_EXTRACTION_VERSION,
	USAGE_EVENT_IDENTITY_VERSION,
	USAGE_EVENT_MODEL_RATE_CARD_VERSION,
} from "@rudel/usage-events";
import postgres from "postgres";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { getIngestContentShape } from "../lib/ingest-content-shape.js";
import {
	claimSessionIngestOwnership,
	recordSessionIngestContent,
	reserveUsageBackfillGeneration,
	reserveUsageExtractionGeneration,
	UsageExtractionSupersededError,
} from "../services/session-ownership.service.js";
import {
	allocateSessionRevision,
	type SessionRevisionTransactionRunner,
} from "../services/session-revision.service.js";
import { runSessionRevisionReceiptCleanupPass } from "../services/session-revision-receipt-cleanup.service.js";
import {
	buildActiveUsageEventsCte,
	writeUsageExtraction,
} from "../services/usage-event-ingest.service.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

setDefaultTimeout(30_000);

const TEST_RUN_ID = `session_ingest_content_${crypto.randomUUID()}`;
const CLAIM_SESSION_ID = `${TEST_RUN_ID}_claim`;
const MONOTONIC_SESSION_ID = `${TEST_RUN_ID}_monotonic`;
const RECEIPT_SESSION_ID = `${TEST_RUN_ID}_receipt`;
const LEGACY_PASS_SESSION_ID = `${TEST_RUN_ID}_legacy_pass`;
const LEGACY_SHRINK_SESSION_ID = `${TEST_RUN_ID}_legacy_shrink`;
const FORCE_REPLACE_SESSION_ID = `${TEST_RUN_ID}_force_replace`;
const RAW_FIRST_FAILURE_SESSION_ID = `${TEST_RUN_ID}_raw_first_failure`;
const EXTRACTION_BYPASS_SESSION_ID = `${TEST_RUN_ID}_extraction_bypass`;
const GENERATION_HEDGE_SESSION_ID = `${TEST_RUN_ID}_generation_hedge`;
const BACKFILL_GENERATION_SESSION_ID = `${TEST_RUN_ID}_backfill_generation`;
const REVISION_SESSION_ID = `${TEST_RUN_ID}_revision`;
const CONCURRENT_RECEIPT_SESSION_ID = `${TEST_RUN_ID}_concurrent_receipt`;
const OWNERSHIP_RACE_SESSION_ID = `${TEST_RUN_ID}_ownership_race`;
const RECURRING_CONTENT_SESSION_ID = `${TEST_RUN_ID}_recurring_content`;
const EXPIRED_REVISION_RECEIPT_SESSION_ID = `${TEST_RUN_ID}_expired_revision_receipt`;
const FRESH_REVISION_RECEIPT_SESSION_ID = `${TEST_RUN_ID}_fresh_revision_receipt`;
const INVERTED_USAGE_REVISION_SESSION_ID = `${TEST_RUN_ID}_inverted_usage_revision`;
const KEYED_RETRY_SESSION_ID = `${TEST_RUN_ID}_keyed_retry`;
const LEGACY_RETRY_SESSION_ID = `${TEST_RUN_ID}_legacy_retry`;
const PIXEL_REUPLOAD_SESSION_ID = `${TEST_RUN_ID}_pixel_reupload`;
const CODEX_SLIM_SESSION_ID = `${TEST_RUN_ID}_codex_slim`;
const CODEX_SAME_VERSION_SESSION_ID = `${TEST_RUN_ID}_codex_same_version`;
const REBASELINE_RECORDS_SESSION_ID = `${TEST_RUN_ID}_rebaseline_records`;
const PREVIOUS_SESSION_FILTER_VERSION = SESSION_INGEST_FILTER_VERSION - 1;
const SCREENSHOT_PIXELS = Buffer.from(
	Array.from({ length: 150_000 }, (_, index) => (index * 31 + 7) % 256),
);

let server: ApiTestServer;
let userId: string;
let bearerToken: string;
let competingUserId: string;

beforeAll(async () => {
	server = await startApiTestServer();
	({ bearerToken, userId } = await createTestUser(server.baseUrl));
	({ userId: competingUserId } = await createTestUser(
		server.baseUrl,
		"competitor",
	));
	await sqlClient`
		INSERT INTO member (id, organization_id, user_id, role)
		VALUES (
			${crypto.randomUUID()},
			${userId},
			${competingUserId},
			'member'
		)
	`;
});

afterAll(async () => {
	await server?.stop();
	await getClickhouse().execute({
		query: `DELETE FROM rudel.usage_events WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
		query_params: { organizationId: userId },
	});
	await sqlClient`
		DELETE FROM organization
		WHERE id IN (${userId}, ${competingUserId})
	`;
	await sqlClient`
		DELETE FROM "user"
		WHERE id IN (${userId}, ${competingUserId})
	`;
});

describe("session ingest content bookkeeping", () => {
	test("serializes concurrent revisions and reuses an exact retry", async () => {
		const claim = await claimSessionIngestOwnership(
			userId,
			REVISION_SESSION_ID,
			userId,
		);
		assert(claim.owned);
		const firstInput = {
			allowReceiptPromotion: false,
			contentSha256: "1".repeat(64),
			operationId: "r2:concurrent-1",
			organizationId: userId,
			sessionId: REVISION_SESSION_ID,
			userId,
		};
		const secondInput = {
			...firstInput,
			contentSha256: "2".repeat(64),
			operationId: "r2:concurrent-2",
		};

		const [first, second] = await Promise.all([
			allocateSessionRevision(firstInput),
			allocateSessionRevision(secondInput),
		]);
		const retry = await allocateSessionRevision(firstInput);
		const ordered = [BigInt(first), BigInt(second)].sort((left, right) =>
			left < right ? -1 : left > right ? 1 : 0,
		);
		const [lower, higher] = ordered;
		assert(lower !== undefined && higher !== undefined);

		expect(first).not.toBe(second);
		// The allocator guarantees strict per-session monotonicity, not dense
		// adjacency: GREATEST(head + 1, epoch_ms << 16) jumps to the epoch
		// floor whenever the clock advances between allocations.
		expect(higher).toBeGreaterThan(lower);
		expect(retry).toBe(first);
	});

	test("serializes a concurrent same-operation first-receipt race on separate connections", async () => {
		const claim = await claimSessionIngestOwnership(
			userId,
			CONCURRENT_RECEIPT_SESSION_ID,
			userId,
		);
		assert(claim.owned);
		const input = {
			allowReceiptPromotion: false,
			contentSha256: "3".repeat(64),
			operationId: "r2:concurrent-same-operation",
			organizationId: userId,
			sessionId: CONCURRENT_RECEIPT_SESSION_ID,
			userId,
		};
		// Reserved connections do not expose begin(); dedicated single-slot
		// clients give the allocator real transactions on truly separate
		// connections.
		const connectionString = process.env.PG_CONNECTION_STRING;
		assert(connectionString);
		const firstConnection = postgres(connectionString, {
			max: 1,
			prepare: false,
		});
		const secondConnection = postgres(connectionString, {
			max: 1,
			prepare: false,
		});
		try {
			const [first, second] = await Promise.all([
				allocateSessionRevision(
					input,
					createRevisionEnvironment(firstConnection),
				),
				allocateSessionRevision(
					input,
					createRevisionEnvironment(secondConnection),
				),
			]);

			expect(second).toBe(first);
			const [receipt] = await sqlClient<Array<{ count: string }>>`
				SELECT count(*)::text AS count
				FROM session_ingest_revision
				WHERE organization_id = ${userId}
					AND session_id = ${CONCURRENT_RECEIPT_SESSION_ID}
			`;
			expect(receipt?.count).toBe("1");
		} finally {
			await Promise.allSettled([
				firstConnection.end({ timeout: 5 }),
				secondConnection.end({ timeout: 5 }),
			]);
		}
	});

	test("serializes a concurrent first-upload ownership race on separate connections", async () => {
		const [firstConnection, secondConnection] = await Promise.all([
			sqlClient.reserve(),
			sqlClient.reserve(),
		]);
		try {
			const [first, second] = await Promise.all([
				claimSessionIngestOwnership(
					userId,
					OWNERSHIP_RACE_SESSION_ID,
					userId,
					firstConnection,
				),
				claimSessionIngestOwnership(
					userId,
					OWNERSHIP_RACE_SESSION_ID,
					competingUserId,
					secondConnection,
				),
			]);

			expect([first.owned, second.owned].filter(Boolean)).toHaveLength(1);
			const winnerId = first.owned ? userId : competingUserId;
			const loser = first.owned ? second : first;
			assert(!loser.owned);
			expect(loser.ownerId).toBe(winnerId);
		} finally {
			firstConnection.release();
			secondConnection.release();
		}
	});

	test("measures revision receipt retention against the PostgreSQL clock", async () => {
		const expiredOperationId = `r2:${crypto.randomUUID()}`;
		const freshOperationId = `r2:${crypto.randomUUID()}`;
		for (const sessionId of [
			EXPIRED_REVISION_RECEIPT_SESSION_ID,
			FRESH_REVISION_RECEIPT_SESSION_ID,
		]) {
			const claim = await claimSessionIngestOwnership(
				userId,
				sessionId,
				userId,
			);
			assert(claim.owned);
		}
		await allocateSessionRevision({
			allowReceiptPromotion: false,
			contentSha256: "8".repeat(64),
			operationId: expiredOperationId,
			organizationId: userId,
			sessionId: EXPIRED_REVISION_RECEIPT_SESSION_ID,
			userId,
		});
		await allocateSessionRevision({
			allowReceiptPromotion: false,
			contentSha256: "9".repeat(64),
			operationId: freshOperationId,
			organizationId: userId,
			sessionId: FRESH_REVISION_RECEIPT_SESSION_ID,
			userId,
		});
		await sqlClient`
			UPDATE session_ingest_revision
			SET created_at = CASE
				WHEN operation_id = ${expiredOperationId}
					THEN clock_timestamp() - interval '31 days'
				ELSE clock_timestamp() - interval '29 days'
			END
			WHERE organization_id = ${userId}
				AND operation_id IN (${expiredOperationId}, ${freshOperationId})
		`;
		const clockClassifications = await sqlClient<
			Array<{ expired: boolean; operationId: string }>
		>`
			SELECT
				operation_id AS "operationId",
				created_at < clock_timestamp() - interval '30 days' AS expired
			FROM session_ingest_revision
			WHERE organization_id = ${userId}
				AND operation_id IN (${expiredOperationId}, ${freshOperationId})
			ORDER BY operation_id
		`;
		expect([...clockClassifications]).toEqual(
			[
				{ expired: true, operationId: expiredOperationId },
				{ expired: false, operationId: freshOperationId },
			].sort((left, right) =>
				left.operationId.localeCompare(right.operationId),
			),
		);

		const cleanup = await runSessionRevisionReceiptCleanupPass(sqlClient);
		expect(cleanup.deleted).toBeGreaterThanOrEqual(1);
		const remaining = await sqlClient<Array<{ operationId: string }>>`
			SELECT operation_id AS "operationId"
			FROM session_ingest_revision
			WHERE organization_id = ${userId}
				AND operation_id IN (${expiredOperationId}, ${freshOperationId})
		`;
		expect([...remaining]).toEqual([{ operationId: freshOperationId }]);
	});

	test("returns a null hash, records it, then returns the stored hash", async () => {
		const initialClaim = await claimSessionIngestOwnership(
			userId,
			CLAIM_SESSION_ID,
			userId,
		);
		assert(initialClaim.owned);
		expect(initialClaim.lastContentSha256).toBeNull();

		const contentHash = "a".repeat(64);
		await recordSessionIngestContent(
			userId,
			CLAIM_SESSION_ID,
			contentHash,
			contentShape(12_345, 42),
			5,
			new Date("2026-07-24T09:30:00.000Z"),
			new Date("2026-07-24T10:00:00.000Z"),
			"1",
		);

		const repeatedClaim = await claimSessionIngestOwnership(
			userId,
			CLAIM_SESSION_ID,
			userId,
		);
		assert(repeatedClaim.owned);
		expect(repeatedClaim.lastContentSha256).toBe(contentHash);
		expect(repeatedClaim.lastContentBytes).toBe(12_345);
		expect(repeatedClaim.lastAssistantLineCount).toBe(42);
		expect(repeatedClaim.lastContentShape).toEqual(contentShape(12_345, 42));
		expect(repeatedClaim.lastFilterVersion).toBe(5);
	});

	test("does not let older bookkeeping overwrite a newer ingest", async () => {
		const initialClaim = await claimSessionIngestOwnership(
			userId,
			MONOTONIC_SESSION_ID,
			userId,
		);
		assert(initialClaim.owned);

		const newerHash = "b".repeat(64);
		const newerIngestedAt = new Date("2026-07-24T12:00:00.000Z");
		await recordSessionIngestContent(
			userId,
			MONOTONIC_SESSION_ID,
			newerHash,
			contentShape(20_000, 20),
			5,
			new Date("2026-07-24T09:30:00.000Z"),
			newerIngestedAt,
			"2",
		);
		await recordSessionIngestContent(
			userId,
			MONOTONIC_SESSION_ID,
			"c".repeat(64),
			contentShape(10_000, 10),
			5,
			new Date("2026-07-24T09:30:00.000Z"),
			new Date("2026-07-24T11:00:00.000Z"),
			"1",
		);

		const [row] = await sqlClient<
			Array<{
				last_assistant_line_count: number | null;
				last_content_bytes: number | null;
				last_content_sha256: string | null;
				last_ingested_at: string | null;
			}>
		>`
			SELECT
				last_content_sha256,
				last_content_bytes,
				last_assistant_line_count,
				last_ingested_at
			FROM session_ownership
			WHERE organization_id = ${userId}
				AND session_id = ${MONOTONIC_SESSION_ID}
		`;
		expect(row?.last_content_sha256).toBe(newerHash);
		expect(row?.last_content_bytes).toBe(20_000);
		expect(row?.last_assistant_line_count).toBe(20);
		expect(new Date(row?.last_ingested_at ?? "")).toEqual(newerIngestedAt);
	});

	test("only the latest reserved generation can certify a usage receipt", async () => {
		const initialClaim = await claimSessionIngestOwnership(
			userId,
			RECEIPT_SESSION_ID,
			userId,
		);
		assert(initialClaim.owned);
		const contentHash = "d".repeat(64);
		await recordSessionIngestContent(
			userId,
			RECEIPT_SESSION_ID,
			contentHash,
			contentShape(2_000, 2),
			5,
			new Date("2026-08-03T09:30:00.000Z"),
			new Date("2026-08-03T10:00:00.000Z"),
			"1",
		);
		const olderGeneration = await reserveUsageExtractionGeneration(
			userId,
			RECEIPT_SESSION_ID,
			userId,
			"1",
		);
		const latestGeneration = await reserveUsageExtractionGeneration(
			userId,
			RECEIPT_SESSION_ID,
			userId,
			"1",
		);
		const receipt = {
			checksum: "e".repeat(64),
			diagnostics: "[]",
			eventCount: 2,
			extractionVersion: USAGE_EVENT_EXTRACTION_VERSION,
			eventIdentityVersion: USAGE_EVENT_IDENTITY_VERSION,
			modelRateCardVersion: USAGE_EVENT_MODEL_RATE_CARD_VERSION,
		};

		await expect(
			recordSessionIngestContent(
				userId,
				RECEIPT_SESSION_ID,
				contentHash,
				contentShape(2_000, 2),
				5,
				new Date("2026-08-03T09:30:00.000Z"),
				new Date("2026-08-03T10:00:00.000Z"),
				"1",
				{ ...receipt, generation: olderGeneration },
			),
		).rejects.toBeInstanceOf(UsageExtractionSupersededError);
		const afterRejectedGeneration = await claimSessionIngestOwnership(
			userId,
			RECEIPT_SESSION_ID,
			userId,
		);
		assert(afterRejectedGeneration.owned);
		expect(afterRejectedGeneration.lastContentSha256).toBe(contentHash);
		expect(afterRejectedGeneration.lastUsageContentSha256).toBeNull();
		await expect(
			recordSessionIngestContent(
				userId,
				RECEIPT_SESSION_ID,
				contentHash,
				contentShape(2_000, 2),
				5,
				new Date("2026-08-03T09:30:00.000Z"),
				new Date("2026-08-03T10:00:00.000Z"),
				"1",
				{ ...receipt, generation: latestGeneration },
			),
		).resolves.toBeUndefined();

		const completedClaim = await claimSessionIngestOwnership(
			userId,
			RECEIPT_SESSION_ID,
			userId,
		);
		assert(completedClaim.owned);
		expect(completedClaim.lastUsageContentSha256).toBe(contentHash);
		expect(completedClaim.lastUsageChecksum).toBe(receipt.checksum);
		expect(completedClaim.lastUsageExtractionVersion).toBe(
			USAGE_EVENT_EXTRACTION_VERSION,
		);
		expect(completedClaim.lastUsageEventIdentityVersion).toBe(
			USAGE_EVENT_IDENTITY_VERSION,
		);
		expect(completedClaim.lastUsageModelRateCardVersion).toBe(
			USAGE_EVENT_MODEL_RATE_CARD_VERSION,
		);
	});

	test("V11 generations survive a Postgres row reset by using the epoch floor", async () => {
		const claim = await claimSessionIngestOwnership(
			userId,
			GENERATION_HEDGE_SESSION_ID,
			userId,
		);
		assert(claim.owned);
		await recordSessionIngestContent(
			userId,
			GENERATION_HEDGE_SESSION_ID,
			"7".repeat(64),
			contentShape(1_000, 1),
			5,
			new Date("2026-08-03T09:30:00.000Z"),
			new Date("2026-08-03T10:00:00.000Z"),
			"1",
		);
		const [beforeReservation] = await sqlClient<Array<{ epoch_ms: string }>>`
			SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint::text AS epoch_ms
		`;
		assert(beforeReservation);
		const first = BigInt(
			await reserveUsageExtractionGeneration(
				userId,
				GENERATION_HEDGE_SESSION_ID,
				userId,
				"1",
			),
		);
		const second = BigInt(
			await reserveUsageExtractionGeneration(
				userId,
				GENERATION_HEDGE_SESSION_ID,
				userId,
				"1",
			),
		);
		const [afterReservation] = await sqlClient<Array<{ epoch_ms: string }>>`
			SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint::text AS epoch_ms
		`;
		assert(afterReservation);

		expect(first).toBeGreaterThanOrEqual(BigInt(beforeReservation.epoch_ms));
		expect(first).toBeLessThanOrEqual(BigInt(afterReservation.epoch_ms));
		expect(second).toBeGreaterThan(first);
	});

	test("rejects an older extraction that reserves after a newer raw revision on another instance", async () => {
		const claim = await claimSessionIngestOwnership(
			userId,
			INVERTED_USAGE_REVISION_SESSION_ID,
			userId,
		);
		assert(claim.owned);
		const connectionString = process.env.PG_CONNECTION_STRING;
		assert(connectionString);
		const olderInstance = postgres(connectionString, {
			max: 1,
			prepare: false,
		});
		const newerInstance = postgres(connectionString, {
			max: 1,
			prepare: false,
		});
		const olderHash = "4".repeat(64);
		const newerHash = "5".repeat(64);
		const olderRevision = "100";
		const newerRevision = "101";

		await recordSessionIngestContent(
			userId,
			INVERTED_USAGE_REVISION_SESSION_ID,
			olderHash,
			contentShape(1_000, 1),
			5,
			new Date("2026-08-03T09:30:00.000Z"),
			new Date("2026-08-03T10:00:00.000Z"),
			olderRevision,
		);
		await recordSessionIngestContent(
			userId,
			INVERTED_USAGE_REVISION_SESSION_ID,
			newerHash,
			contentShape(2_000, 2),
			5,
			new Date("2026-08-03T09:31:00.000Z"),
			new Date("2026-08-03T10:01:00.000Z"),
			newerRevision,
		);

		const newerInput = makeClaudeInput(INVERTED_USAGE_REVISION_SESSION_ID, 1);
		const newerExtraction = extractUsageEvents({
			content: newerInput.content,
			organizationId: userId,
			sessionId: INVERTED_USAGE_REVISION_SESSION_ID,
			source: "claude_code",
			subagents: { worker: newerInput.subagents?.[0]?.content ?? "" },
			userId,
		});
		if (newerExtraction.status !== "complete") {
			throw new Error("Expected the newer usage extraction to complete");
		}
		const newerGeneration = await reserveUsageExtractionGeneration(
			userId,
			INVERTED_USAGE_REVISION_SESSION_ID,
			userId,
			newerRevision,
			newerInstance,
		);
		await writeUsageExtraction(getClickhouse(), {
			contentSha256: newerHash,
			extraction: newerExtraction,
			filterVersion: 5,
			generation: newerGeneration,
			ingestedAt: new Date("2026-08-03T10:01:00.000Z"),
			organizationId: userId,
			replaceAbsentEvents: true,
			sessionDate: new Date("2026-08-03T09:31:00.000Z"),
			sessionId: INVERTED_USAGE_REVISION_SESSION_ID,
			source: "claude_code",
			userId,
		});
		await recordSessionIngestContent(
			userId,
			INVERTED_USAGE_REVISION_SESSION_ID,
			newerHash,
			contentShape(2_000, 2),
			5,
			new Date("2026-08-03T09:31:00.000Z"),
			new Date("2026-08-03T10:01:00.000Z"),
			newerRevision,
			{
				checksum: newerExtraction.receipt.checksum,
				diagnostics: JSON.stringify(newerExtraction.diagnostics),
				eventCount: newerExtraction.receipt.eventCount,
				extractionVersion: newerExtraction.receipt.extractionVersion,
				eventIdentityVersion: newerExtraction.receipt.eventIdentityVersion,
				generation: newerGeneration,
				modelRateCardVersion: newerExtraction.receipt.modelRateCardVersion,
			},
		);

		// The older instance finishes its scan only after the newer generation and
		// receipt are durable, then tries to reserve in the inverted order.
		const olderInput = makeClaudeInput(INVERTED_USAGE_REVISION_SESSION_ID, 0);
		const olderExtraction = extractUsageEvents({
			content: olderInput.content,
			organizationId: userId,
			sessionId: INVERTED_USAGE_REVISION_SESSION_ID,
			source: "claude_code",
			subagents: {},
			userId,
		});
		expect(olderExtraction.status).toBe("complete");
		await expect(
			reserveUsageExtractionGeneration(
				userId,
				INVERTED_USAGE_REVISION_SESSION_ID,
				userId,
				olderRevision,
				olderInstance,
			),
		).rejects.toBeInstanceOf(UsageExtractionSupersededError);

		const latestRows = await readLatestUsageRows(
			INVERTED_USAGE_REVISION_SESSION_ID,
		);
		expect(latestRows.length).toBeGreaterThan(1);
		expect(latestRows.every((row) => row.content_sha256 === newerHash)).toBe(
			true,
		);
		expect(latestRows.some((row) => row.is_deleted === 1)).toBe(false);
		expect(
			latestRows.some(
				(row) =>
					row.record_kind === "receipt" &&
					row.event_version === newerGeneration,
			),
		).toBe(true);
		await Promise.all([
			olderInstance.end({ timeout: 5 }),
			newerInstance.end({ timeout: 5 }),
		]);
	});

	test("backfill generation reservation loses to a newer live snapshot", async () => {
		const claim = await claimSessionIngestOwnership(
			userId,
			BACKFILL_GENERATION_SESSION_ID,
			userId,
		);
		assert(claim.owned);
		const currentHash = "f".repeat(64);
		await recordSessionIngestContent(
			userId,
			BACKFILL_GENERATION_SESSION_ID,
			currentHash,
			contentShape(4_000, 4),
			5,
			new Date("2026-08-03T10:00:00.000Z"),
			new Date("2026-08-03T10:01:00.000Z"),
			"1",
		);

		expect(
			await reserveUsageBackfillGeneration(
				userId,
				BACKFILL_GENERATION_SESSION_ID,
				userId,
				"e".repeat(64),
				new Date("2026-08-03T10:00:00.000Z"),
			),
		).toBeNull();
		expect(
			await reserveUsageBackfillGeneration(
				userId,
				BACKFILL_GENERATION_SESSION_ID,
				userId,
				currentHash,
				new Date("2026-08-03T10:02:00.000Z"),
			),
		).not.toBeNull();
	});

	test("drives the legacy fallback through total-vs-total pass and shrink rejection", async () => {
		const completeInput = makeClaudeInput(LEGACY_PASS_SESSION_ID, 5);
		await seedLegacyContentShape(completeInput);

		const legitimateResponse = await callIngest(completeInput);
		expect(legitimateResponse.status).toBe(200);

		const legacyShrinkBaseline = makeClaudeInput(LEGACY_SHRINK_SESSION_ID, 5);
		await seedLegacyContentShape(legacyShrinkBaseline);
		const truncatedInput = makeClaudeInput(LEGACY_SHRINK_SESSION_ID, 0);

		const shrinkResponse = await callIngest(truncatedInput);
		expect(shrinkResponse.status).toBe(409);
		expect(readRpcErrorCode(shrinkResponse.body)).toBe(
			SESSION_UPLOAD_SHRINK_REJECTED_CODE,
		);
	});

	test("stores screenshots as markers and re-baselines a session stored with pixels once", async () => {
		const pixelInput = makeClaudeScreenshotInput(PIXEL_REUPLOAD_SESSION_ID);
		await seedStoredContentShape(pixelInput, PREVIOUS_SESSION_FILTER_VERSION);

		const firstResponse = await callIngest(pixelInput);
		expect(firstResponse.status).toBe(200);
		const stored = await readLatestRawSession(PIXEL_REUPLOAD_SESSION_ID);
		assert(stored);
		const marker = `opaline-image-omitted:v1;sha256=${createHash("sha256").update(SCREENSHOT_PIXELS).digest("hex")};bytes=${SCREENSHOT_PIXELS.byteLength};type=image/png`;
		expect(stored.content).toBe(slimTranscriptText(pixelInput.content));
		expect(stored.content).toContain(`"data":"${marker}"`);
		expect(stored.content).toContain(`"base64":"${marker}"`);
		expect(stored.content).not.toContain(
			SCREENSHOT_PIXELS.toString("base64").slice(0, 64),
		);
		const firstHash = await readLastContentHash(PIXEL_REUPLOAD_SESSION_ID);

		// Old clients resend pixels and new clients send markers; both are the
		// same stored transcript, not a new revision.
		expect((await callIngest(pixelInput)).status).toBe(200);
		expect(
			(
				await callIngest({
					...pixelInput,
					content: slimTranscriptText(pixelInput.content),
				})
			).status,
		).toBe(200);
		expect(await readLastContentHash(PIXEL_REUPLOAD_SESSION_ID)).toBe(
			firstHash,
		);
		expect(
			(await readLatestRawSession(PIXEL_REUPLOAD_SESSION_ID))?.revision,
		).toBe(stored.revision);

		const truncatedLines = stored.content.split("\n").slice(0, -2);
		const truncatedResponse = await callIngest({
			...pixelInput,
			content: truncatedLines.join("\n"),
		});
		expect(truncatedResponse.status).toBe(409);
		expect(readRpcErrorCode(truncatedResponse.body)).toBe(
			SESSION_UPLOAD_SHRINK_REJECTED_CODE,
		);
	});

	test("the filter-version re-baseline skips only byte sizes: lost assistant records and subagent streams are still refused", async () => {
		const base = makeClaudeInput(REBASELINE_RECORDS_SESSION_ID, 3);
		const extraAssistantRecords = Array.from({ length: 11 }, (_, index) =>
			JSON.stringify({
				message: {
					content: `Assistant record ${index}`,
					role: "assistant",
					usage: { input_tokens: 2, output_tokens: 1 },
				},
				timestamp: `2026-07-24T09:31:${String(index).padStart(2, "0")}.000Z`,
				type: "assistant",
			}),
		);
		const full: IngestSessionInput = {
			...base,
			content: [base.content, ...extraAssistantRecords].join("\n"),
		};
		expect(getIngestContentShape(full).main.assistantLineCount).toBe(12);
		await seedStoredContentShape(full, PREVIOUS_SESSION_FILTER_VERSION);

		// A released CLI uploading a truncated local transcript: 12 -> 2 records.
		const truncated = {
			...full,
			content: full.content.split("\n").slice(0, 3).join("\n"),
		};
		expect(getIngestContentShape(truncated).main.assistantLineCount).toBe(2);
		const truncatedResponse = await callIngest(truncated);
		expect(truncatedResponse.status).toBe(409);
		expect(readRpcErrorCode(truncatedResponse.body)).toBe(
			SESSION_UPLOAD_SHRINK_REJECTED_CODE,
		);

		// A previously uploaded subagent stream is missing.
		const withoutSubagent = await callIngest({ ...full, subagents: [] });
		expect(withoutSubagent.status).toBe(409);
		expect(readRpcErrorCode(withoutSubagent.body)).toBe(
			SESSION_UPLOAD_SHRINK_REJECTED_CODE,
		);
		expect(await readLastFilterVersion(REBASELINE_RECORDS_SESSION_ID)).toBe(
			PREVIOUS_SESSION_FILTER_VERSION,
		);

		// The complete transcript re-baselines and stores the current version.
		expect((await callIngest(full)).status).toBe(200);
		expect(await readLastFilterVersion(REBASELINE_RECORDS_SESSION_ID)).toBe(
			SESSION_INGEST_FILTER_VERSION,
		);
	});

	test("accepts a slimmed re-upload of a full Codex session stored by the previous filter version once", async () => {
		const fullInput = makeCodexSlimmableInput(CODEX_SLIM_SESSION_ID);
		const slimmedContent = slimTranscriptText(fullInput.content);
		expect(slimmedContent.length).toBeLessThan(fullInput.content.length * 0.6);
		await seedStoredContentShape(fullInput, PREVIOUS_SESSION_FILTER_VERSION);

		// A slimming CLI uploads the slimmed transcript.
		expect(
			(await callIngest({ ...fullInput, content: slimmedContent })).status,
		).toBe(200);
		const stored = await readLatestRawSession(
			CODEX_SLIM_SESSION_ID,
			"rudel.codex_sessions",
		);
		assert(stored);
		expect(stored.content).toBe(slimmedContent);
		expect(await readLastFilterVersion(CODEX_SLIM_SESSION_ID)).toBe(
			SESSION_INGEST_FILTER_VERSION,
		);
		const firstHash = await readLastContentHash(CODEX_SLIM_SESSION_ID);

		// A released CLI resends the full transcript: the server slims it to
		// the same bytes, hash and revision.
		expect((await callIngest(fullInput)).status).toBe(200);
		expect(await readLastContentHash(CODEX_SLIM_SESSION_ID)).toBe(firstHash);
		expect(
			(
				await readLatestRawSession(
					CODEX_SLIM_SESSION_ID,
					"rudel.codex_sessions",
				)
			)?.revision,
		).toBe(stored.revision);

		// The re-baseline happened once: truncation is refused again.
		const truncated = slimmedContent.split("\n").slice(0, -4).join("\n");
		const truncatedResponse = await callIngest({
			...fullInput,
			content: truncated,
		});
		expect(truncatedResponse.status).toBe(409);
		expect(readRpcErrorCode(truncatedResponse.body)).toBe(
			SESSION_UPLOAD_SHRINK_REJECTED_CODE,
		);
	});

	test("still refuses the slimmed size against a full shape stored at the current filter version", async () => {
		const fullInput = makeCodexSlimmableInput(CODEX_SAME_VERSION_SESSION_ID);
		await seedStoredContentShape(fullInput, SESSION_INGEST_FILTER_VERSION);

		const response = await callIngest({
			...fullInput,
			content: slimTranscriptText(fullInput.content),
		});

		expect(response.status).toBe(409);
		expect(readRpcErrorCode(response.body)).toBe(
			SESSION_UPLOAD_SHRINK_REJECTED_CODE,
		);
	});

	test("force replacement retires request facts absent from the accepted generation", async () => {
		const completeInput = makeClaudeInput(FORCE_REPLACE_SESSION_ID, 1);
		expect((await callIngest(completeInput)).status).toBe(200);
		expect(await readActiveUsageEventCount(FORCE_REPLACE_SESSION_ID)).toBe(2);

		const replacementInput = makeClaudeInput(FORCE_REPLACE_SESSION_ID, 0);
		replacementInput.force_replace = true;
		expect((await callIngest(replacementInput)).status).toBe(200);
		expect(await readActiveUsageEventCount(FORCE_REPLACE_SESSION_ID)).toBe(1);
	});

	test("C to D to force-replace C allocates a fresh winning legacy revision", async () => {
		const contentC = makeClaudeInput(RECURRING_CONTENT_SESSION_ID, 0);
		const contentD = {
			...contentC,
			content: contentC.content.replace("Session content", "Changed content"),
		};

		expect((await callIngest(contentC)).status).toBe(200);
		const first = await readLatestRawSession(RECURRING_CONTENT_SESSION_ID);
		expect((await callIngest(contentD)).status).toBe(200);
		const intervening = await readLatestRawSession(
			RECURRING_CONTENT_SESSION_ID,
		);
		expect(
			(await callIngest({ ...contentC, force_replace: true })).status,
		).toBe(200);
		const recurrence = await readLatestRawSession(RECURRING_CONTENT_SESSION_ID);

		assert(first && intervening && recurrence);
		expect(BigInt(intervening.revision)).toBeGreaterThan(
			BigInt(first.revision),
		);
		expect(BigInt(recurrence.revision)).toBeGreaterThan(
			BigInt(intervening.revision),
		);
		expect(recurrence.content).toBe(contentC.content);
	});

	test("reuses a client operation revision without promoting its stale payload", async () => {
		const operationId = crypto.randomUUID();
		const older = {
			...makeClaudeInput(KEYED_RETRY_SESSION_ID, 0),
			operationId,
		};
		const newer = {
			...older,
			content: older.content.replace("Session content", "Content session"),
			operationId: crypto.randomUUID(),
		};

		expect((await callIngest(older)).status).toBe(200);
		expect((await callIngest(newer)).status).toBe(200);
		const winnerBeforeRetry = await readLatestRawSession(
			KEYED_RETRY_SESSION_ID,
		);
		expect((await callIngest(older)).status).toBe(200);
		const winnerAfterRetry = await readLatestRawSession(KEYED_RETRY_SESSION_ID);

		assert(winnerBeforeRetry && winnerAfterRetry);
		expect(winnerAfterRetry).toEqual(winnerBeforeRetry);
		expect(winnerAfterRetry.content).toBe(newer.content);
		expect(await readLatestAnalyticsRevision(KEYED_RETRY_SESSION_ID)).toBe(
			winnerAfterRetry.revision,
		);
		expect(
			await readOperationRevision(KEYED_RETRY_SESSION_ID, `op:${operationId}`),
		).toBeLessThan(BigInt(winnerAfterRetry.revision));
	});

	test("reuses an exact no-UUID legacy receipt without promoting stale content", async () => {
		const older = makeClaudeInput(LEGACY_RETRY_SESSION_ID, 0);
		const newer = {
			...older,
			content: older.content.replace("Session content", "Content session"),
		};

		expect((await callIngest(older)).status).toBe(200);
		expect((await callIngest(newer)).status).toBe(200);
		const winnerBeforeRetry = await readLatestRawSession(
			LEGACY_RETRY_SESSION_ID,
		);
		expect((await callIngest(older)).status).toBe(200);
		const winnerAfterRetry = await readLatestRawSession(
			LEGACY_RETRY_SESSION_ID,
		);

		assert(winnerBeforeRetry && winnerAfterRetry);
		expect(winnerAfterRetry).toEqual(winnerBeforeRetry);
		expect(winnerAfterRetry.content).toBe(newer.content);
		expect(await readLatestAnalyticsRevision(LEGACY_RETRY_SESSION_ID)).toBe(
			winnerAfterRetry.revision,
		);
		const latestUsageRows = await readLatestUsageRows(LEGACY_RETRY_SESSION_ID);
		expect(latestUsageRows.length).toBeGreaterThan(1);
		expect(latestUsageRows.some((row) => row.is_deleted === 1)).toBe(false);
	});

	test("stores raw before rejecting genuinely usage-bearing malformed telemetry", async () => {
		const malformedInput = makeClaudeInput(RAW_FIRST_FAILURE_SESSION_ID, 0);
		malformedInput.content += '\n{"type":"assistant","message":{"usage":';

		const response = await callIngest(malformedInput);

		expect(response.status).toBe(503);
		expect(await rawClaudeSessionExists(RAW_FIRST_FAILURE_SESSION_ID)).toBe(
			true,
		);
		expect(
			await readLatestReceiptCompleteness(RAW_FIRST_FAILURE_SESSION_ID),
		).toBe(0);
	});

	test("the operational bypass acknowledges raw without claiming extraction", async () => {
		const bypassServer = await startApiTestServer({
			USAGE_EVENT_EXTRACTION_ENABLED: "false",
		});
		try {
			const response = await callIngest(
				makeClaudeInput(EXTRACTION_BYPASS_SESSION_ID, 0),
				bypassServer.baseUrl,
			);

			expect(response.status).toBe(200);
			expect(await rawClaudeSessionExists(EXTRACTION_BYPASS_SESSION_ID)).toBe(
				true,
			);
			expect(
				await readLatestReceiptCompleteness(EXTRACTION_BYPASS_SESSION_ID),
			).toBeNull();
		} finally {
			await bypassServer.stop();
		}
	});
});

function contentShape(contentBytes: number, assistantLineCount: number) {
	return {
		assistantLineCount,
		contentBytes,
		main: { assistantLineCount, contentBytes },
		subagents: {},
		version: 1 as const,
	};
}

async function createTestUser(
	baseUrl: string,
	suffix = "owner",
): Promise<{ bearerToken: string; userId: string }> {
	const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			email: `${TEST_RUN_ID}_${suffix}@example.com`,
			name: "Session Ingest Content Test",
			password: "session-ingest-content-test-password",
		}),
	});
	expect(response.ok).toBe(true);
	const body: unknown = await response.json();
	assert(isAuthResponse(body));

	const meResponse = await fetch(`${baseUrl}/rpc/me`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${body.token}`,
			"Content-Type": "application/json",
		},
		body: "{}",
	});
	expect(meResponse.ok).toBe(true);
	const meBody: unknown = await meResponse.json();
	assert(isMeResponse(meBody));
	return { bearerToken: body.token, userId: meBody.json.id };
}

function createRevisionEnvironment(connection: postgres.Sql): {
	transactions: SessionRevisionTransactionRunner;
} {
	return {
		transactions: {
			run: (operation) =>
				connection.begin((transaction) =>
					operation((query, parameters) =>
						transaction.unsafe(query, [...parameters]),
					),
				),
		},
	};
}

async function seedLegacyContentShape(
	input: IngestSessionInput,
): Promise<void> {
	const ownership = await claimSessionIngestOwnership(
		userId,
		input.sessionId,
		userId,
	);
	assert(ownership.owned);
	const shape = getIngestContentShape(input);

	await sqlClient`
		UPDATE session_ownership
		SET
			last_content_bytes = ${shape.contentBytes},
			last_assistant_line_count = ${shape.assistantLineCount},
			last_content_shape_json = NULL
		WHERE organization_id = ${userId}
			AND session_id = ${input.sessionId}
	`;
}

/** The ownership row as a server storing `input` unslimmed left it. */
async function seedStoredContentShape(
	input: IngestSessionInput,
	filterVersion: number,
): Promise<void> {
	const ownership = await claimSessionIngestOwnership(
		userId,
		input.sessionId,
		userId,
	);
	assert(ownership.owned);
	const shape = getIngestContentShape(input);

	await sqlClient`
		UPDATE session_ownership
		SET
			last_content_bytes = ${shape.contentBytes},
			last_assistant_line_count = ${shape.assistantLineCount},
			last_content_shape_json = ${JSON.stringify(shape)},
			last_filter_version = ${filterVersion}
		WHERE organization_id = ${userId}
			AND session_id = ${input.sessionId}
	`;
}

async function readLastFilterVersion(
	sessionId: string,
): Promise<number | null> {
	const [row] = await sqlClient<Array<{ version: number | null }>>`
		SELECT last_filter_version AS version
		FROM session_ownership
		WHERE organization_id = ${userId}
			AND session_id = ${sessionId}
	`;
	return row?.version ?? null;
}

async function readLastContentHash(sessionId: string): Promise<string | null> {
	const [row] = await sqlClient<Array<{ hash: string | null }>>`
		SELECT last_content_sha256 AS hash
		FROM session_ownership
		WHERE organization_id = ${userId}
			AND session_id = ${sessionId}
	`;
	return row?.hash ?? null;
}

async function callIngest(input: IngestSessionInput, baseUrl = server.baseUrl) {
	const response = await fetch(`${baseUrl}/rpc/ingestSession`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${bearerToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ json: input }),
	});

	return { body: await response.json(), status: response.status };
}

async function readActiveUsageEventCount(sessionId: string): Promise<number> {
	const [row] = await getClickhouse().query<{ event_count: number }>({
		query: `
			WITH ${buildActiveUsageEventsCte()}
			SELECT count() AS event_count
			FROM active_usage_events
		`,
		query_params: {
			organizationId: userId,
			sessionId,
			source: "claude_code",
			userId,
		},
	});
	return row?.event_count ?? 0;
}

async function readLatestUsageRows(sessionId: string): Promise<
	Array<{
		content_sha256: string;
		event_version: string;
		is_deleted: number;
		record_kind: string;
	}>
> {
	return getClickhouse().query({
		query: `
			SELECT
				content_sha256,
				toString(event_version) AS event_version,
				is_deleted,
				record_kind
			FROM (
				SELECT *
				FROM rudel.usage_events
				WHERE organization_id = {organizationId:String}
					AND user_id = {userId:String}
					AND source = 'claude_code'
					AND session_id = {sessionId:String}
				ORDER BY event_version DESC
				LIMIT 1 BY event_id
			)
			ORDER BY record_kind, event_version
		`,
		query_params: { organizationId: userId, sessionId, userId },
	});
}

async function rawClaudeSessionExists(sessionId: string): Promise<boolean> {
	const [row] = await getClickhouse().query<{ present: number }>({
		query: `
			SELECT 1 AS present
			FROM rudel.claude_sessions
			WHERE organization_id = {organizationId:String}
				AND user_id = {userId:String}
				AND session_id = {sessionId:String}
			LIMIT 1
		`,
		query_params: { organizationId: userId, sessionId, userId },
	});
	return row?.present === 1;
}

async function readLatestRawSession(
	sessionId: string,
	table:
		| "rudel.claude_sessions"
		| "rudel.codex_sessions" = "rudel.claude_sessions",
): Promise<{ content: string; revision: string } | undefined> {
	const [row] = await getClickhouse().query<{
		content: string;
		revision: string;
	}>({
		query: `
			SELECT
				argMax(content, raw.revision) AS content,
				toString(max(raw.revision)) AS revision
			FROM ${table} AS raw
			WHERE organization_id = {organizationId:String}
				AND user_id = {userId:String}
				AND session_id = {sessionId:String}
			HAVING count() > 0
		`,
		query_params: { organizationId: userId, sessionId, userId },
	});
	return row;
}

async function readOperationRevision(
	sessionId: string,
	operationId: string,
): Promise<bigint> {
	const [row] = await sqlClient<Array<{ revision: string }>>`
		SELECT revision::text AS revision
		FROM session_ingest_revision
		WHERE organization_id = ${userId}
			AND session_id = ${sessionId}
			AND operation_id = ${operationId}
	`;
	if (!row) throw new Error("Session operation revision was not recorded");
	return BigInt(row.revision);
}

async function readLatestAnalyticsRevision(sessionId: string): Promise<string> {
	const [row] = await getClickhouse().query<{ revision: string }>({
		query: `SELECT toString(max(revision)) AS revision
		FROM rudel.session_analytics
		WHERE organization_id = {organizationId:String}
			AND user_id = {userId:String}
			AND source = 'claude_code'
			AND session_id = {sessionId:String}
		HAVING count() > 0`,
		query_params: { organizationId: userId, sessionId, userId },
	});
	if (!row) throw new Error("Session analytics revision was not recorded");
	return row.revision;
}

async function readLatestReceiptCompleteness(
	sessionId: string,
): Promise<number | null> {
	const [row] = await getClickhouse().query<{ complete: number }>({
		query: `
			SELECT argMax(receipt_is_complete, event_version) AS complete
			FROM rudel.usage_events
			WHERE organization_id = {organizationId:String}
				AND user_id = {userId:String}
				AND source = 'claude_code'
				AND session_id = {sessionId:String}
				AND record_kind = 'receipt'
			HAVING count() > 0
		`,
		query_params: { organizationId: userId, sessionId, userId },
	});
	return row?.complete ?? null;
}

function makeClaudeInput(
	sessionId: string,
	subagentAssistantLines: number,
): IngestSessionInput {
	const assistantLine = (index: number) =>
		JSON.stringify({
			message: {
				content: `Assistant content ${index}`,
				role: "assistant",
				usage: { input_tokens: 2, output_tokens: 1 },
			},
			timestamp: `2026-07-24T09:30:${String(index).padStart(2, "0")}.000Z`,
			type: "assistant",
		});

	return {
		content: [
			JSON.stringify({
				message: { content: "Session content", role: "user" },
				timestamp: "2026-07-24T09:30:00.000Z",
				type: "user",
			}),
			assistantLine(1),
		].join("\n"),
		projectPath: "/test/session-ingest-content",
		sessionId,
		source: "claude_code",
		subagents:
			subagentAssistantLines === 0
				? []
				: [
						{
							agentId: "worker",
							content: Array.from(
								{ length: subagentAssistantLines },
								(_, index) => assistantLine(index + 2),
							).join("\n"),
						},
					],
		upload_mode: "manual",
	};
}

/**
 * A screenshot tool result as Claude Code writes it: the pixels appear in the
 * tool-result image source and again in `toolUseResult.file.base64`.
 */
function makeClaudeScreenshotInput(sessionId: string): IngestSessionInput {
	const base = makeClaudeInput(sessionId, 0);
	const pixels = SCREENSHOT_PIXELS.toString("base64");
	const assistantLine = (index: number) =>
		JSON.stringify({
			message: {
				content: `Assistant content after screenshot ${index}: ${"detail ".repeat(400)}`,
				role: "assistant",
				usage: { input_tokens: 2, output_tokens: 1 },
			},
			timestamp: `2026-07-24T09:31:${String(index).padStart(2, "0")}.000Z`,
			type: "assistant",
		});
	return {
		...base,
		content: [
			base.content,
			JSON.stringify({
				message: {
					content: [
						{
							content: [
								{
									source: {
										data: pixels,
										media_type: "image/png",
										type: "base64",
									},
									type: "image",
								},
							],
							tool_use_id: "toolu_screenshot",
							type: "tool_result",
						},
					],
					role: "user",
				},
				timestamp: "2026-07-24T09:30:30.000Z",
				toolUseResult: {
					file: { base64: pixels, type: "image/png" },
					type: "image",
				},
				type: "user",
			}),
			...Array.from({ length: 4 }, (_, index) => assistantLine(index + 1)),
		].join("\n"),
	};
}

/**
 * A Codex session as released CLIs upload it: every command output three
 * times, a browser screenshot and a compaction that replays earlier items.
 */
function makeCodexSlimmableInput(sessionId: string): IngestSessionInput {
	const output = (index: number) =>
		Array.from(
			{ length: 400 },
			(_, line) => `build ${index} step ${line}: compiled module`,
		).join("\n");
	const assistant = (index: number) => ({
		payload: {
			content: [{ text: `Assistant step ${index}`, type: "output_text" }],
			role: "assistant",
			type: "message",
		},
		timestamp: `2026-07-24T10:00:${String(index * 2 + 2).padStart(2, "0")}.000Z`,
		type: "response_item",
	});
	const prompt = {
		content: [{ text: "Run the build", type: "input_text" }],
		role: "user",
		type: "message",
	};
	const lines: unknown[] = [
		{
			payload: { cwd: "/repo", id: sessionId },
			timestamp: "2026-07-24T10:00:00.000Z",
			type: "session_meta",
		},
		{
			payload: prompt,
			timestamp: "2026-07-24T10:00:01.000Z",
			type: "response_item",
		},
	];
	for (let index = 0; index < 6; index += 1) {
		lines.push(assistant(index), {
			payload: {
				item: {
					aggregated_output: output(index),
					command: ["/bin/zsh", "-lc", "bun run build"],
					exit_code: 0,
					formatted_output: output(index),
					id: `exec-${index}`,
					stdout: output(index),
					type: "CommandExecution",
				},
				type: "item_completed",
			},
			timestamp: `2026-07-24T10:00:${String(index * 2 + 3).padStart(2, "0")}.000Z`,
			type: "event_msg",
		});
	}
	lines.push(
		{
			payload: {
				item: {
					id: "browser-1",
					result: {
						_meta: {
							"codex/toolSurface": {
								screenshot: {
									url: `data:image/png;base64,${SCREENSHOT_PIXELS.toString("base64")}`,
								},
							},
						},
					},
					type: "McpToolCall",
				},
				type: "item_completed",
			},
			timestamp: "2026-07-24T10:00:20.000Z",
			type: "event_msg",
		},
		{
			payload: { message: "", replacement_history: [prompt] },
			timestamp: "2026-07-24T10:00:21.000Z",
			type: "compacted",
		},
		assistant(10),
	);
	return {
		content: lines.map((line) => JSON.stringify(line)).join("\n"),
		projectPath: "/test/session-ingest-content-codex",
		sessionId,
		source: "codex",
		upload_mode: "manual",
	};
}

function readRpcErrorCode(value: unknown): string {
	if (
		typeof value === "object" &&
		value !== null &&
		"json" in value &&
		typeof value.json === "object" &&
		value.json !== null &&
		"code" in value.json &&
		typeof value.json.code === "string"
	) {
		return value.json.code;
	}
	throw new Error("RPC response did not include json.code");
}

function isAuthResponse(value: unknown): value is { token: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"token" in value &&
		typeof value.token === "string"
	);
}

function isMeResponse(value: unknown): value is { json: { id: string } } {
	return (
		typeof value === "object" &&
		value !== null &&
		"json" in value &&
		typeof value.json === "object" &&
		value.json !== null &&
		"id" in value.json &&
		typeof value.json.id === "string"
	);
}
