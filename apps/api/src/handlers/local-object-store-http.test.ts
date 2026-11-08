import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalObjectStoreClient } from "../services/local-object-store.js";
import { signDownloadUrl } from "../services/local-object-store-url.js";
import { createR2ImageUrlSigner } from "../services/session-image-read.service.js";
import { handleLocalObjectStoreRoute } from "./local-object-store-http.js";

const SECRET = "better-auth-secret-0123456789abcdef";
const NOW = new Date("2026-11-08T12:00:00.000Z");
const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

function setup() {
	const dataDirectory = mkdtempSync(join(tmpdir(), "opaline-object-http-"));
	directories.push(dataDirectory);
	const environment = {
		APP_URL: "http://localhost:4791",
		BETTER_AUTH_SECRET: SECRET,
		OPALINE_DATA_DIR: dataDirectory,
		OPALINE_SELF_HOSTED: "1",
	};
	const configuration = {
		backend: "local" as const,
		directory: join(dataDirectory, "object-store"),
		publicOrigin: "http://localhost:4791",
		signingSecret: SECRET,
	};
	const store = createLocalObjectStoreClient(configuration, () => NOW);
	const routeAt = (now: Date) => (request: Request) =>
		handleLocalObjectStoreRoute(request, new URL(request.url), {
			environment,
			now: () => now,
		});
	return { configuration, route: routeAt(NOW), routeAt, store };
}

function putRequest(url: string, body: Uint8Array, contentLength?: string) {
	return new Request(url, {
		body,
		headers:
			contentLength === undefined ? {} : { "Content-Length": contentLength },
		method: "PUT",
	});
}

describe("part uploads", () => {
	test("a signed PUT stores the part and answers its ETag; the parts complete the object", async () => {
		const { route, store } = setup();
		const { uploadId } = await store.createMultipartUpload({
			metadata: {},
			objectKey: "ingest/job/main.jsonl",
		});
		const chunks = [new Uint8Array(1024).fill(97), new Uint8Array([10])];
		const etags: string[] = [];
		for (const [index, chunk] of chunks.entries()) {
			const url = await store.presignUploadPart({
				byteLength: chunk.byteLength,
				objectKey: "ingest/job/main.jsonl",
				partNumber: index + 1,
				uploadId,
			});
			const response = await route(
				putRequest(url, chunk, String(chunk.byteLength)),
			);
			expect(response?.status).toBe(200);
			const etag = response?.headers.get("ETag") ?? "";
			expect(etag).toBe(`"${createHash("md5").update(chunk).digest("hex")}"`);
			etags.push(etag);
		}
		await store.completeMultipartUpload({
			objectKey: "ingest/job/main.jsonl",
			parts: etags.map((etag, index) => ({ etag, partNumber: index + 1 })),
			uploadId,
		});
		expect((await store.getObject("ingest/job/main.jsonl")).byteLength).toBe(
			1025,
		);
	});

	test("rejects unsigned, tampered, expired, oversized and unknown uploads", async () => {
		const { configuration, route, routeAt, store } = setup();
		const { uploadId } = await store.createMultipartUpload({
			metadata: {},
			objectKey: "ingest/job/main.jsonl",
		});
		const url = await store.presignUploadPart({
			byteLength: 4,
			objectKey: "ingest/job/main.jsonl",
			partNumber: 1,
			uploadId,
		});
		const body = new Uint8Array([1, 2, 3, 4]);

		const unsigned = new URL(url);
		unsigned.searchParams.delete("signature");
		expect(
			(await route(putRequest(unsigned.toString(), body, "4")))?.status,
		).toBe(403);

		const tampered = new URL(url);
		tampered.searchParams.set("bytes", "5");
		expect(
			(await route(putRequest(tampered.toString(), body, "5")))?.status,
		).toBe(403);

		const expired = await routeAt(new Date(NOW.getTime() + 16 * 60_000))(
			putRequest(url, body, "4"),
		);
		expect(expired?.status).toBe(403);
		expect(await expired?.text()).toContain("expired");

		const oversized = await route(
			putRequest(url, new Uint8Array([1, 2, 3, 4, 5]), "5"),
		);
		expect(oversized?.status).toBe(403);

		const missingLength = new Request(url, {
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(body);
					controller.close();
				},
			}),
			method: "PUT",
		});
		expect((await route(missingLength))?.status).toBe(411);

		const otherUpload = await store.presignUploadPart({
			byteLength: 4,
			objectKey: "ingest/job/main.jsonl",
			partNumber: 1,
			uploadId: "e".repeat(32),
		});
		expect((await route(putRequest(otherUpload, body, "4")))?.status).toBe(404);
		expect(
			readdirSync(join(configuration.directory, "uploads", uploadId)),
		).toEqual(["upload.json"]);
	});

	test("only PUT is accepted for parts", async () => {
		const { route, store } = setup();
		const url = await store.presignUploadPart({
			byteLength: 1,
			objectKey: "ingest/job/main.jsonl",
			partNumber: 1,
			uploadId: "a".repeat(32),
		});
		const response = await route(new Request(url, { method: "POST" }));
		expect(response?.status).toBe(405);
		expect(response?.headers.get("Allow")).toBe("PUT");
	});
});

