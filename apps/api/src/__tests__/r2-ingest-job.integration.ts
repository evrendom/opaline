import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { R2_INGEST_PART_SIZE_BYTES } from "@rudel/api-routes";
import { sqlClient } from "../db.js";
import {
	getR2IngestJobStatus,
	initR2IngestJob,
} from "../services/ingest-job.service.js";
import type { R2MultipartUploadClient } from "../services/r2-ingest-storage.service.js";

const USER_ID = `r2-ingest-user-${crypto.randomUUID()}`;
const ORGANIZATION_ID = `r2-ingest-org-${crypto.randomUUID()}`;
const JOB_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-25T10:00:00.000Z");
const createdObjectKeys: string[] = [];
const abortedObjectKeys: string[] = [];

const fakeR2Client: R2MultipartUploadClient = {
	async abortMultipartUpload(input) {
		abortedObjectKeys.push(input.objectKey);
	},
	async createMultipartUpload(input) {
		createdObjectKeys.push(input.objectKey);
		return { uploadId: `upload-${createdObjectKeys.length}` };
	},
	async presignUploadPart(input) {
		return `https://uploads.example.test/${input.partNumber}?uploadId=${input.uploadId}`;
	},
};

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
	await sqlClient`
		DELETE FROM "user"
		WHERE id = ${USER_ID}
	`;
});

describe("R2 ingest init and status lifecycle", () => {
	test("persists a sorted multipart manifest and returns a bounded status", async () => {
		const initialized = await initR2IngestJob({
			database: sqlClient,
			input: {
				objects: [
					{
						agentId: "agent-z",
						byteLength: 3,
						kind: "subagent",
						sha256: "b".repeat(64),
					},
					{
						byteLength: R2_INGEST_PART_SIZE_BYTES + 1,
						kind: "main",
						sha256: "a".repeat(64),
					},
				],
				projectPath: "/test/r2",
				sessionId: "r2-session",
				source: "claude_code",
			},
			now: () => NOW,
			organizationId: ORGANIZATION_ID,
			r2: fakeR2Client,
			randomUUID: () => JOB_ID,
			userId: USER_ID,
		});

		expect(initialized.jobId).toBe(JOB_ID);
		expect(initialized.objects.map((object) => object.kind)).toEqual([
			"main",
			"subagent",
		]);
		expect(
			initialized.objects[0]?.parts.map((part) => part.byteLength),
		).toEqual([R2_INGEST_PART_SIZE_BYTES, 1]);
		expect(createdObjectKeys).toEqual([
			`ingest/${JOB_ID}/main.jsonl`,
			`ingest/${JOB_ID}/subagent-1.jsonl`,
		]);
		expect(abortedObjectKeys).toEqual([]);

		const status = await getR2IngestJobStatus(JOB_ID, USER_ID);
		expect(status).toMatchObject({
			attempts: 0,
			error: null,
			jobId: JOB_ID,
			leaseExpiresAt: null,
			result: null,
			status: "pending",
		});
		expect(await getR2IngestJobStatus(JOB_ID, "another-user")).toBeNull();
	});
});
