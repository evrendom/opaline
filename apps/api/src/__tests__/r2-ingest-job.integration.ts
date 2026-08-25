import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type {
	IngestSessionInput,
	R2IngestCommitInput,
	R2IngestInitOutput,
} from "@rudel/api-routes";
import { sqlClient } from "../db.js";
import {
	getR2IngestJobStatus,
	initR2IngestJob,
} from "../services/ingest-job.service.js";
import {
	commitR2IngestJob,
	type R2IngestProcessorResult,
} from "../services/r2-ingest-commit.service.js";
import type {
	R2MultipartUploadClient,
	R2ObjectMetadata,
} from "../services/r2-ingest-storage.service.js";

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

const USER_ID = `r2-ingest-user-${crypto.randomUUID()}`;
const ORGANIZATION_ID = `r2-ingest-org-${crypto.randomUUID()}`;
const HASH_AFTER_FILTERING = "c".repeat(64);

interface FakeStoredObject {
	bytes: Uint8Array | null;
	complete: boolean;
	metadata: Readonly<Record<string, string>>;
	uploadId: string;
}

class FakeR2Client implements R2MultipartUploadClient {
	readonly completedKeys: string[] = [];
	readonly deletedKeys: string[] = [];
	readonly objects = new Map<string, FakeStoredObject>();

	async abortMultipartUpload(input: {
		objectKey: string;
		uploadId: string;
	}): Promise<void> {
		this.objects.delete(input.objectKey);
	}

	async completeMultipartUpload(input: {
		objectKey: string;
		parts: readonly { etag: string; partNumber: number }[];
		uploadId: string;
	}): Promise<void> {
		const object = this.requireObject(input.objectKey);
		if (object.uploadId !== input.uploadId || input.parts.length === 0) {
			throw new Error("invalid multipart completion");
		}
		object.complete = true;
		this.completedKeys.push(input.objectKey);
	}

	async createMultipartUpload(input: {
		metadata: Readonly<Record<string, string>>;
		objectKey: string;
	}): Promise<{ uploadId: string }> {
		const uploadId = `upload-${this.objects.size + 1}`;
		this.objects.set(input.objectKey, {
			bytes: null,
			complete: false,
			metadata: input.metadata,
			uploadId,
		});
		return { uploadId };
	}

	async deleteObjects(objectKeys: readonly string[]): Promise<void> {
		for (const objectKey of objectKeys) {
			this.deletedKeys.push(objectKey);
			this.objects.delete(objectKey);
		}
	}

	async getObject(objectKey: string): Promise<Uint8Array> {
		const object = this.requireObject(objectKey);
		if (!object.complete || !object.bytes)
			throw new Error("object unavailable");
		return object.bytes;
	}

	async headObject(objectKey: string): Promise<R2ObjectMetadata | null> {
		const object = this.objects.get(objectKey);
		if (!object?.complete || !object.bytes) return null;
		return { byteLength: object.bytes.byteLength, metadata: object.metadata };
	}

	async presignUploadPart(input: {
		byteLength: number;
		objectKey: string;
		partNumber: number;
		uploadId: string;
	}): Promise<string> {
		return `https://uploads.example.test/${input.partNumber}?uploadId=${input.uploadId}`;
	}

	uploadText(objectKey: string, content: string): void {
		this.requireObject(objectKey).bytes = new TextEncoder().encode(content);
	}

	private requireObject(objectKey: string): FakeStoredObject {
		const object = this.objects.get(objectKey);
		if (!object) throw new Error("unknown fake R2 object");
		return object;
	}
}

const fakeR2 = new FakeR2Client();

beforeAll(async () => {
	await sqlClient`
		INSERT INTO "user" (id, name, email)
		VALUES (${USER_ID}, 'R2 Ingest Test', ${`${USER_ID}@example.com`})
	`;
	await sqlClient`
		INSERT INTO organization (id, name, slug)
		VALUES (${ORGANIZATION_ID}, 'R2 Ingest Test', ${ORGANIZATION_ID})
	`;
});

afterAll(async () => {
	await sqlClient`DELETE FROM organization WHERE id = ${ORGANIZATION_ID}`;
	await sqlClient`DELETE FROM "user" WHERE id = ${USER_ID}`;
});