describe("downloads", () => {
	test("an image URL from the session image signer serves the stored bytes with the pinned headers", async () => {
		const { configuration, route, store } = setup();
		const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1]);
		await store.putObject({
			body: png,
			contentType: "application/octet-stream",
			metadata: {},
			objectKey: "evidence/v2/org/ab/abcd/uuid",
		});
		const signer = createR2ImageUrlSigner(configuration);
		const url = await signer({
			contentDisposition: 'inline; filename="abcd.png"',
			contentType: "image/png",
			expiresInSeconds: 600,
			objectKey: "evidence/v2/org/ab/abcd/uuid",
		});
		expect(new URL(url).origin).toBe("http://localhost:4791");

		const response = await route(new Request(url));
		expect(response?.status).toBe(200);
		expect(response?.headers.get("Content-Type")).toBe("image/png");
		expect(response?.headers.get("Content-Disposition")).toBe(
			'inline; filename="abcd.png"',
		);
		expect(response?.headers.get("Content-Length")).toBe("10");
		expect(response?.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(
			new Uint8Array((await response?.arrayBuffer()) ?? new ArrayBuffer(0)),
		).toEqual(png);

		const head = await route(new Request(url, { method: "HEAD" }));
		expect(head?.status).toBe(200);
		expect(await head?.text()).toBe("");

		const tampered = new URL(url);
		tampered.searchParams.set("type", "text/html");
		expect((await route(new Request(tampered.toString())))?.status).toBe(403);
	});

	test("a signed traversal key is refused and a missing object is 404", async () => {
		const { configuration, route } = setup();
		const sign = (objectKey: string) =>
			signDownloadUrl(configuration, {
				cacheControl: "no-store",
				contentDisposition: "attachment",
				contentType: "application/octet-stream",
				expiresAt: Math.floor(NOW.getTime() / 1000) + 60,
				objectKey,
			});
		expect(
			(await route(new Request(sign("../../../etc/passwd"))))?.status,
		).toBe(400);
		expect((await route(new Request(sign("evidence/../../x"))))?.status).toBe(
			400,
		);
		expect((await route(new Request(sign("evidence/missing"))))?.status).toBe(
			404,
		);
	});
});

describe("routing", () => {
	test("does nothing unless self-hosted, and is 404 without a local store", async () => {
		const request = new Request(
			"http://localhost:4791/api/selfhost/objects/part",
		);
		expect(
			handleLocalObjectStoreRoute(request, new URL(request.url), {
				environment: { R2_ACCOUNT_ID: "a" },
			}),
		).toBeNull();
		const s3 = await handleLocalObjectStoreRoute(
			request,
			new URL(request.url),
			{
				environment: {
					OPALINE_SELF_HOSTED: "1",
					S3_ACCESS_KEY_ID: "k",
					S3_BUCKET: "b",
					S3_ENDPOINT: "http://127.0.0.1:8333",
					S3_SECRET_ACCESS_KEY: "s",
				},
			},
		);
		expect(s3?.status).toBe(404);
		const other = new Request("http://localhost:4791/api/selfhost/info");
		expect(
			handleLocalObjectStoreRoute(other, new URL(other.url), {
				environment: { OPALINE_SELF_HOSTED: "1" },
			}),
		).toBeNull();
	});
});
