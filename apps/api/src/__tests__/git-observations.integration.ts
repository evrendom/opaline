import { afterAll, afterEach, expect, setDefaultTimeout, test } from "bun:test";
import assert from "node:assert/strict";
import { getAdapter } from "@rudel/agent-adapters";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
} from "@rudel/api-routes/transcript-records";
import type { RudelSessionGitObservationsRow } from "@rudel/ch-schema/generated";
import { type ClickHouseExecutor, getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { ClickHouseWriteFencedError } from "../lib/clickhouse-write-fence.js";
import { enqueueClickHousePurge } from "../services/clickhouse-purge.service.js";
import { assertNoClickHousePurgeTombstone } from "../services/clickhouse-purge-tombstone.service.js";
import { backfillGitObservations } from "../services/git-observation-backfill.service.js";
import {
	extractGitObservations,
	persistGitObservationsBestEffort,
	retireOlderGitObservations,
} from "../services/git-observation-extraction.service.js";
import { gitObservationGenerationVersion } from "../services/git-observation-parser.js";
import {
	deleteOrgSessions,
	deleteUserSessions,
} from "../services/org-session.service.js";
import {
	persistTranscriptRecordsBestEffort,
	readTranscriptRecordsExtractionConfig,
} from "../services/transcript-records-extraction.service.js";
import {
	hashTranscriptContent,
	writeTranscriptRecords,
} from "../services/transcript-records-ingest.service.js";
import {
	claudeGitFixture,
	codexGitContinuationFixture,
	codexGitFixture,
	type GitTranscriptFixture,
} from "./fixtures/git-observation-transcripts.js";

setDefaultTimeout(120_000);
const executor = getClickhouse();
const prefix = `a3_${crypto.randomUUID()}`;
const organizationId = `${prefix}_org`;
const userId = `${prefix}_user`;
const switchValue = process.env.GIT_OBSERVATION_EXTRACTION_ENABLED;

afterEach(() => {
	if (switchValue === undefined)
		delete process.env.GIT_OBSERVATION_EXTRACTION_ENABLED;
	else process.env.GIT_OBSERVATION_EXTRACTION_ENABLED = switchValue;
});
afterAll(async () => {
	await deleteOrgSessions(organizationId);
	await deleteUserSessions(userId);
	await sqlClient`DELETE FROM clickhouse_purge_job WHERE target_id IN (${organizationId}, ${userId})`;
});

test("published records automatically extract realistic Claude fixtures including raw truncation and subagents", async () => {
	const fixture = claudeGitFixture();
	const input = scope("automatic", fixture);
	await storeRaw(input, fixture, "100");
	expect(
		await persistTranscriptRecordsBestEffort(executor, {
			...input,
			assertWritable: () => fence(input),
			config: readTranscriptRecordsExtractionConfig(),
			content: fixture.content,
			subagents: fixture.subagents,
			revision: "100",
			sessionDate: fixture.timestamp,
		}),
	).toBe("written");
	const rows = await readRows(input.sessionId);
	expect(rows).toHaveLength(6);
	expect(
		rows
			.filter((row) => row.kind === "commit_created")
			.map((row) => row.short_sha)
			.sort(),
	).toEqual(["abc1234", "cafe123", "def5678"]);
	expect(rows.find((row) => row.short_sha === "cafe123")?.agent_id).toBe(
		"child-1",
	);
	expect(rows.find((row) => row.kind === "mcp_pr_created")?.pr_number).toBe(
		134,
	);
	expect(rows.find((row) => row.kind === "push_range")?.push_to_sha).toBe(
		"d4e5f6a",
	);
	const classes = await executor.query<{
		command_class: string;
		exit_code: number | null;
	}>({
		query:
			"SELECT command_class, exit_code FROM rudel.transcript_records WHERE organization_id = {organizationId:String} AND session_id = {sessionId:String} AND call_id = 'compound' AND agent_id = '' ORDER BY kind",
		query_params: input,
	});
	expect(classes.map((row) => row.command_class)).toContain("test");
	expect(classes.every((row) => row.exit_code === null)).toBe(true);
});

test("Codex bodyless metadata reads only the pinned raw range and strips credentials", async () => {
	const fixture = codexGitFixture();
	const input = scope("codex", fixture);
	await prepare(input, fixture, "100");
	expect(
		await extractGitObservations(executor, {
			...input,
			assertWritable: () => fence(input),
		}),
	).toBe("written");
	const rows = await readRows(input.sessionId);
	expect(rows).toHaveLength(3);
	expect(rows.find((row) => row.kind === "codex_session_meta")).toMatchObject({
		repository_url: "https://github.com/opalinehq/athena.git",
		commit_hash: "a".repeat(40),
	});
});

test("Codex PTY continuations are fetched and paired within their agent scope", async () => {
	const fixture = codexGitContinuationFixture();
	const input = scope("pty", fixture);
	await prepare(input, fixture, "100");
	expect(
		await extractGitObservations(executor, {
			...input,
			assertWritable: () => fence(input),
		}),
	).toBe("written");
	const rows = await readRows(input.sessionId);
	// The failed command printed `[main bad1234]`: git prints it only once the commit exists.
	expect(rows).toHaveLength(4);
	expect(rows.some((row) => row.short_sha === "bad1234")).toBe(true);
	expect(rows.some((row) => row.short_sha === "bad5678")).toBe(false);
	expect(rows.find((row) => row.short_sha === "abc1234")?.agent_id).toBe("");
	expect(rows.find((row) => row.short_sha === "cafe123")?.agent_id).toBe(
		"child-1",
	);
	expect(rows.find((row) => row.kind === "push_range")?.push_to_sha).toBe(
		"d4e5f6a",
	);
});

test.each([
	"--dry-run",
	"-n",
])("git push %s is excluded after real transcript ingestion", async (flag) => {
	const original = claudeGitFixture();
	const fixture = {
		...original,
		content: original.content.replace(
			"git push origin feat/observations",
			`git push ${flag} origin feat/observations`,
		),
	};
	const input = scope(`dry-run-${flag}`, fixture);
	await prepare(input, fixture, "100");
	await extractGitObservations(executor, {
		...input,
		assertWritable: () => fence(input),
	});
	const rows = await readRows(input.sessionId);
	expect(rows).toHaveLength(5);
	expect(rows.some((row) => row.kind === "push_range")).toBe(false);
});

test("forced pushes are retained without accepting rejected updates", async () => {
	const original = claudeGitFixture();
	const fixture = {
		...original,
		content: original.content.replace(
			"a1b2c3d..d4e5f6a  feat/observations -> feat/observations",
			"+ a1b2c3d...d4e5f6a main -> main (forced update)\\n ! [rejected] main -> main (non-fast-forward)",
		),
	};
	const input = scope("forced", fixture);
	await prepare(input, fixture, "100");
	await extractGitObservations(executor, {
		...input,
		assertWritable: () => fence(input),
	});
	expect(
		(await readRows(input.sessionId)).filter(
			(row) => row.kind === "push_range",
		),
	).toMatchObject([
		{ push_from_sha: "a1b2c3d", push_to_sha: "d4e5f6a", branch: "main" },
	]);
});

test("revision and parser advancement replace old generations; retries are resumable", async () => {
	const fixture = claudeGitFixture();
	const input = scope("replace", fixture);
	await prepare(input, fixture, "100");
	await extractGitObservations(executor, {
		...input,
		assertWritable: () => fence(input),
	});
	const updated = {
		...fixture,
		content: fixture.content.replaceAll("abc1234", "f00ba12"),
	};
	await prepare(input, updated, "200");
	expect(
		await extractGitObservations(executor, {
			...input,
			assertWritable: () => fence(input),
		}),
	).toBe("written");
	let rows = await readRows(input.sessionId);
	expect(rows.every((row) => row.revision === "200")).toBe(true);
	expect(rows.some((row) => row.short_sha === "f00ba12")).toBe(true);
	const completedRows = await readRows(input.sessionId, true);
	await executor.execute({
		query:
			"DELETE FROM rudel.session_git_observations WHERE organization_id = {organizationId:String} AND session_id = {sessionId:String} SETTINGS lightweight_deletes_sync = 1",
		query_params: input,
	});
	await executor.insert({
		table: "rudel.session_git_observations",
		asyncInsert: false,
		values: completedRows.map((row) => ({
			...row,
			parser_version:
				gitObservationGenerationVersion(TRANSCRIPT_RECORDS_PARSER_VERSION) - 1,
		})),
	});
	expect(
		await extractGitObservations(executor, {
			...input,
			assertWritable: () => fence(input),
		}),
	).toBe("written");
	rows = await readRows(input.sessionId);
	expect(
		rows.every(
			(row) =>
				row.parser_version ===
				gitObservationGenerationVersion(TRANSCRIPT_RECORDS_PARSER_VERSION),
		),
	).toBe(true);
	expect(
		await extractGitObservations(executor, {
			...input,
			assertWritable: () => fence(input),
		}),
	).toBe("skipped");
});

test("a backfill keeps older generations until one batched retirement removes them", async () => {
	const fixture = claudeGitFixture();
	const input = scope("deferred", fixture);
	await prepare(input, fixture, "100");
	await extractGitObservations(executor, {
		...input,
		assertWritable: () => fence(input),
		retireOlder: false,
	});
	await prepare(
		input,
		{ ...fixture, content: fixture.content.replaceAll("abc1234", "f00ba12") },
		"200",
	);
	expect(
		await extractGitObservations(executor, {
			...input,
			assertWritable: () => fence(input),
			retireOlder: false,
		}),
	).toBe("written");
	let rows = await readRows(input.sessionId);
	expect(new Set(rows.map((row) => row.revision))).toEqual(
		new Set(["100", "200"]),
	);

	expect(
		await retireOlderGitObservations(executor, { organizationId }),
	).toBeGreaterThanOrEqual(1);
	rows = await readRows(input.sessionId);
	expect(rows.length).toBeGreaterThan(0);
	expect(rows.every((row) => row.revision === "200")).toBe(true);
	expect(await retireOlderGitObservations(executor, { organizationId })).toBe(
		0,
	);
});

test("source participates in identity even when native session IDs collide", async () => {
	const claude = claudeGitFixture();
	const codex = codexGitFixture();
	const input = scope("source-collision", claude);
	await prepare(input, claude, "100");
	await extractGitObservations(executor, {
		...input,
		assertWritable: () => fence(input),
	});
	await prepare({ ...input, source: "codex" }, codex, "200");
	await extractGitObservations(executor, {
		...input,
		source: "codex",
		assertWritable: () => fence(input),
	});
	const rows = await readRows(input.sessionId);
	expect(rows.filter((row) => row.source === "claude_code")).toHaveLength(6);
	expect(rows.filter((row) => row.source === "codex")).toHaveLength(3);
});

test("latest receipt ordering uses numeric revisions, not their string serialization", async () => {
	const fixture = claudeGitFixture();
	const input = scope("numeric-revision", fixture);
	await prepare(input, fixture, "9");
	await prepare(
		input,
		{ ...fixture, content: fixture.content.replaceAll("abc1234", "f00ba12") },
		"100",
	);
	await extractGitObservations(executor, {
		...input,
		assertWritable: () => fence(input),
	});
	const rows = await readRows(input.sessionId);
	expect(rows.every((row) => row.revision === "100")).toBe(true);
	expect(rows.some((row) => row.short_sha === "f00ba12")).toBe(true);
});

test("preview/cutoff/execute resumes empty and populated generations and skips advanced snapshots", async () => {
	const fixture = claudeGitFixture();
	const input = scope("backfill", fixture);
	await prepare(input, fixture, "100");
	const empty = {
		...fixture,
		content: JSON.stringify({
			type: "user",
			timestamp: fixture.timestamp,
			message: { role: "user", content: "Hello" },
		}),
		subagents: {},
	};
	await prepare(scope("empty", empty), empty, "100");
	const options = {
		cutoff: new Date(Date.now() + 1_000),
		maxSessions: 100,
		organizationId,
		assertWritable: fence,
	};
	const preview = await backfillGitObservations(executor, options);
	expect(preview.wouldWriteCount).toBeGreaterThanOrEqual(2);
	const execute = await backfillGitObservations(executor, options, true);
	expect(execute.failedCount).toBe(0);
	expect(execute.completedCount).toBeGreaterThanOrEqual(2);
	const resumed = await backfillGitObservations(executor, options, true);
	expect(resumed.completedCount).toBe(0);
	expect(resumed.wouldWriteCount).toBe(0);
	const advanced = await extractGitObservations(executor, {
		...input,
		expectedGeneration: {
			revision: "99",
			parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
		},
		assertWritable: () => fence(input),
	});
	expect(advanced).toBe("skipped");
});

test("kill switch and database/parser failure never fail transcript receipt publication", async () => {
	process.env.GIT_OBSERVATION_EXTRACTION_ENABLED = "false";
	const fixture = claudeGitFixture();
	const input = scope("disabled", fixture);
	await prepare(input, fixture, "100");
	expect(
		await persistGitObservationsBestEffort(executor, {
			...input,
			assertWritable: () => fence(input),
		}),
	).toBe("skipped");
	expect(await readRows(input.sessionId)).toHaveLength(0);
	delete process.env.GIT_OBSERVATION_EXTRACTION_ENABLED;
	const failing: ClickHouseExecutor = {
		...executor,
		query: async () => {
			throw new Error("Unavailable derived table");
		},
	};
	expect(
		await persistGitObservationsBestEffort(failing, {
			...input,
			assertWritable: () => fence(input),
		}),
	).toBe("failed");
});

test("backfill cutoff is receipt publication, not the earlier transcript timestamp", async () => {
	const cutoff = new Date();
	const options = {
		cutoff,
		maxSessions: 100,
		organizationId,
		assertWritable: fence,
	};
	const preview = await backfillGitObservations(executor, options);
	await Bun.sleep(5);
	const fixture = codexGitFixture(
		new Date(Date.now() - 3_600_000).toISOString(),
	);
	const input = scope("published-after-cutoff", fixture);
	await prepare(input, fixture, "100");
	const result = await backfillGitObservations(executor, options, true);
	expect(result.sessionCount).toBe(preview.sessionCount);
	expect(await readRows(input.sessionId)).toHaveLength(0);
});

test("oversized raw fallback is bounded and never publishes an incomplete observation generation", async () => {
	const fixture = codexGitFixture();
	const envelope: unknown = JSON.parse(fixture.content.split("\n")[0] ?? "");
	assert(envelope && typeof envelope === "object");
	const oversized = {
		...fixture,
		content: JSON.stringify({ ...envelope, filler: "x".repeat(1024 * 1024) }),
	};
	const input = scope("bounded", oversized);
	await prepare(input, oversized, "100");
	expect(
		await persistGitObservationsBestEffort(executor, {
			...input,
			assertWritable: () => fence(input),
		}),
	).toBe("failed");
	expect(await readRows(input.sessionId)).toHaveLength(0);
});

test("real Postgres tombstones fence both account and workspace writes and clean in-flight publication", async () => {
	const fixture = claudeGitFixture();
	const input = scope("fenced", fixture);
	await prepare(input, fixture, "100");
	let checks = 0;
	await expect(
		extractGitObservations(executor, {
			...input,
			assertWritable: async () => {
				if (++checks === 2)
					await sqlClient.begin((transaction) =>
						enqueueClickHousePurge(
							{ targetId: userId, targetType: "account" },
							transaction,
						),
					);
				await fence(input);
			},
		}),
	).rejects.toBeInstanceOf(ClickHouseWriteFencedError);
	expect(await readRows(input.sessionId)).toHaveLength(0);
	await sqlClient`DELETE FROM clickhouse_purge_job WHERE target_id = ${userId}`;
	await sqlClient.begin((transaction) =>
		enqueueClickHousePurge(
			{ targetId: organizationId, targetType: "organization" },
			transaction,
		),
	);
	await expect(
		extractGitObservations(executor, {
			...input,
			assertWritable: () => fence(input),
		}),
	).rejects.toBeInstanceOf(ClickHouseWriteFencedError);
	await sqlClient`DELETE FROM clickhouse_purge_job WHERE target_id = ${organizationId}`;
});

test("real account and workspace purges remove observation rows and completion receipts", async () => {
	const fixture = codexGitFixture();
	const input = scope("purge", fixture);
	await prepare(input, fixture, "100");
	await extractGitObservations(executor, {
		...input,
		assertWritable: () => fence(input),
	});
	await deleteUserSessions(userId);
	expect(await readRows(input.sessionId, true)).toHaveLength(0);
	await prepare(input, fixture, "200");
	await extractGitObservations(executor, {
		...input,
		assertWritable: () => fence(input),
	});
	await deleteOrgSessions(organizationId);
	expect(await readRows(input.sessionId, true)).toHaveLength(0);
});

function scope(name: string, fixture: GitTranscriptFixture) {
	return {
		organizationId,
		userId,
		sessionId: `${prefix}_${name}`,
		source: fixture.source,
	};
}
function fence(target: { organizationId: string; userId: string }) {
	return assertNoClickHousePurgeTombstone(target, { database: sqlClient });
}
async function storeRaw(
	input: ReturnType<typeof scope>,
	fixture: GitTranscriptFixture,
	revision: string,
) {
	await getAdapter(fixture.source).ingest(
		executor,
		{
			content: fixture.content,
			projectPath: "/work/opaline",
			sessionId: input.sessionId,
			source: fixture.source,
			subagents: Object.entries(fixture.subagents).map(
				([agentId, content]) => ({ agentId, content }),
			),
		},
		{
			organizationId,
			userId,
			revision,
			ingestedAt: new Date(),
			timestamps: {
				sessionDate: fixture.timestamp,
				lastInteractionDate: fixture.timestamp,
			},
		},
	);
}
async function prepare(
	input: ReturnType<typeof scope>,
	fixture: GitTranscriptFixture,
	revision: string,
) {
	await storeRaw(input, fixture, revision);
	const stats = createSplitStats();
	await writeTranscriptRecords(executor, {
		...input,
		assertWritable: () => fence(input),
		revision,
		sessionDate: fixture.timestamp,
		contentSha256: hashTranscriptContent(fixture.content, fixture.subagents),
		drafts: splitSessionTranscript(
			{ ...fixture, sessionDate: fixture.timestamp },
			stats,
		),
		summary: () => summarizeSplit(stats),
	});
}
function readRows(sessionId: string, receipts = false) {
	return executor.query<RudelSessionGitObservationsRow>({
		query: `SELECT * EXCEPT (revision), toString(revision) AS revision FROM rudel.session_git_observations FINAL WHERE organization_id = {organizationId:String} AND session_id = {sessionId:String} ${receipts ? "" : "AND kind != 'receipt'"} ORDER BY source, agent_id, record_idx, block_idx`,
		query_params: { organizationId, sessionId },
	});
}
