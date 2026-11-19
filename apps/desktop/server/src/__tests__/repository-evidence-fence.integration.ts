import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
	type RepositoryEvidenceInitInput,
	RepositoryEvidenceInitInputSchema,
	type RepositoryEvidenceObjectDescriptor,
} from "@rudel/api-routes";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { ClickHouseWriteFencedError } from "../lib/clickhouse-write-fence.js";
import {
	type ClickHousePurgePass,
	purgeRepositoryEvidenceObjects,
	runClickHousePurgeWorkerOnce,
	runClickHousePurgeWorkerPass,
} from "../services/clickhouse-purge.service.js";
import { assertNoClickHousePurgeTombstone } from "../services/clickhouse-purge-tombstone.service.js";
import {
	commitRepositoryEvidence,
	initRepositoryEvidence,
	RepositoryEvidenceStateError,
} from "../services/repository-evidence.service.js";
import { EVIDENCE_R2_CONCURRENCY } from "../services/repository-evidence-batching.js";
import { sweepRepositoryEvidence } from "../services/repository-evidence-fence.service.js";
import { buildRepositoryEvidenceIndexRow } from "../services/repository-evidence-index.service.js";
import {
	publishRepositoryEvidenceIndexAfterCommit,
	runRepositoryEvidenceIndexPublisherPass,
} from "../services/repository-evidence-index-publication.service.js";
import { deleteUserPostgresData } from "../services/user-deletion.service.js";
import {
	FakeEvidenceR2,
	NoSuchUploadError,
} from "./helpers/fake-evidence-r2.js";

setDefaultTimeout(120_000);

const RUN_ID = `evidence_fence_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const USER_IDS: string[] = [];
const ORGANIZATION_IDS: string[] = [];

afterEach(async () => {
	const organizationIds = ORGANIZATION_IDS.splice(0);
	const userIds = USER_IDS.splice(0);
	await sqlClient.unsafe(
		"DELETE FROM repository_evidence_upload_intent WHERE organization_id = ANY($1::text[]) OR user_id = ANY($2::text[])",
		[organizationIds, userIds],
	);
	await sqlClient.unsafe(
		"DELETE FROM clickhouse_purge_job WHERE target_id = ANY($1::text[])",
		[[...organizationIds, ...userIds]],
	);
	await sqlClient.unsafe(
		"DELETE FROM organization WHERE id = ANY($1::text[])",
		[organizationIds],
	);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = ANY($1::text[])', [
		userIds,
	]);
});

interface Fixture {
	readonly organizationId: string;
	readonly survivorId: string;
	readonly victimId: string;
}

async function createFixture(name: string): Promise<Fixture> {
	const organizationId = `${RUN_ID}_${name}_org`;
	const victimId = `${RUN_ID}_${name}_victim`;
	const survivorId = `${RUN_ID}_${name}_survivor`;
	USER_IDS.push(victimId, survivorId);
	ORGANIZATION_IDS.push(organizationId);
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email, email_verified)
		 VALUES ($1, 'Victim', $2, false), ($3, 'Survivor', $4, false)`,
		[
			victimId,
			`${victimId}@example.com`,
			survivorId,
			`${survivorId}@example.com`,
		],
	);
	await sqlClient.unsafe(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'Workspace', $1)",
		[organizationId],
	);
	await sqlClient.unsafe(
		`INSERT INTO member (id, organization_id, user_id, role)
		 VALUES ($1, $2, $3, 'member'), ($4, $2, $5, 'owner')`,
		[
			`${organizationId}_m1`,
			organizationId,
			victimId,
			`${organizationId}_m2`,
			survivorId,
		],
	);
	return { organizationId, survivorId, victimId };
}

function buildObject(
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

function buildEvidence(input: {
	readonly manifest: ReturnType<typeof buildObject>;
	readonly organizationId: string;
	readonly payload: ReturnType<typeof buildObject>;
	readonly sessionId: string;
}): RepositoryEvidenceInitInput {
	const repositoryHash = createHash("sha256")
		.update(input.sessionId)
		.digest("hex");
	return RepositoryEvidenceInitInputSchema.parse({
		capture: {
			baseGitCommit: null,
			contextId: crypto.randomUUID(),
			headGitCommit: null,
			parentContextId: null,
			timing: {
				captureCompletedAt: "2026-09-30T10:00:01.000Z",
				captureStartedAt: "2026-09-30T10:00:00.000Z",
				firstActionAt: null,
				firstActionBasis: "unavailable",
				firstActionRelationship: "unknown",
				lifecycle: "end",
			},
			transcriptWatermark: null,
		},
		coverage: [{ area: "git-state", reason: null, status: "complete" }],
		manifestObjectId: input.manifest.descriptor.objectId,
		objects: [input.manifest.descriptor, input.payload.descriptor],
		operationId: crypto.randomUUID(),
		organizationId: input.organizationId,
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
			sessionId: input.sessionId,
			source: "codex",
		},
	});
}

function newEvidence(
	organizationId: string,
	sessionId: string,
	payloadContent: string,
) {
	const manifest = buildObject(
		JSON.stringify({
			unique: crypto.randomUUID(),
			contextIndex: { facets: [], skills: [] },
		}),
		"context-manifest",
	);
	const payload = buildObject(payloadContent, "source-blob");
	return {
		input: buildEvidence({ manifest, organizationId, payload, sessionId }),
		manifest,
		payload,
	};
}

async function uploadAndCommit(input: {
	readonly evidence: ReturnType<typeof newEvidence>;
	readonly initialized: Awaited<ReturnType<typeof initRepositoryEvidence>>;
	readonly organizationId: string;
	readonly r2: FakeEvidenceR2;
	readonly userId: string;
}) {
	const bytesByObjectId = new Map([
		[
			input.evidence.manifest.descriptor.objectId,
			input.evidence.manifest.bytes,
		],
		[input.evidence.payload.descriptor.objectId, input.evidence.payload.bytes],
	]);
	const objects = input.initialized.missingObjects.map((object) => {
		const bytes = bytesByObjectId.get(object.objectId);
		if (!bytes) throw new Error("Unexpected evidence object");
		const etag = input.r2.putPart(object.uploadId, 1, bytes);
		return {
			objectId: object.objectId,
			objectKey: object.objectKey,
			parts: [{ etag, partNumber: 1 }],
			uploadId: object.uploadId,
		};
	});
	return commitRepositoryEvidence({
		database: sqlClient,
		input: {
			objects,
			organizationId: input.organizationId,
			uploadReceiptId: input.initialized.uploadReceiptId,
		},
		now: () => new Date(),
		organizationId: input.organizationId,
		prepareIndex: (evidence) =>
			buildRepositoryEvidenceIndexRow(
				evidence.input,
				evidence.manifest,
				new Date(),
				input.userId,
			),
		r2: input.r2,
		randomUUID: () => crypto.randomUUID(),
		userId: input.userId,
	});
}

