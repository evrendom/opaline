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
	HistoricalSkillDetailSchema,
	HistoricalSkillSummarySchema,
	type IngestSessionInput,
} from "@rudel/api-routes";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import {
	extractSessionSkills,
	hashSkillSourceContent,
} from "../services/skill-extraction.js";
import {
	buildSkillExtractionRows,
	buildSkillExtractionSeq,
	createSkillExtractionRun,
	writeSkillExtractionRowBatch,
	writeSkillUseRows,
	writeSkillVersionContentRows,
} from "../services/skill-extraction-ingest.service.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

setDefaultTimeout(60_000);

const RUN_ID = crypto.randomUUID();
const CLAUDE_SESSION_ID = `skill_claude_${RUN_ID}`;
const CODEX_SESSION_ID = `skill_codex_${RUN_ID}`;
const CLAUDE_BODY = "# Claude readable body\n\nByte-identical content.\n";
const CODEX_BODY = [
	"---",
	"name: shared-skill",
	"description: Codex body.",
	"---",
	"",
	"# Codex readable body",
	"",
].join("\n");

let server: ApiTestServer;
let bearerToken: string;
let userId: string;

beforeAll(async () => {
	server = await startApiTestServer({
		SKILL_ANALYTICS_CUTOVER_MODE: "all",
		SKILL_EXTRACTION_ENABLED: "true",
	});
	({ bearerToken, userId } = await createTestUser(server.baseUrl));
});

afterAll(async () => {
	await server?.stop();
	const clickhouse = getClickhouse();
	for (const table of [
		"rudel.skill_receipts",
		"rudel.skill_uses",
		"rudel.skill_version_contents",
		"rudel.usage_events",
		"rudel.claude_sessions",
		"rudel.codex_sessions",
	]) {
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
			query_params: { organizationId: userId },
		});
	}
	await sqlClient`
		DELETE FROM organization
		WHERE id = ${userId}
	`;
	await sqlClient`
		DELETE FROM "user"
		WHERE id = ${userId}
	`;
});

