import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	compareObjectKeys,
	createLocalObjectStoreClient,
	decodeSegment,
	encodeObjectKey,
	type LocalObjectStore,
	LocalObjectStoreError,
} from "./local-object-store.js";
import type { LocalDiskConfiguration } from "./r2-ingest-storage.service.js";

const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

function createStore(now?: () => Date): {
	configuration: LocalDiskConfiguration;
	store: LocalObjectStore;
} {
	const directory = mkdtempSync(join(tmpdir(), "opaline-object-store-"));
	directories.push(directory);
	const configuration: LocalDiskConfiguration = {
		backend: "local",
		directory,
		publicOrigin: "http://localhost:4100",
		signingSecret: "test-signing-secret-0123456789abcdef",
	};
	return {
		configuration,
		store: createLocalObjectStoreClient(configuration, now),
	};
}

function bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

function md5(data: Uint8Array): string {
	return createHash("md5").update(data).digest("hex");
}

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
	});
}

async function put(store: LocalObjectStore, objectKey: string, body = "x") {
	await store.putObject({
		body: bytes(body),
		contentType: "text/plain",
		metadata: {},
		objectKey,
	});
}

async function listAll(
	store: LocalObjectStore,
	input: { maxKeys?: number; prefix: string; startAfter?: string },
): Promise<string[]> {
	const keys: string[] = [];
	let continuationToken: string | undefined;
	do {
		const page = await store.listObjects({ ...input, continuationToken });
		keys.push(...page.objects.map((object) => object.key));
		continuationToken = page.nextContinuationToken ?? undefined;
	} while (continuationToken);
	return keys;
}

describe("object key mapping", () => {
	test("rejects keys that could leave the store or name nothing", () => {
		for (const key of [
			"",
			"../etc/passwd",
			"ingest/../../secret",
			"ingest/./main.jsonl",
			"/absolute",
			"trailing/",
			"double//slash",
			"nul\u0000byte",
			"line\nbreak",
			"x".repeat(1025),
			"lone\ud800surrogate",
		]) {
			expect(() => encodeObjectKey(key)).toThrow(LocalObjectStoreError);
		}
	});

	test("encodes every segment to a safe, case-folding-proof name and back", () => {
		const keys = [
			"ingest/0f6a/main.jsonl",
			"live/v1/Agent-ABC/.hidden",
			"evidence/sha256:abc/ü ✓",
			"a%2Fb",
		];
		for (const key of keys) {
			const names = encodeObjectKey(key);
			for (const name of names) {
				expect(name).toMatch(/^(?:[a-z0-9._-]|%[0-9A-F]{2})+$/u);
				expect(name.startsWith(".")).toBe(false);
			}
			expect(names.map((name) => decodeSegment(name)).join("/")).toBe(key);
		}
		expect(encodeObjectKey("A")).not.toEqual(encodeObjectKey("a"));
		expect(decodeSegment("%61")).toBeNull();
		expect(decodeSegment(".hidden")).toBeNull();
		expect(decodeSegment("..")).toBeNull();
		expect(decodeSegment("%2F")).toBeNull();
	});
});

describe("objects", () => {
	test("stores, reads, heads and deletes an object with its metadata", async () => {
		const { store } = createStore();
		await store.putObject({
			body: bytes("hello world"),
			contentType: "text/plain",
			metadata: { "Content-SHA256": "abc", at: "2026-11-08T00:00:00.000Z" },
			objectKey: "maintenance/activity",
		});

		expect(
			new TextDecoder().decode(await store.getObject("maintenance/activity")),
		).toBe("hello world");
		expect(await store.headObject("maintenance/activity")).toEqual({
			byteLength: 11,
			metadata: { at: "2026-11-08T00:00:00.000Z", "content-sha256": "abc" },
		});

		await store.deleteObjects(["maintenance/activity", "never/existed"]);
		expect(await store.headObject("maintenance/activity")).toBeNull();
		await expect(store.getObject("maintenance/activity")).rejects.toMatchObject(
			{
				name: "NoSuchKey",
			},
		);
	});

	test("an empty object round-trips and a replaced object keeps only the new bytes", async () => {
		const { store } = createStore();
		await put(store, "k/empty", "");
		expect((await store.getObject("k/empty")).byteLength).toBe(0);
		await put(store, "k/v", "first");
		await put(store, "k/v", "second");
		expect(new TextDecoder().decode(await store.getObject("k/v"))).toBe(
			"second",
		);
	});

	test("a key can be an object and a prefix of other objects at once", async () => {
		const { store } = createStore();
		await put(store, "a", "file");
		await put(store, "a/b", "nested");
		expect(new TextDecoder().decode(await store.getObject("a"))).toBe("file");
		expect(new TextDecoder().decode(await store.getObject("a/b"))).toBe(
			"nested",
		);
	});

	test("deleting the last object of a prefix removes its empty directories", async () => {
		const { configuration, store } = createStore();
		await put(store, "ingest/job-1/main.jsonl");
		await put(store, "ingest/job-2/main.jsonl");
		await store.deleteObjects(["ingest/job-1/main.jsonl"]);
		expect(
			readdirSync(join(configuration.directory, "objects", "ingest")),
		).toEqual(["job-2"]);
	});
});

