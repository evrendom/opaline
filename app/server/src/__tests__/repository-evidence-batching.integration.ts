import { afterEach, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	type RepositoryEvidenceInitInput,
	RepositoryEvidenceInitInputSchema,
	type RepositoryEvidenceObjectDescriptor,
} from "@rudel/api-routes";
import postgres from "postgres";
import { sqlClient } from "../db.js";
import {
	commitRepositoryEvidence,
	initRepositoryEvidence,
	type RepositoryEvidenceForIndex,
} from "../services/repository-evidence.service.js";
import { buildRepositoryEvidenceIndexRow } from "../services/repository-evidence-index.service.js";
import { FakeEvidenceR2 } from "./helpers/fake-evidence-r2.js";

const ORGANIZATION_IDS: string[] = [];
const DATABASES: postgres.Sql[] = [];
const QUERY_LATENCY_MS = 20;

afterEach(async () => {
	await Promise.all(DATABASES.splice(0).map((database) => database.end()));
	const ids = ORGANIZATION_IDS.splice(0);
	await sqlClient.unsafe(
		"DELETE FROM repository_evidence_upload_intent WHERE organization_id = ANY($1::text[])",
		[ids],
	);
	await sqlClient.unsafe(
		"DELETE FROM organization WHERE id = ANY($1::text[])",
		[ids],
	);
	await sqlClient.unsafe('DELETE FROM "user" WHERE id = ANY($1::text[])', [
		ids,
	]);
});