function initialize(
	fixture: Fixture,
	userId: string,
	evidence: ReturnType<typeof newEvidence>,
	r2: FakeEvidenceR2,
	now: () => Date = () => new Date(),
) {
	return initRepositoryEvidence({
		database: sqlClient,
		input: evidence.input,
		now,
		organizationId: fixture.organizationId,
		r2,
		randomUUID: () => crypto.randomUUID(),
		userId,
	});
}

async function countRows(sql: string, parameters: string[]): Promise<number> {
	const [row] = await sqlClient.unsafe<Array<{ count: number }>>(
		sql,
		parameters,
	);
	return row?.count ?? 0;
}

async function initializeForPublication(name: string) {
	const fixture = await createFixture(name);
	const r2 = new FakeEvidenceR2();
	const evidence = newEvidence(
		fixture.organizationId,
		`${RUN_ID}-${name}`,
		"publication",
	);
	const initialized = await initialize(fixture, fixture.victimId, evidence, r2);
	return {
		fixture,
		evidence,
		initialized,
		organizationId: fixture.organizationId,
		r2,
		userId: fixture.victimId,
		contextId: evidence.input.capture.contextId,
		database: sqlClient,
	};
}

async function commitForPublication(name: string) {
	const input = await initializeForPublication(name);
	return { ...input, committed: await uploadAndCommit(input) };
}

async function readPublication(organizationId: string) {
	const [row] = await sqlClient.unsafe<
		Array<{
			indexRow: unknown;
			publishedAt: string | null;
			nextAttemptAt: string;
		}>
	>(
		`SELECT index_row AS "indexRow", index_published_at::text AS "publishedAt",
		 index_next_attempt_at::text AS "nextAttemptAt" FROM repository_evidence_capture
		 WHERE organization_id = $1`,
		[organizationId],
	);
	assert(row);
	return row;
}

async function makePublicationDue(organizationId: string) {
	await sqlClient.unsafe(
		"UPDATE repository_evidence_capture SET index_next_attempt_at = NOW() WHERE organization_id = $1",
		[organizationId],
	);
}

async function countPublished(organizationId: string) {
	const [row] = await getClickhouse().query<{ count: number }>({
		query: `SELECT count() AS count FROM rudel.repository_session_evidence_index FINAL
		 WHERE organization_id = {organizationId:String} SETTINGS max_execution_time=10`,
		query_params: { organizationId },
	});
	assert(row);
	return row.count;
}