describe("listing", () => {
	test("lists in S3 byte order with prefix, start-after and continuation", async () => {
		const { store } = createStore();
		const keys = [
			"a",
			"a-b/c",
			"a.b",
			"a/b",
			"a/b/c",
			"ab",
			"B",
			"live/v1/x/1",
			"ü",
		];
		for (const key of [...keys].reverse()) await put(store, key);
		const sorted = [...keys].sort(compareObjectKeys);

		expect(await listAll(store, { prefix: "" })).toEqual(sorted);
		expect(await listAll(store, { maxKeys: 2, prefix: "" })).toEqual(sorted);
		expect(await listAll(store, { prefix: "a" })).toEqual(
			sorted.filter((key) => key.startsWith("a")),
		);
		expect(await listAll(store, { prefix: "a/" })).toEqual(["a/b", "a/b/c"]);
		expect(await listAll(store, { prefix: "", startAfter: "a/b" })).toEqual(
			sorted.filter((key) => compareObjectKeys(key, "a/b") > 0),
		);
		expect(await listAll(store, { prefix: "", startAfter: "a/a" })).toEqual(
			sorted.filter((key) => compareObjectKeys(key, "a/a") > 0),
		);
		expect(await listAll(store, { prefix: "../" })).toEqual([]);
		expect(await listAll(store, { prefix: "missing/" })).toEqual([]);
	});

	test("reports each object's last modification time", async () => {
		const { configuration, store } = createStore();
		await put(store, "ingest/old/main.jsonl");
		const old = new Date("2026-01-01T00:00:00.000Z");
		utimesSync(
			join(configuration.directory, "objects", "ingest", "old", "main.jsonl~"),
			old,
			old,
		);
		const page = await store.listObjects({ prefix: "ingest/" });
		expect(page.objects).toEqual([
			{ key: "ingest/old/main.jsonl", lastModified: old },
		]);
		expect(page.nextContinuationToken).toBeNull();
	});
});

