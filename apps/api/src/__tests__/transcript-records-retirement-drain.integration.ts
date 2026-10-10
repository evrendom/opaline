import "./helpers/local-integration-guard.js";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { getAdapter } from "@rudel/agent-adapters";
import {
	createSplitStats,
	NO_TRANSCRIPT_RECORD_FACTS,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
} from "@rudel/api-routes/transcript-records";
import postgres from "postgres";
import { getClickhouse } from "../clickhouse.js";
import { assertNoClickHousePurgeTombstone } from "../services/clickhouse-purge-tombstone.service.js";
import { auditL1, compareL1Audits } from "../services/l1-audit.service.js";
import { backfillTranscriptRecords } from "../services/transcript-records-backfill.service.js";
import {
	buildTranscriptRecordRow,
	buildTranscriptRecordsReceiptRow,
	hashTranscriptContent,
	TRANSCRIPT_RECORDS_RETIRE_GRACE_MS,
} from "../services/transcript-records-ingest.service.js";
import { readSessionFacts } from "../services/transcript-records-reader.service.js";
import { drainTranscriptRecordsRetirement } from "../services/transcript-records-retirement-drain.service.js";

setDefaultTimeout(120_000);
// Its own client: another suite in this process may close the shared one.
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", {
	max: 2,
	prepare: false,
});
const RUN = `retire_drain_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const organizationId = `${RUN}_org`;
const otherOrganizationId = `${RUN}_other_org`;
const userId = `${RUN}_user`;
const clickhouse = getClickhouse();
const BASE_TIME_MS =
	Math.floor((Date.now() - 2 * 60 * 60 * 1_000) / 1_000) * 1_000;
const SESSION_DATE = new Date(BASE_TIME_MS).toISOString();
const OLD_PARSER = TRANSCRIPT_RECORDS_PARSER_VERSION - 1;

afterAll(async () => {
	for (const table of [
		"rudel.transcript_records",
		"rudel.claude_sessions",
		"rudel.session_analytics",
		"rudel.session_git_observations",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id IN {ids:Array(String)} SETTINGS lightweight_deletes_sync = 3`,
			query_params: { ids: [organizationId, otherOrganizationId] },
		});
	await sqlClient.end();
});

function prompt(text: string): string {
	return JSON.stringify({
		type: "user",
		timestamp: SESSION_DATE,
		message: { role: "user", content: text },
	});
}

/** A raw session plus a committed generation of the previous parser. */
async function seed(owner: string, sessionId: string, revision: string) {
	const content = prompt(`backfill then retire ${sessionId}`);
	await getAdapter("claude_code").ingest(
		clickhouse,
		{
			content,
			projectPath: "/test/retire-drain",
			sessionId,
			source: "claude_code",
			subagents: [],
		},
		{
			ingestedAt: new Date(BASE_TIME_MS + 60_000),
			organizationId: owner,
			revision,
			timestamps: {
				lastInteractionDate: SESSION_DATE,
				sessionDate: SESSION_DATE,
			},
			userId,
		},
	);
	const identity = {
		organizationId: owner,
		userId,
		sessionId,
		source: "claude_code" as const,
		revision,
		sessionDate: SESSION_DATE,
	};
	const stats = createSplitStats();
	const rows = [
		...splitSessionTranscript(
			{ content, sessionDate: SESSION_DATE, source: "claude_code" },
			stats,
		),
	].map((draft) => ({
		...buildTranscriptRecordRow(identity, {
			...draft,
			facts: NO_TRANSCRIPT_RECORD_FACTS,
		}),
		parser_version: OLD_PARSER,
	}));
	await clickhouse.insert({
		table: "rudel.transcript_records",
		asyncInsert: false,
		values: [
			...rows,
			buildTranscriptRecordsReceiptRow(identity, {
				...summarizeSplit(stats),
				contentSha256: hashTranscriptContent(content),
				parserVersion: OLD_PARSER,
				publishedAt: new Date(BASE_TIME_MS + 120_000).toISOString(),
				rowCount: rows.length,
			}),
		],
	});
}

