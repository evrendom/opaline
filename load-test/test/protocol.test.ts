import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateTranscriptCorpus } from "../src/generator.ts";
import { loadAndVerifyManifest } from "../src/manifest.ts";
import { executeLoadTest } from "../src/protocol.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
	);
});

describe("R2 ingest protocol driver", () => {
	test("completes two same-session-hash uploads through a loopback mock", async () => {
		const root = await createTemporaryRoot();
		await generateTranscriptCorpus({
			entropy: "high",
			outputDirectory: join(root, "corpus"),
			seed: "mock-protocol",
			source: "claude_code",
			subagentCount: 1,
			timestampLines: 4,
			timestampStart: "2026-08-25T10:00:00.000Z",
			totalBytes: 64 * 1024,
		});
		const manifest = await loadAndVerifyManifest(
			join(root, "corpus", "manifest.json"),
		);
		const mock = createProtocolMock();
		try {
			const passed = await executeLoadTest({
				apiKey: "local-test-key",
				barrierBeforeCommit: true,
				baseUrl: new URL(mock.origin),
				clickHouseObserver: null,
				clickHouseSettleMs: 0,
				commitAttempts: 2,
				concurrency: 2,
				manifest,
				organizationId: "test-organization",
				partConcurrency: 2,
				processingPids: [],
				ratePerSecond: null,
				requestTimeoutMs: 5_000,
				sameSessionHash: true,
				scenarioName: "loopback-protocol-test",
				statusWaitMs: 0,
				summaryPath: join(root, "summary.json"),
				thresholds: {
					maxClickHousePartDelta: null,
					maxE2eP95Ms: null,
					maxFailures: 0,
					maxFirstCommitP95Ms: null,
					maxOrphaned: 0,
					maxPeakRssBytes: null,
					maxTransportFailures: 0,
				},
				uploads: 2,
			});

			expect(passed).toBe(true);
			expect(mock.sessionIds).toEqual([
				manifest.manifest.metadata.sessionId,
				manifest.manifest.metadata.sessionId,
			]);
			expect(mock.completedJobs).toBe(2);
			const summary: unknown = JSON.parse(
				await Bun.file(join(root, "summary.json")).text(),
			);
			expect(readNestedNumber(summary, "totals", "completed")).toBe(2);
			expect(readNestedNumber(summary, "totals", "orphaned")).toBe(0);
			expect(readNestedNumber(summary, "totals", "uploadedBytes")).toBe(
				manifest.manifest.aggregateBytes * 2,
			);
		} finally {
			mock.stop();
		}
	});
});

