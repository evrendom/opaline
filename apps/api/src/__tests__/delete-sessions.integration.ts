import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { getAdapter } from "@rudel/agent-adapters";
import type { IngestSessionInput } from "@rudel/api-routes";
import { NO_TRANSCRIPT_RECORD_FACTS } from "@rudel/api-routes/transcript-records";
import {
	ingestRudelSessionLineage,
	ingestRudelWrappedUserArchetypeSnapshotsV1,
	type RudelWrappedUserArchetypeSnapshotsV1Row,
} from "@rudel/ch-schema";
import { getClickhouse, getSafeClickHouseTable } from "../clickhouse.js";
import {
	deleteOrgSessions,
	deleteUserSessions,
} from "../services/org-session.service.js";
import { buildTranscriptRecordRow } from "../services/transcript-records-ingest.service.js";

const testRunId = `del_test_${Date.now()}_${Math.random()
	.toString(36)
	.slice(2, 8)}`;
const orgId = `org_${testRunId}`;
const userIdAlpha = `user_${testRunId}_alpha`;
const userIdBeta = `user_${testRunId}_beta`;
const sessionByOrgId = `${testRunId}_by_org`;
const sessionByUserAlpha = `${testRunId}_by_user_alpha`;
const sessionByUserBeta = `${testRunId}_by_user_beta`;
const snapshotByOrgId = `${testRunId}_snapshot_by_org`;
const snapshotByUserAlpha = `${testRunId}_snapshot_by_user_alpha`;
const snapshotByUserBeta = `${testRunId}_snapshot_by_user_beta`;

const ch = getClickhouse();

setDefaultTimeout(120_000);

interface CountRow {
	count: string;
}

async function countByOrg(targetOrgId: string): Promise<number> {
	const rows = await ch.query<CountRow>({
		query: `SELECT count() AS count FROM ${getSafeClickHouseTable("rudel.claude_sessions")} WHERE organization_id = {orgId:String}`,
		query_params: { orgId: targetOrgId },
	});
	return Number(rows[0]?.count ?? 0);
}

async function countByUser(targetUserId: string): Promise<number> {
	const rows = await ch.query<CountRow>({
		query: `SELECT count() AS count FROM ${getSafeClickHouseTable("rudel.claude_sessions")} WHERE user_id = {userId:String}`,
		query_params: { userId: targetUserId },
	});
	return Number(rows[0]?.count ?? 0);
}

async function countSkillRows(
	column: "organization_id" | "user_id",
	value: string,
): Promise<number> {
	const counts = await Promise.all(
		[
			"rudel.skill_receipts",
			"rudel.skill_uses",
			"rudel.skill_version_contents",
			"rudel.transcript_records",
			"rudel.run_index",
			"rudel.weekly_totals",
			"rudel.run_setup",
			"rudel.call_facts",
			"rudel.setup_texts",
			"rudel.session_saved_outputs",
			"rudel.session_images",
		].map(async (table) => {
			const [row] = await ch.query<CountRow>({
				query: `SELECT count() AS count FROM ${getSafeClickHouseTable(table)} WHERE ${column} = {value:String}`,
				query_params: { value },
			});
			return Number(row?.count ?? 0);
		}),
	);
	return counts.reduce((total, count) => total + count, 0);
}

async function countLineageRows(
	column: "organization_id" | "user_id",
	value: string,
): Promise<number> {
	const [row] = await ch.query<CountRow>({
		query: `SELECT count() AS count FROM ${getSafeClickHouseTable("rudel.session_lineage")} WHERE ${column} = {value:String}`,
		query_params: { value },
	});
	return Number(row?.count ?? 0);
}

async function ingestLineageRow(
	sessionId: string,
	userId: string,
	targetOrgId: string,
): Promise<void> {
	const at = "2026-07-29 10:00:00.000";
	await ingestRudelSessionLineage(ch, [
		{
			anchor_operation_ordinal: 0,
			anchor_tool_use_id: "",
			anchor_ts: at,
			carrier: "unmatched",
			child_entrypoint: "",
			child_first_ingested_at: at,
			child_model: "gpt-test",
			child_originator: "",
			child_session_date: at,
			child_session_id: sessionId,
			child_source: "codex",
			child_start_ts: at,
			confidence: "ambiguous",
			countable: 0,
			derivation_version: 1,
			derived_at: at,
			input_sequence: "1",
			organization_id: targetOrgId,
			outcome: "unknown",
			parent_session_date: at,
			parent_session_id: "",
			parent_source: "",
			prompt_fingerprint: "c".repeat(64),
			reason: "purge me",
			replacement_version: "1",
			user_id: userId,
			workdir: "/test/delete-sessions",
		},
	]);
}