describe("persistent skill extraction through the real API", () => {
	test("keeps content readable across ingest and replacement", async () => {
		const claudeUpload = await callRpc("ingestSession", claudeInput());
		expect(claudeUpload.status).toBe(200);
		const initialList = HistoricalSkillSummarySchema.array().parse(
			readJsonEnvelope((await callRpc("analytics/skills/list")).body),
		);
		expect(initialList).toMatchObject([
			{
				name: "shared-skill",
				sessionCount: 1,
				claudeSessionCount: 1,
				codexSessionCount: 0,
				contentPreview: CLAUDE_BODY,
				versionCount: 1,
				attribution: {
					userCount: 1,
					topUsers: [{ userId, sessionCount: 1 }],
					repoCount: 1,
					topRepos: [{ repoLabel: "No repository", sessionCount: 1 }],
				},
			},
		]);

		const claudeDetail = HistoricalSkillDetailSchema.parse(
			readJsonEnvelope(
				(await callRpc("analytics/skills/detail", { name: "shared-skill" }))
					.body,
			),
		);
		expect(claudeDetail.versions[0]?.content).toBe(CLAUDE_BODY);
		expect(claudeDetail.versions[0]?.sourceAgent).toBe("claude");

		const codexUpload = await callRpc("ingestSession", codexInput());
		expect(codexUpload.status).toBe(200);
		const mergedDetail = HistoricalSkillDetailSchema.parse(
			readJsonEnvelope(
				(await callRpc("analytics/skills/detail", { name: "shared-skill" }))
					.body,
			),
		);
		expect(mergedDetail).toMatchObject({
			claudeSessionCount: 1,
			codexSessionCount: 1,
			sessionCount: 2,
			sourceAgents: ["claude", "codex"],
			unavailableSessionCount: 0,
		});
		expect(
			mergedDetail.versions.map((version) => [
				version.sourceAgent,
				version.content,
			]),
		).toEqual([
			["codex", CODEX_BODY],
			["claude", CLAUDE_BODY],
		]);

		const replacement = await callRpc("ingestSession", {
			...claudeInput(),
			content: claudeTranscript("removed-skill", "# Removed\n"),
			force_replace: true,
		});
		expect(replacement.status).toBe(200);
		const afterReplacement = HistoricalSkillSummarySchema.array().parse(
			readJsonEnvelope((await callRpc("analytics/skills/list")).body),
		);
		expect(afterReplacement).toMatchObject([
			{
				name: "removed-skill",
				sessionCount: 1,
				claudeSessionCount: 1,
				codexSessionCount: 0,
				contentPreview: "# Removed\n",
				attribution: {
					userCount: 1,
					topUsers: [{ userId, sessionCount: 1 }],
					repoCount: 1,
					topRepos: [{ repoLabel: "No repository", sessionCount: 1 }],
				},
			},
			{
				name: "shared-skill",
				sessionCount: 1,
				claudeSessionCount: 0,
				codexSessionCount: 1,
				contentPreview: CODEX_BODY,
				versionCount: 1,
				attribution: {
					userCount: 1,
					topUsers: [{ userId, sessionCount: 1 }],
					repoCount: 1,
					topRepos: [{ repoLabel: "No repository", sessionCount: 1 }],
				},
			},
		]);
	});

	test("keeps a fast newer raw revision active after a slow older extraction finishes", async () => {
		const clickhouse = getClickhouse();
		const sessionId = `skill_raw_order_${RUN_ID}`;
		const olderRawRevision = new Date("2026-08-20T11:00:00.000Z");
		const newerRawRevision = new Date("2026-08-20T11:01:00.000Z");
		const olderSeq = buildSkillExtractionSeq(
			revisionForDate(olderRawRevision),
			1,
		);
		const newerSeq = buildSkillExtractionSeq(
			revisionForDate(newerRawRevision),
			1,
		);
		const olderContentHash = "1".repeat(64);
		const newerContentHash = "2".repeat(64);
		await clickhouse.insert({
			table: "rudel.skill_version_contents",
			values: [
				{
					organization_id: userId,
					skill_name: "raw-order-skill",
					content_sha256: newerContentHash,
					user_id: userId,
					content: "newer body",
					parser_version: 1,
					extraction_seq: newerSeq,
					extracted_at: "2026-08-20 11:02:00.000",
				},
			],
		});
		await clickhouse.insert({
			table: "rudel.skill_uses",
			values: [
				buildUseRow({
					contentSha256: newerContentHash,
					extractedAt: "2026-08-20 11:02:00.000",
					extractionSeq: newerSeq,
					parserVersion: 1,
					sessionId,
					skillName: "raw-order-skill",
					sourceContentSha256: "b".repeat(64),
					usedAt: "2026-08-20 11:01:00.000",
				}),
			],
		});
		await clickhouse.insert({
			table: "rudel.skill_receipts",
			values: [
				buildReceiptRow({
					extractedAt: "2026-08-20 11:02:00.000",
					extractionSeq: newerSeq,
					parserVersion: 1,
					sessionId,
					sourceContentSha256: "b".repeat(64),
				}),
			],
		});

		// The older raw revision finishes later and is appended after the newer run.
		await clickhouse.insert({
			table: "rudel.skill_version_contents",
			values: [
				{
					organization_id: userId,
					skill_name: "raw-order-skill",
					content_sha256: olderContentHash,
					user_id: userId,
					content: "older body",
					parser_version: 1,
					extraction_seq: olderSeq,
					extracted_at: "2026-08-20 11:10:00.000",
				},
			],
		});
		await clickhouse.insert({
			table: "rudel.skill_uses",
			values: [
				buildUseRow({
					contentSha256: olderContentHash,
					extractedAt: "2026-08-20 11:10:00.000",
					extractionSeq: olderSeq,
					parserVersion: 1,
					sessionId,
					skillName: "raw-order-skill",
					sourceContentSha256: "a".repeat(64),
					usedAt: "2026-08-20 11:00:00.000",
				}),
			],
		});
		await clickhouse.insert({
			table: "rudel.skill_receipts",
			values: [
				buildReceiptRow({
					extractedAt: "2026-08-20 11:10:00.000",
					extractionSeq: olderSeq,
					parserVersion: 1,
					sessionId,
					sourceContentSha256: "a".repeat(64),
				}),
			],
		});

		const detail = HistoricalSkillDetailSchema.parse(
			readJsonEnvelope(
				(
					await callRpc("analytics/skills/detail", {
						name: "raw-order-skill",
					})
				).body,
			),
		);
		expect(detail.versions).toHaveLength(1);
		expect(detail.versions[0]).toMatchObject({
			content: "newer body",
			contentSha256: newerContentHash,
			sourceAgent: "claude",
		});
	});

	test("keeps the committed generation active when a newer use is orphaned before and after FINAL", async () => {
		const clickhouse = getClickhouse();
		const sessionId = `skill_orphan_generation_${RUN_ID}`;
		const skillName = "orphan-generation-skill";
		const committedHash = "6".repeat(64);
		const orphanHash = "7".repeat(64);
		await insertSkillRun({
			content: "committed body",
			contentSha256: committedHash,
			extractedAt: "2026-08-20 11:11:00.000",
			extractionSeq: buildSkillExtractionSeq(
				revisionForDate(new Date("2026-08-20T11:10:00.000Z")),
				1,
			),
			parserVersion: 1,
			sessionId,
			skillName,
			sourceContentSha256: "8".repeat(64),
		});
		const orphanSeq = buildSkillExtractionSeq(
			revisionForDate(new Date("2026-08-20T11:12:00.000Z")),
			1,
		);
		await clickhouse.insert({
			table: "rudel.skill_version_contents",
			values: [
				{
					organization_id: userId,
					skill_name: skillName,
					content_sha256: orphanHash,
					user_id: userId,
					content: "orphan body",
					parser_version: 1,
					extraction_seq: orphanSeq,
					extracted_at: "2026-08-20 11:13:00.000",
				},
			],
		});
		await clickhouse.insert({
			table: "rudel.skill_uses",
			values: [
				buildUseRow({
					contentSha256: orphanHash,
					extractedAt: "2026-08-20 11:13:00.000",
					extractionSeq: orphanSeq,
					parserVersion: 1,
					sessionId,
					skillName,
					sourceContentSha256: "9".repeat(64),
					usedAt: "2026-08-20 11:12:00.000",
				}),
			],
		});

		const assertCommittedGeneration = async () => {
			const detail = HistoricalSkillDetailSchema.parse(
				readJsonEnvelope(
					(await callRpc("analytics/skills/detail", { name: skillName })).body,
				),
			);
			expect(detail).toMatchObject({ sessionCount: 1 });
			expect(detail.versions).toHaveLength(1);
			expect(detail.versions[0]).toMatchObject({
				content: "committed body",
				contentSha256: committedHash,
			});
		};

		await assertCommittedGeneration();
		await clickhouse.execute({
			query: "OPTIMIZE TABLE rudel.skill_uses FINAL",
		});
		await assertCommittedGeneration();
	});

	test("activates a higher-parser replay for the same raw revision", async () => {
		const rawRevision = new Date("2026-08-20T11:20:00.000Z");
		const sessionId = `skill_parser_replay_${RUN_ID}`;
		await insertSkillRun({
			content: "parser one body",
			contentSha256: "3".repeat(64),
			extractedAt: "2026-08-20 11:21:00.000",
			extractionSeq: buildSkillExtractionSeq(revisionForDate(rawRevision), 1),
			parserVersion: 1,
			sessionId,
			skillName: "parser-replay-skill",
			sourceContentSha256: "c".repeat(64),
		});
		await insertSkillRun({
			content: "parser two body",
			contentSha256: "4".repeat(64),
			extractedAt: "2026-08-20 11:22:00.000",
			extractionSeq: buildSkillExtractionSeq(revisionForDate(rawRevision), 2),
			parserVersion: 2,
			sessionId,
			skillName: "parser-replay-skill",
			sourceContentSha256: "d".repeat(64),
		});

		const detail = HistoricalSkillDetailSchema.parse(
			readJsonEnvelope(
				(
					await callRpc("analytics/skills/detail", {
						name: "parser-replay-skill",
					})
				).body,
			),
		);
		expect(detail.versions).toHaveLength(1);
		expect(detail.versions[0]?.content).toBe("parser two body");
	});

	test("retries a failed attempt with a fresh deterministic run and activates it", async () => {
		const sessionId = `skill_receipt_retry_${RUN_ID}`;
		const rawRevision = new Date("2026-08-20T11:30:00.000Z");
		const clickhouse = getClickhouse();
		const writeInput = {
			extractedAt: new Date("2026-08-20T11:31:00.000Z"),
			extraction: extractSessionSkills({
				content: claudeTranscript(
					"receipt-retry-skill",
					"# Receipt retry body\n",
				),
				parserVersion: 1,
				sessionDate: rawRevision.toISOString(),
				source: "claude_code" as const,
			}),
			organizationId: userId,
			rawRevision: revisionForDate(rawRevision),
			sessionDate: rawRevision,
			sessionId,
			userId,
		};
		const failedRun = createSkillExtractionRun(writeInput);
		const failedRows = buildSkillExtractionRows(failedRun, []);
		await writeSkillVersionContentRows(clickhouse, failedRows.contentRows);
		await writeSkillUseRows(clickhouse, failedRows.useRows);

		const beforeRetry = HistoricalSkillDetailSchema.parse(
			readJsonEnvelope(
				(
					await callRpc("analytics/skills/detail", {
						name: "receipt-retry-skill",
					})
				).body,
			),
		);
		expect(beforeRetry).toMatchObject({ sessionCount: 0, versions: [] });

		const retryRun = createSkillExtractionRun(writeInput);
		expect(retryRun).not.toBe(failedRun);
		expect(retryRun.extractionSeq).toBe(failedRun.extractionSeq);
		const retryRows = buildSkillExtractionRows(retryRun, []);
		await writeSkillExtractionRowBatch(clickhouse, retryRows);

		const afterRetry = HistoricalSkillDetailSchema.parse(
			readJsonEnvelope(
				(
					await callRpc("analytics/skills/detail", {
						name: "receipt-retry-skill",
					})
				).body,
			),
		);
		expect(afterRetry).toMatchObject({ sessionCount: 1 });
		expect(afterRetry.versions[0]?.content).toBe("# Receipt retry body\n");
	});
});