describe("multipart uploads", () => {
	test("assembles verified parts in order into one object with the upload's metadata", async () => {
		const { store } = createStore();
		const { uploadId } = await store.createMultipartUpload({
			metadata: { "ingest-job-id": "job" },
			objectKey: "ingest/job/main.jsonl",
		});
		const first = bytes("a".repeat(1024));
		const second = bytes("tail\n");
		const firstEtag = await store.writePart({
			body: streamOf(first.subarray(0, 100), first.subarray(100)),
			byteLength: first.byteLength,
			partNumber: 1,
			uploadId,
		});
		const secondEtag = await store.writePart({
			body: streamOf(second),
			byteLength: second.byteLength,
			partNumber: 2,
			uploadId,
		});
		expect(firstEtag).toBe(md5(first));
		expect(
			await store.hasMultipartUpload({
				objectKey: "ingest/job/main.jsonl",
				uploadId,
			}),
		).toBe(true);
		expect(
			await store.hasMultipartUpload({
				objectKey: "ingest/other.jsonl",
				uploadId,
			}),
		).toBe(false);
		expect(
			(await store.listMultipartUploads("ingest/job/main.jsonl")).map(
				(upload) => upload.uploadId,
			),
		).toEqual([uploadId]);

		await store.completeMultipartUpload({
			objectKey: "ingest/job/main.jsonl",
			parts: [
				{ etag: `"${firstEtag}"`, partNumber: 1 },
				{ etag: secondEtag, partNumber: 2 },
			],
			uploadId,
		});

		const stored = await store.getObject("ingest/job/main.jsonl");
		expect(new TextDecoder().decode(stored)).toBe(`${"a".repeat(1024)}tail\n`);
		expect(await store.headObject("ingest/job/main.jsonl")).toEqual({
			byteLength: 1029,
			metadata: { "ingest-job-id": "job" },
		});
		expect(
			await store.hasMultipartUpload({
				objectKey: "ingest/job/main.jsonl",
				uploadId,
			}),
		).toBe(false);
		await expect(
			store.completeMultipartUpload({
				objectKey: "ingest/job/main.jsonl",
				parts: [{ etag: firstEtag, partNumber: 1 }],
				uploadId,
			}),
		).rejects.toMatchObject({ name: "NoSuchUpload" });
	});

	test("a re-uploaded part replaces the earlier attempt", async () => {
		const { store } = createStore();
		const { uploadId } = await store.createMultipartUpload({
			metadata: {},
			objectKey: "evidence/x",
		});
		await store.writePart({
			body: streamOf(bytes("old")),
			byteLength: 3,
			partNumber: 1,
			uploadId,
		});
		const etag = await store.writePart({
			body: streamOf(bytes("new")),
			byteLength: 3,
			partNumber: 1,
			uploadId,
		});
		await store.completeMultipartUpload({
			objectKey: "evidence/x",
			parts: [{ etag, partNumber: 1 }],
			uploadId,
		});
		expect(new TextDecoder().decode(await store.getObject("evidence/x"))).toBe(
			"new",
		);
	});

	test("rejects unknown, out of order and tampered parts without writing the object", async () => {
		const { configuration, store } = createStore();
		const { uploadId } = await store.createMultipartUpload({
			metadata: {},
			objectKey: "ingest/j/main.jsonl",
		});
		const one = await store.writePart({
			body: streamOf(bytes("one")),
			byteLength: 3,
			partNumber: 1,
			uploadId,
		});
		const two = await store.writePart({
			body: streamOf(bytes("two")),
			byteLength: 3,
			partNumber: 2,
			uploadId,
		});
		const complete = (parts: { etag: string; partNumber: number }[]) =>
			store.completeMultipartUpload({
				objectKey: "ingest/j/main.jsonl",
				parts,
				uploadId,
			});

		await expect(complete([])).rejects.toMatchObject({ name: "InvalidPart" });
		await expect(
			complete([
				{ etag: two, partNumber: 2 },
				{ etag: one, partNumber: 1 },
			]),
		).rejects.toMatchObject({ name: "InvalidPartOrder" });
		await expect(
			complete([{ etag: md5(bytes("other")), partNumber: 1 }]),
		).rejects.toMatchObject({
			name: "InvalidPart",
		});
		await expect(
			complete([{ etag: "not-an-etag", partNumber: 1 }]),
		).rejects.toMatchObject({
			name: "InvalidPart",
		});
		const partFile = readdirSync(
			join(configuration.directory, "uploads", uploadId),
		).find((name) => name.startsWith("part-00001-"));
		writeFileSync(
			join(configuration.directory, "uploads", uploadId, partFile ?? ""),
			"ONE",
		);
		await expect(
			complete([
				{ etag: one, partNumber: 1 },
				{ etag: two, partNumber: 2 },
			]),
		).rejects.toMatchObject({ name: "InvalidPart" });
		await expect(
			store.completeMultipartUpload({
				objectKey: "ingest/other/main.jsonl",
				parts: [{ etag: one, partNumber: 1 }],
				uploadId,
			}),
		).rejects.toMatchObject({ name: "NoSuchUpload" });
		expect(await store.headObject("ingest/j/main.jsonl")).toBeNull();
		expect(readdirSync(join(configuration.directory, "tmp"))).toEqual([]);
	});

	test("refuses a part longer or shorter than its signed length and keeps nothing", async () => {
		const { configuration, store } = createStore();
		const { uploadId } = await store.createMultipartUpload({
			metadata: {},
			objectKey: "ingest/j/main.jsonl",
		});
		await expect(
			store.writePart({
				body: streamOf(bytes("1234"), bytes("5678")),
				byteLength: 5,
				partNumber: 1,
				uploadId,
			}),
		).rejects.toMatchObject({ name: "EntityTooLarge" });
		await expect(
			store.writePart({
				body: streamOf(bytes("1234")),
				byteLength: 5,
				partNumber: 1,
				uploadId,
			}),
		).rejects.toMatchObject({ name: "IncompleteBody" });
		await expect(
			store.writePart({ body: null, byteLength: 5, partNumber: 1, uploadId }),
		).rejects.toMatchObject({ name: "IncompleteBody" });
		await expect(
			store.writePart({
				body: streamOf(bytes("12345")),
				byteLength: 5,
				partNumber: 1,
				uploadId: "f".repeat(32),
			}),
		).rejects.toMatchObject({ name: "NoSuchUpload" });
		expect(
			readdirSync(join(configuration.directory, "uploads", uploadId)),
		).toEqual(["upload.json"]);
		expect(readdirSync(join(configuration.directory, "tmp"))).toEqual([]);
	});

	test("aborting removes the parts; aborting again is NoSuchUpload", async () => {
		const { store } = createStore();
		const { uploadId } = await store.createMultipartUpload({
			metadata: {},
			objectKey: "evidence/y",
		});
		await store.writePart({
			body: streamOf(bytes("p")),
			byteLength: 1,
			partNumber: 1,
			uploadId,
		});
		await expect(
			store.abortMultipartUpload({ objectKey: "evidence/other", uploadId }),
		).rejects.toMatchObject({ name: "NoSuchUpload" });
		await store.abortMultipartUpload({ objectKey: "evidence/y", uploadId });
		await expect(
			store.abortMultipartUpload({ objectKey: "evidence/y", uploadId }),
		).rejects.toMatchObject({ name: "NoSuchUpload" });
		await expect(
			store.abortMultipartUpload({
				objectKey: "evidence/y",
				uploadId: "../../x",
			}),
		).rejects.toMatchObject({ name: "NoSuchUpload" });
		expect(await store.listMultipartUploads("evidence/y")).toEqual([]);
	});

	test("enumerates incomplete uploads with their start time", async () => {
		const started = new Date("2026-11-01T00:00:00.000Z");
		const { store } = createStore(() => started);
		const { uploadId } = await store.createMultipartUpload({
			metadata: {},
			objectKey: "ingest/z/main.jsonl",
		});
		const uploads = [];
		for await (const upload of store.incompleteMultipartUploads())
			uploads.push(upload);
		expect(uploads).toEqual([
			{ initiatedAt: started, objectKey: "ingest/z/main.jsonl", uploadId },
		]);
	});
});