test.each([
	{ objectCount: 1_001, queryLatencyMs: QUERY_LATENCY_MS, maxStatements: 32 },
	{ objectCount: 4_096, queryLatencyMs: 0, maxStatements: 48 },
])("$objectCount evidence objects use bounded SQL for first init, resume, commit and reuse", async ({
	objectCount,
	queryLatencyMs,
	maxStatements,
}) => {
	const organizationId = `evidence_batch_${crypto.randomUUID()}`;
	ORGANIZATION_IDS.push(organizationId);
	await sqlClient.unsafe(
		`INSERT INTO "user" (id, name, email, email_verified)
		 VALUES ($1, 'Evidence batching', $2, false)`,
		[organizationId, `${organizationId}@example.com`],
	);
	await sqlClient.unsafe(
		"INSERT INTO organization (id, name, slug) VALUES ($1, 'Evidence batching', $1)",
		[organizationId],
	);
	const manifest = buildObject(
		JSON.stringify({ contextIndex: { facets: [], skills: [] } }),
		"context-manifest",
	);
	const objects = [
		manifest,
		...Array.from({ length: objectCount - 1 }, (_, index) =>
			buildObject(`source ${index}`, "source-blob"),
		),
	];
	const input = buildInput(
		organizationId,
		objects.map((object) => object.descriptor),
		manifest.descriptor.objectId,
	);
	let statementCount = 0;
	let measuring = false;
	const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
	const connectionString = process.env.PG_CONNECTION_STRING;
	assert(connectionString);
	const database = postgres(connectionString, {
		max: 5,
		prepare: false,
		debug: () => {
			if (measuring) {
				statementCount += 1;
				Atomics.wait(waitBuffer, 0, 0, queryLatencyMs);
			}
		},
	});
	DATABASES.push(database);
	await database.unsafe("SELECT 1");
	const measurements: Array<{
		phase: string;
		statements: number;
		milliseconds: number;
	}> = [];
	const measure = async <TResult>(
		phase: string,
		operation: () => Promise<TResult>,
	): Promise<TResult> => {
		statementCount = 0;
		measuring = true;
		const started = performance.now();
		const result = await operation();
		measuring = false;
		const measurement = {
			phase,
			statements: statementCount,
			milliseconds: Math.round(performance.now() - started),
		};
		measurements.push(measurement);
		console.log(
			"evidence-batching",
			JSON.stringify({ objectCount, queryLatencyMs, ...measurement }),
		);
		return result;
	};
	const r2 = new FakeEvidenceR2();
	const options = {
		database,
		input,
		now: () => new Date(),
		organizationId,
		r2,
		randomUUID: () => crypto.randomUUID(),
		userId: organizationId,
	};
	const initialized = await measure("first-init", () =>
		initRepositoryEvidence(options),
	);
	expect(initialized.missingObjects).toHaveLength(objects.length);
	expect(initialized.reusedObjectIds).toEqual([]);
	const [pending] = await sqlClient.unsafe<
		Array<{ objects: number; links: number; intents: number }>
	>(
		`SELECT
		 (SELECT count(*)::int FROM repository_evidence_object WHERE organization_id = $1 AND status = 'pending') AS objects,
		 (SELECT count(*)::int FROM repository_evidence_upload_object WHERE organization_id = $1) AS links,
		 (SELECT count(*)::int FROM repository_evidence_upload_intent WHERE organization_id = $1 AND upload_id IS NOT NULL) AS intents`,
		[organizationId],
	);
	expect(pending).toEqual({
		objects: objects.length,
		links: objects.length,
		intents: objects.length,
	});
	const resumed = await measure("resume", () =>
		initRepositoryEvidence(options),
	);
	expect(resumed.uploadReceiptId).toBe(initialized.uploadReceiptId);
	expect(resumed.missingObjects).toEqual(initialized.missingObjects);
	expect(r2.uploads.size).toBe(objects.length);
	await sqlClient.unsafe(
		"UPDATE repository_evidence_upload SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1",
		[initialized.uploadReceiptId],
	);
	await sqlClient.unsafe(
		"DELETE FROM repository_evidence_object WHERE organization_id = $1 AND status = 'pending'",
		[organizationId],
	);
	const renewed = await measure("renewed-resume", () =>
		initRepositoryEvidence(options),
	);
	expect(renewed.uploadReceiptId).toBe(initialized.uploadReceiptId);
	expect(renewed.missingObjects).toHaveLength(objects.length);
	const originalKeys = new Set(
		initialized.missingObjects.map((object) => object.objectKey),
	);
	expect(
		renewed.missingObjects.every(
			(object) => !originalKeys.has(object.objectKey),
		),
	).toBe(true);
	expect(r2.uploads.size).toBe(objects.length);
	expect(r2.abortedUploadIds).toHaveLength(objects.length);
	const contents = new Map(
		objects.map((object) => [object.descriptor.objectId, object.bytes]),
	);
	const completed = renewed.missingObjects.map((object) => {
		const bytes = contents.get(object.objectId);
		assert(bytes);
		return {
			objectId: object.objectId,
			objectKey: object.objectKey,
			uploadId: object.uploadId,
			parts: [{ partNumber: 1, etag: r2.putPart(object.uploadId, 1, bytes) }],
		};
	});
	const commitOptions = {
		...options,
		input: {
			organizationId,
			uploadReceiptId: initialized.uploadReceiptId,
			objects: completed,
		},
		prepareIndex: (evidence: RepositoryEvidenceForIndex) =>
			buildRepositoryEvidenceIndexRow(
				evidence.input,
				evidence.manifest,
				new Date(),
				organizationId,
			),
	};
	const committed = await measure("commit", () =>
		commitRepositoryEvidence(commitOptions),
	);
	expect(committed.output.status).toBe("accepted");
	expect(committed.output.storedObjectIds).toEqual(
		input.objects.map((object) => object.objectId),
	);
	expect(committed.preparedIndex.context_id).toBe(input.capture.contextId);
	expect(r2.uploads.size).toBe(0);
	expect(r2.objects.size).toBe(objects.length);
	const reusedInput = {
		...input,
		operationId: crypto.randomUUID(),
		capture: { ...input.capture, contextId: crypto.randomUUID() },
	};
	const reused = await measure("reused-init", () =>
		initRepositoryEvidence({ ...options, input: reusedInput }),
	);
	expect(reused.missingObjects).toEqual([]);
	expect(reused.reusedObjectIds).toEqual(
		input.objects.map((object) => object.objectId),
	);
	const reusedCommit = await measure("reused-commit", () =>
		commitRepositoryEvidence({
			...commitOptions,
			input: {
				organizationId,
				uploadReceiptId: reused.uploadReceiptId,
				objects: [],
			},
		}),
	);
	expect(reusedCommit.output.status).toBe("accepted");
	const added = buildObject("new source for the mixed capture", "source-blob");
	const mixedInput = {
		...reusedInput,
		operationId: crypto.randomUUID(),
		capture: { ...input.capture, contextId: crypto.randomUUID() },
		objects: [...input.objects.slice(0, -1), added.descriptor],
	};
	const mixed = await measure("mixed-init", () =>
		initRepositoryEvidence({ ...options, input: mixedInput }),
	);
	expect(mixed.missingObjects.map((object) => object.objectId)).toEqual([
		added.descriptor.objectId,
	]);
	expect(mixed.reusedObjectIds).toEqual(
		input.objects.slice(0, -1).map((object) => object.objectId),
	);
	const mixedCompletion = mixed.missingObjects.map((object) => ({
		objectId: object.objectId,
		objectKey: object.objectKey,
		uploadId: object.uploadId,
		parts: [
			{ partNumber: 1, etag: r2.putPart(object.uploadId, 1, added.bytes) },
		],
	}));
	const mixedCommit = await measure("mixed-commit", () =>
		commitRepositoryEvidence({
			...commitOptions,
			input: {
				organizationId,
				uploadReceiptId: mixed.uploadReceiptId,
				objects: mixedCompletion,
			},
		}),
	);
	expect(mixedCommit.output.storedObjectIds).toEqual(
		mixedInput.objects.map((object) => object.objectId),
	);
	const duplicate = await measure("duplicate-commit", () =>
		commitRepositoryEvidence(commitOptions),
	);
	expect(duplicate.output.receiptId).toBe(committed.output.receiptId);
	expect(duplicate.output.status).toBe("duplicate");
	const committedResume = await measure("committed-resume", () =>
		initRepositoryEvidence(options),
	);
	expect(committedResume.missingObjects).toEqual([]);
	expect(committedResume.reusedObjectIds).toHaveLength(objects.length);
	const [counts] = await sqlClient.unsafe<
		Array<{
			available: number;
			links: number;
			uploads: number;
			captures: number;
			intents: number;
		}>
	>(
		`SELECT
		 (SELECT count(*)::int FROM repository_evidence_object WHERE organization_id = $1 AND status = 'available') AS available,
		 (SELECT count(*)::int FROM repository_evidence_upload_object WHERE organization_id = $1) AS links,
		 (SELECT count(*)::int FROM repository_evidence_upload WHERE organization_id = $1 AND status = 'committed') AS uploads,
		 (SELECT count(*)::int FROM repository_evidence_capture WHERE organization_id = $1) AS captures,
		 (SELECT count(*)::int FROM repository_evidence_upload_intent WHERE organization_id = $1) AS intents`,
		[organizationId],
	);
	expect(counts).toEqual({
		available: objects.length + 1,
		links: objects.length * 3,
		uploads: 3,
		captures: 3,
		intents: 0,
	});
	for (const measurement of measurements) {
		expect(measurement.statements, measurement.phase).toBeLessThanOrEqual(
			maxStatements,
		);
	}
}, 300_000);

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

function buildInput(
	organizationId: string,
	objects: RepositoryEvidenceObjectDescriptor[],
	manifestObjectId: string,
): RepositoryEvidenceInitInput {
	const repositoryHash = "a".repeat(64);
	return RepositoryEvidenceInitInputSchema.parse({
		capture: {
			baseGitCommit: null,
			contextId: crypto.randomUUID(),
			headGitCommit: null,
			parentContextId: null,
			timing: {
				captureCompletedAt: "2026-10-01T10:00:01.000Z",
				captureStartedAt: "2026-10-01T10:00:00.000Z",
				firstActionAt: null,
				firstActionBasis: "unavailable",
				firstActionRelationship: "unknown",
				lifecycle: "end",
			},
			transcriptWatermark: null,
		},
		coverage: [{ area: "git-state", reason: null, status: "complete" }],
		manifestObjectId,
		objects,
		operationId: crypto.randomUUID(),
		organizationId,
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
			sessionId: crypto.randomUUID(),
			source: "codex",
		},
	});
}