describe("durable repository evidence index publication", () => {
	test("quarantines a permanently invalid stored row without holding back healthy rows", async () => {
		const poisoned = await commitForPublication("poison-index");
		const healthy = await commitForPublication("healthy-index");
		await sqlClient.unsafe(
			"UPDATE repository_evidence_capture SET index_published_at = NULL, index_next_attempt_at = NOW() WHERE organization_id = ANY($1::text[])",
			[[poisoned.organizationId, healthy.organizationId]],
		);
		await sqlClient.unsafe(
			`UPDATE repository_evidence_capture SET index_row = '{"context_id":"not-a-uuid"}'::jsonb WHERE organization_id = $1`,
			[poisoned.organizationId],
		);
		for (let pass = 0; pass < 2; pass += 1) {
			await runRepositoryEvidenceIndexPublisherPass({
				database: sqlClient,
				clickhouse: getClickhouse(),
			});
			await makePublicationDue(healthy.organizationId);
		}
		expect(await countPublished(healthy.organizationId)).toBe(1);
		expect(
			(await readPublication(healthy.organizationId)).publishedAt,
		).not.toBeNull();
		const quarantined = await readPublication(poisoned.organizationId);
		expect(quarantined.publishedAt).toBeNull();
		expect(String(quarantined.nextAttemptAt)).toContain("infinity");
		expect(await countPublished(poisoned.organizationId)).toBe(0);
	});

	test("publishes healthy rows one by one when ClickHouse rejects the batch", async () => {
		const first = await commitForPublication("isolated-index-a");
		const second = await commitForPublication("isolated-index-b");
		await sqlClient.unsafe(
			"UPDATE repository_evidence_capture SET index_published_at = NULL, index_next_attempt_at = NOW() WHERE organization_id = ANY($1::text[])",
			[[first.organizationId, second.organizationId]],
		);
		const clickhouse = getClickhouse();
		const pass = await runRepositoryEvidenceIndexPublisherPass({
			database: sqlClient,
			clickhouse: {
				...clickhouse,
				insert: (params: Parameters<typeof clickhouse.insert>[0]) => {
					const rows = params.values as Array<{ organization_id: string }>;
					if (rows.some((row) => row.organization_id === first.organizationId))
						return Promise.reject(new Error("ClickHouse rejected the row"));
					return clickhouse.insert(params);
				},
			},
		});
		expect(pass.published).toBeGreaterThanOrEqual(1);
		expect(await countPublished(second.organizationId)).toBe(1);
		expect(await countPublished(first.organizationId)).toBe(0);
		const deferred = await readPublication(first.organizationId);
		expect(deferred.publishedAt).toBeNull();
		expect(new Date(deferred.nextAttemptAt).getTime()).toBeGreaterThan(
			Date.now() + 50_000,
		);
	});

	test("publishes many pending captures with one ClickHouse insert", async () => {
		const first = await commitForPublication("batch-index-a");
		const second = await commitForPublication("batch-index-b");
		await sqlClient.unsafe(
			"UPDATE repository_evidence_capture SET index_published_at = NULL, index_next_attempt_at = NOW() WHERE organization_id = ANY($1::text[])",
			[[first.organizationId, second.organizationId]],
		);
		const clickhouse = getClickhouse();
		let inserts = 0;
		const pass = await runRepositoryEvidenceIndexPublisherPass({
			database: sqlClient,
			clickhouse: {
				...clickhouse,
				insert: (params: Parameters<typeof clickhouse.insert>[0]) => {
					inserts += 1;
					return clickhouse.insert(params);
				},
			},
		});
		expect(pass.published).toBeGreaterThanOrEqual(2);
		expect(inserts).toBe(1);
		expect(await countPublished(first.organizationId)).toBe(1);
		expect(await countPublished(second.organizationId)).toBe(1);
	});

	test("commits successfully with an insert slower than three seconds and publishes in a later pass", async () => {
		const input = await initializeForPublication("slow-index");
		const clickhouse = getClickhouse();
		let aborted = false;
		const slowExecutor = {
			...clickhouse,
			async insert(params: Parameters<typeof clickhouse.insert>[0]) {
				assert(params.abortSignal);
				params.abortSignal.addEventListener(
					"abort",
					() => {
						aborted = true;
					},
					{ once: true },
				);
				await delay(10_000, undefined, { signal: params.abortSignal });
				await clickhouse.insert(params);
			},
		};
		const startedAt = performance.now();
		const committed = await uploadAndCommit(input);
		await assertNoClickHousePurgeTombstone(input, { database: sqlClient });
		await publishRepositoryEvidenceIndexAfterCommit({
			...input,
			clickhouse: slowExecutor,
		});
		expect(performance.now() - startedAt).toBeLessThan(5_000);
		expect(aborted).toBe(true);
		expect(committed.output.status).toBe("accepted");
		const pending = await readPublication(input.organizationId);
		expect(pending.indexRow).toEqual(committed.preparedIndex);
		expect(pending.publishedAt).toBeNull();
		expect(await countPublished(input.organizationId)).toBe(0);
		await makePublicationDue(input.organizationId);
		const pass = await runRepositoryEvidenceIndexPublisherPass({
			database: sqlClient,
			clickhouse,
		});
		expect(pass.published).toBe(1);
		expect(
			(await readPublication(input.organizationId)).publishedAt,
		).not.toBeNull();
		expect(await countPublished(input.organizationId)).toBe(1);
	});

	test("keeps the commit successful when inline publication fails", async () => {
		const input = await commitForPublication("scheduling-failure");
		const clickhouse = getClickhouse();
		await publishRepositoryEvidenceIndexAfterCommit({
			...input,
			clickhouse: {
				...clickhouse,
				insert: (params) =>
					clickhouse.insert({
						...params,
						values: [{ ...params.values[0], context_id: "not-a-uuid" }],
					}),
			},
		});
		expect(input.committed.output.status).toBe("accepted");
		expect(
			(await readPublication(input.organizationId)).publishedAt,
		).toBeNull();
		await makePublicationDue(input.organizationId);
		expect((await runRepositoryEvidenceIndexPublisherPass()).published).toBe(1);
		expect(await countPublished(input.organizationId)).toBe(1);
	});

	test("backs off a real ClickHouse failure and eventually publishes the same prepared row", async () => {
		const input = await commitForPublication("failed-index");
		const clickhouse = getClickhouse();
		const failingExecutor = {
			...clickhouse,
			insert: (params: Parameters<typeof clickhouse.insert>[0]) =>
				clickhouse.insert({
					...params,
					values: [{ ...params.values[0], context_id: "not-a-uuid" }],
				}),
		};
		const failed = await runRepositoryEvidenceIndexPublisherPass({
			database: sqlClient,
			clickhouse: failingExecutor,
		});
		expect(failed).toMatchObject({
			attempted: 1,
			published: 0,
			hasMore: false,
		});
		const pending = await readPublication(input.organizationId);
		expect(pending.publishedAt).toBeNull();
		expect(new Date(pending.nextAttemptAt).getTime()).toBeGreaterThan(
			Date.now() + 50_000,
		);
		expect(await countPublished(input.organizationId)).toBe(0);
		const deferred = await runRepositoryEvidenceIndexPublisherPass({
			database: sqlClient,
			clickhouse,
		});
		expect(deferred.attempted).toBe(0);
		await makePublicationDue(input.organizationId);
		const retried = await runRepositoryEvidenceIndexPublisherPass({
			database: sqlClient,
			clickhouse,
		});
		expect(retried.published).toBe(1);
		expect((await readPublication(input.organizationId)).indexRow).toEqual(
			input.committed.preparedIndex,
		);
		expect(
			(await readPublication(input.organizationId)).publishedAt,
		).not.toBeNull();
		expect(await countPublished(input.organizationId)).toBe(1);
	});

	test.each([
		"account",
		"organization",
	])("drops publication when a %s purge tombstone exists", async (targetType) => {
		const input = await commitForPublication(`purged-index-${targetType}`);
		await sqlClient.unsafe(
			"INSERT INTO clickhouse_purge_job (id, target_type, target_id, max_attempts) VALUES ($1, $2, $3, 5)",
			[
				crypto.randomUUID(),
				targetType,
				targetType === "account"
					? input.fixture.victimId
					: input.organizationId,
			],
		);
		const pass = await runRepositoryEvidenceIndexPublisherPass({
			database: sqlClient,
			clickhouse: getClickhouse(),
		});
		expect(pass).toMatchObject({ attempted: 1, published: 0, hasMore: false });
		const dropped = await readPublication(input.organizationId);
		expect(dropped.indexRow).toBeNull();
		expect(dropped.publishedAt).toBeNull();
		expect(await countPublished(input.organizationId)).toBe(0);
	});

	test("publishes inline on the fast path", async () => {
		const input = await commitForPublication("fast-index");
		await publishRepositoryEvidenceIndexAfterCommit({
			...input,
			clickhouse: getClickhouse(),
		});
		expect(input.committed.output.status).toBe("accepted");
		expect(
			(await readPublication(input.organizationId)).publishedAt,
		).not.toBeNull();
		expect(await countPublished(input.organizationId)).toBe(1);
		await publishRepositoryEvidenceIndexAfterCommit({
			...input,
			clickhouse: getClickhouse(),
		});
		expect(await countPublished(input.organizationId)).toBe(1);
		expect((await runRepositoryEvidenceIndexPublisherPass()).attempted).toBe(0);
	});
});

