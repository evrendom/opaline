import { describe, expect, test } from "bun:test";
import {
	getR2IngestPartByteLengths,
	sortR2IngestObjects,
} from "../lib/r2-ingest-manifest.js";
import {
	createR2MultipartUploadClient,
	R2_INGEST_BUCKET,
	readR2IngestAvailability,
} from "./r2-ingest-storage.service.js";

describe("R2 ingest storage configuration", () => {
	test("fails closed with the exact missing variable names", () => {
		expect(
			readR2IngestAvailability({ R2_ACCESS_KEY_ID: "access-key" }),
		).toEqual({
			enabled: false,
			missingVariables: ["R2_ACCOUNT_ID", "R2_SECRET_ACCESS_KEY"],
		});
	});

	test("pins the EU-jurisdiction endpoint and production bucket", () => {
		expect(
			readR2IngestAvailability({
				R2_ACCESS_KEY_ID: "access-key",
				R2_ACCOUNT_ID: "account-id",
				R2_SECRET_ACCESS_KEY: "secret-key",
			}),
		).toEqual({
			enabled: true,
			configuration: {
				accessKeyId: "access-key",
				accountId: "account-id",
				bucket: R2_INGEST_BUCKET,
				endpoint: "https://account-id.eu.r2.cloudflarestorage.com",
				secretAccessKey: "secret-key",
			},
		});
	});

	test("rejects a different upload-part byte length at the signed boundary", async () => {
		const client = createR2MultipartUploadClient({
			accessKeyId: "test-access-key",
			accountId: "test-account",
			bucket: R2_INGEST_BUCKET,
			endpoint: "https://test-account.example.test",
			secretAccessKey: "test-secret-key",
		});
		const expectedLengthUrl = new URL(
			await client.presignUploadPart({
				byteLength: 7,
				objectKey: "ingest/test/main.jsonl",
				partNumber: 1,
				uploadId: "test-upload",
			}),
		);
		const mismatchedLengthUrl = new URL(
			await client.presignUploadPart({
				byteLength: 8,
				objectKey: "ingest/test/main.jsonl",
				partNumber: 1,
				uploadId: "test-upload",
			}),
		);

		expect(expectedLengthUrl.searchParams.get("X-Amz-SignedHeaders")).toBe(
			"content-length;host",
		);
		expect(expectedLengthUrl.searchParams.get("X-Amz-Signature")).not.toBe(
			mismatchedLengthUrl.searchParams.get("X-Amz-Signature"),
		);
	});
});

describe("R2 ingest manifest helpers", () => {
	test("sorts the main transcript first and subagents by agent ID", () => {
		const hash = "a".repeat(64);
		expect(
			sortR2IngestObjects([
				{ agentId: "z", byteLength: 1, kind: "subagent", sha256: hash },
				{ byteLength: 1, kind: "main", sha256: hash },
				{ agentId: "a", byteLength: 1, kind: "subagent", sha256: hash },
			]),
		).toEqual([
			{ byteLength: 1, kind: "main", sha256: hash },
			{ agentId: "a", byteLength: 1, kind: "subagent", sha256: hash },
			{ agentId: "z", byteLength: 1, kind: "subagent", sha256: hash },
		]);
	});

	test("splits objects into fixed parts with a bounded final part", () => {
		expect(getR2IngestPartByteLengths(21, 8)).toEqual([8, 8, 5]);
	});
});
