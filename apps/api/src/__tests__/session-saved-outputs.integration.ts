import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	type RepositoryEvidenceInitInput,
	RepositoryEvidenceInitInputSchema,
	type RepositoryEvidenceObjectDescriptor,
} from "@rudel/api-routes";
import postgres from "postgres";
import { getClickhouse } from "../clickhouse.js";
import { deleteUserSessions } from "../services/org-session.service.js";
import {
	commitRepositoryEvidence,
	initRepositoryEvidence,
} from "../services/repository-evidence.service.js";
import { buildRepositoryEvidenceIndexRow } from "../services/repository-evidence-index.service.js";
import { publishRepositoryEvidenceIndexAfterCommit } from "../services/repository-evidence-index-publication.service.js";
import { readSessionSavedOutput } from "../services/session-saved-output-read.service.js";
import { FakeEvidenceR2 } from "./helpers/fake-evidence-r2.js";

/**
 * Saved outputs end to end (gap A1): a capture's manifest names background
 * task outputs and a large tool output; the commit stages their rows with the
 * capture, the evidence index publication writes them to
 * rudel.session_saved_outputs, the reader returns each one with its text, a
 * later capture replaces a file's row only when it knows as much, and account
 * deletion purges them. Needs local ClickHouse and Postgres (CI).
 */

setDefaultTimeout(120_000);

