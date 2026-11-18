import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdtempSync,
	readdirSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalObjectStoreClient } from "./local-object-store.js";
import {
	needsObjectStoreSweep,
	type SweepableObjectStore,
	sweepObjectStore,
} from "./object-store-sweep.service.js";

const NOW = new Date("2026-11-08T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

function localStore(clock: { now: Date }) {
	const directory = mkdtempSync(join(tmpdir(), "opaline-object-sweep-"));
	directories.push(directory);
	return createLocalObjectStoreClient(
		{
			backend: "local",
			directory,
			publicOrigin: "http://localhost:4100",
			signingSecret: "secret-0123456789abcdef0123456789",
		},
		() => clock.now,
	);
}

async function putAged(
	store: ReturnType<typeof localStore>,
	objectKey: string,
	ageMs: number,
): Promise<void> {
	await store.putObject({
		body: new Uint8Array([1]),
		contentType: "application/x-ndjson",
		metadata: {},
		objectKey,
	});
	const at = new Date(NOW.getTime() - ageMs);
	utimesSync(store.objectPath(objectKey), at, at);
}

describe("object store expiry sweep", () => {
	test("deletes ingest objects older than seven days, aborts week-old uploads and clears stale scratch", async () => {
		const clock = { now: new Date(NOW.getTime() - 8 * DAY) };
		const store = localStore(clock);
		const abandoned = await store.createMultipartUpload({
			metadata: {},
			objectKey: "ingest/abandoned/main.jsonl",
		});
		const oldEvidence = await store.createMultipartUpload({
			metadata: {},
			objectKey: "evidence/v2/org/ab/abcd/uuid",
		});
		clock.now = new Date(NOW.getTime() - DAY);
		const recent = await store.createMultipartUpload({
			metadata: {},
			objectKey: "ingest/recent/main.jsonl",
		});
		await putAged(store, "ingest/old-job/main.jsonl", 8 * DAY);
		await putAged(store, "ingest/old-job/subagent-1.jsonl", 7 * DAY + 1);
		await putAged(store, "ingest/new-job/main.jsonl", 6 * DAY);
		await putAged(store, "evidence/v2/org/cd/cdef/uuid", 400 * DAY);
		await putAged(
			store,
			"live/v1/org/claude_code/s/main/g1/0000000001-x.jsonl",
			30 * DAY,
		);
		writeFileSync(join(store.scratchRoot, "crashed-write"), "partial");
		const old = new Date(NOW.getTime() - 2 * DAY);
		utimesSync(join(store.scratchRoot, "crashed-write"), old, old);

		const result = await sweepObjectStore({ now: NOW, store });

		expect(result).toEqual({
			abortedUploads: 2,
			deletedObjects: 2,
			hasMore: false,
			listedObjects: 3,
			removedScratch: 1,
		});
		const remaining = await store.listObjects({ prefix: "" });
		expect(remaining.objects.map((object) => object.key)).toEqual([
			"evidence/v2/org/cd/cdef/uuid",
			"ingest/new-job/main.jsonl",
			"live/v1/org/claude_code/s/main/g1/0000000001-x.jsonl",
		]);
		expect(readdirSync(store.uploadsRoot)).toEqual([recent.uploadId]);
		expect(
			await store.hasMultipartUpload({
				objectKey: "ingest/abandoned/main.jsonl",
				uploadId: abandoned.uploadId,
			}),
		).toBe(false);
		expect(
			await store.hasMultipartUpload({
				objectKey: "evidence/v2/org/ab/abcd/uuid",
				uploadId: oldEvidence.uploadId,
			}),
		).toBe(false);
		expect(readdirSync(store.scratchRoot)).toEqual([]);
	});

	test("stops at the deadline and reports more work", async () => {
		const store = localStore({ now: NOW });
		await putAged(store, "ingest/a/main.jsonl", 8 * DAY);
		const result = await sweepObjectStore({
			deadline: { deadlineAt: 0, now: () => 1 },
			now: NOW,
			store,
		});
		expect(result).toMatchObject({ deletedObjects: 0, hasMore: true });
	});

	test("pages through listings, tolerates uploads that vanished and works without scratch", async () => {
		const deleted: string[][] = [];
		const store: SweepableObjectStore = {
			abortMultipartUpload: async () => {
				throw Object.assign(new Error("gone"), { name: "NoSuchUpload" });
			},
			deleteObjects: async (keys) => {
				deleted.push([...keys]);
			},
			async *incompleteMultipartUploads() {
				yield {
					initiatedAt: new Date(0),
					objectKey: "ingest/x/main.jsonl",
					uploadId: "u",
				};
			},
			listObjects: async ({ continuationToken }) =>
				continuationToken === undefined
					? {
							nextContinuationToken: "page-2",
							objects: [
								{ key: "ingest/1/main.jsonl", lastModified: new Date(0) },
							],
						}
					: {
							nextContinuationToken: null,
							objects: [{ key: "ingest/2/main.jsonl", lastModified: NOW }],
						},
		};
		expect(await sweepObjectStore({ now: NOW, store })).toEqual({
			abortedUploads: 0,
			deletedObjects: 1,
			hasMore: false,
			listedObjects: 2,
			removedScratch: 0,
		});
		expect(deleted).toEqual([["ingest/1/main.jsonl"]]);
	});

	test("runs for the local and S3 backends only; R2 keeps its bucket lifecycle rule", () => {
		expect(
			needsObjectStoreSweep({
				backend: "local",
				directory: "/d",
				publicOrigin: "http://localhost",
				signingSecret: "s",
			}),
		).toBe(true);
		expect(
			needsObjectStoreSweep({
				accessKeyId: "a",
				backend: "s3",
				bucket: "b",
				endpoint: "http://nas:8333",
				forcePathStyle: true,
				region: "us-east-1",
				secretAccessKey: "s",
			}),
		).toBe(true);
		expect(
			needsObjectStoreSweep({
				accessKeyId: "a",
				accountId: "acc",
				bucket: "opaline-ingest-prod",
				endpoint: "https://acc.eu.r2.cloudflarestorage.com",
				forcePathStyle: false,
				secretAccessKey: "s",
			}),
		).toBe(false);
	});
});
