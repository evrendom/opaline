import { describe, expect, test } from "bun:test";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
				forcePathStyle: false,
				secretAccessKey: "secret-key",
			},
		});
	});

	test("uses path-style addressing for an explicit local endpoint", () => {
		expect(
			readR2IngestAvailability({
				R2_ACCESS_KEY_ID: "access-key",
				R2_ACCOUNT_ID: "account-id",
				R2_ENDPOINT: "http://127.0.0.1:9000",
				R2_SECRET_ACCESS_KEY: "secret-key",
			}),
		).toMatchObject({
			enabled: true,
			configuration: {
				endpoint: "http://127.0.0.1:9000",
				forcePathStyle: true,
			},
		});
	});

	test("rejects a different upload-part byte length at the signed boundary", async () => {
		const accessKeyId = "test-access-key";
		const secretAccessKey = "test-secret-key";
		const server = createPresignedUploadStub({ accessKeyId, secretAccessKey });
		const client = createR2MultipartUploadClient({
			accessKeyId,
			accountId: "test-account",
			bucket: R2_INGEST_BUCKET,
			endpoint: server.url.origin,
			forcePathStyle: true,
			secretAccessKey,
		});
		const uploadUrl = new URL(
			await client.presignUploadPart({
				byteLength: 7,
				objectKey: "ingest/test/main.jsonl",
				partNumber: 1,
				uploadId: "test-upload",
			}),
		);

		expect(uploadUrl.searchParams.get("X-Amz-SignedHeaders")).toBe(
			"content-length;host",
		);
		const accepted = await fetch(uploadUrl, {
			body: new Uint8Array(7),
			headers: { "Content-Length": "7" },
			method: "PUT",
		});
		const rejected = await fetch(uploadUrl, {
			body: new Uint8Array(8),
			headers: { "Content-Length": "8" },
			method: "PUT",
		});

		expect(accepted.status).toBe(200);
		expect(rejected.status).toBe(403);
		expect(await rejected.text()).toBe(
			"SignatureDoesNotMatch: signed Content-Length differs",
		);
		await server.stop(true);
	});
});

function createPresignedUploadStub(input: {
	accessKeyId: string;
	secretAccessKey: string;
}): Bun.Server<undefined> {
	return Bun.serve({
		fetch(request) {
			if (hasValidPresignedUploadSignature(request, input)) {
				return new Response(null, { status: 200 });
			}
			return new Response(
				"SignatureDoesNotMatch: signed Content-Length differs",
				{ status: 403 },
			);
		},
		hostname: "127.0.0.1",
		port: 0,
	});
}

function hasValidPresignedUploadSignature(
	request: Request,
	credentials: { accessKeyId: string; secretAccessKey: string },
): boolean {
	const url = new URL(request.url);
	const algorithm = url.searchParams.get("X-Amz-Algorithm");
	const credential = url.searchParams.get("X-Amz-Credential");
	const requestDate = url.searchParams.get("X-Amz-Date");
	const signedHeaders = url.searchParams.get("X-Amz-SignedHeaders");
	const signature = url.searchParams.get("X-Amz-Signature");
	const payloadHash = url.searchParams.get("X-Amz-Content-Sha256");
	if (
		algorithm !== "AWS4-HMAC-SHA256" ||
		!credential ||
		!requestDate ||
		signedHeaders !== "content-length;host" ||
		!signature ||
		!payloadHash
	) {
		return false;
	}

	const [accessKeyId, date, region, service, terminator] =
		credential.split("/");
	if (
		accessKeyId !== credentials.accessKeyId ||
		!date ||
		!region ||
		!service ||
		terminator !== "aws4_request"
	) {
		return false;
	}
	const contentLength = request.headers.get("content-length");
	const host = request.headers.get("host");
	if (!contentLength || !host) return false;

	const canonicalRequest = [
		request.method,
		url.pathname,
		buildCanonicalQuery(url),
		`content-length:${contentLength}\nhost:${host}\n`,
		signedHeaders,
		payloadHash,
	].join("\n");
	const credentialScope = `${date}/${region}/${service}/aws4_request`;
	const stringToSign = [
		algorithm,
		requestDate,
		credentialScope,
		createHash("sha256").update(canonicalRequest).digest("hex"),
	].join("\n");
	const dateKey = hmac(`AWS4${credentials.secretAccessKey}`, date);
	const regionKey = hmac(dateKey, region);
	const serviceKey = hmac(regionKey, service);
	const signingKey = hmac(serviceKey, "aws4_request");
	const expected = createHmac("sha256", signingKey)
		.update(stringToSign)
		.digest();
	const actual = Buffer.from(signature, "hex");
	return (
		actual.byteLength === expected.byteLength &&
		timingSafeEqual(actual, expected)
	);
}

function buildCanonicalQuery(url: URL): string {
	return [...url.searchParams.entries()]
		.filter(([name]) => name !== "X-Amz-Signature")
		.map(([name, value]) => [awsEncode(name), awsEncode(value)] as const)
		.sort(([leftName, leftValue], [rightName, rightValue]) => {
			if (leftName < rightName) return -1;
			if (leftName > rightName) return 1;
			if (leftValue < rightValue) return -1;
			if (leftValue > rightValue) return 1;
			return 0;
		})
		.map(([name, value]) => `${name}=${value}`)
		.join("&");
}

function awsEncode(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/gu,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

function hmac(key: string | Uint8Array, value: string): Buffer {
	return createHmac("sha256", key).update(value).digest();
}

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