const RUN_ID = `saved_outputs_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const ORGANIZATION_ID = `${RUN_ID}_org`;
const USER_ID = `${RUN_ID}_user`;
const SESSION_ID = `${RUN_ID}-session`;
const clickhouse = getClickhouse();
const r2 = new FakeEvidenceR2();
// Its own client: an earlier file in the integration run ends the shared one.
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", { max: 2 });

afterAll(async () => {
	await clickhouse
		.execute({
			query:
				"DELETE FROM rudel.session_saved_outputs WHERE organization_id = {organizationId:String}",
			query_params: { organizationId: ORGANIZATION_ID },
		})
		.catch(() => {});
	await clickhouse
		.execute({
			query:
				"DELETE FROM rudel.repository_session_evidence_index WHERE organization_id = {organizationId:String}",
			query_params: { organizationId: ORGANIZATION_ID },
		})
		.catch(() => {});
	await sqlClient.unsafe(
		"DELETE FROM repository_evidence_upload_intent WHERE organization_id = $1",
		[ORGANIZATION_ID],
	);
	await sqlClient.unsafe("DELETE FROM organization WHERE id = $1", [
		ORGANIZATION_ID,
	]);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = $1', [USER_ID]);
	await sqlClient.end();
});

function object(
	content: string,
	kind: RepositoryEvidenceObjectDescriptor["kind"],
): { bytes: Uint8Array; descriptor: RepositoryEvidenceObjectDescriptor } {
	const bytes = new TextEncoder().encode(content);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	return {
		bytes,
		descriptor: {
			byteLength: bytes.byteLength,
			contentEncoding: "identity",
			filterVersion: null,
			kind,
			mediaType:
				kind === "context-manifest" ? "application/json" : "text/plain",
			objectId: `sha256:${sha256}`,
			sha256,
		},
	};
}

function fileEntry(rootId: string, path: string, content: unknown) {
	return {
		rootId,
		path,
		name: path,
		parentPath: null,
		mode: 0o100644,
		modifiedAtMs: Date.parse("2026-10-16T09:00:00.000Z"),
		categories: [],
		gitProvenance: "outside-repository",
		evidenceReason: null,
		kind: "file",
		size: 1,
		hash: { status: "omitted", reason: "not-file" },
		content,
	};
}

function stored(blob: ReturnType<typeof object>, truncatedFrom?: number) {
	return {
		status: "available",
		blobId: blob.descriptor.objectId,
		sourceByteLength: blob.descriptor.byteLength,
		storedByteLength: blob.descriptor.byteLength,
		encoding: "utf-8",
		secretFilter: { filterVersion: 3, counts: {}, redactedBytes: 0 },
		...(truncatedFrom === undefined
			? {}
			: { truncation: { kept: "tail", originalByteLength: truncatedFrom } }),
	};
}

async function captureSession(input: {
	readonly completedAt: string;
	readonly blobs: readonly ReturnType<typeof object>[];
	readonly localContext: Record<string, unknown>;
}) {
	const manifest = object(
		JSON.stringify({
			contextIndex: { facets: [], skills: [] },
			localContext: input.localContext,
		}),
		"context-manifest",
	);
	const repositoryHash = createHash("sha256").update(SESSION_ID).digest("hex");
	const evidence: RepositoryEvidenceInitInput =
		RepositoryEvidenceInitInputSchema.parse({
			capture: {
				baseGitCommit: null,
				contextId: crypto.randomUUID(),
				headGitCommit: null,
				parentContextId: null,
				timing: {
					captureCompletedAt: input.completedAt,
					captureStartedAt: input.completedAt,
					firstActionAt: null,
					firstActionBasis: "unavailable",
					firstActionRelationship: "unknown",
					lifecycle: "checkpoint",
				},
				transcriptWatermark: null,
			},
			coverage: [{ area: "git-state", reason: null, status: "complete" }],
			manifestObjectId: manifest.descriptor.objectId,
			objects: [
				manifest.descriptor,
				...input.blobs.map((blob) => blob.descriptor),
			],
			operationId: crypto.randomUUID(),
			organizationId: ORGANIZATION_ID,
			protocol: "repository_evidence_v1",
			repository: {
				local: {
					installationId: crypto.randomUUID(),
					repositoryId: `local-repository:${repositoryHash}`,
					worktreeId: `local-worktree:${repositoryHash}`,
				},
				provider: null,
				remoteHint: null,
			},
			session: {
				agentId: null,
				parentAgentId: null,
				runId: "run",
				segmentId: "segment",
				sessionId: SESSION_ID,
				source: "claude_code",
			},
		});
	const initialized = await initRepositoryEvidence({
		database: sqlClient,
		input: evidence,
		now: () => new Date(),
		organizationId: ORGANIZATION_ID,
		r2,
		randomUUID: () => crypto.randomUUID(),
		userId: USER_ID,
	});
	const bytes = new Map(
		[manifest, ...input.blobs].map((item) => [
			item.descriptor.objectId,
			item.bytes,
		]),
	);
	const committed = await commitRepositoryEvidence({
		database: sqlClient,
		input: {
			objects: initialized.missingObjects.map((missing) => {
				const content = bytes.get(missing.objectId);
				if (!content) throw new Error("Unexpected evidence object");
				return {
					objectId: missing.objectId,
					objectKey: missing.objectKey,
					parts: [
						{ etag: r2.putPart(missing.uploadId, 1, content), partNumber: 1 },
					],
					uploadId: missing.uploadId,
				};
			}),
			organizationId: ORGANIZATION_ID,
			uploadReceiptId: initialized.uploadReceiptId,
		},
		now: () => new Date(),
		organizationId: ORGANIZATION_ID,
		prepareIndex: (prepared) =>
			buildRepositoryEvidenceIndexRow(
				prepared.input,
				prepared.manifest,
				new Date(),
				USER_ID,
			),
		r2,
		randomUUID: () => crypto.randomUUID(),
		userId: USER_ID,
	});
	// Inline publication has a 3 s budget; a slow CI ClickHouse gets retries.
	for (let attempt = 0; attempt < 5; attempt++) {
		await publishRepositoryEvidenceIndexAfterCommit({
			clickhouse,
			database: sqlClient,
			organizationId: ORGANIZATION_ID,
			contextId: committed.output.contextId,
		});
		const [capture] = await sqlClient.unsafe<Array<{ published: boolean }>>(
			`SELECT index_published_at IS NOT NULL AS published
			 FROM repository_evidence_capture WHERE organization_id = $1 AND context_id = $2`,
			[ORGANIZATION_ID, committed.output.contextId],
		);
		if (capture?.published) break;
	}
	return committed.output.contextId;
}

function read(lookup: { taskId: string } | { toolUseId: string }) {
	return readSessionSavedOutput(
		{
			...lookup,
			organizationId: ORGANIZATION_ID,
			ownerId: USER_ID,
			sessionId: SESSION_ID,
		},
		{ clickhouse, database: sqlClient, r2: () => r2 },
	);
}

async function countRows(): Promise<number> {
	const [row] = await clickhouse.query<{ count: string }>({
		query:
			"SELECT count() AS count FROM rudel.session_saved_outputs FINAL WHERE organization_id = {organizationId:String}",
		query_params: { organizationId: ORGANIZATION_ID },
	});
	return Number(row?.count ?? 0);
}

const TASKS = "claude-task-outputs";
const TOOLS = "claude-tool-results";
const BUILD_REFERENCE = {
	taskId: "bbuild",
	path: "bbuild.output",
	agentId: null,
	recordIndex: 4,
	toolUseId: "toolu_build",
	source: "result",
};

describe("session saved outputs (integration)", () => {
	test("setup", async () => {
		await sqlClient.unsafe(
			`INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, 'Member', $2, false)`,
			[USER_ID, `${USER_ID}@example.com`],
		);
		await sqlClient.unsafe(
			"INSERT INTO organization (id, name, slug) VALUES ($1, 'Workspace', $1)",
			[ORGANIZATION_ID],
		);
		await sqlClient.unsafe(
			"INSERT INTO member (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'owner')",
			[`${ORGANIZATION_ID}_m`, ORGANIZATION_ID, USER_ID],
		);
	});

	test("a capture's task outputs, tool output and missing task are stored and read", async () => {
		const log = object("build started\n", "source-blob");
		const tool = object("a very large tool output\n", "source-blob");
		const contextId = await captureSession({
			completedAt: "2026-10-16T10:00:00.000Z",
			blobs: [log, tool],
			localContext: {
				entries: [
					fileEntry(TASKS, "bbuild.output", stored(log)),
					fileEntry(TOOLS, "toolu_big.txt", stored(tool)),
				],
				taskOutputReferences: {
					references: [BUILD_REFERENCE],
					omitted: 0,
					missingTaskIds: ["bgone"],
					missingTaskIdsOmitted: 0,
				},
				toolResultReferences: {
					references: [
						{
							path: "toolu_big.txt",
							agentId: null,
							recordIndex: 9,
							toolUseId: "toolu_big",
						},
					],
					omitted: 0,
				},
			},
		});
		const [staged] = await sqlClient.unsafe<
			Array<{ savedOutputs: unknown; publishedAt: string | null }>
		>(
			`SELECT saved_outputs AS "savedOutputs", index_published_at::text AS "publishedAt"
			 FROM repository_evidence_capture WHERE organization_id = $1 AND context_id = $2`,
			[ORGANIZATION_ID, contextId],
		);
		expect(Array.isArray(staged?.savedOutputs)).toBe(true);
		expect(staged?.publishedAt).not.toBeNull();
		expect(await countRows()).toBe(3);

		expect(await read({ taskId: "bbuild" })).toMatchObject({
			status: "captured",
			kind: "task_output",
			path: "bbuild.output",
			toolUseId: "toolu_build",
			recordIndex: 4,
			text: "build started\n",
		});
		expect(await read({ toolUseId: "toolu_build" })).toMatchObject({
			status: "captured",
			taskId: "bbuild",
		});
		expect(await read({ toolUseId: "toolu_big" })).toMatchObject({
			status: "captured",
			kind: "tool_result",
			text: "a very large tool output\n",
		});
		expect(await read({ taskId: "bgone" })).toMatchObject({
			status: "missing",
			path: "bgone.output",
		});
		expect(await read({ taskId: "bnever" })).toMatchObject({
			status: "not_captured",
		});
	});

	test("a later capture replaces a file's row only when it knows as much", async () => {
		const longer = object("build started\nbuild done\n", "source-blob");
		await captureSession({
			completedAt: "2026-10-16T11:00:00.000Z",
			blobs: [longer],
			localContext: {
				captureReason: "task-output-sweep",
				entries: [fileEntry(TASKS, "bbuild.output", stored(longer, 5_000_000))],
				// The tool output is gone from disk now: not listed, its row stays.
				taskOutputReferences: {
					references: [BUILD_REFERENCE],
					missingTaskIds: [],
				},
			},
		});
		expect(await read({ taskId: "bbuild" })).toMatchObject({
			status: "truncated",
			truncated: true,
			originalBytes: 5_000_000,
			captureReason: "task-output-sweep",
			text: "build started\nbuild done\n",
			toolUseId: "toolu_build",
		});
		await captureSession({
			completedAt: "2026-10-16T12:00:00.000Z",
			blobs: [],
			localContext: {
				entries: [
					fileEntry(TASKS, "bbuild.output", {
						status: "omitted",
						reason: "total-content-cap",
						detail: null,
					}),
				],
				taskOutputReferences: { references: [], missingTaskIds: ["bgone"] },
			},
		});
		expect(await read({ taskId: "bbuild" })).toMatchObject({
			status: "truncated",
			text: "build started\nbuild done\n",
		});
		expect(await read({ toolUseId: "toolu_big" })).toMatchObject({
			status: "captured",
		});
		expect(await countRows()).toBe(3);
	});

	test("account deletion purges the rows", async () => {
		await deleteUserSessions(USER_ID);
		expect(await countRows()).toBe(0);
	});
});