async function countSnapshotsByOrg(targetOrgId: string): Promise<number> {
	const rows = await ch.query<CountRow>({
		query: `SELECT count() AS count FROM ${getSafeClickHouseTable("rudel.wrapped_user_archetype_snapshots_v1")} WHERE organization_id = {orgId:String}`,
		query_params: { orgId: targetOrgId },
	});
	return Number(rows[0]?.count ?? 0);
}

async function countSnapshotsByUser(targetUserId: string): Promise<number> {
	const rows = await ch.query<CountRow>({
		query: `SELECT count() AS count FROM ${getSafeClickHouseTable("rudel.wrapped_user_archetype_snapshots_v1")} WHERE user_id = {userId:String}`,
		query_params: { userId: targetUserId },
	});
	return Number(rows[0]?.count ?? 0);
}

async function ingestSession(
	sessionId: string,
	userId: string,
	targetOrgId: string,
): Promise<void> {
	const input: IngestSessionInput = {
		source: "claude_code",
		sessionId,
		projectPath: "/test/delete-sessions",
		gitBranch: "main",
		gitSha: "deadbeef",
		tag: "tests",
		content: JSON.stringify({
			type: "user",
			timestamp: "2026-07-29T10:00:00.000Z",
		}),
		subagents: [],
	};
	const adapter = getAdapter(input.source);
	await adapter.ingest(ch, input, {
		ingestedAt: new Date(),
		revision: "1",
		userId,
		organizationId: targetOrgId,
	});
}

async function ingestSnapshot(
	snapshotId: string,
	userId: string,
	targetOrgId: string,
): Promise<void> {
	await ingestRudelWrappedUserArchetypeSnapshotsV1(ch, [
		createSnapshot(snapshotId, userId, targetOrgId),
	]);
}