describe("repository evidence session ownership", () => {
	test("rejects evidence for a session owned by another member before reserving anything", async () => {
		const fixture = await createFixture("ownership");
		const r2 = new FakeEvidenceR2();
		const sessionId = `${RUN_ID}-owned-session`;
		await sqlClient.unsafe(
			"INSERT INTO session_ownership (organization_id, session_id, user_id) VALUES ($1, $2, $3)",
			[fixture.organizationId, sessionId, fixture.survivorId],
		);
		const evidence = newEvidence(fixture.organizationId, sessionId, "payload");

		const rejection = initialize(fixture, fixture.victimId, evidence, r2).catch(
			(error: unknown) => error,
		);

		const error = await rejection;
		expect(error).toBeInstanceOf(RepositoryEvidenceStateError);
		expect((error as RepositoryEvidenceStateError).code).toBe(
			"EVIDENCE_SESSION_CONFLICT",
		);
		expect(r2.uploads.size).toBe(0);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM repository_evidence_object WHERE organization_id = $1",
				[fixture.organizationId],
			),
		).toBe(0);
	});

	test("reserves the session for a start capture that precedes raw ingest and rechecks it at commit", async () => {
		const fixture = await createFixture("reserve");
		const r2 = new FakeEvidenceR2();
		const sessionId = `${RUN_ID}-start-session`;
		const evidence = newEvidence(fixture.organizationId, sessionId, "payload");

		const initialized = await initialize(
			fixture,
			fixture.victimId,
			evidence,
			r2,
		);

		const [reserved] = await sqlClient.unsafe<Array<{ userId: string }>>(
			`SELECT user_id AS "userId" FROM session_ownership
			 WHERE organization_id = $1 AND session_id = $2`,
			[fixture.organizationId, sessionId],
		);
		expect(reserved?.userId).toBe(fixture.victimId);
		await sqlClient.unsafe(
			"UPDATE session_ownership SET user_id = $3 WHERE organization_id = $1 AND session_id = $2",
			[fixture.organizationId, sessionId, fixture.survivorId],
		);
		const commit = uploadAndCommit({
			evidence,
			initialized,
			organizationId: fixture.organizationId,
			r2,
			userId: fixture.victimId,
		}).catch((error: unknown) => error);
		const error = await commit;
		expect((error as RepositoryEvidenceStateError).code).toBe(
			"EVIDENCE_SESSION_CONFLICT",
		);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM repository_evidence_capture WHERE organization_id = $1",
				[fixture.organizationId],
			),
		).toBe(0);
	});
});