async function generations(owner: string, sessionId: string) {
	return (
		await clickhouse.query<{ generation: string }>({
			query: `SELECT DISTINCT concat(toString(revision), '/', toString(parser_version)) AS generation
				FROM rudel.transcript_records
				WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
					AND session_id = {sessionId:String}
				ORDER BY generation`,
			query_params: { organizationId: owner, userId, sessionId },
		})
	).map((row) => row.generation);
}

test("a backfill's superseded generations are retired by the drain after the grace, per organization", async () => {
	const sessions = ["a", "b", "c"].map((suffix) => `${RUN}_${suffix}`);
	for (const sessionId of sessions)
		await seed(organizationId, sessionId, "100");
	const otherSession = `${RUN}_other`;
	await seed(otherOrganizationId, otherSession, "100");

	const backfill = await backfillTranscriptRecords(clickhouse, {
		assertWritable: (target) =>
			assertNoClickHousePurgeTombstone(target, { database: sqlClient }),
		batchMaxBytes: 64 * 1024 * 1024,
		batchMaxRows: 10,
		cutoff: new Date(BASE_TIME_MS + 86_400_000),
		maxRows: 100_000,
		maxSessionBytes: 64 * 1024 * 1024,
		maxSessions: 100,
		organizationId,
		sessionTimeoutMs: 120_000,
	});
	expect(backfill).toMatchObject({ completedCount: 3, failedCount: 0 });
	const current = `100/${TRANSCRIPT_RECORDS_PARSER_VERSION}`;
	const old = `100/${OLD_PARSER}`;
	for (const sessionId of sessions)
		expect(await generations(organizationId, sessionId)).toEqual(
			[old, current].sort(),
		);

	const drain = (execute: boolean, nowMs: number) =>
		drainTranscriptRecordsRetirement(clickhouse, {
			execute,
			maxSessions: 100,
			organizationId,
			pageSize: 2,
			pauseMs: 0,
			now: () => nowMs,
		});

	// Inside the grace of the backfill's publication: nothing is retirable.
	expect(await drain(true, Date.now())).toMatchObject({
		sessionCount: 0,
		generations: 0,
		deleteStatements: 0,
	});

	const later = Date.now() + TRANSCRIPT_RECORDS_RETIRE_GRACE_MS + 60_000;
	const preview = await drain(false, later);
	expect(preview).toMatchObject({
		status: "preview",
		sessionCount: 3,
		sessionsRetired: 3,
		committedGenerations: 3,
		deleteStatements: 0,
	});
	expect(preview.rows).toBeGreaterThan(0);
	for (const sessionId of sessions)
		expect(await generations(organizationId, sessionId)).toHaveLength(2);

	// The audit sees the doubled storage, read-only, in every section.
	const audit = () => auditL1(clickhouse, sqlClient, { organizationId });
	const before = await audit();
	for (const [name, value] of Object.entries(before))
		expect({ name, error: (value as { error?: string })?.error }).toEqual({
			name,
			error: undefined,
		});
	expect(before.transcripts).toMatchObject({
		totals: {
			sessions: 3,
			sessionsWithSuperseded: 3,
			supersededGenerations: 3,
		},
	});
	expect(before.runIndex).toMatchObject({ transcriptSessions: 3, missing: 3 });

	const executed = await drain(true, later);
	expect(executed).toMatchObject({
		status: "completed",
		sessionCount: 3,
		generations: 3,
		deleteStatements: 2,
		hasMore: false,
	});
	for (const sessionId of sessions) {
		expect(await generations(organizationId, sessionId)).toEqual([current]);
		const [facts] = await readSessionFacts({ organizationId, userId }, [
			sessionId,
		]);
		expect(facts).toMatchObject({ indexed: true, revision: "100" });
	}
	// Another organization is never touched by a scoped run.
	expect(await generations(otherOrganizationId, otherSession)).toEqual([old]);

	const changes = compareL1Audits(before, await audit());
	expect(changes).toContainEqual({
		path: "transcripts.totals.supersededGenerations",
		before: 3,
		after: 0,
		delta: -3,
	});

	// Resumable and idempotent: the next run finds nothing left.
	expect(await drain(true, later)).toMatchObject({
		sessionCount: 0,
		generations: 0,
	});
});