describe("skills used inside Claude subagent transcripts", () => {
	test("a skill a subagent loaded is extracted, and its receipt covers every stream", async () => {
		const sessionId = `skill_subagent_${RUN_ID}`;
		const input: IngestSessionInput = {
			content: JSON.stringify({
				message: { role: "user", content: "delegate the review" },
				timestamp: "2026-08-20T09:59:00.000Z",
				type: "user",
			}),
			projectPath: "/tmp/skill-persistence-subagent",
			sessionId,
			source: "claude_code",
			subagents: [
				{
					agentId: "agent-review",
					content: claudeTranscript("subagent-only-skill", "# Child body\n"),
				},
			],
			upload_mode: "manual",
		};
		expect((await callRpc("ingestSession", input)).status).toBe(200);
		const detail = HistoricalSkillDetailSchema.parse(
			readJsonEnvelope(
				(
					await callRpc("analytics/skills/detail", {
						name: "subagent-only-skill",
					})
				).body,
			),
		);
		expect(detail).toMatchObject({ claudeSessionCount: 1, sessionCount: 1 });
		expect(detail.versions[0]?.content).toBe("# Child body\n");

		// The receipt hashes every stream, so a duplicate upload or a replay of
		// this content is already complete.
		const [receipt] = await getClickhouse().query<{ sha: string }>({
			query: `SELECT argMax(source_content_sha256, extraction_seq) AS sha FROM rudel.skill_receipts
				WHERE organization_id = {organizationId:String} AND session_id = {sessionId:String}`,
			query_params: { organizationId: userId, sessionId },
		});
		expect(receipt?.sha).toBe(
			hashSkillSourceContent(input.content, {
				"agent-review": input.subagents?.[0]?.content ?? "",
			}),
		);
		expect(receipt?.sha).not.toBe(hashSkillSourceContent(input.content));
	});
});