describe("repository evidence deletion fence", () => {
	test("deleting a member during the first creation window preserves another member's shared upload", async () => {
		const fixture = await createFixture("overlapping-init");
		const creationStarted = Promise.withResolvers<void>();
		const releaseCreation = Promise.withResolvers<void>();
		class GatedEvidenceR2 extends FakeEvidenceR2 {
			blockParts = false;

			override async presignUploadPart(
				input: Parameters<FakeEvidenceR2["presignUploadPart"]>[0],
			): Promise<string> {
				if (this.blockParts) {
					creationStarted.resolve();
					await releaseCreation.promise;
				}
				return super.presignUploadPart(input);
			}
		}
		const r2 = new GatedEvidenceR2();
		const survivorEvidence = newEvidence(
			fixture.organizationId,
			`${RUN_ID}-overlap-survivor`,
			"overlapping payload",
		);
		const survivorInit = await initialize(
			fixture,
			fixture.survivorId,
			survivorEvidence,
			r2,
		);
		const sharedUpload = survivorInit.missingObjects.find(
			(object) =>
				object.objectId === survivorEvidence.payload.descriptor.objectId,
		);
		assert(sharedUpload);
		const victimEvidence = newEvidence(
			fixture.organizationId,
			`${RUN_ID}-overlap-victim`,
			"overlapping payload",
		);
		const victimInput = {
			...victimEvidence,
			input: {
				...victimEvidence.input,
				objects: [
					victimEvidence.manifest.descriptor,
					...Array.from(
						{ length: EVIDENCE_R2_CONCURRENCY - 1 },
						(_, index) =>
							buildObject(`victim-only ${index}`, "source-blob").descriptor,
					),
					victimEvidence.payload.descriptor,
				],
			},
		};
		r2.blockParts = true;
		const victimResult = initialize(
			fixture,
			fixture.victimId,
			victimInput,
			r2,
		).catch((error: unknown) => error);
		await creationStarted.promise;
		try {
			expect(
				await countRows(
					"SELECT COUNT(*)::int AS count FROM repository_evidence_upload_intent WHERE user_id = $1 AND object_key = $2 AND upload_id IS NULL",
					[fixture.victimId, sharedUpload.objectKey],
				),
			).toBe(1);
			await deleteUserPostgresData(fixture.victimId, { sqlClient });
			const [job] = await sqlClient.unsafe<Array<{ id: string }>>(
				"SELECT id FROM clickhouse_purge_job WHERE target_type = 'account' AND target_id = $1",
				[fixture.victimId],
			);
			assert(job);
			await purgeRepositoryEvidenceObjects(
				{ targetId: fixture.victimId, targetType: "account" },
				{ finalPass: false, purgeJobId: job.id },
				sqlClient,
				r2,
			);
			expect(r2.abortedUploadIds).not.toContain(sharedUpload.uploadId);
			expect(r2.uploads.has(sharedUpload.uploadId)).toBe(true);
			await uploadAndCommit({
				evidence: survivorEvidence,
				initialized: survivorInit,
				organizationId: fixture.organizationId,
				r2,
				userId: fixture.survivorId,
			});
		} finally {
			releaseCreation.resolve();
			await victimResult;
		}
		expect(await victimResult).toBeInstanceOf(ClickHouseWriteFencedError);
		const [job] = await sqlClient.unsafe<Array<{ id: string }>>(
			"SELECT id FROM clickhouse_purge_job WHERE target_type = 'account' AND target_id = $1",
			[fixture.victimId],
		);
		assert(job);
		await purgeRepositoryEvidenceObjects(
			{ targetId: fixture.victimId, targetType: "account" },
			{ finalPass: true, purgeJobId: job.id },
			sqlClient,
			r2,
		);
		expect(r2.objects.has(sharedUpload.objectKey)).toBe(true);
		expect(r2.uploads.size).toBe(0);
	});

	test("rejects init and commit once a deletion tombstone exists and creates no multipart upload", async () => {
		const fixture = await createFixture("tombstone");
		const r2 = new FakeEvidenceR2();
		const sessionId = `${RUN_ID}-tombstone-session`;
		const evidence = newEvidence(fixture.organizationId, sessionId, "payload");
		const initialized = await initialize(
			fixture,
			fixture.victimId,
			evidence,
			r2,
		);
		const uploadsBefore = r2.uploads.size;
		await sqlClient.unsafe(
			`INSERT INTO clickhouse_purge_job (id, target_type, target_id, max_attempts)
			 VALUES ($1, 'account', $2, 5)`,
			[crypto.randomUUID(), fixture.victimId],
		);

		const commitError = await uploadAndCommit({
			evidence,
			initialized,
			organizationId: fixture.organizationId,
			r2,
			userId: fixture.victimId,
		}).catch((error: unknown) => error);
		const laterEvidence = newEvidence(
			fixture.organizationId,
			`${sessionId}-later`,
			"later",
		);
		const initError = await initialize(
			fixture,
			fixture.victimId,
			laterEvidence,
			r2,
		).catch((error: unknown) => error);

		expect(commitError).toBeInstanceOf(ClickHouseWriteFencedError);
		expect(initError).toBeInstanceOf(ClickHouseWriteFencedError);
		expect(r2.uploads.size).toBe(uploadsBefore);
		expect(
			[...r2.objects.keys()].filter((key) => key.startsWith("evidence/")),
		).toEqual([]);
		await expect(
			assertNoClickHousePurgeTombstone(
				{
					organizationId: fixture.organizationId,
					userId: fixture.survivorId,
				},
				{ database: sqlClient },
			),
		).resolves.toBeUndefined();
	});

	test("a queued account purge never deletes content a surviving member re-uploads afterwards", async () => {
		const fixture = await createFixture("reacquire");
		const r2 = new FakeEvidenceR2();
		const victimSession = `${RUN_ID}-victim-session`;
		const survivorSession = `${RUN_ID}-survivor-session`;
		const sharedPayload = "identical content";
		const victimEvidence = newEvidence(
			fixture.organizationId,
			victimSession,
			sharedPayload,
		);
		const victimInit = await initialize(
			fixture,
			fixture.victimId,
			victimEvidence,
			r2,
		);
		await uploadAndCommit({
			evidence: victimEvidence,
			initialized: victimInit,
			organizationId: fixture.organizationId,
			r2,
			userId: fixture.victimId,
		});
		const victimPayloadKey = victimInit.missingObjects.find(
			(object) =>
				object.objectId === victimEvidence.payload.descriptor.objectId,
		)?.objectKey;
		if (!victimPayloadKey) throw new Error("Expected a victim payload key");

		await deleteUserPostgresData(fixture.victimId, { sqlClient });
		const survivorEvidence = newEvidence(
			fixture.organizationId,
			survivorSession,
			sharedPayload,
		);
		const survivorInit = await initialize(
			fixture,
			fixture.survivorId,
			survivorEvidence,
			r2,
		);
		await uploadAndCommit({
			evidence: survivorEvidence,
			initialized: survivorInit,
			organizationId: fixture.organizationId,
			r2,
			userId: fixture.survivorId,
		});
		const survivorPayloadKey = survivorInit.missingObjects.find(
			(object) =>
				object.objectId === survivorEvidence.payload.descriptor.objectId,
		)?.objectKey;
		const [job] = await sqlClient.unsafe<Array<{ id: string }>>(
			"SELECT id FROM clickhouse_purge_job WHERE target_type = 'account' AND target_id = $1",
			[fixture.victimId],
		);
		if (!job) throw new Error("Expected the account purge job");

		await purgeRepositoryEvidenceObjects(
			{ targetId: fixture.victimId, targetType: "account" },
			{ finalPass: true, purgeJobId: job.id },
			sqlClient,
			r2,
		);

		expect(survivorPayloadKey).toBeDefined();
		expect(survivorPayloadKey).not.toBe(victimPayloadKey);
		expect(r2.deletedKeys).toContain(victimPayloadKey);
		expect(r2.objects.has(victimPayloadKey)).toBe(false);
		expect(r2.objects.has(survivorPayloadKey ?? "")).toBe(true);
		const [survivorObject] = await sqlClient.unsafe<Array<{ status: string }>>(
			"SELECT status FROM repository_evidence_object WHERE organization_id = $1 AND object_key = $2",
			[fixture.organizationId, survivorPayloadKey ?? ""],
		);
		expect(survivorObject?.status).toBe("available");
	});

	test("account deletion aborts multipart uploads that were never committed", async () => {
		const fixture = await createFixture("abort");
		const r2 = new FakeEvidenceR2();
		const evidence = newEvidence(
			fixture.organizationId,
			`${RUN_ID}-abort-session`,
			"never committed",
		);
		const initialized = await initialize(
			fixture,
			fixture.victimId,
			evidence,
			r2,
		);
		const uploadIds = initialized.missingObjects.map(
			(object) => object.uploadId,
		);
		expect(uploadIds.length).toBeGreaterThan(0);

		await deleteUserPostgresData(fixture.victimId, { sqlClient });
		const [job] = await sqlClient.unsafe<Array<{ id: string }>>(
			"SELECT id FROM clickhouse_purge_job WHERE target_type = 'account' AND target_id = $1",
			[fixture.victimId],
		);
		if (!job) throw new Error("Expected the account purge job");
		await purgeRepositoryEvidenceObjects(
			{ targetId: fixture.victimId, targetType: "account" },
			{ finalPass: true, purgeJobId: job.id },
			sqlClient,
			r2,
		);

		expect(r2.abortedUploadIds.sort()).toEqual([...uploadIds].sort());
		expect(r2.uploads.size).toBe(0);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM repository_evidence_upload_intent WHERE user_id = $1",
				[fixture.victimId],
			),
		).toBe(0);
	});

	test("the second purge pass deletes an object an in-flight commit materialized after the first pass", async () => {
		const fixture = await createFixture("followup");
		const r2 = new FakeEvidenceR2();
		const evidence = newEvidence(
			fixture.organizationId,
			`${RUN_ID}-followup-session`,
			"late write",
		);
		const initialized = await initialize(
			fixture,
			fixture.victimId,
			evidence,
			r2,
		);
		await deleteUserPostgresData(fixture.victimId, { sqlClient });
		const [job] = await sqlClient.unsafe<Array<{ id: string }>>(
			`SELECT id FROM clickhouse_purge_job
			 WHERE target_type = 'account' AND target_id = $1`,
			[fixture.victimId],
		);
		if (!job) throw new Error("Expected the account purge job");
		const firstPass: ClickHousePurgePass = {
			finalPass: false,
			purgeJobId: job.id,
		};
		await purgeRepositoryEvidenceObjects(
			{ targetId: fixture.victimId, targetType: "account" },
			firstPass,
			sqlClient,
			r2,
		);
		const payloadUpload = initialized.missingObjects.find(
			(object) => object.objectId === evidence.payload.descriptor.objectId,
		);
		if (!payloadUpload) throw new Error("Expected a payload upload");
		r2.objects.set(payloadUpload.objectKey, {
			bytes: evidence.payload.bytes,
			metadata: {},
		});

		await purgeRepositoryEvidenceObjects(
			{ targetId: fixture.victimId, targetType: "account" },
			{ ...firstPass, finalPass: true },
			sqlClient,
			r2,
		);

		expect(r2.objects.has(payloadUpload.objectKey)).toBe(false);
	});

	test("schedules one follow-up pass after a successful purge and runs it once it is due", async () => {
		const fixture = await createFixture("schedule");
		await deleteUserPostgresData(fixture.victimId, { sqlClient });
		const passes: boolean[] = [];
		const env = {
			executePurge: async (_target: unknown, pass?: ClickHousePurgePass) => {
				passes.push(pass?.finalPass ?? false);
			},
			leaseDurationMs: 60_000,
			now: () => new Date(),
			random: () => 0,
			sqlClient,
		};

		await runClickHousePurgeWorkerOnce(env);
		const [afterFirst] = await sqlClient.unsafe<
			Array<{ followupScheduled: boolean; status: string }>
		>(
			`SELECT status, followup_due_at > NOW() AS "followupScheduled"
			 FROM clickhouse_purge_job
			 WHERE target_type = 'account' AND target_id = $1`,
			[fixture.victimId],
		);
		const notYetDue = await runClickHousePurgeWorkerOnce(env);
		await sqlClient.unsafe(
			"UPDATE clickhouse_purge_job SET followup_due_at = NOW() - INTERVAL '1 second' WHERE target_type = 'account' AND target_id = $1",
			[fixture.victimId],
		);
		await runClickHousePurgeWorkerOnce(env);
		const [afterSecond] = await sqlClient.unsafe<
			Array<{ followupDueAt: Date | null; status: string }>
		>(
			`SELECT status, followup_due_at AS "followupDueAt"
			 FROM clickhouse_purge_job
			 WHERE target_type = 'account' AND target_id = $1`,
			[fixture.victimId],
		);

		expect(passes).toEqual([false, true]);
		expect(notYetDue).toBe(false);
		expect(afterFirst).toEqual({
			followupScheduled: true,
			status: "succeeded",
		});
		expect(afterSecond).toEqual({ followupDueAt: null, status: "succeeded" });
	});
});