async function ingestSkillRows(
	sessionId: string,
	userId: string,
	targetOrgId: string,
): Promise<void> {
	const sourceContentSha256 = "a".repeat(64);
	const contentSha256 = "b".repeat(64);
	const extractedAt = "2026-08-20 10:00:00.000";
	await ch.insert({
		table: "rudel.skill_version_contents",
		values: [
			{
				content: "shared purge skill body",
				content_sha256: contentSha256,
				extracted_at: extractedAt,
				extraction_seq: "1",
				organization_id: targetOrgId,
				parser_version: 1,
				skill_name: "purge-skill",
				user_id: userId,
			},
		],
	});
	await ch.insert({
		table: "rudel.skill_uses",
		values: [
			{
				agent: "claude",
				content_sha256: contentSha256,
				extracted_at: extractedAt,
				extraction_seq: "1",
				organization_id: targetOrgId,
				parser_version: 1,
				session_id: sessionId,
				skill_name: "purge-skill",
				source_content_sha256: sourceContentSha256,
				used_at: extractedAt,
				user_id: userId,
			},
		],
	});
	await ch.insert({
		table: "rudel.skill_receipts",
		values: [
			{
				agent: "claude",
				extracted_at: extractedAt,
				extraction_seq: "1",
				organization_id: targetOrgId,
				parser_version: 1,
				session_id: sessionId,
				source_content_sha256: sourceContentSha256,
				user_id: userId,
			},
		],
	});
	await ch.insert({
		table: "rudel.transcript_records",
		values: [
			buildTranscriptRecordRow(
				{
					organizationId: targetOrgId,
					revision: "1",
					sessionDate: "2026-07-29T10:00:00.000Z",
					sessionId,
					source: "claude_code",
					userId,
				},
				{
					agentId: "",
					blockIdx: 0,
					byteLen: 12,
					byteStart: 0,
					callId: "",
					commandClass: "",
					exitCode: null,
					facts: NO_TRANSCRIPT_RECORD_FACTS,
					fileOp: "",
					filePath: "",
					head: "purge me",
					isError: false,
					kind: "user_prompt",
					recordIdx: 1,
					recordUuid: "",
					spawnedAgentId: "",
					subtype: "",
					tail: "",
					text: "purge me",
					textChars: 8,
					toolName: "",
					ts: "2026-07-29T10:00:00.000Z",
					turnIdx: 1,
				},
			),
		],
	});
	await ch.insert({
		table: "rudel.run_index",
		values: [
			{
				organization_id: targetOrgId,
				user_id: userId,
				session_id: sessionId,
				revision: "1",
				parser_version: 8,
				index_version: 1,
				agent_id: "",
				start_record: 1,
				row_kind: "run",
				source: "claude_code",
				turn_idx: 1,
				build_revision: "1",
				session_date: "2026-07-29 10:00:00.000",
				prompt_head: "purge me",
			},
		],
	});
	// Received setup: a run's setup file version and the member's copy of its text.
	await ch.insert({
		table: "rudel.run_setup",
		values: [
			{
				organization_id: targetOrgId,
				user_id: userId,
				session_id: sessionId,
				revision: "1",
				parser_version: 10,
				index_version: 6,
				build_revision: "1",
				agent_id: "",
				run_start_record: 1,
				setup_file: "repository:github.com/acme/shop:CLAUDE.md",
				version: "d".repeat(64),
				source: "claude_code",
				session_date: "2026-07-29 10:00:00.000",
			},
		],
	});
	await ch.insert({
		table: "rudel.call_facts",
		values: [
			{
				organization_id: targetOrgId,
				user_id: userId,
				session_id: sessionId,
				revision: "1",
				parser_version: 15,
				index_version: 10,
				build_revision: "1",
				agent_id: "",
				record_idx: 2,
				block_idx: 0,
				source: "claude_code",
				call_id: "call-1",
				tool_name: "Bash",
				command: "cat purge-me.txt",
				files_read: ["/w/purge-me.txt"],
				session_date: "2026-07-29 10:00:00.000",
				started_at: "2026-07-29 10:00:01.000",
			},
		],
	});
	await ch.insert({
		table: "rudel.setup_texts",
		values: [
			{
				organization_id: targetOrgId,
				user_id: userId,
				version: "d".repeat(64),
				chars: 8,
				text: "purge me",
				written_at: "2026-07-29 10:00:00.000",
			},
		],
	});
	// A saved background task output of the session.
	await ch.insert({
		table: "rudel.session_saved_outputs",
		values: [
			{
				organization_id: targetOrgId,
				user_id: userId,
				session_id: sessionId,
				session_source: "claude_code",
				root_id: "claude-task-outputs",
				path: "b1a2c3.output",
				kind: "task_output",
				task_id: "b1a2c3",
				status: "captured",
				blob_object_id: `sha256:${"e".repeat(64)}`,
				capture_id: crypto.randomUUID(),
				captured_at: "2026-07-29 10:00:00.000",
				version: "1",
				written_at: "2026-07-29 10:00:00.000",
			},
		],
	});
	// A screenshot of the session.
	await ch.insert({
		table: "rudel.session_images",
		values: [
			{
				organization_id: targetOrgId,
				user_id: userId,
				session_id: sessionId,
				session_source: "claude_code",
				sha256: "f".repeat(64),
				agent_id: "",
				record_idx: 3,
				media_type: "image/png",
				bytes: "1024",
				image_source: "inline",
				status: "captured",
				capture_id: crypto.randomUUID(),
				captured_at: "2026-07-29 10:00:00.000",
				version: "1",
				written_at: "2026-07-29 10:00:00.000",
			},
		],
	});
	// A current snapshot: older ones expire by TTL.
	const refreshedAt = new Date()
		.toISOString()
		.replace("T", " ")
		.replace("Z", "");
	await ch.insert({
		table: "rudel.weekly_totals",
		values: [
			{
				refreshed_at: refreshedAt,
				refresh_id: `test ${refreshedAt}`,
				snapshot_rows: "1",
				organization_id: targetOrgId,
				user_id: userId,
				agent: "claude_code",
				week: "2026-07-27",
				runs: "1",
			},
		],
	});
}

function createSnapshot(
	snapshotId: string,
	userId: string,
	targetOrgId: string,
): RudelWrappedUserArchetypeSnapshotsV1Row {
	return {
		active_days: 1,
		archetype_distance: 0.1,
		archetype_distance_ratio_to_max: 0.2,
		archetype_id: 1,
		archetype_key: "test",
		archetype_name: "Test",
		breadth: null,
		breadth_available: 0,
		breadth_raw: null,
		centroid_version: "test",
		claude_session_count: 1,
		codex_session_count: 0,
		commit_sessions: 0,
		consistency: 0.1,
		consistency_raw: 0.1,
		cost_intensity: 0.1,
		cost_intensity_raw: 0.1,
		days_since_first_session: 0,
		distinct_repos: null,
		estimated_spend_usd: 0,
		first_session_at: "2026-07-24 12:00:00.000",
		intensity: 0.1,
		intensity_raw: 0.1,
		last_session_at: "2026-07-24 12:00:00.000",
		longest_session_min: 1,
		mean_session_min: 1,
		organization_id: targetOrgId,
		output: 0.1,
		output_raw: 0.1,
		pipeline_version: "test",
		range: 0.1,
		range_entropy: 0.1,
		range_raw: 0.1,
		scope: "test",
		session_shape: 0.1,
		session_shape_raw: 0.1,
		snapshot_created_at: "2026-07-24 12:00:00.000",
		snapshot_id: snapshotId,
		total_sessions: 1,
		total_tokens: "1",
		user_id: userId,
	};
}