function buildUseRow(input: {
	readonly contentSha256: string;
	readonly extractedAt: string;
	readonly extractionSeq: string;
	readonly organizationId?: string;
	readonly parserVersion: number;
	readonly sessionId: string;
	readonly skillName: string;
	readonly sourceContentSha256: string;
	readonly usedAt: string;
	readonly userId?: string;
}): Record<string, unknown> {
	return {
		agent: "claude",
		content_sha256: input.contentSha256,
		extracted_at: input.extractedAt,
		extraction_seq: input.extractionSeq,
		organization_id: input.organizationId ?? userId,
		parser_version: input.parserVersion,
		session_id: input.sessionId,
		skill_name: input.skillName,
		source_content_sha256: input.sourceContentSha256,
		used_at: input.usedAt,
		user_id: input.userId ?? userId,
	};
}

function buildReceiptRow(input: {
	readonly extractedAt: string;
	readonly extractionSeq: string;
	readonly organizationId?: string;
	readonly parserVersion: number;
	readonly sessionId: string;
	readonly sourceContentSha256: string;
	readonly userId?: string;
}): Record<string, unknown> {
	return {
		agent: "claude",
		extracted_at: input.extractedAt,
		extraction_seq: input.extractionSeq,
		organization_id: input.organizationId ?? userId,
		parser_version: input.parserVersion,
		session_id: input.sessionId,
		source_content_sha256: input.sourceContentSha256,
		user_id: input.userId ?? userId,
	};
}