describe("repository evidence sweeper", () => {
	test("retains unidentified uploads on a live shared generation until that generation is removed", async () => {
		const fixture = await createFixture("unknown-shared-owner");
		const r2 = new FakeEvidenceR2();
		const victimEvidence = newEvidence(
			fixture.organizationId,
			`${RUN_ID}-unknown-victim`,
			"shared unknown upload",
		);
		const survivorEvidence = newEvidence(
			fixture.organizationId,
			`${RUN_ID}-unknown-survivor`,
			"shared unknown upload",
		);
		const victimInit = await initialize(
			fixture,
			fixture.victimId,
			victimEvidence,
			r2,
		);
		const survivorInit = await initialize(
			fixture,
			fixture.survivorId,
			survivorEvidence,
			r2,
		);
		const unknownUpload = victimInit.missingObjects.find(
			(object) =>
				object.objectId === victimEvidence.payload.descriptor.objectId,
		);
		const survivorUpload = survivorInit.missingObjects.find(
			(object) =>
				object.objectId === survivorEvidence.payload.descriptor.objectId,
		);
		assert(unknownUpload);
		assert(survivorUpload);
		expect(unknownUpload.objectKey).toBe(survivorUpload.objectKey);
		await sqlClient.unsafe(
			"UPDATE repository_evidence_upload_intent SET upload_id = NULL WHERE upload_receipt_id = $1 AND object_key = $2",
			[victimInit.uploadReceiptId, unknownUpload.objectKey],
		);
		await deleteUserPostgresData(fixture.victimId, { sqlClient });
		const [job] = await sqlClient.unsafe<Array<{ id: string }>>(
			"SELECT id FROM clickhouse_purge_job WHERE target_type = 'account' AND target_id = $1",
			[fixture.victimId],
		);
		assert(job);
		await purgeRepositoryEvidenceObjects(
			{ targetId: fixture.victimId, targetType: "account" },
			{ finalPass: true, purgeJobId: job.id },
			sqlClient,
			r2,
		);
		const liveSweepNow = new Date();
		await sqlClient.unsafe(
			"UPDATE repository_evidence_upload_intent SET due_at = $2 WHERE upload_receipt_id = $1",
			[victimInit.uploadReceiptId, liveSweepNow.toISOString()],
		);
		await sweepRepositoryEvidence({
			database: sqlClient,
			r2,
			now: liveSweepNow,
		});
		expect(r2.uploads.has(unknownUpload.uploadId)).toBe(true);
		expect(r2.uploads.has(survivorUpload.uploadId)).toBe(true);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM repository_evidence_upload_intent WHERE upload_receipt_id = $1 AND upload_id IS NULL AND due_at > $2",
				[victimInit.uploadReceiptId, liveSweepNow.toISOString()],
			),
		).toBe(1);
		await uploadAndCommit({
			evidence: survivorEvidence,
			initialized: survivorInit,
			organizationId: fixture.organizationId,
			r2,
			userId: fixture.survivorId,
		});
		await deleteUserPostgresData(fixture.survivorId, { sqlClient });
		const removedSweepNow = new Date();
		await sqlClient.unsafe(
			"UPDATE repository_evidence_upload_intent SET due_at = $2 WHERE upload_receipt_id = $1",
			[victimInit.uploadReceiptId, removedSweepNow.toISOString()],
		);
		await sweepRepositoryEvidence({
			database: sqlClient,
			r2,
			now: removedSweepNow,
		});
		expect(r2.abortedUploadIds).toContain(unknownUpload.uploadId);
		expect(r2.abortedUploadIds).not.toContain(survivorUpload.uploadId);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM repository_evidence_upload_intent WHERE upload_receipt_id = $1",
				[victimInit.uploadReceiptId],
			),
		).toBe(0);
	});

	test("preserves live multipart IDs and parts when the listing omits them", async () => {
		const fixture = await createFixture("truncated-resume");
		const r2 = new FakeEvidenceR2();
		r2.multipartListingLimit = 1;
		const evidence = newEvidence(
			fixture.organizationId,
			`${RUN_ID}-truncated-session`,
			"already uploaded payload",
		);
		const first = await initialize(fixture, fixture.survivorId, evidence, r2);
		const other = {
			...evidence,
			input: {
				...evidence.input,
				operationId: crypto.randomUUID(),
				capture: { ...evidence.input.capture, contextId: crypto.randomUUID() },
			},
		};
		const initialized = await initialize(
			fixture,
			fixture.survivorId,
			other,
			r2,
		);
		const live = initialized.missingObjects.find(
			(object) => object.objectId === evidence.payload.descriptor.objectId,
		);
		assert(live);
		r2.putPart(live.uploadId, 1, evidence.payload.bytes);
		expect(await r2.headObject(live.objectKey)).toBeNull();
		expect(
			(await r2.listMultipartUploads(live.objectKey)).map(
				(upload) => upload.uploadId,
			),
		).not.toContain(live.uploadId);
		const resumed = await initialize(fixture, fixture.survivorId, other, r2);
		expect(resumed.uploadReceiptId).toBe(initialized.uploadReceiptId);
		expect(resumed.missingObjects.map((object) => object.uploadId)).toEqual(
			initialized.missingObjects.map((object) => object.uploadId),
		);
		expect(r2.abortedUploadIds).toEqual([]);
		expect(r2.uploads.get(live.uploadId)?.parts.get(1)).toEqual(
			evidence.payload.bytes,
		);
		await uploadAndCommit({
			evidence: other,
			initialized: resumed,
			organizationId: fixture.organizationId,
			r2,
			userId: fixture.survivorId,
		});
		expect([...r2.uploads.keys()].sort()).toEqual(
			first.missingObjects.map((object) => object.uploadId).sort(),
		);
	});

	test("resumes an unexpired receipt after its multipart upload ID was revoked", async () => {
		const fixture = await createFixture("revoked-resume");
		const r2 = new FakeEvidenceR2();
		const evidence = newEvidence(
			fixture.organizationId,
			`${RUN_ID}-revoked-session`,
			"recoverable payload",
		);
		const initialized = await initialize(
			fixture,
			fixture.survivorId,
			evidence,
			r2,
		);
		const revoked = initialized.missingObjects.find(
			(object) => object.objectId === evidence.payload.descriptor.objectId,
		);
		assert(revoked);
		await r2.abortMultipartUpload(revoked);
		expect(() =>
			r2.putPart(revoked.uploadId, 1, evidence.payload.bytes),
		).toThrow(NoSuchUploadError);
		const resumed = await initialize(fixture, fixture.survivorId, evidence, r2);
		expect(resumed.uploadReceiptId).toBe(initialized.uploadReceiptId);
		const replacement = resumed.missingObjects.find(
			(object) => object.objectId === revoked.objectId,
		);
		assert(replacement);
		expect(replacement.objectKey).toBe(revoked.objectKey);
		expect(replacement.uploadId).not.toBe(revoked.uploadId);
		expect(r2.uploads.has(replacement.uploadId)).toBe(true);
		const resumedAgain = await initialize(
			fixture,
			fixture.survivorId,
			evidence,
			r2,
		);
		expect(
			resumedAgain.missingObjects.map((object) => object.uploadId),
		).toEqual(resumed.missingObjects.map((object) => object.uploadId));
		await uploadAndCommit({
			evidence,
			initialized: resumedAgain,
			organizationId: fixture.organizationId,
			r2,
			userId: fixture.survivorId,
		});
		expect(r2.uploads.size).toBe(0);
	});

	test("aborts deduplicated multipart uploads before releasing their intents", async () => {
		const fixture = await createFixture("deduplicated");
		const r2 = new FakeEvidenceR2();
		const evidence = newEvidence(
			fixture.organizationId,
			"deduplicated-session",
			"identical content",
		);
		const other = {
			...evidence,
			input: {
				...evidence.input,
				operationId: crypto.randomUUID(),
				capture: { ...evidence.input.capture, contextId: crypto.randomUUID() },
			},
		};
		const first = await initialize(fixture, fixture.victimId, evidence, r2);
		const second = await initialize(fixture, fixture.victimId, other, r2);
		await uploadAndCommit({
			evidence,
			initialized: first,
			organizationId: fixture.organizationId,
			r2,
			userId: fixture.victimId,
		});
		await uploadAndCommit({
			evidence: other,
			initialized: second,
			organizationId: fixture.organizationId,
			r2,
			userId: fixture.victimId,
		});
		expect(r2.uploads.size).toBe(0);
		expect(r2.abortedUploadIds.sort()).toEqual(
			second.missingObjects.map((object) => object.uploadId).sort(),
		);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM repository_evidence_upload_intent WHERE organization_id = $1",
				[fixture.organizationId],
			),
		).toBe(0);
	});

	test("aborts uploads that a resumed plan no longer needs", async () => {
		const fixture = await createFixture("resumed-deduplicated");
		const r2 = new FakeEvidenceR2();
		const evidence = newEvidence(
			fixture.organizationId,
			"resumed-session",
			"same content",
		);
		const other = {
			...evidence,
			input: {
				...evidence.input,
				operationId: crypto.randomUUID(),
				capture: { ...evidence.input.capture, contextId: crypto.randomUUID() },
			},
		};
		const first = await initialize(fixture, fixture.victimId, evidence, r2);
		const second = await initialize(fixture, fixture.victimId, other, r2);
		await uploadAndCommit({
			evidence,
			initialized: first,
			organizationId: fixture.organizationId,
			r2,
			userId: fixture.victimId,
		});
		const resumed = await initialize(fixture, fixture.victimId, other, r2);
		expect(resumed.missingObjects).toEqual([]);
		expect(r2.uploads.size).toBe(0);
		expect(r2.abortedUploadIds.sort()).toEqual(
			second.missingObjects.map((object) => object.uploadId).sort(),
		);
	});

	test("retains pending follow-ups and starts retention at follow-up completion", async () => {
		const fixture = await createFixture("retention");
		await deleteUserPostgresData(fixture.victimId, { sqlClient });
		await sqlClient.unsafe(
			"UPDATE clickhouse_purge_job SET status = 'succeeded', succeeded_at = NOW() - INTERVAL '31 days', followup_due_at = NOW() + INTERVAL '1 day' WHERE target_id = $1",
			[fixture.victimId],
		);
		const env = {
			resend: {},
			sqlClient,
		};
		await runClickHousePurgeWorkerPass(env);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM clickhouse_purge_job WHERE target_id = $1",
				[fixture.victimId],
			),
		).toBe(1);
		await sqlClient.unsafe(
			"UPDATE clickhouse_purge_job SET followup_due_at = NULL, followup_completed_at = NOW() WHERE target_id = $1",
			[fixture.victimId],
		);
		await runClickHousePurgeWorkerPass(env);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM clickhouse_purge_job WHERE target_id = $1",
				[fixture.victimId],
			),
		).toBe(1);
		await sqlClient.unsafe(
			"UPDATE clickhouse_purge_job SET followup_completed_at = NOW() - INTERVAL '31 days' WHERE target_id = $1",
			[fixture.victimId],
		);
		await runClickHousePurgeWorkerPass(env);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM clickhouse_purge_job WHERE target_id = $1",
				[fixture.victimId],
			),
		).toBe(0);
	});

	test("aborts expired multipart uploads and marks the upload expired", async () => {
		const fixture = await createFixture("expired");
		const r2 = new FakeEvidenceR2();
		const evidence = newEvidence(
			fixture.organizationId,
			`${RUN_ID}-expired-session`,
			"abandoned",
		);
		const initializedAt = new Date(Date.now() - 3 * 60 * 60_000);
		const initialized = await initialize(
			fixture,
			fixture.victimId,
			evidence,
			r2,
			() => initializedAt,
		);
		expect(r2.uploads.size).toBe(initialized.missingObjects.length);

		const swept = await sweepRepositoryEvidence({
			database: sqlClient,
			now: new Date(),
			r2,
		});

		expect(swept.attempted).toBeGreaterThan(0);
		expect(r2.uploads.size).toBe(0);
		const [upload] = await sqlClient.unsafe<Array<{ status: string }>>(
			"SELECT status FROM repository_evidence_upload WHERE id = $1",
			[initialized.uploadReceiptId],
		);
		expect(upload?.status).toBe("expired");
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM repository_evidence_upload_intent WHERE organization_id = $1",
				[fixture.organizationId],
			),
		).toBe(0);
	});

	test("removes stale materialized objects without touching shared content that has its own row", async () => {
		const fixture = await createFixture("stale");
		const r2 = new FakeEvidenceR2();
		const shared = newEvidence(
			fixture.organizationId,
			`${RUN_ID}-shared-session`,
			"shared content",
		);
		const sharedInit = await initialize(
			fixture,
			fixture.survivorId,
			shared,
			r2,
		);
		await uploadAndCommit({
			evidence: shared,
			initialized: sharedInit,
			organizationId: fixture.organizationId,
			r2,
			userId: fixture.survivorId,
		});
		const abandoned = newEvidence(
			fixture.organizationId,
			`${RUN_ID}-abandoned-session`,
			"abandoned content",
		);
		const abandonedInit = await initialize(
			fixture,
			fixture.victimId,
			abandoned,
			r2,
			() => new Date(Date.now() - 5 * 60 * 60_000),
		);
		const abandonedPayload = abandonedInit.missingObjects.find(
			(object) => object.objectId === abandoned.payload.descriptor.objectId,
		);
		if (!abandonedPayload) throw new Error("Expected an abandoned payload");
		r2.putPart(abandonedPayload.uploadId, 1, abandoned.payload.bytes);
		await r2.completeMultipartUpload({
			objectKey: abandonedPayload.objectKey,
			parts: [{ etag: "x", partNumber: 1 }],
			uploadId: abandonedPayload.uploadId,
		});
		await sqlClient.unsafe(
			"UPDATE repository_evidence_object SET updated_at = NOW() - INTERVAL '5 hours' WHERE organization_id = $1 AND status = 'pending'",
			[fixture.organizationId],
		);
		const sharedKeys = sharedInit.missingObjects.map(
			(object) => object.objectKey,
		);

		await sweepRepositoryEvidence({ database: sqlClient, r2 });
		await sweepRepositoryEvidence({ database: sqlClient, r2 });

		expect(r2.objects.has(abandonedPayload.objectKey)).toBe(false);
		for (const key of sharedKeys) expect(r2.objects.has(key)).toBe(true);
		expect(
			await countRows(
				"SELECT COUNT(*)::int AS count FROM repository_evidence_object WHERE organization_id = $1 AND status = 'pending'",
				[fixture.organizationId],
			),
		).toBe(0);
	});

	test("aborts uploads recorded by an intent whose upload ID was never attached", async () => {
		const fixture = await createFixture("unattached");
		const r2 = new FakeEvidenceR2();
		const objectKey = `evidence/v2/${RUN_ID}/unattached`;
		const { uploadId } = await r2.createMultipartUpload({
			metadata: {},
			objectKey,
		});
		await sqlClient.unsafe(
			`INSERT INTO repository_evidence_upload_intent (
				id, organization_id, user_id, upload_receipt_id, object_key, due_at
			 ) VALUES ($1, $2, $3, $4, $5, NOW() - INTERVAL '1 minute')`,
			[
				crypto.randomUUID(),
				fixture.organizationId,
				fixture.victimId,
				crypto.randomUUID(),
				objectKey,
			],
		);

		await sweepRepositoryEvidence({ database: sqlClient, r2 });

		expect(r2.abortedUploadIds).toEqual([uploadId]);
	});
});
