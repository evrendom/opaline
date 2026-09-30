import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	type RepositoryEvidenceInitInput,
	RepositoryEvidenceInitInputSchema,
	type RepositoryEvidenceObjectDescriptor,
} from "@rudel/api-routes";
import { sqlClient } from "../db.js";
import { ClickHouseWriteFencedError } from "../lib/clickhouse-write-fence.js";
import {
	assertNoClickHousePurgeTombstone,
	type ClickHousePurgePass,
	purgeRepositoryEvidenceObjects,
	runClickHousePurgeWorkerOnce,
	runClickHousePurgeWorkerPass,
} from "../services/clickhouse-purge.service.js";
import {
	commitRepositoryEvidence,
	initRepositoryEvidence,
	RepositoryEvidenceStateError,
} from "../services/repository-evidence.service.js";
import { sweepRepositoryEvidence } from "../services/repository-evidence-fence.service.js";
import { deleteUserPostgresData } from "../services/user-deletion.service.js";
import { FakeEvidenceR2 } from "./helpers/fake-evidence-r2.js";

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
		JSON.stringify({ unique: crypto.randomUUID() }),
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
		prepareIndex: () => "prepared",
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
			assertNoClickHousePurgeTombstone({
				organizationId: fixture.organizationId,
				userId: fixture.survivorId,
			}),
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