async function waitFor(
	predicate: () => Promise<boolean>,
	timeoutMs = 30000,
	intervalMs = 1000,
): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await predicate()) return true;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return predicate();
}

afterAll(async () => {
	for (const table of [
		"rudel.claude_sessions",
		"rudel.skill_receipts",
		"rudel.skill_uses",
		"rudel.skill_version_contents",
		"rudel.transcript_records",
		"rudel.run_index",
		"rudel.weekly_totals",
		"rudel.run_setup",
		"rudel.call_facts",
		"rudel.setup_texts",
		"rudel.session_saved_outputs",
		"rudel.session_images",
		"rudel.session_lineage",
	]) {
		await ch
			.execute({
				query: `DELETE FROM ${getSafeClickHouseTable(table)} WHERE organization_id = {orgId:String} OR user_id IN ({u1:String}, {u2:String})`,
				query_params: {
					orgId,
					u1: userIdAlpha,
					u2: userIdBeta,
				},
			})
			.catch(() => {});
	}
	await ch
		.execute({
			query: `DELETE FROM ${getSafeClickHouseTable("rudel.wrapped_user_archetype_snapshots_v1")} WHERE organization_id = {orgId:String} OR user_id IN ({u1:String}, {u2:String})`,
			query_params: {
				orgId,
				u1: userIdAlpha,
				u2: userIdBeta,
			},
		})
		.catch(() => {});
});

describe("ClickHouse session purge (integration)", () => {
	test("organization purge removes rows scoped to organization_id", async () => {
		await ingestSession(sessionByOrgId, userIdAlpha, orgId);
		await ingestSnapshot(snapshotByOrgId, userIdAlpha, orgId);
		await ingestSkillRows(sessionByOrgId, userIdAlpha, orgId);
		await ingestLineageRow(sessionByOrgId, userIdAlpha, orgId);
		const inserted = await waitFor(
			async () =>
				(await countByOrg(orgId)) > 0 &&
				(await countSnapshotsByOrg(orgId)) > 0 &&
				(await countSkillRows("organization_id", orgId)) === 11 &&
				(await countLineageRows("organization_id", orgId)) === 1,
		);
		expect(inserted).toBe(true);

		await deleteOrgSessions(orgId);

		const cleared = await waitFor(
			async () =>
				(await countByOrg(orgId)) === 0 &&
				(await countSnapshotsByOrg(orgId)) === 0 &&
				(await countSkillRows("organization_id", orgId)) === 0 &&
				(await countLineageRows("organization_id", orgId)) === 0,
		);
		expect(cleared).toBe(true);
	}, 120000);

	test("account purge removes rows scoped to user_id only", async () => {
		await ingestSession(sessionByUserAlpha, userIdAlpha, orgId);
		await ingestSession(sessionByUserBeta, userIdBeta, orgId);
		await ingestSnapshot(snapshotByUserAlpha, userIdAlpha, orgId);
		await ingestSnapshot(snapshotByUserBeta, userIdBeta, orgId);
		await ingestSkillRows(sessionByUserAlpha, userIdAlpha, orgId);
		await ingestSkillRows(sessionByUserBeta, userIdBeta, orgId);
		await ingestLineageRow(sessionByUserAlpha, userIdAlpha, orgId);
		await ingestLineageRow(sessionByUserBeta, userIdBeta, orgId);

		const inserted = await waitFor(
			async () =>
				(await countByUser(userIdAlpha)) > 0 &&
				(await countByUser(userIdBeta)) > 0 &&
				(await countSnapshotsByUser(userIdAlpha)) > 0 &&
				(await countSnapshotsByUser(userIdBeta)) > 0 &&
				(await countSkillRows("user_id", userIdAlpha)) === 11 &&
				(await countSkillRows("user_id", userIdBeta)) === 11 &&
				(await countLineageRows("user_id", userIdAlpha)) === 1 &&
				(await countLineageRows("user_id", userIdBeta)) === 1,
		);
		expect(inserted).toBe(true);

		await deleteUserSessions(userIdAlpha);

		const alphaCleared = await waitFor(
			async () => (await countByUser(userIdAlpha)) === 0,
		);
		expect(alphaCleared).toBe(true);
		expect(await countByUser(userIdBeta)).toBeGreaterThan(0);
		expect(await countSnapshotsByUser(userIdAlpha)).toBe(0);
		expect(await countSnapshotsByUser(userIdBeta)).toBeGreaterThan(0);
		expect(await countSkillRows("user_id", userIdAlpha)).toBe(0);
		expect(await countSkillRows("user_id", userIdBeta)).toBe(11);
		expect(await countLineageRows("user_id", userIdAlpha)).toBe(0);
		expect(await countLineageRows("user_id", userIdBeta)).toBe(1);

		await deleteUserSessions(userIdBeta);
	}, 120000);
});
