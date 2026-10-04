import {
	afterAll,
	beforeAll,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import assert from "node:assert/strict";
import {
	ingestRudelClaudeSessions,
	ingestRudelCodexSessions,
} from "@rudel/ch-schema/generated";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { handleNativeSessionLineageMaintenanceRequest } from "../handlers/native-session-lineage-maintenance.js";
import { getDeveloperFeatureUsage } from "../services/developer.service.js";
import { getProjectFeatureUsage } from "../services/project.service.js";
import {
	getInteractionTimingDistribution,
	getSessionAnalytics,
	getSessionAnalyticsSummary,
	getSessionAnalyticsSummaryComparison,
	getSessionDimensionAnalysis,
} from "../services/session-analytics.service.js";
import { sessionArrivalChannel } from "../services/session-arrival-channel.js";
import {
	buildLineageEnrichedMetadataCte,
	buildSessionLineageCteDefinitions,
} from "../services/session-lineage-analytics.service.js";
import { startSessionLineageReconciliationWorker } from "../services/session-lineage-reconciliation.service.js";
import { getSessionFilterCatalog } from "../services/session-list-filters.js";
import {
	projectNativeSessionLineage,
	readNativeSessionRelationships,
	repairNativeSessionLineage,
	repairNativeSessionLineagePass,
} from "../services/session-native-lineage.service.js";
import {
	classifyBoundedNativeMetadataContentReadFailure,
	readBoundedNativeMetadataContent,
	runNativeMetadataDiscoveryPass,
} from "../services/session-native-metadata-discovery.service.js";
import {
	claimSessionIngestOwnership,
	recordSessionAgentMetadata,
	recordSessionIngestContent,
	SessionAgentMetadataConflictError,
} from "../services/session-ownership.service.js";

setDefaultTimeout(30_000);

const run = crypto.randomUUID();
const organizationId = `native-lineage-org-${run}`;
const otherOrganizationId = `native-lineage-other-org-${run}`;
const userId = `native-lineage-user-${run}`;
const otherUserId = `native-lineage-other-user-${run}`;
const clickhouse = getClickhouse();

beforeAll(async () => {
	await sqlClient`
		INSERT INTO "user" (id, name, email) VALUES
			(${userId}, 'Native Lineage User', ${`${userId}@example.test`}),
			(${otherUserId}, 'Other Native Lineage User', ${`${otherUserId}@example.test`})
	`;
	await sqlClient`
		INSERT INTO organization (id, name, slug) VALUES
			(${organizationId}, 'Native Lineage', ${organizationId}),
			(${otherOrganizationId}, 'Other Native Lineage', ${otherOrganizationId})
	`;
});

afterAll(async () => {
	for (const table of [
		"session_lineage",
		"session_analytics",
		"claude_sessions",
		"codex_sessions",
	]) {
		await clickhouse.execute({
			query: `DELETE FROM rudel.${table} WHERE organization_id IN ({organizationId:String}, {otherOrganizationId:String}) SETTINGS lightweight_deletes_sync = 3`,
			query_params: { organizationId, otherOrganizationId },
		});
	}
	await sqlClient`
		DELETE FROM organization
		WHERE id IN (${organizationId}, ${otherOrganizationId})
	`;
	await sqlClient`
		DELETE FROM "user"
		WHERE id IN (${userId}, ${otherUserId})
	`;
});

describe("native Codex lineage", () => {
	test("keeps an incomplete child top-level, then groups it without losing usage", async () => {
		const parentId = `child-first-parent-${run}`;
		const childId = `child-first-child-${run}`;
		await reserve(childId);
		await recordSessionAgentMetadata(organizationId, childId, userId, {
			nativeParentSessionId: parentId,
			nativeSubagentModel: "gpt-5.6-sol",
			nativeSubagentPath: "/root/review",
			source: "codex",
		});
		await recordContent(childId, false);

		expect(await project(childId)).toEqual([]);
		expect(await readVisibility(parentId, childId)).toEqual([
			{ childCount: 0, sessionId: childId, topLevel: 1 },
			{ childCount: 0, sessionId: parentId, topLevel: 1 },
		]);

		await reserve(parentId);
		await recordSessionAgentMetadata(organizationId, parentId, userId, {
			source: "codex",
		});
		expect(await project(childId)).toEqual([childId]);
		expect(await readCurrentLineage(childId)).toMatchObject({ countable: 0 });

		await recordContent(childId, true);
		await recordContent(parentId, true);
		expect(await project(parentId)).toEqual([childId]);
		expect(await readCurrentLineage(childId)).toMatchObject({
			childModel: "gpt-5.6-sol",
			countable: 1,
			parentSessionId: parentId,
		});
		expect(await readVisibility(parentId, childId)).toEqual([
			{ childCount: 0, sessionId: childId, topLevel: 0 },
			{ childCount: 1, sessionId: parentId, topLevel: 1 },
		]);
		expect(await readEnrichedUsageTotal(parentId, childId)).toBe(30);
		expect(
			await readNativeSessionRelationships({
				organizationId,
				sessionId: parentId,
				userId,
			}),
		).toEqual({
			children: [
				{
					agentPath: "/root/review",
					model: "gpt-5.6-sol",
					sessionId: childId,
				},
			],
			parent: null,
		});

		// Rolling analytics windows need a runtime-relative fixture so this test
		// does not expire as its fixed historical transcript dates age.
		const analyticsSessionDate = new Date(Date.now() - 5 * 60 * 1000);
		await insertAnalytics(parentId, childId, analyticsSessionDate);
		const analyticsDate = analyticsSessionDate.toISOString().slice(0, 10);
		const dateRange = {
			end_date: analyticsDate,
			start_date: analyticsDate,
		};
		expect(
			(await getSessionFilterCatalog(organizationId, dateRange)).sessionCount,
		).toBe(1);
		expect(
			(
				await getSessionAnalytics(organizationId, {
					...dateRange,
					limit: 1,
					offset: 0,
				})
			).map((session) => session.session_id),
		).toEqual([parentId]);
		const summary = await getSessionAnalyticsSummary(organizationId, {
			days: 1,
		});
		expect(summary.total_sessions).toBe(1);
		expect(summary.subagents_adoption_rate).toBe(100);
		const comparison = await getSessionAnalyticsSummaryComparison(
			organizationId,
			{ days: 1 },
		);
		expect(comparison.current.total_sessions).toBe(1);
		expect(comparison.current.subagents_adoption_rate).toBe(100);
		const sessionDimension = await getSessionDimensionAnalysis(organizationId, {
			days: 1,
			dimension: "model_used",
			metric: "session_count",
		});
		expect(sessionDimension).toEqual([
			{ dimension_value: "gpt-5.6-sol", metric_value: 1 },
		]);
		const tokenDimension = await getSessionDimensionAnalysis(organizationId, {
			days: 1,
			dimension: "model_used",
			metric: "total_tokens",
		});
		expect(tokenDimension).toEqual([
			{ dimension_value: "gpt-5.6-sol", metric_value: 5 },
		]);
		expect(
			(await getDeveloperFeatureUsage(organizationId, userId, 1))
				.subagents_adoption_rate,
		).toBe(100);
		expect(
			(await getProjectFeatureUsage(organizationId, "/workspace/opaline", 1))
				.subagents_adoption_rate,
		).toBe(100);
		expect(
			await getInteractionTimingDistribution(organizationId, {
				days: 1,
				project_path: "/workspace/opaline",
				user_id: userId,
			}),
		).toHaveLength(3);
	});

	test("projects parent-first and repairs a missed completion exactly once", async () => {
		const parentId = `parent-first-parent-${run}`;
		const childId = `parent-first-child-${run}`;
		await reserve(parentId);
		await recordSessionAgentMetadata(organizationId, parentId, userId, {
			source: "codex",
		});
		await recordContent(parentId, true);
		await reserve(childId);
		await recordSessionAgentMetadata(organizationId, childId, userId, {
			nativeParentSessionId: parentId,
			nativeSubagentModel: "gpt-5.6-sol",
			source: "codex",
		});
		await recordContent(childId, true);

		expect(await project(childId)).toEqual([childId]);
		expect(await readCurrentLineage(childId)).toMatchObject({ countable: 1 });
		await sqlClient`
			UPDATE session_ownership
			SET native_lineage_projected_at = NULL,
				native_lineage_projected_signature = NULL
			WHERE organization_id = ${organizationId}
				AND session_id = ${childId}
		`;
		const notifications: string[] = [];
		const subscription = await sqlClient.listen(
			sessionArrivalChannel(organizationId),
			(payload) => notifications.push(payload),
		);
		let worker: ReturnType<
			typeof startSessionLineageReconciliationWorker
		> | null = null;
		const previousLineageEnabled = process.env.SESSION_LINEAGE_ENABLED;
		try {
			expect(
				await repairNativeSessionLineagePass(10, {
					deadlineAt: 0,
					now: () => 0,
				}),
			).toEqual({ hasMore: true, repaired: 0 });
			expect(
				await repairNativeSessionLineagePass(10, {
					deadlineAt: 1,
					now: () => 0,
				}),
			).toEqual({ hasMore: false, repaired: 1 });
			expect(await repairNativeSessionLineage(10)).toBe(0);
			await Bun.sleep(10);
			expect(notifications).toEqual(["lineage-refresh"]);

			await sqlClient`
				UPDATE session_ownership
				SET native_lineage_projected_at = NULL,
					native_lineage_projected_signature = NULL
				WHERE organization_id = ${organizationId}
					AND session_id = ${childId}
			`;
			process.env.SESSION_LINEAGE_ENABLED = "false";
			worker = startSessionLineageReconciliationWorker({
				batchSize: 10,
				initialDelayMs: 1,
				intervalMs: 60_000,
			});
			for (
				let attempt = 0;
				attempt < 50 && notifications.length < 2;
				attempt += 1
			) {
				await Bun.sleep(10);
			}
			expect(notifications).toEqual(["lineage-refresh", "lineage-refresh"]);
			expect(await repairNativeSessionLineage(10)).toBe(0);
		} finally {
			await worker?.stop();
			if (previousLineageEnabled === undefined) {
				delete process.env.SESSION_LINEAGE_ENABLED;
			} else {
				process.env.SESSION_LINEAGE_ENABLED = previousLineageEnabled;
			}
			await subscription.unlisten();
		}
	});

	test("coalesces first arrivals with lineage refreshes", async () => {
		const parentId = `coalesced-parent-${run}`;
		const childId = `coalesced-child-${run}`;
		await reserve(parentId);
		await recordSessionAgentMetadata(organizationId, parentId, userId, {
			source: "codex",
		});
		await recordContent(parentId, false);
		await reserve(childId);
		await recordSessionAgentMetadata(organizationId, childId, userId, {
			nativeParentSessionId: parentId,
			nativeSubagentModel: "gpt-5.6-sol",
			source: "codex",
		});
		await recordContent(childId, true);

		const notifications: string[] = [];
		const subscription = await sqlClient.listen(
			sessionArrivalChannel(organizationId),
			(payload) => notifications.push(payload),
		);
		try {
			expect(
				await projectNativeSessionLineage({
					notifyPendingArrival: true,
					organizationId,
					sessionId: childId,
					userId,
				}),
			).toEqual([childId]);
			await waitForNotifications(notifications, 1);
			expect(notifications).toEqual(["lineage-refresh"]);

			expect(
				await projectNativeSessionLineage({
					notifyPendingArrival: true,
					organizationId,
					sessionId: childId,
					userId,
				}),
			).toEqual([]);
			await Bun.sleep(25);
			expect(notifications).toHaveLength(1);

			const waitingParentId = `coalesced-waiting-parent-${run}`;
			const waitingChildId = `coalesced-waiting-child-${run}`;
			await reserve(waitingChildId);
			await recordSessionAgentMetadata(organizationId, waitingChildId, userId, {
				nativeParentSessionId: waitingParentId,
				source: "codex",
			});
			await recordContent(waitingChildId, true);
			expect(
				await projectNativeSessionLineage({
					notifyPendingArrival: true,
					organizationId,
					sessionId: waitingChildId,
					userId,
				}),
			).toEqual([]);
			await waitForNotifications(notifications, 2);
			expect(notifications).toEqual(["lineage-refresh", "lineage-refresh"]);

			await reserve(waitingParentId);
			await recordSessionAgentMetadata(
				organizationId,
				waitingParentId,
				userId,
				{ source: "codex" },
			);
			await recordContent(waitingParentId, true);
			expect(
				await projectNativeSessionLineage({
					notifyPendingArrival: true,
					organizationId,
					sessionId: waitingParentId,
					userId,
				}),
			).toEqual([waitingChildId]);
			await waitForNotifications(notifications, 3);
			expect(notifications).toEqual(["lineage-refresh", "lineage-refresh", ""]);
		} finally {
			await subscription.unlisten();
		}
	});

	test("discovers historical native metadata in bounded owner-scoped passes", async () => {
		const childId = `discovery-01-child-${run}`;
		const crossOwnerId = `discovery-02-cross-owner-${run}`;
		const missingId = `discovery-03-missing-${run}`;
		const parentId = `discovery-04-parent-${run}`;
		const claudeId = `discovery-05-claude-${run}`;
		const candidateIds = [childId, crossOwnerId, missingId, parentId, claudeId];
		for (const sessionId of candidateIds) await reserve(sessionId);
		await sqlClient`
			UPDATE session_ownership
			SET created_at = '2100-01-01T00:00:00.000Z'::timestamptz
			WHERE organization_id = ${organizationId}
				AND session_id IN ${sqlClient(candidateIds)}
		`;
		await ingestRudelCodexSessions(clickhouse, [
			buildRawSession(childId, historicalNativeTranscript(childId, parentId)),
			buildRawSession(parentId, rootTranscript(parentId)),
			buildRawSession(crossOwnerId, rootTranscript(crossOwnerId), otherUserId),
		]);
		await ingestRudelClaudeSessions(clickhouse, [
			buildClaudeRawSession(claudeId),
		]);

		expect(
			await runNativeMetadataDiscoveryPass(2, {
				deadlineAt: 0,
				now: () => 0,
			}),
		).toEqual({
			discovered: 0,
			hasMore: true,
			missing: 0,
			nativeChildren: 0,
			projected: 0,
			readFailed: 0,
			rejected: 0,
			scanned: 0,
			skipped: 0,
		});
		expect(await readDiscoveryState(candidateIds)).toEqual(
			[...candidateIds].sort().map((sessionId) => ({
				hasRaw: false,
				hasUsageReceipt: false,
				scanned: false,
				scanOutcome: null,
				sessionId,
				source: null,
			})),
		);

		expect(await runNativeMetadataDiscoveryPass(2)).toEqual({
			discovered: 1,
			hasMore: true,
			missing: 1,
			nativeChildren: 1,
			projected: 0,
			readFailed: 0,
			rejected: 0,
			scanned: 2,
			skipped: 0,
		});
		expect(await readCurrentLineage(childId)).toBeUndefined();

		const previousBatchSize = process.env.SESSION_LINEAGE_RECONCILE_BATCH_SIZE;
		const previousCronSecret = process.env.CRON_SECRET;
		const cronSecret = "native-lineage-test-secret";
		process.env.SESSION_LINEAGE_RECONCILE_BATCH_SIZE = "2";
		process.env.CRON_SECRET = cronSecret;
		let maintenanceResponse: Response;
		try {
			maintenanceResponse = await handleNativeSessionLineageMaintenanceRequest(
				new Request("https://example.test/api/cron/native-lineage", {
					headers: { Authorization: `Bearer ${cronSecret}` },
				}),
			);
		} finally {
			if (previousBatchSize === undefined) {
				delete process.env.SESSION_LINEAGE_RECONCILE_BATCH_SIZE;
			} else {
				process.env.SESSION_LINEAGE_RECONCILE_BATCH_SIZE = previousBatchSize;
			}
			if (previousCronSecret === undefined) {
				delete process.env.CRON_SECRET;
			} else {
				process.env.CRON_SECRET = previousCronSecret;
			}
		}
		expect(maintenanceResponse.status).toBe(200);
		expect(await maintenanceResponse.json()).toEqual({
			ok: true,
			nativeSessionLineage: {
				discovered: 1,
				hasMore: false,
				iterations: 2,
				missing: 2,
				nativeChildren: 0,
				projected: 1,
				readFailed: 0,
				repaired: 0,
				rejected: 0,
				scanned: 3,
				skipped: 0,
				stopReason: "complete",
			},
		});
		expect(await readCurrentLineage(childId)).toMatchObject({
			childModel: "gpt-5.6-sol",
			countable: 1,
			parentSessionId: parentId,
		});
		expect(await readEnrichedUsageTotal(parentId, childId)).toBe(30);
		expect(await readDiscoveryState(candidateIds)).toEqual([
			{
				hasRaw: true,
				hasUsageReceipt: false,
				scanned: true,
				scanOutcome: "codex",
				sessionId: childId,
				source: "codex",
			},
			{
				hasRaw: false,
				hasUsageReceipt: false,
				scanned: true,
				scanOutcome: "missing",
				sessionId: crossOwnerId,
				source: null,
			},
			{
				hasRaw: false,
				hasUsageReceipt: false,
				scanned: true,
				scanOutcome: "missing",
				sessionId: missingId,
				source: null,
			},
			{
				hasRaw: true,
				hasUsageReceipt: false,
				scanned: true,
				scanOutcome: "codex",
				sessionId: parentId,
				source: "codex",
			},
			{
				hasRaw: false,
				hasUsageReceipt: false,
				scanned: true,
				scanOutcome: "missing",
				sessionId: claudeId,
				source: null,
			},
		]);
		expect(await runNativeMetadataDiscoveryPass(5)).toEqual({
			discovered: 0,
			hasMore: false,
			missing: 0,
			nativeChildren: 0,
			projected: 0,
			readFailed: 0,
			rejected: 0,
			scanned: 0,
			skipped: 0,
		});
		await deleteDiscoveryRaw(candidateIds);
	});

	test("marks rejected historical metadata without starving older rows", async () => {
		const conflictingParentId = `rejected-01-parent-${run}`;
		const rejectedChildId = `rejected-02-child-${run}`;
		const oversizedId = `rejected-03-oversized-${run}`;
		const followingRootId = `rejected-04-root-${run}`;
		await reserve(conflictingParentId, organizationId, otherUserId);
		await recordSessionAgentMetadata(
			organizationId,
			conflictingParentId,
			otherUserId,
			{ source: "codex" },
		);
		await reserve(rejectedChildId);
		await reserve(oversizedId);
		await reserve(followingRootId);
		await sqlClient`
			UPDATE session_ownership
			SET created_at = '2099-12-31T00:00:00.000Z'::timestamptz
			WHERE organization_id = ${organizationId}
				AND session_id IN (${rejectedChildId}, ${oversizedId}, ${followingRootId})
		`;
		await ingestRudelCodexSessions(clickhouse, [
			buildRawSession(
				rejectedChildId,
				nativeTranscript(rejectedChildId, conflictingParentId),
			),
			buildRawSession(oversizedId, oversizedHeaderTranscript(oversizedId)),
			buildRawSession(followingRootId, rootTranscript(followingRootId)),
		]);

		expect(await runNativeMetadataDiscoveryPass(3)).toEqual({
			discovered: 1,
			hasMore: false,
			missing: 0,
			nativeChildren: 0,
			projected: 0,
			readFailed: 0,
			rejected: 1,
			scanned: 3,
			skipped: 1,
		});
		expect(
			await readDiscoveryState([rejectedChildId, oversizedId, followingRootId]),
		).toEqual([
			{
				hasRaw: false,
				hasUsageReceipt: false,
				scanned: true,
				scanOutcome: "rejected",
				sessionId: rejectedChildId,
				source: null,
			},
			{
				hasRaw: false,
				hasUsageReceipt: false,
				scanned: true,
				scanOutcome: "oversized-header",
				sessionId: oversizedId,
				source: null,
			},
			{
				hasRaw: true,
				hasUsageReceipt: false,
				scanned: true,
				scanOutcome: "codex",
				sessionId: followingRootId,
				source: "codex",
			},
		]);
		await deleteDiscoveryRaw([rejectedChildId, oversizedId, followingRootId]);
	});

	test("reads a bounded winning revision from wide physical granules", async () => {
		const rawTable = `rudel.native_metadata_content_read_${run.replaceAll("-", "")}`;
		const sessionDate = "2026-09-18T12:00:00.000Z";
		const locator = (sessionId: string, rawRevision: string) => ({
			firstIngestedAt: sessionDate,
			latestIngestedAt: sessionDate,
			organizationId,
			projectPath: "/workspace/opaline",
			rawRevision,
			sessionDate,
			sessionId,
			userId,
		});
		try {
			await clickhouse.execute({
				query: `
					CREATE TABLE ${rawTable} (
						organization_id String,
						session_date DateTime64(3, 'UTC'),
						session_id String,
						user_id String,
						project_path String,
						content String,
						revision UInt64,
						ingested_at DateTime64(3, 'UTC')
					)
					ENGINE = MergeTree
					PARTITION BY toYYYYMM(toDate(session_date))
					ORDER BY (organization_id, session_date, session_id)
					SETTINGS index_granularity = 8192, index_granularity_bytes = 0
				`,
			});
			await clickhouse.execute({
				clickhouse_settings: {
					max_memory_usage: "5000000000",
					max_threads: 1,
				},
				query: `
					INSERT INTO ${rawTable}
					SELECT
						{organizationId:String},
						parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC'),
						concat('max-', toString(number)),
						{userId:String},
						'/workspace/opaline',
						concat(
							'{"type":"session_meta","payload":{"id":"',
							concat('max-', toString(number)),
							'","thread_source":"user"}}\\n',
							'{"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}\\n',
							repeat(repeat('x', 1000000), 134),
							repeat('x', 216000)
						),
						toUInt64(100 + number),
						parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC')
					FROM numbers(4)
				`,
				query_params: { organizationId, sessionDate, userId },
			});
			await clickhouse.execute({ query: `OPTIMIZE TABLE ${rawTable} FINAL` });

			await expect(
				clickhouse.query({
					clickhouse_settings: {
						max_block_size: "1",
						max_memory_usage: String(256 * 1024 * 1024),
						max_threads: 1,
					},
					query: `
						SELECT
							session_id,
							argMax(substring(content, 1, 65536), ingested_at) AS header
						FROM ${rawTable}
						PREWHERE organization_id = {organizationId:String}
							AND user_id = {userId:String}
						GROUP BY organization_id, session_id
					`,
					query_params: { organizationId, userId },
				}),
			).rejects.toMatchObject({ code: "241", type: "MEMORY_LIMIT_EXCEEDED" });

			const [size] = await clickhouse.query<{ contentBytes: number }>({
				clickhouse_settings: {
					max_bytes_to_read: String(1024 * 1024),
					max_memory_usage: String(64 * 1024 * 1024),
					max_threads: 1,
				},
				query: `
					SELECT content.size AS contentBytes
					FROM ${rawTable}
					PREWHERE organization_id = {organizationId:String}
						AND session_date = parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC')
						AND session_id = 'max-3'
						AND user_id = {userId:String}
						AND revision = 103
					LIMIT 1
				`,
				query_params: { organizationId, sessionDate, userId },
			});
			expect(Number(size?.contentBytes)).toBeLessThanOrEqual(128 * 1024 * 1024);

			const fallback = await readBoundedNativeMetadataContent(
				clickhouse,
				rawTable,
				locator("max-3", "103"),
			);
			expect(fallback).toMatchObject({
				content: {
					headerComplete: 1,
					model: "gpt-5.6-sol",
					modelSearchComplete: 1,
				},
				fallbackAttempted: true,
			});

			await clickhouse.execute({ query: `TRUNCATE TABLE ${rawTable}` });
			await clickhouse.execute({
				clickhouse_settings: {
					max_memory_usage: "3000000000",
					max_threads: 1,
				},
				query: `
					INSERT INTO ${rawTable}
					SELECT
						{organizationId:String},
						parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC'),
						if(number = 0, 'target-a-neighbor', 'target-z-child'),
						{userId:String},
						'/workspace/opaline',
						concat(
							'{"type":"session_meta","payload":{"id":"',
							if(number = 0, 'target-a-neighbor', 'target-z-child'),
							'","thread_source":"user"}}\\n',
							'{"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}\\n',
							repeat(repeat('x', 1000000), if(number = 0, 120, 23))
						),
						toUInt64(100 + number),
						parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC')
					FROM numbers(2)
				`,
				query_params: { organizationId, sessionDate, userId },
			});
			await clickhouse.execute({ query: `OPTIMIZE TABLE ${rawTable} FINAL` });
			const targetSized = await readBoundedNativeMetadataContent(
				clickhouse,
				rawTable,
				locator("target-z-child", "101"),
			);
			expect(targetSized).toMatchObject({
				content: { model: "gpt-5.6-sol" },
				fallbackAttempted: false,
			});
		} finally {
			await clickhouse.execute({ query: `DROP TABLE IF EXISTS ${rawTable}` });
		}
	});

	test("surfaces an unresolved wide row and continues to the next candidate", async () => {
		const failedId = `content-read-01-failed-${run}`;
		const followingId = `content-read-02-following-${run}`;
		await reserve(failedId);
		await reserve(followingId);
		await sqlClient`
			UPDATE session_ownership
			SET created_at = '2099-12-30T00:00:00.000Z'::timestamptz
			WHERE organization_id = ${organizationId}
				AND session_id IN (${failedId}, ${followingId})
		`;
		// The failed row is wider than the largest accepted session (256 MiB).
		// Only the raw row matters here; the analytics views cannot fit such a
		// row in local ClickHouse's memory, so their errors are ignored.
		await clickhouse.execute({
			clickhouse_settings: {
				materialized_views_ignore_errors: 1,
				max_memory_usage: "3000000000",
				max_threads: 1,
			},
			query: `
				INSERT INTO rudel.codex_sessions (
					session_date,
					last_interaction_date,
					session_id,
					organization_id,
					project_path,
					content,
					filter_version,
					revision,
					ingested_at,
					user_id,
					git_branch,
					git_sha,
					tag
				)
				SELECT
					parseDateTime64BestEffort('2026-09-18T13:00:00.000Z', 3, 'UTC'),
					parseDateTime64BestEffort('2026-09-18T13:00:00.000Z', 3, 'UTC'),
					if(number = 0, {failedId:String}, {followingId:String}),
					{organizationId:String},
					'/workspace/opaline',
					concat(
						'{"type":"session_meta","payload":{"id":"',
						if(number = 0, {failedId:String}, {followingId:String}),
						'","originator":"codex_sdk_ts","thread_source":"user"}}\\n',
						if(number = 0, repeat(repeat('x', 1000000), 320), '')
					),
					1,
					toUInt64(100 + number),
					parseDateTime64BestEffort('2026-09-18T13:00:00.000Z', 3, 'UTC'),
					{userId:String},
					NULL,
					NULL,
					NULL
				FROM numbers(2)
			`,
			query_params: { failedId, followingId, organizationId, userId },
		});

		expect(await runNativeMetadataDiscoveryPass(2)).toEqual({
			discovered: 1,
			hasMore: false,
			missing: 0,
			nativeChildren: 0,
			projected: 0,
			readFailed: 1,
			rejected: 0,
			scanned: 2,
			skipped: 1,
		});
		expect(await readDiscoveryState([failedId, followingId])).toEqual([
			{
				hasRaw: false,
				hasUsageReceipt: false,
				scanned: true,
				scanOutcome: "content-read-failed",
				sessionId: failedId,
				source: null,
			},
			{
				hasRaw: true,
				hasUsageReceipt: false,
				scanned: true,
				scanOutcome: "codex",
				sessionId: followingId,
				source: "codex",
			},
		]);
		await deleteDiscoveryRaw([failedId, followingId]);
	});

	test("classifies a timed-out bounded content read for persisted failure handling", () => {
		const timeout = Object.assign(new Error("bounded test timeout"), {
			code: "159",
			type: "TIMEOUT_EXCEEDED",
		});

		expect(classifyBoundedNativeMetadataContentReadFailure(timeout)).toEqual({
			code: "159",
			type: "TIMEOUT_EXCEEDED",
		});
		expect(
			classifyBoundedNativeMetadataContentReadFailure(new Error("unbounded")),
		).toBeUndefined();
	});

	test("guards cycles and ownership boundaries", async () => {
		const cycleA = `cycle-a-${run}`;
		const cycleB = `cycle-b-${run}`;
		await reserve(cycleA);
		await reserve(cycleB);
		await recordSessionAgentMetadata(organizationId, cycleA, userId, {
			nativeParentSessionId: cycleB,
			source: "codex",
		});
		await expect(
			recordSessionAgentMetadata(organizationId, cycleB, userId, {
				nativeParentSessionId: cycleA,
				source: "codex",
			}),
		).rejects.toBeInstanceOf(SessionAgentMetadataConflictError);

		const foreignParent = `foreign-parent-${run}`;
		const wrongOwnerChild = `wrong-owner-child-${run}`;
		await reserve(foreignParent, organizationId, otherUserId);
		await recordSessionAgentMetadata(
			organizationId,
			foreignParent,
			otherUserId,
			{ source: "codex" },
		);
		await reserve(wrongOwnerChild);
		await expect(
			recordSessionAgentMetadata(organizationId, wrongOwnerChild, userId, {
				nativeParentSessionId: foreignParent,
				source: "codex",
			}),
		).rejects.toBeInstanceOf(SessionAgentMetadataConflictError);

		const crossOrgParent = `cross-org-parent-${run}`;
		const crossOrgChild = `cross-org-child-${run}`;
		await reserve(crossOrgParent, otherOrganizationId, otherUserId);
		await recordSessionAgentMetadata(
			otherOrganizationId,
			crossOrgParent,
			otherUserId,
			{ source: "codex" },
		);
		await recordContent(crossOrgParent, true, otherOrganizationId);
		await reserve(crossOrgChild);
		await recordSessionAgentMetadata(organizationId, crossOrgChild, userId, {
			nativeParentSessionId: crossOrgParent,
			source: "codex",
		});
		await recordContent(crossOrgChild, true);
		expect(await project(crossOrgChild)).toEqual([]);
	});

	test("returns exact projected IDs and makes raw-only cutover sessions displayable once", async () => {
		const middle = `middle-${run}`;
		const grandchild = `grandchild-${run}`;
		await reserve(middle);
		await recordSessionAgentMetadata(organizationId, middle, userId, {
			nativeParentSessionId: `missing-parent-${run}`,
			source: "codex",
		});
		await recordContent(middle, true);
		await reserve(grandchild);
		await recordSessionAgentMetadata(organizationId, grandchild, userId, {
			nativeParentSessionId: middle,
			source: "codex",
		});
		await recordContent(grandchild, true);
		expect(await project(middle)).toEqual([grandchild]);

		const parentId = `backfill-parent-${run}`;
		const childId = `backfill-child-${run}`;
		const unrelatedClaudeId = `backfill-claude-${run}`;
		await reserve(parentId);
		await reserve(childId);
		await reserve(unrelatedClaudeId);
		await ingestRudelCodexSessions(clickhouse, [
			buildRawSession(parentId, rootTranscript(parentId)),
			buildRawSession(childId, nativeTranscript(childId, parentId)),
		]);
		await ingestRudelClaudeSessions(clickhouse, [
			buildClaudeRawSession(unrelatedClaudeId),
		]);
		const { reconcileSessionLineageOnce } = await import(
			"../services/session-lineage-reconciliation.service.js"
		);
		const previousFingerprint = process.env.SESSION_LINEAGE_FINGERPRINT_KEY;
		process.env.SESSION_LINEAGE_FINGERPRINT_KEY =
			"native-lineage-integration-fingerprint-key";
		try {
			const result = await reconcileSessionLineageOnce(25);
			expect(result.edges).toBeGreaterThanOrEqual(1);
			expect(await readCurrentLineage(childId)).toMatchObject({
				countable: 1,
				parentSessionId: parentId,
			});
			expect(
				await readNativeSessionRelationships({
					organizationId,
					sessionId: parentId,
					userId,
				}),
			).toEqual({
				children: [
					{
						agentPath: "/root/backfill",
						model: "gpt-5.6-sol",
						sessionId: childId,
					},
				],
				parent: null,
			});
			const ownership = await readOwnershipState(parentId, childId);
			expect(ownership).toEqual([
				{
					hasRaw: true,
					hasUsageReceipt: false,
					sessionId: childId,
				},
				{
					hasRaw: true,
					hasUsageReceipt: false,
					sessionId: parentId,
				},
			]);
			const second = await reconcileSessionLineageOnce(25);
			expect(second.edges).toBe(0);
			expect(second.remainingLag).toBe(0);
		} finally {
			if (previousFingerprint === undefined) {
				delete process.env.SESSION_LINEAGE_FINGERPRINT_KEY;
			} else {
				process.env.SESSION_LINEAGE_FINGERPRINT_KEY = previousFingerprint;
			}
		}
	});

	test("enriches an accepted fallback model once without usage receipts", async () => {
		const parentId = `model-parent-${run}`;
		const childId = `model-child-${run}`;
		await reserve(parentId);
		await recordSessionAgentMetadata(organizationId, parentId, userId, {
			source: "codex",
		});
		await recordContent(parentId, false);
		await reserve(childId);
		await recordSessionAgentMetadata(organizationId, childId, userId, {
			nativeParentSessionId: parentId,
			nativeSubagentModel: "codex",
			nativeSubagentPath: "/root/model",
			source: "codex",
		});
		await recordContent(childId, false);

		const notifications: string[] = [];
		const subscription = await sqlClient.listen(
			sessionArrivalChannel(organizationId),
			(payload) => notifications.push(payload),
		);
		try {
			expect(await project(childId)).toEqual([childId]);
			await waitForNotifications(notifications, 1);
			expect(notifications).toEqual(["lineage-refresh"]);

			await recordSessionAgentMetadata(organizationId, childId, userId, {
				nativeParentSessionId: parentId,
				nativeSubagentModel: "gpt-5.6-sol",
				nativeSubagentPath: "/root/model",
				source: "codex",
			});
			expect(await project(childId)).toEqual([childId]);
			await waitForNotifications(notifications, 2);
			expect(notifications).toEqual(["lineage-refresh", "lineage-refresh"]);
			expect(await project(childId)).toEqual([]);
			await Bun.sleep(25);
			expect(notifications).toHaveLength(2);
			await recordContent(childId, false);
			expect(await project(childId)).toEqual([childId]);
			await Bun.sleep(25);
			expect(notifications).toHaveLength(2);
			expect(await readCurrentLineage(childId)).toMatchObject({
				childModel: "gpt-5.6-sol",
				countable: 1,
			});
			const ownership = await readOwnershipState(parentId, childId);
			expect(ownership.every((row) => !row.hasUsageReceipt)).toBe(true);
		} finally {
			await subscription.unlisten();
		}
	});

	test("does not let older historical observations overwrite live ownership", async () => {
		const sessionId = `historical-seed-guard-${run}`;
		await reserve(sessionId);
		await recordSessionAgentMetadata(organizationId, sessionId, userId, {
			source: "codex",
		});
		await recordContent(sessionId, true);
		const before = await readOwnershipTimestamps(sessionId);
		assert(before);

		await recordSessionAgentMetadata(organizationId, sessionId, userId, {
			rawIngestedAt: "2026-09-18T09:00:00.000Z",
			rawSessionDate: "2026-09-18T08:00:00.000Z",
			source: "codex",
		});
		expect(await readOwnershipTimestamps(sessionId)).toEqual(before);
	});
});

async function reserve(
	sessionId: string,
	orgId = organizationId,
	ownerId = userId,
): Promise<void> {
	const claim = await claimSessionIngestOwnership(orgId, sessionId, ownerId);
	assert(claim.owned);
}

async function recordContent(
	sessionId: string,
	withReceipt: boolean,
	orgId = organizationId,
): Promise<void> {
	await recordSessionIngestContent(
		orgId,
		sessionId,
		"a".repeat(64),
		{
			version: 1,
			assistantLineCount: 1,
			contentBytes: 10,
			main: { assistantLineCount: 1, contentBytes: 10 },
			subagents: {},
		},
		1,
		new Date("2026-09-18T10:00:00.000Z"),
		new Date(),
		"1",
		withReceipt
			? {
					checksum: "b".repeat(64),
					diagnostics: "{}",
					eventCount: 1,
					extractionVersion: 1,
					eventIdentityVersion: 1,
					generation: "0",
					modelRateCardVersion: "test",
				}
			: undefined,
		{ deferArrivalNotification: true },
	);
}

function project(sessionId: string): Promise<readonly string[]> {
	return projectNativeSessionLineage({ organizationId, sessionId, userId });
}

async function readCurrentLineage(childSessionId: string) {
	const rows = await clickhouse.query<{
		childModel: string;
		countable: number;
		parentSessionId: string;
	}>({
		query: `
			SELECT
				argMax(child_model, replacement_version) AS childModel,
				argMax(countable, replacement_version) AS countable,
				argMax(parent_session_id, replacement_version) AS parentSessionId
			FROM rudel.session_lineage
			WHERE organization_id = {organizationId:String}
				AND child_session_id = {childSessionId:String}
			GROUP BY organization_id, user_id, child_source, child_session_id
		`,
		query_params: { childSessionId, organizationId },
	});
	return rows[0];
}

async function readVisibility(parentId: string, childId: string) {
	return clickhouse.query<{
		childCount: number;
		sessionId: string;
		topLevel: number;
	}>({
		query: `
			WITH ${buildSessionLineageCteDefinitions(false)},
			base AS (
				SELECT {organizationId:String} AS organization_id,
					{userId:String} AS user_id, 'codex' AS source,
					arrayJoin([{parentId:String}, {childId:String}]) AS session_id
			),
			${buildLineageEnrichedMetadataCte({ baseRelation: "base", outputRelation: "enriched" })}
			SELECT session_id AS sessionId,
				is_top_level_session AS topLevel,
				length(native_child_sessions) AS childCount
			FROM enriched ORDER BY session_id
		`,
		query_params: {
			childId,
			organizationId,
			orgId: organizationId,
			parentId,
			userId,
		},
	});
}

async function readEnrichedUsageTotal(parentId: string, childId: string) {
	const [row] = await clickhouse.query<{ total: number }>({
		query: `
			WITH ${buildSessionLineageCteDefinitions(false)},
			base AS (
				SELECT {organizationId:String} AS organization_id,
					{userId:String} AS user_id, 'codex' AS source,
					arrayJoin([{parentId:String}, {childId:String}]) AS session_id,
					if(session_id = {parentId:String}, 10, 20) AS tokens
			),
			${buildLineageEnrichedMetadataCte({ baseRelation: "base", outputRelation: "enriched" })}
			SELECT sum(tokens) AS total FROM enriched
		`,
		query_params: {
			childId,
			organizationId,
			orgId: organizationId,
			parentId,
			userId,
		},
	});
	return row?.total ?? 0;
}

async function readOwnershipState(parentId: string, childId: string) {
	const rows = await sqlClient<
		Array<{ hasRaw: boolean; hasUsageReceipt: boolean; sessionId: string }>
	>`
		SELECT
			session_id AS "sessionId",
			last_ingested_at IS NOT NULL AS "hasRaw",
			last_usage_completed_at IS NOT NULL AS "hasUsageReceipt"
		FROM session_ownership
		WHERE organization_id = ${organizationId}
			AND session_id IN (${parentId}, ${childId})
		ORDER BY session_id
	`;
	return [...rows];
}

async function readOwnershipTimestamps(sessionId: string) {
	const [row] = await sqlClient<
		Array<{
			ingestedAt: string | null;
			sessionDate: string | null;
			usageCompletedAt: string | null;
		}>
	>`
		SELECT
			last_ingested_at::text AS "ingestedAt",
			last_session_date::text AS "sessionDate",
			last_usage_completed_at::text AS "usageCompletedAt"
		FROM session_ownership
		WHERE organization_id = ${organizationId}
			AND session_id = ${sessionId}
	`;
	return row;
}

async function readDiscoveryState(sessionIds: readonly string[]) {
	const rows = await sqlClient<
		Array<{
			hasRaw: boolean;
			hasUsageReceipt: boolean;
			scanned: boolean;
			scanOutcome: string | null;
			sessionId: string;
			source: string | null;
		}>
	>`
		SELECT
			session_id AS "sessionId",
			agent_source AS source,
			agent_metadata_scanned_at IS NOT NULL AS scanned,
			agent_metadata_scan_outcome AS "scanOutcome",
			last_ingested_at IS NOT NULL AS "hasRaw",
			last_usage_completed_at IS NOT NULL AS "hasUsageReceipt"
		FROM session_ownership
		WHERE organization_id = ${organizationId}
			AND session_id IN ${sqlClient(sessionIds)}
		ORDER BY session_id
	`;
	return [...rows];
}

async function deleteDiscoveryRaw(sessionIds: readonly string[]) {
	for (const table of ["codex_sessions", "claude_sessions"]) {
		await clickhouse.execute({
			query: `DELETE FROM rudel.${table} WHERE organization_id = {organizationId:String} AND has({sessionIds:Array(String)}, session_id) SETTINGS lightweight_deletes_sync = 3`,
			query_params: { organizationId, sessionIds },
		});
	}
}

async function waitForNotifications(
	notifications: readonly string[],
	expected: number,
): Promise<void> {
	for (
		let attempt = 0;
		attempt < 50 && notifications.length < expected;
		attempt += 1
	) {
		await Bun.sleep(10);
	}
}

function buildRawSession(sessionId: string, content: string, ownerId = userId) {
	return {
		content,
		filter_version: 1,
		git_branch: null,
		git_remote: "",
		git_sha: null,
		ingested_at: "2026-09-18 10:01:00.000",
		last_interaction_date: "2026-09-18 10:00:30.000",
		organization_id: organizationId,
		package_name: "",
		package_type: "",
		project_path: "/workspace/opaline",
		revision: "1",
		session_date: "2026-09-18 10:00:00.000",
		session_id: sessionId,
		tag: null,
		user_id: ownerId,
	};
}

function buildClaudeRawSession(sessionId: string) {
	return {
		content: JSON.stringify({
			message: { content: "unrelated codex launch" },
			timestamp: "2026-09-18T10:02:00.000Z",
			type: "user",
		}),
		filter_version: 1,
		git_branch: null,
		git_remote: "",
		git_sha: null,
		ingested_at: "2026-09-18 10:03:00.000",
		last_interaction_date: "2026-09-18 10:02:00.000",
		organization_id: organizationId,
		package_name: "",
		package_type: "",
		project_path: "/workspace/opaline",
		revision: "1",
		session_date: "2026-09-18 10:02:00.000",
		session_id: sessionId,
		subagents: {},
		tag: null,
		user_id: userId,
	};
}

async function insertAnalytics(
	parentId: string,
	childId: string,
	sessionDate: Date,
) {
	const formatTimestamp = (date: Date) =>
		date.toISOString().replace("T", " ").replace("Z", "");
	const sessionTimestamp = formatTimestamp(sessionDate);
	const lastInteractionTimestamp = formatTimestamp(
		new Date(sessionDate.getTime() + 30_000),
	);
	const ingestedTimestamp = formatTimestamp(
		new Date(sessionDate.getTime() + 60_000),
	);

	await clickhouse.insert({
		table: "rudel.session_analytics",
		values: [parentId, childId].map((sessionId, index) => ({
			actual_duration_min: 1,
			error_count: 0,
			ingested_at: ingestedTimestamp,
			input_tokens: String(index + 1),
			last_interaction_date: lastInteractionTimestamp,
			model_used: "gpt-5.6-sol",
			organization_id: organizationId,
			output_tokens: "1",
			project_path: "/workspace/opaline",
			revision: "1",
			session_date: sessionTimestamp,
			session_id: sessionId,
			skills: [],
			source: "codex",
			total_tokens: String(index + 2),
			user_id: userId,
		})),
	});
}

function rootTranscript(sessionId: string): string {
	return JSON.stringify({
		payload: {
			cwd: "/workspace/opaline",
			id: sessionId,
			originator: "codex_sdk_ts",
			thread_source: "user",
		},
		timestamp: "2026-09-18T10:00:00.000Z",
		type: "session_meta",
	});
}

function nativeTranscript(sessionId: string, parentId: string): string {
	return JSON.stringify({
		payload: {
			agent_path: "/root/backfill",
			cwd: "/workspace/opaline",
			id: sessionId,
			model: "gpt-5.6-sol",
			originator: "codex_sdk_ts",
			parent_thread_id: parentId,
			source: {
				subagent: {
					thread_spawn: {
						agent_path: "/root/backfill",
						parent_thread_id: parentId,
					},
				},
			},
			thread_source: "subagent",
		},
		timestamp: "2026-09-18T10:00:00.000Z",
		type: "session_meta",
	});
}

function historicalNativeTranscript(
	sessionId: string,
	parentId: string,
): string {
	const header = JSON.stringify({
		padding: "h".repeat(40_000),
		payload: {
			agent_path: "/root/backfill",
			cwd: "/workspace/opaline",
			id: sessionId,
			originator: "codex_sdk_ts",
			parent_thread_id: parentId,
			source: {
				subagent: {
					thread_spawn: {
						agent_path: "/root/backfill",
						parent_thread_id: parentId,
					},
				},
			},
			thread_source: "subagent",
		},
		timestamp: "2026-09-18T10:00:00.000Z",
		type: "session_meta",
	});
	const filler = JSON.stringify({
		payload: { content: "f".repeat(75_000), type: "message" },
		type: "response_item",
	});
	const turnContext = JSON.stringify({
		type: "turn_context",
		payload: { model: "gpt-5.6-sol", turn_id: "turn-1" },
	});
	return `${header}\n${filler}\n${turnContext}`;
}

function oversizedHeaderTranscript(sessionId: string): string {
	return JSON.stringify({
		padding: "o".repeat(70_000),
		payload: {
			id: sessionId,
			originator: "codex_sdk_ts",
			thread_source: "user",
		},
		timestamp: "2026-09-18T10:00:00.000Z",
		type: "session_meta",
	});
}