describe("R2 ingest commit lifecycle", () => {
	test("aborts every upload created during partial initialization failure", async () => {
		const mainPresigned = Promise.withResolvers<void>();
		const abortedUploads: string[] = [];
		const partialFailureClient: R2MultipartUploadClient = {
			async abortMultipartUpload(input) {
				abortedUploads.push(input.uploadId);
			},
			async createMultipartUpload(input) {
				if (input.objectKey.endsWith("subagent-1.jsonl")) {
					await mainPresigned.promise;
					throw new Error("multipart initialization failed");
				}
				if (input.objectKey.endsWith("subagent-2.jsonl")) {
					await Bun.sleep(25);
				}
				return { uploadId: `upload-${input.objectKey}` };
			},
			async presignUploadPart(input) {
				if (input.objectKey.endsWith("main.jsonl")) {
					mainPresigned.resolve();
				}
				return `https://uploads.example.test/${input.partNumber}?uploadId=${input.uploadId}`;
			},
		};

		const initialization = initR2IngestJob({
			database: sqlClient,
			input: {
				objects: [
					{
						byteLength: 1,
						kind: "main",
						sha256: "a".repeat(64),
					},
					{
						agentId: "agent-a",
						byteLength: 1,
						kind: "subagent",
						sha256: "b".repeat(64),
					},
					{
						agentId: "agent-b",
						byteLength: 1,
						kind: "subagent",
						sha256: "c".repeat(64),
					},
				],
				projectPath: "/test/r2-partial-failure",
				sessionId: "r2-partial-failure-session",
				source: "claude_code",
			},
			now: () => new Date("2026-08-25T10:00:00.000Z"),
			organizationId: ORGANIZATION_ID,
			r2: partialFailureClient,
			randomUUID: () => "00000000-0000-4000-8000-000000000002",
			userId: USER_ID,
		});

		await expect(initialization).rejects.toThrow(
			"multipart initialization failed",
		);
		await Bun.sleep(50);
		expect(abortedUploads.sort()).toEqual(
			[
				"upload-ingest/00000000-0000-4000-8000-000000000002/main.jsonl",
				"upload-ingest/00000000-0000-4000-8000-000000000002/subagent-2.jsonl",
			].sort(),
		);
	});

	test("verifies, processes, completes, cleans up, and retries idempotently", async () => {
		const initialized = await initializeUploadedJob(
			"00000000-0000-4000-8000-000000000011",
			"main transcript",
			[{ agentId: "agent-a", content: "subagent transcript" }],
		);
		const completion = buildCompletionInput(initialized);
		let processCalls = 0;
		const process = async (
			input: IngestSessionInput,
		): Promise<R2IngestProcessorResult> => {
			processCalls += 1;
			expect(fakeR2.deletedKeys).toHaveLength(0);
			expect(input).toMatchObject({
				content: "main transcript",
				organizationId: ORGANIZATION_ID,
				sessionId: initialized.objects[0]?.objectKey.split("/")[1],
				subagents: [{ agentId: "agent-a", content: "subagent transcript" }],
			});
			return processorResult(input.sessionId);
		};

		const committed = await commitR2IngestJob({
			input: completion,
			process,
			r2: fakeR2,
			userId: USER_ID,
		});
		expect(committed).toMatchObject({
			jobId: initialized.jobId,
			status: "completed",
		});
		expect(processCalls).toBe(1);
		expect(fakeR2.deletedKeys).toHaveLength(2);

		const status = await getR2IngestJobStatus(initialized.jobId, USER_ID);
		expect(status).toMatchObject({
			attempts: 1,
			error: null,
			result: { success: true },
			status: "completed",
		});
		expect(
			await getR2IngestJobStatus(initialized.jobId, "another-user"),
		).toBeNull();

		await commitR2IngestJob({
			input: completion,
			process,
			r2: fakeR2,
			userId: USER_ID,
		});
		expect(processCalls).toBe(1);
	});

	test("leaves objects intact on failure and succeeds after the retry window", async () => {
		const initialized = await initializeUploadedJob(
			"00000000-0000-4000-8000-000000000012",
			"retry transcript",
		);
		const completion = buildCompletionInput(initialized);
		const firstAttemptAt = new Date("2030-01-01T00:00:00.000Z");
		await expect(
			commitR2IngestJob({
				input: completion,
				now: () => firstAttemptAt,
				process: async () => {
					throw new Error("synthetic processor failure");
				},
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toThrow("synthetic processor failure");
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			attempts: 1,
			error: { code: "R2_INGEST_PROCESSING_FAILED" },
			status: "pending",
		});
		expect(
			initialized.objects.every((object) =>
				fakeR2.objects.has(object.objectKey),
			),
		).toBe(true);

		const retried = await commitR2IngestJob({
			input: completion,
			now: () => new Date("2030-01-01T00:00:02.000Z"),
			process: async (input) => processorResult(input.sessionId),
			r2: fakeR2,
			userId: USER_ID,
		});
		expect(retried.status).toBe("completed");
	});

	test("claims and repairs at most one expired lease per commit", async () => {
		const requested = await initializeUploadedJob(
			"00000000-0000-4000-8000-000000000013",
			"requested transcript",
		);
		const orphanA = await initializeUploadedJob(
			"00000000-0000-4000-8000-000000000014",
			"orphan a",
		);
		const orphanB = await initializeUploadedJob(
			"00000000-0000-4000-8000-000000000015",
			"orphan b",
		);
		await expireJobWithReceipt(orphanA);
		await expireJobWithReceipt(orphanB);
		let processCalls = 0;

		await commitR2IngestJob({
			input: buildCompletionInput(requested),
			now: () => new Date("2030-01-01T00:00:00.000Z"),
			process: async (input) => {
				processCalls += 1;
				return processorResult(input.sessionId);
			},
			r2: fakeR2,
			userId: USER_ID,
		});

		expect(processCalls).toBe(2);
		const orphanStatuses = await sqlClient<Array<{ status: string }>>`
			SELECT status
			FROM ingest_job
			WHERE id IN (${orphanA.jobId}, ${orphanB.jobId})
			ORDER BY id
		`;
		expect(orphanStatuses.map((row) => row.status).sort()).toEqual([
			"completed",
			"running",
		]);
	});
});

async function initializeUploadedJob(
	jobId: Uuid,
	mainContent: string,
	subagents: readonly { agentId: string; content: string }[] = [],
): Promise<R2IngestInitOutput> {
	const objects = [
		{
			byteLength: byteLength(mainContent),
			kind: "main" as const,
			sha256: sha256(mainContent),
		},
		...subagents.map((subagent) => ({
			agentId: subagent.agentId,
			byteLength: byteLength(subagent.content),
			kind: "subagent" as const,
			sha256: sha256(subagent.content),
		})),
	];
	const initialized = await initR2IngestJob({
		database: sqlClient,
		input: {
			objects,
			projectPath: "/test/r2",
			sessionId: jobId,
			source: "claude_code",
		},
		now: () => new Date("2026-08-25T10:00:00.000Z"),
		organizationId: ORGANIZATION_ID,
		r2: fakeR2,
		randomUUID: () => jobId,
		userId: USER_ID,
	});
	for (const object of initialized.objects) {
		if (object.kind === "main") {
			fakeR2.uploadText(object.objectKey, mainContent);
		} else {
			const subagent = subagents.find(
				(item) => item.agentId === object.agentId,
			);
			if (!subagent) throw new Error("missing fake subagent content");
			fakeR2.uploadText(object.objectKey, subagent.content);
		}
	}
	return initialized;
}

function buildCompletionInput(
	initialized: R2IngestInitOutput,
): R2IngestCommitInput {
	return {
		jobId: initialized.jobId,
		objects: initialized.objects.map((object) => ({
			objectKey: object.objectKey,
			parts: object.parts.map((part) => ({
				etag: `"etag-${part.partNumber}"`,
				partNumber: part.partNumber,
			})),
			uploadId: object.uploadId,
		})),
	};
}

async function expireJobWithReceipt(
	initialized: R2IngestInitOutput,
): Promise<void> {
	const completion = buildCompletionInput(initialized);
	const completedByKey = new Map(
		completion.objects.map((object) => [object.objectKey, object]),
	);
	const manifest = initialized.objects.map((object) => ({
		...(object.kind === "subagent" ? { agentId: object.agentId } : {}),
		kind: object.kind,
		objectKey: object.objectKey,
		parts: object.parts.map((part) => ({
			byteLength: part.byteLength,
			etag:
				completedByKey
					.get(object.objectKey)
					?.parts.find((item) => item.partNumber === part.partNumber)?.etag ??
				"",
			partNumber: part.partNumber,
		})),
		uploadId: object.uploadId,
	}));
	await sqlClient.unsafe(
		`UPDATE ingest_job
		 SET
			status = 'running',
			attempts = 1,
			object_manifest = $1,
			lease_token = 'expired-test-lease',
			lease_expires_at = '2029-12-31T23:00:00.000Z',
			updated_at = NOW()
		 WHERE id = $2`,
		[JSON.stringify(manifest), initialized.jobId],
	);
}

function processorResult(sessionId: string): R2IngestProcessorResult {
	return {
		contentSha256: HASH_AFTER_FILTERING,
		result: {
			redacted: {},
			redactedBytes: 0,
			sessionId,
			success: true,
		},
	};
}

function byteLength(content: string): number {
	return new TextEncoder().encode(content).byteLength;
}

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}