function createProtocolMock(): {
	readonly completedJobs: number;
	readonly origin: string;
	readonly sessionIds: readonly string[];
	readonly stop: () => void;
} {
	const jobs = new Map<
		string,
		{ readonly objects: readonly MockObject[]; readonly sessionId: string }
	>();
	const receivedUploads = new Set<string>();
	const sessionIds: string[] = [];
	let completedJobs = 0;
	let origin = "";
	let jobCounter = 0;
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			if (request.method === "POST" && url.pathname === "/rpc/ingest/init") {
				const payload = readRpcPayload(await request.json());
				const sessionId = readString(payload, "sessionId");
				const objects = readObjectInputs(payload);
				const jobId = `00000000-0000-4000-8000-${(++jobCounter)
					.toString()
					.padStart(12, "0")}`;
				const initialized = objects.map((object, index) => ({
					...(object.agentId ? { agentId: object.agentId } : {}),
					byteLength: object.byteLength,
					kind: object.kind,
					objectKey: `${jobId}/object-${index}`,
					parts: [
						{
							byteLength: object.byteLength,
							headers: { "Content-Length": object.byteLength.toString() },
							partNumber: 1,
							uploadUrl: `${origin}/upload/${jobId}/${index}`,
						},
					],
					sha256: object.sha256,
					uploadId: `upload-${jobId}-${index}`,
				}));
				jobs.set(jobId, { objects: initialized, sessionId });
				sessionIds.push(sessionId);
				return Response.json({
					json: {
						expiresAt: "2026-08-25T11:00:00.000Z",
						jobId,
						objects: initialized,
						partSizeBytes: 8 * 1024 * 1024,
						protocol: "r2_multipart_v1",
					},
				});
			}

			if (request.method === "PUT" && url.pathname.startsWith("/upload/")) {
				const bytes = await request.bytes();
				const expected = Number(request.headers.get("content-length"));
				if (bytes.byteLength !== expected)
					return new Response(null, { status: 400 });
				receivedUploads.add(url.pathname);
				return new Response(null, { headers: { etag: '"local-etag"' } });
			}

			if (request.method === "POST" && url.pathname === "/rpc/ingest/commit") {
				const payload = readRpcPayload(await request.json());
				const jobId = readString(payload, "jobId");
				const job = jobs.get(jobId);
				if (!job) return new Response(null, { status: 404 });
				const everyObjectUploaded = job.objects.every((_, index) =>
					receivedUploads.has(`/upload/${jobId}/${index}`),
				);
				if (!everyObjectUploaded) return new Response(null, { status: 409 });
				completedJobs += 1;
				return Response.json({
					json: {
						jobId,
						protocol: "r2_multipart_v1",
						result: { redacted: {}, sessionId: job.sessionId, success: true },
						status: "completed",
					},
				});
			}

			if (request.method === "POST" && url.pathname === "/rpc/ingest/status") {
				const payload = readRpcPayload(await request.json());
				const jobId = readString(payload, "jobId");
				const job = jobs.get(jobId);
				if (!job) return new Response(null, { status: 404 });
				return Response.json({
					json: {
						attempts: 1,
						availableAt: "2026-08-25T10:00:00.000Z",
						error: null,
						jobId,
						leaseExpiresAt: null,
						protocol: "r2_multipart_v1",
						result: { redacted: {}, sessionId: job.sessionId, success: true },
						status: "completed",
						updatedAt: "2026-08-25T10:00:01.000Z",
					},
				});
			}

			return new Response(null, { status: 404 });
		},
	});
	origin = server.url.origin;
	return {
		get completedJobs() {
			return completedJobs;
		},
		origin,
		sessionIds,
		stop: () => server.stop(true),
	};
}

interface MockObject {
	readonly agentId?: string;
	readonly byteLength: number;
	readonly kind: "main" | "subagent";
	readonly sha256: string;
}

function readRpcPayload(value: unknown): Record<string, unknown> {
	if (!isRecord(value) || !isRecord(value.json)) {
		throw new Error("Expected an oRPC JSON envelope");
	}
	return value.json;
}

function readObjectInputs(value: Record<string, unknown>): MockObject[] {
	if (!Array.isArray(value.objects)) throw new Error("Expected objects");
	return value.objects.map((object) => {
		if (!isRecord(object)) throw new Error("Expected object input");
		const kind = readString(object, "kind");
		if (kind !== "main" && kind !== "subagent") {
			throw new Error("Unexpected object kind");
		}
		const byteLength = object.byteLength;
		if (typeof byteLength !== "number") throw new Error("Expected byteLength");
		return {
			...(kind === "subagent"
				? { agentId: readString(object, "agentId") }
				: {}),
			byteLength,
			kind,
			sha256: readString(object, "sha256"),
		};
	});
}

function readNestedNumber(value: unknown, parent: string, key: string): number {
	if (!isRecord(value) || !isRecord(value[parent])) {
		throw new Error(`Expected ${parent}`);
	}
	const field = value[parent][key];
	if (typeof field !== "number") throw new Error(`Expected ${parent}.${key}`);
	return field;
}

function readString(value: Record<string, unknown>, key: string): string {
	const field = value[key];
	if (typeof field !== "string" || !field) throw new Error(`Expected ${key}`);
	return field;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function createTemporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "opaline-load-test-protocol-"));
	temporaryDirectories.push(root);
	return root;
}
