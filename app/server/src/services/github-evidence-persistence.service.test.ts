import { describe, expect, test } from "bun:test";
import { persistContentAddressedGitHubObject } from "./github-evidence-persistence.service.js";
import type { R2EvidenceStorageClient } from "./r2-ingest-storage.service.js";

describe("GitHub evidence object persistence", () => {
	test("stores filtered evidence under a tenant-scoped content address once", async () => {
		const objects = new Map<string, Uint8Array>();
		const puts: string[] = [];
		const r2 = createMemoryR2(objects, puts);
		const input = {
			bytes: new TextEncoder().encode("filtered log"),
			contentType: "text/plain",
			kind: "ci-log" as const,
			organizationId: "organization-secret-id",
			r2,
			repositoryId: "12345",
		};
		const first = await persistContentAddressedGitHubObject(input);
		const second = await persistContentAddressedGitHubObject(input);

		expect(first).toEqual(second);
		expect(first.objectId).toMatch(/^sha256:[a-f0-9]{64}$/u);
		expect(first.objectKey).toContain("/github/12345/ci-log/");
		expect(first.objectKey).not.toContain("organization-secret-id");
		expect(puts).toEqual([first.objectKey]);
	});

	test("fails closed when a content-addressed key has a different size", async () => {
		const objects = new Map<string, Uint8Array>();
		const puts: string[] = [];
		const r2 = createMemoryR2(objects, puts);
		const input = {
			bytes: new TextEncoder().encode("one"),
			contentType: "application/json",
			kind: "ci-metadata" as const,
			organizationId: "organization-1",
			r2,
			repositoryId: "12345",
		};
		const stored = await persistContentAddressedGitHubObject(input);
		objects.set(stored.objectKey, new Uint8Array(99));
		await expect(persistContentAddressedGitHubObject(input)).rejects.toThrow(
			"conflicting content length",
		);
	});

	test("fails closed when an existing same-size object has different bytes", async () => {
		const objects = new Map<string, Uint8Array>();
		const r2 = createMemoryR2(objects, []);
		const input = {
			bytes: new TextEncoder().encode("one"),
			contentType: "application/json",
			kind: "ci-metadata" as const,
			organizationId: "organization-1",
			r2,
			repositoryId: "12345",
		};
		const stored = await persistContentAddressedGitHubObject(input);
		objects.set(stored.objectKey, new TextEncoder().encode("two"));
		await expect(persistContentAddressedGitHubObject(input)).rejects.toThrow(
			"failed its digest check",
		);
	});
});

function createMemoryR2(
	objects: Map<string, Uint8Array>,
	puts: string[],
): R2EvidenceStorageClient {
	return {
		abortMultipartUpload: async () => {},
		completeMultipartUpload: async () => {},
		createMultipartUpload: async () => ({ uploadId: "unused" }),
		deleteObjects: async () => {},
		getObject: async (key) => objects.get(key) ?? new Uint8Array(),
		hasMultipartUpload: async () => false,
		headObject: async (key) => {
			const value = objects.get(key);
			return value ? { byteLength: value.byteLength, metadata: {} } : null;
		},
		listMultipartUploads: async () => [],
		presignUploadPart: async () => "https://example.invalid",
		putObject: async ({ body, objectKey }) => {
			puts.push(objectKey);
			objects.set(objectKey, body);
		},
	};
}