describe("signed URLs", () => {
	test("part URLs point at the server's own origin and carry the signed length", async () => {
		const { store } = createStore(() => new Date("2026-11-08T12:00:00.000Z"));
		const url = new URL(
			await store.presignUploadPart({
				byteLength: 8_388_608,
				objectKey: "ingest/j/main.jsonl",
				partNumber: 3,
				uploadId: "a".repeat(32),
			}),
		);
		expect(url.origin).toBe("http://localhost:4100");
		expect(url.pathname).toBe("/api/selfhost/objects/part");
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			bytes: "8388608",
			expires: String(Date.parse("2026-11-08T12:15:00.000Z") / 1000),
			part: "3",
			upload: "a".repeat(32),
		});
		await expect(
			store.presignUploadPart({
				byteLength: 1,
				objectKey: "../x",
				partNumber: 1,
				uploadId: "a".repeat(32),
			}),
		).rejects.toMatchObject({ name: "InvalidObjectName" });
	});
});

describe("scratch", () => {
	test("removes stale scratch files and broken upload directories only", async () => {
		const { configuration, store } = createStore();
		await put(store, "keep/me");
		const { uploadId } = await store.createMultipartUpload({
			metadata: {},
			objectKey: "keep/upload",
		});
		const scratch = join(configuration.directory, "tmp");
		writeFileSync(join(scratch, "stale"), "x");
		writeFileSync(join(scratch, "fresh"), "x");
		const broken = join(configuration.directory, "uploads", "b".repeat(32));
		const old = new Date("2026-01-01T00:00:00.000Z");
		mkdirSync(broken);
		utimesSync(join(scratch, "stale"), old, old);
		utimesSync(broken, old, old);

		expect(
			await store.removeStaleScratch(new Date("2026-06-01T00:00:00.000Z")),
		).toBe(2);
		expect(readdirSync(scratch)).toEqual(["fresh"]);
		expect(readdirSync(join(configuration.directory, "uploads"))).toEqual([
			uploadId,
		]);
		expect(readFileSync(store.objectPath("keep/me"), "utf8")).toContain("\nx");
	});
});