async function insertSkillRun(input: {
	readonly content: string;
	readonly contentSha256: string;
	readonly extractedAt: string;
	readonly extractionSeq: string;
	readonly parserVersion: number;
	readonly sessionId: string;
	readonly skillName: string;
	readonly sourceContentSha256: string;
}): Promise<void> {
	const clickhouse = getClickhouse();
	await clickhouse.insert({
		table: "rudel.skill_version_contents",
		values: [
			{
				organization_id: userId,
				skill_name: input.skillName,
				content_sha256: input.contentSha256,
				user_id: userId,
				content: input.content,
				parser_version: input.parserVersion,
				extraction_seq: input.extractionSeq,
				extracted_at: input.extractedAt,
			},
		],
	});
	await clickhouse.insert({
		table: "rudel.skill_uses",
		values: [
			buildUseRow({
				contentSha256: input.contentSha256,
				extractedAt: input.extractedAt,
				extractionSeq: input.extractionSeq,
				parserVersion: input.parserVersion,
				sessionId: input.sessionId,
				skillName: input.skillName,
				sourceContentSha256: input.sourceContentSha256,
				usedAt: input.extractedAt,
			}),
		],
	});
	await clickhouse.insert({
		table: "rudel.skill_receipts",
		values: [
			buildReceiptRow({
				extractedAt: input.extractedAt,
				extractionSeq: input.extractionSeq,
				parserVersion: input.parserVersion,
				sessionId: input.sessionId,
				sourceContentSha256: input.sourceContentSha256,
			}),
		],
	});
}

function revisionForDate(value: Date): string {
	return (BigInt(value.getTime()) << 16n).toString();
}

function claudeInput(): IngestSessionInput {
	return {
		content: claudeTranscript("shared-skill", CLAUDE_BODY),
		projectPath: "/tmp/skill-persistence-claude",
		sessionId: CLAUDE_SESSION_ID,
		source: "claude_code",
		upload_mode: "manual",
	};
}

function codexInput(): IngestSessionInput {
	const path = "/Users/test/.codex/skills/shared-skill/SKILL.md";
	return {
		content: [
			JSON.stringify({
				payload: { id: CODEX_SESSION_ID },
				timestamp: "2026-08-20T11:00:00.000Z",
				type: "session_meta",
			}),
			JSON.stringify({
				payload: {
					arguments: JSON.stringify({ cmd: `cat ${path}` }),
					call_id: "skill-call",
					name: "exec_command",
					type: "function_call",
				},
				timestamp: "2026-08-20T11:01:00.000Z",
				type: "response_item",
			}),
			JSON.stringify({
				payload: {
					call_id: "skill-call",
					output: [
						"Chunk ID: integration",
						"Process exited with code 0",
						"Final output:",
						CODEX_BODY,
					].join("\n"),
					type: "function_call_output",
				},
				timestamp: "2026-08-20T11:01:01.000Z",
				type: "response_item",
			}),
		].join("\n"),
		projectPath: "/tmp/skill-persistence-codex",
		sessionId: CODEX_SESSION_ID,
		source: "codex",
		upload_mode: "manual",
	};
}

function claudeTranscript(skillName: string, body: string): string {
	return [
		JSON.stringify({
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: `tool-${skillName}`,
						name: "Skill",
						input: { skill: skillName },
					},
				],
			},
			timestamp: "2026-08-20T10:00:00.000Z",
			type: "assistant",
		}),
		JSON.stringify({
			isMeta: true,
			message: {
				role: "user",
				content: `Base directory for this skill: /tmp/skills/${skillName}\n\n${body}`,
			},
			timestamp: "2026-08-20T10:00:01.000Z",
			type: "user",
		}),
	].join("\n");
}

async function createTestUser(
	baseUrl: string,
): Promise<{ bearerToken: string; userId: string }> {
	const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			email: `skill-persistence-${RUN_ID}@example.com`,
			name: "Skill Persistence Test",
			password: "skill-persistence-test-password",
		}),
	});
	expect(response.ok).toBe(true);
	const body: unknown = await response.json();
	assert(isAuthResponse(body));
	const me = await fetch(`${baseUrl}/rpc/me`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${body.token}`,
			"Content-Type": "application/json",
		},
		body: "{}",
	});
	expect(me.ok).toBe(true);
	const meBody: unknown = await me.json();
	const json = readJsonEnvelope(meBody);
	assert(isRecord(json) && typeof json.id === "string");
	return { bearerToken: body.token, userId: json.id };
}

async function callRpc(
	path: string,
	input?: Record<string, unknown> | IngestSessionInput,
) {
	const response = await fetch(`${server.baseUrl}/rpc/${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${bearerToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(input ? { json: input } : {}),
	});
	return { body: await response.json(), status: response.status };
}

function readJsonEnvelope(value: unknown): unknown {
	if (isRecord(value) && "json" in value) return value.json;
	throw new Error("RPC response did not contain a json envelope");
}

function isAuthResponse(value: unknown): value is { token: string } {
	return isRecord(value) && typeof value.token === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
