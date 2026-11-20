import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { S3ServiceException } from "@aws-sdk/client-s3";
import { parseError } from "@clickhouse/client-web";
import { createRouterClient } from "@orpc/server";
import type {
	IngestSessionInput,
	R2IngestCommitInput,
	R2IngestInitOutput,
} from "@rudel/api-routes";
import postgres from "postgres";
import {
	createClickHouseExecutor,
	getClickhouse,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { ingestProcessingSqlClient, sqlClient } from "../db.js";
import { handleR2IngestMaintenanceRequest } from "../handlers/api-maintenance.js";
import { router } from "../router.js";
import { setAnalysisLogForTests } from "../services/analysis-log/config.js";
import { createLocalEmbedder } from "../services/analysis-log/embedder.js";
import { createMemoryAnalysisStore } from "../services/analysis-log/memory-store.js";
import { IngestFilterQueue } from "../services/ingest-filter.service.js";
import {
	extendNonterminalR2IngestJobExpiries,
	getR2IngestJobStatus,
	initR2IngestJob,
} from "../services/ingest-job.service.js";
import {
	type IngestProcessingBoundary,
	IngestProcessingCrashSimulationError,
	type IngestProcessingFailpoint,
} from "../services/ingest-processing-boundary.js";
import {
	createIngestProcessingSemaphore,
	withIngestProcessingLedger,
} from "../services/ingest-processing-ledger.service.js";
import { IngestFilterWorkerOperationalError } from "../services/ingest-worker-operational.error.js";
import {
	acquirePostgresLease,
	PostgresLeaseLostError,
} from "../services/postgres-lease.service.js";
import {
	cleanupIngestJobObjects,
	getNextR2IngestWorkDueAt,
	repairR2IngestCleanupJobs,
	sweepExpiredR2IngestJobs,
} from "../services/r2-ingest-cleanup.service.js";
import {
	commitR2IngestJob,
	hasDueLargeR2IngestWork,
	type R2IngestProcessorResult,
	repairRecoverableR2IngestJobs,
} from "../services/r2-ingest-commit.service.js";
import { createR2IngestMaterializationGate } from "../services/r2-ingest-materialization-gate.js";
import { R2IngestCommitQueuedError } from "../services/r2-ingest-processing-error.js";
import { runR2IngestRepairPass } from "../services/r2-ingest-repair.service.js";
import {
	R2_INGEST_BUCKET,
	type R2MultipartUploadClient,
	type R2MultipartUploadInitClient,
	type R2ObjectMetadata,
} from "../services/r2-ingest-storage.service.js";
import {
	type IngestErrorFactories,
	processIngestSession,
	type SessionImportDependencies,
} from "../services/session-import/index.js";
import { UsageExtractionQueueTimeoutError } from "../services/usage-extraction.service.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

const USER_ID = `r2-ingest-user-${crypto.randomUUID()}`;
const ORGANIZATION_ID = `r2-ingest-org-${crypto.randomUUID()}`;
const HASH_AFTER_FILTERING = "c".repeat(64);
const MEMBER_ID = `r2-ingest-member-${crypto.randomUUID()}`;
const REAL_CLAUDE_SESSION_DATE = "2026-08-25 10:00:00.000";

interface FakeStoredObject {
	bytes: Uint8Array | null;
	complete: boolean;
	metadata: Readonly<Record<string, string>>;
	uploadId: string;
}

class FakeR2Client implements R2MultipartUploadClient {
	readonly abortedKeys: string[] = [];
	readonly abortFailures = new Map<string, unknown>();
	readonly completedKeys: string[] = [];
	readonly deletedKeys: string[] = [];
	readonly getObjectKeys: string[] = [];
	readonly getObjectFailures = new Map<string, unknown>();
	readonly headObjectKeys: string[] = [];
	readonly objects = new Map<string, FakeStoredObject>();

	async abortMultipartUpload(input: {
		objectKey: string;
		uploadId: string;
	}): Promise<void> {
		const abortFailure = this.abortFailures.get(input.objectKey);
		if (abortFailure) {
			this.abortFailures.delete(input.objectKey);
			throw abortFailure;
		}
		const object = this.objects.get(input.objectKey);
		if (!object || object.uploadId !== input.uploadId) return;
		this.abortedKeys.push(input.objectKey);
		if (!object.complete) this.objects.delete(input.objectKey);
	}

	async hasMultipartUpload(input: {
		objectKey: string;
		uploadId: string;
	}): Promise<boolean> {
		const object = this.objects.get(input.objectKey);
		return !!object && !object.complete && object.uploadId === input.uploadId;
	}

	async listMultipartUploads(
		objectKey: string,
	): Promise<readonly { initiatedAt: Date; uploadId: string }[]> {
		const object = this.objects.get(objectKey);
		return object && !object.complete
			? [{ initiatedAt: new Date(0), uploadId: object.uploadId }]
			: [];
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
		this.getObjectKeys.push(objectKey);
		const failure = this.getObjectFailures.get(objectKey);
		if (failure) {
			this.getObjectFailures.delete(objectKey);
			throw failure;
		}
		const object = this.requireObject(objectKey);
		if (!object.complete || !object.bytes)
			throw new Error("object unavailable");
		return object.bytes;
	}

	async headObject(objectKey: string): Promise<R2ObjectMetadata | null> {
		this.headObjectKeys.push(objectKey);
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
		this.uploadBytes(objectKey, new TextEncoder().encode(content));
	}

	uploadBytes(objectKey: string, bytes: Uint8Array): void {
		this.requireObject(objectKey).bytes = bytes;
	}

	failNextAbort(objectKey: string, error: unknown): void {
		this.abortFailures.set(objectKey, error);
	}

	failNextGetObject(objectKey: string, error: unknown): void {
		this.getObjectFailures.set(objectKey, error);
	}

	reset(): void {
		this.abortedKeys.length = 0;
		this.abortFailures.clear();
		this.completedKeys.length = 0;
		this.deletedKeys.length = 0;
		this.getObjectKeys.length = 0;
		this.getObjectFailures.clear();
		this.headObjectKeys.length = 0;
		this.objects.clear();
	}

	private requireObject(objectKey: string): FakeStoredObject {
		const object = this.objects.get(objectKey);
		if (!object) throw new Error("unknown fake R2 object");
		return object;
	}
}

const fakeR2 = new FakeR2Client();

function createFakeR2S3Endpoint(): Bun.Server<undefined> {
	return Bun.serve({
		async fetch(request) {
			const url = new URL(request.url);
			const objectKey = readFakeR2ObjectKey(url);
			if (
				request.method === "POST" &&
				url.searchParams.has("delete") &&
				objectKey === null
			) {
				const body = await request.text();
				const objectKeys = [...body.matchAll(/<Key>([^<]+)<\/Key>/gu)].map(
					(match) => decodeXmlText(match[1] ?? ""),
				);
				await fakeR2.deleteObjects(objectKeys);
				return xmlResponse(
					'<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/" />',
				);
			}
			if (objectKey === null) return new Response(null, { status: 404 });
			if (request.method === "POST" && url.searchParams.has("uploads")) {
				const metadata = Object.fromEntries(
					[...request.headers]
						.filter(([name]) => name.startsWith("x-amz-meta-"))
						.map(([name, value]) => [name.slice("x-amz-meta-".length), value]),
				);
				const created = await fakeR2.createMultipartUpload({
					metadata,
					objectKey,
				});
				return xmlResponse(
					`<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>${R2_INGEST_BUCKET}</Bucket><Key>${objectKey}</Key><UploadId>${created.uploadId}</UploadId></InitiateMultipartUploadResult>`,
				);
			}
			const uploadId = url.searchParams.get("uploadId");
			if (request.method === "DELETE" && uploadId) {
				await fakeR2.abortMultipartUpload({ objectKey, uploadId });
				return new Response(null, { status: 204 });
			}
			if (request.method === "POST" && uploadId) {
				await fakeR2.completeMultipartUpload({
					objectKey,
					parts: [{ etag: '"fake-etag"', partNumber: 1 }],
					uploadId,
				});
				return xmlResponse(
					`<CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>${R2_INGEST_BUCKET}</Bucket><Key>${objectKey}</Key><ETag>"fake-etag"</ETag></CompleteMultipartUploadResult>`,
				);
			}
			if (request.method === "HEAD") {
				const metadata = await fakeR2.headObject(objectKey);
				if (!metadata) return new Response(null, { status: 404 });
				return new Response(null, {
					headers: buildFakeR2Headers(metadata),
					status: 200,
				});
			}
			if (request.method === "GET") {
				const bytes = await fakeR2.getObject(objectKey);
				const stored = fakeR2.objects.get(objectKey);
				if (!stored) return new Response(null, { status: 404 });
				return new Response(bytes, {
					headers: buildFakeR2Headers({
						byteLength: bytes.byteLength,
						metadata: stored.metadata,
					}),
					status: 200,
				});
			}
			return new Response(null, { status: 405 });
		},
		hostname: "127.0.0.1",
		port: 0,
	});
}

function readFakeR2ObjectKey(url: URL): string | null {
	const bucketPath = `/${R2_INGEST_BUCKET}`;
	if (url.pathname === bucketPath || url.pathname === `${bucketPath}/`) {
		return null;
	}
	if (!url.pathname.startsWith(`${bucketPath}/`)) return null;
	return decodeURIComponent(url.pathname.slice(bucketPath.length + 1));
}

function buildFakeR2Headers(metadata: R2ObjectMetadata): Headers {
	const headers = new Headers({
		"Content-Length": metadata.byteLength.toString(),
		ETag: '"fake-etag"',
	});
	for (const [name, value] of Object.entries(metadata.metadata)) {
		headers.set(`x-amz-meta-${name}`, value);
	}
	return headers;
}

function decodeXmlText(value: string): string {
	return value
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'");
}

function xmlResponse(body: string): Response {
	return new Response(body, {
		headers: { "Content-Type": "application/xml" },
		status: 200,
	});
}

beforeAll(async () => {
	await sqlClient`
		INSERT INTO "user" (id, name, email)
		VALUES (${USER_ID}, 'R2 Ingest Test', ${`${USER_ID}@example.com`})
	`;
	await sqlClient`
		INSERT INTO organization (id, name, slug)
		VALUES (${ORGANIZATION_ID}, 'R2 Ingest Test', ${ORGANIZATION_ID})
	`;
	await sqlClient`
		INSERT INTO member (id, organization_id, user_id, role)
		VALUES (${MEMBER_ID}, ${ORGANIZATION_ID}, ${USER_ID}, 'owner')
	`;
});

afterAll(async () => {
	for (const table of [
		"rudel.claude_sessions",
		"rudel.session_analytics",
		"rudel.session_language_signals",
		"rudel.skill_receipts",
		"rudel.skill_uses",
		"rudel.skill_version_contents",
		"rudel.usage_events",
	]) {
		await getClickhouse().execute({
			query: `DELETE FROM ${getSafeClickHouseTable(table)} WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
			query_params: { organizationId: ORGANIZATION_ID },
		});
	}
	await sqlClient`DELETE FROM organization WHERE id = ${ORGANIZATION_ID}`;
	await sqlClient`DELETE FROM "user" WHERE id = ${USER_ID}`;
});

describe("R2 ingest commit lifecycle", () => {
	beforeEach(async () => {
		await sqlClient`DELETE FROM ingest_job WHERE user_id = ${USER_ID}`;
		fakeR2.reset();
	});

	test("a commit that times out while queued is stored and completed by recovery without another commit", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"queued materialization transcript",
		);
		const committedAt = new Date("2030-01-01T00:00:00.000Z");
		let releaseBlocker: (() => void) | undefined;
		const blocker = new Promise<void>((resolve) => {
			releaseBlocker = resolve;
		});
		const gate = createR2IngestMaterializationGate({
			maxBytes: 128 * 1024 * 1024,
			maxJobs: 1,
			maxQueuedJobs: 1,
			operationTimeoutMs: 1_000,
			queueTimeoutMs: 10,
		});
		const active = gate.run(1, async () => blocker);
		expect(gate.getStats().activeJobs).toBe(1);

		try {
			const queued = commitR2IngestJob({
				gate,
				input: buildCompletionInput(initialized),
				now: () => committedAt,
				process: async () => {
					throw new Error("queued job unexpectedly started");
				},
				r2: fakeR2,
				userId: USER_ID,
			});
			// Released CLIs poll status on this reason instead of failing.
			await expect(queued).rejects.toMatchObject({
				code: "R2_INGEST_JOB_RETRY_LATER",
				retryable: true,
			});
			await expect(queued).rejects.toBeInstanceOf(R2IngestCommitQueuedError);
		} finally {
			releaseBlocker?.();
			await active;
		}
		const status = await getR2IngestJobStatus(initialized.jobId, USER_ID);
		expect(status).toMatchObject({
			attempts: 0,
			error: { code: "R2_INGEST_COMMIT_QUEUED" },
			result: null,
			status: "pending",
		});
		expect(status?.availableAt).toBe(
			new Date(committedAt.getTime() + 5_000).toISOString(),
		);
		expect(await getNextR2IngestWorkDueAt(sqlClient)).toEqual(
			new Date(committedAt.getTime() + 5_000),
		);

		// A client retry inside the window is answered at once, without a slot.
		await expect(
			commitR2IngestJob({
				gate,
				input: buildCompletionInput(initialized),
				now: () => new Date(committedAt.getTime() + 1_000),
				process: async () => {
					throw new Error("retry inside the window unexpectedly started");
				},
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toMatchObject({ code: "R2_INGEST_JOB_RETRY_LATER" });
		expect(gate.getStats()).toMatchObject({ activeJobs: 0, queuedJobs: 0 });

		// Recovery ignores the job until its short delay passes, then finishes it
		// from the stored completion receipt.
		await expect(
			repairRecoverableR2IngestJobs({
				database: sqlClient,
				gate,
				now: () => new Date(committedAt.getTime() + 1_000),
				process: async (input) => processorResult(input.sessionId),
				r2: fakeR2,
			}),
		).resolves.toMatchObject({ attempted: 0, completed: 0 });
		let processed = 0;
		await expect(
			repairRecoverableR2IngestJobs({
				database: sqlClient,
				gate,
				now: () => new Date(committedAt.getTime() + 60_000),
				process: async (input) => {
					processed += 1;
					return processorResult(input.sessionId);
				},
				r2: fakeR2,
			}),
		).resolves.toMatchObject({ attempted: 1, completed: 1 });
		expect(processed).toBe(1);
		expect(fakeR2.completedKeys).toEqual(
			initialized.objects.map((object) => object.objectKey),
		);
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			attempts: 1,
			error: null,
			result: { sessionId: initialized.jobId, success: true },
			status: "completed",
		});
	});

	test("a session above the standard size is queued at commit and materialized only where large jobs are admitted", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"x".repeat(128 * 1024 * 1024 + 1),
		);
		const committedAt = new Date("2030-01-01T00:00:00.000Z");
		const createGate = (largeJobMaxBytes: number | undefined) =>
			createR2IngestMaterializationGate({
				largeJobMaxBytes,
				maxBytes: 128 * 1024 * 1024,
				maxJobs: 1,
				maxQueuedJobs: 1,
				operationTimeoutMs: 60_000,
				queueTimeoutMs: 1_000,
			});
		const standardGate = createGate(undefined);
		const residentGate = createGate(256 * 1024 * 1024);

		// Even where it could run, a large commit never materializes inline.
		await expect(
			commitR2IngestJob({
				gate: residentGate,
				input: buildCompletionInput(initialized),
				now: () => committedAt,
				process: async () => {
					throw new Error("large commit unexpectedly materialized inline");
				},
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toBeInstanceOf(R2IngestCommitQueuedError);
		expect(residentGate.getStats()).toMatchObject({ activeJobs: 0 });
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			attempts: 0,
			error: { code: "R2_INGEST_COMMIT_QUEUED" },
			status: "pending",
		});
		const dueAt = new Date(committedAt.getTime() + 60_000);
		expect(await hasDueLargeR2IngestWork(sqlClient, committedAt)).toBe(false);
		expect(await hasDueLargeR2IngestWork(sqlClient, dueAt)).toBe(true);

		await expect(
			repairRecoverableR2IngestJobs({
				database: sqlClient,
				gate: standardGate,
				now: () => dueAt,
				process: async () => {
					throw new Error("a standard process claimed a large job");
				},
				r2: fakeR2,
			}),
		).resolves.toMatchObject({ attempted: 0, completed: 0 });

		let processedBytes = 0;
		await expect(
			repairRecoverableR2IngestJobs({
				database: sqlClient,
				gate: residentGate,
				now: () => dueAt,
				process: async (input) => {
					processedBytes = byteLength(input.content);
					return processorResult(input.sessionId);
				},
				r2: fakeR2,
			}),
		).resolves.toMatchObject({ attempted: 1, completed: 1 });
		expect(processedBytes).toBe(128 * 1024 * 1024 + 1);
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			attempts: 1,
			error: null,
			status: "completed",
		});
		expect(await hasDueLargeR2IngestWork(sqlClient, dueAt)).toBe(false);
	}, 120_000);

	test("the minute cron materializes a commit that timed out while queued", async () => {
		const jobId = crypto.randomUUID();
		const initialized = await initializeUploadedJob(
			jobId,
			buildRealClaudeTranscript(`queued-cron-${jobId}`),
		);
		let releaseBlocker: (() => void) | undefined;
		const blocker = new Promise<void>((resolve) => {
			releaseBlocker = resolve;
		});
		const gate = createR2IngestMaterializationGate({
			maxBytes: 128 * 1024 * 1024,
			maxJobs: 1,
			maxQueuedJobs: 1,
			operationTimeoutMs: 1_000,
			queueTimeoutMs: 10,
		});
		const active = gate.run(1, async () => blocker);
		try {
			await expect(
				commitR2IngestJob({
					gate,
					input: buildCompletionInput(initialized),
					process: createRealProcessor(undefined),
					r2: fakeR2,
					userId: USER_ID,
				}),
			).rejects.toBeInstanceOf(R2IngestCommitQueuedError);
		} finally {
			releaseBlocker?.();
			await active;
		}
		await sqlClient`
			UPDATE ingest_job SET available_at = NOW() - INTERVAL '1 second'
			WHERE id = ${jobId}
		`;

		const fakeR2Endpoint = createFakeR2S3Endpoint();
		const environment = {
			CRON_SECRET: "r2-ingest-queued-cron-secret",
			R2_ACCESS_KEY_ID: "test-access-key",
			R2_ACCOUNT_ID: "test-account",
			R2_ENDPOINT: fakeR2Endpoint.url.origin,
			R2_SECRET_ACCESS_KEY: "test-secret-key",
			SKILL_EXTRACTION_ENABLED: "false",
			TRANSCRIPT_RECORDS_EXTRACTION_ENABLED: "false",
			USAGE_EVENT_EXTRACTION_ENABLED: "false",
		};
		const previousEnvironment = new Map(
			Object.keys(environment).map((name) => [name, process.env[name]]),
		);
		const cron = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: handleR2IngestMaintenanceRequest,
		});
		try {
			for (const [name, value] of Object.entries(environment))
				process.env[name] = value;
			const recovered = await fetch(cron.url, {
				headers: { Authorization: `Bearer ${environment.CRON_SECRET}` },
			});
			expect(recovered.status).toBe(200);
			expect(await recovered.json()).toMatchObject({ enabled: true });
			expect(await getR2IngestJobStatus(jobId, USER_ID)).toMatchObject({
				attempts: 1,
				error: null,
				result: { sessionId: jobId, success: true },
				status: "completed",
			});
		} finally {
			for (const [name, value] of previousEnvironment)
				restoreEnvironmentVariable(name, value);
			await cron.stop(true);
			await fakeR2Endpoint.stop(true);
		}
	}, 60_000);

	test("an R2 upload naming an analysis goes to its workspace and echoes the link on commit and status", async () => {
		const analysisWorkspaceId = `r2-analysis-workspace-${crypto.randomUUID()}`;
		const analysisId = `a_r2_${crypto.randomUUID().slice(0, 8)}`;
		const log = {
			store: createMemoryAnalysisStore(),
			embedder: createLocalEmbedder(),
			now: () => new Date(),
		};
		const createdAt = new Date().toISOString();
		await log.store.createAnalysis({
			id: analysisId,
			workspaceId: analysisWorkspaceId,
			authorId: USER_ID,
			host: "plugin",
			question: "Which runs failed?",
			status: "finished",
			draft: false,
			shared: false,
			pinned: false,
			createdAt,
			cutoff: createdAt,
			scope: { from: null, to: null, filters: {} },
			finalAnswer: "None.",
			topics: [],
			updates: null,
			changes: [],
			notes: [],
			cost: null,
			queryCount: 0,
			stepCount: 0,
			visibilityRevision: 0,
		});
		await sqlClient`
			INSERT INTO organization (id, name, slug)
			VALUES (${analysisWorkspaceId}, 'R2 analysis workspace', ${analysisWorkspaceId})
		`;
		await sqlClient`
			INSERT INTO member (id, organization_id, user_id, role)
			VALUES (${crypto.randomUUID()}, ${analysisWorkspaceId}, ${USER_ID}, 'member')
		`;
		const fakeR2Endpoint = createFakeR2S3Endpoint();
		const environment = {
			ANALYSIS_LOG_WORKSPACES: analysisWorkspaceId,
			R2_ACCESS_KEY_ID: "test-access-key",
			R2_ACCOUNT_ID: "test-account",
			R2_ENDPOINT: fakeR2Endpoint.url.origin,
			R2_SECRET_ACCESS_KEY: "test-secret-key",
			SKILL_EXTRACTION_ENABLED: "false",
			TRANSCRIPT_RECORDS_EXTRACTION_ENABLED: "false",
			USAGE_EVENT_EXTRACTION_ENABLED: "false",
		};
		const previousEnvironment = new Map(
			Object.keys(environment).map((name) => [name, process.env[name]]),
		);
		for (const [name, value] of Object.entries(environment))
			process.env[name] = value;
		setAnalysisLogForTests(log);
		try {
			const client = createRouterClient(router, {
				context: {
					user: {
						id: USER_ID,
						name: "R2 Ingest Test",
						email: `${USER_ID}@example.com`,
						emailVerified: false,
						createdAt: new Date(),
						updatedAt: new Date(),
					},
					session: null,
					apiKeyId: "r2-analysis-test-key",
					authFailure: null,
					ingestOperatorAuthorized: false,
					requestId: crypto.randomUUID(),
					publicLookupSource: "test",
				},
			});
			const sessionId = `r2-analysis-chat-${crypto.randomUUID()}`;
			const content = buildRealClaudeTranscript(`r2-analysis-${sessionId}`);
			const initialized = await client.ingest.init({
				analysisId,
				objects: [
					{
						byteLength: byteLength(content),
						kind: "main",
						sha256: sha256(content),
					},
				],
				// The CLI's default workspace; the analysis's workspace wins.
				organizationId: ORGANIZATION_ID,
				projectPath: "/test/r2-analysis",
				sessionId,
				source: "claude_code",
				upload_mode: "manual",
			});
			const [job] = await sqlClient<Array<{ organizationId: string }>>`
				SELECT organization_id AS "organizationId" FROM ingest_job
				WHERE id = ${initialized.jobId}
			`;
			expect(job?.organizationId).toBe(analysisWorkspaceId);
			const objectKey = initialized.objects[0]?.objectKey;
			assert(objectKey);
			fakeR2.uploadText(objectKey, content);

			const committed = await client.ingest.commit(
				buildCompletionInput(initialized),
			);
			expect(committed).toMatchObject({
				result: { analysisId, sessionId, success: true },
				status: "completed",
			});
			expect(
				await client.ingest.status({ jobId: initialized.jobId }),
			).toMatchObject({
				result: { analysisId, sessionId },
				status: "completed",
			});
			expect(await log.store.getSessionLinks(analysisId)).toEqual([
				{
					analysisId,
					sessionId,
					source: "claude_code",
					ownerId: USER_ID,
					uploadedAt: expect.any(String),
				},
			]);

			await expect(
				client.ingest.init({
					analysisId: "a_unknown",
					objects: [
						{
							byteLength: byteLength(content),
							kind: "main",
							sha256: sha256(content),
						},
					],
					projectPath: "/test/r2-analysis",
					sessionId: `${sessionId}-refused`,
					source: "claude_code",
				}),
			).rejects.toMatchObject({ status: 404 });
		} finally {
			setAnalysisLogForTests(undefined);
			for (const [name, value] of previousEnvironment)
				restoreEnvironmentVariable(name, value);
			await fakeR2Endpoint.stop(true);
			await getClickhouse().execute({
				query: `DELETE FROM ${getSafeClickHouseTable("rudel.claude_sessions")} WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
				query_params: { organizationId: analysisWorkspaceId },
			});
			await sqlClient`DELETE FROM organization WHERE id = ${analysisWorkspaceId}`;
		}
	}, 60_000);

	test("quiescence blocks ingest-state PostgreSQL writes and R2 access after authentication while allowing operator commit", async () => {
		const operatorToken = `operator-${crypto.randomUUID()}`;
		const fakeR2Endpoint = createFakeR2S3Endpoint();
		const server = await startApiTestServer({
			R2_ACCESS_KEY_ID: "test-access-key",
			R2_ACCOUNT_ID: "test-account",
			R2_ENDPOINT: fakeR2Endpoint.url.origin,
			R2_SECRET_ACCESS_KEY: "test-secret-key",
			SESSION_INGEST_OPERATOR_TOKEN: operatorToken,
			SESSION_INGEST_QUIESCED: "true",
			SKILL_EXTRACTION_ENABLED: "false",
			TRANSCRIPT_RECORDS_EXTRACTION_ENABLED: "false",
			USAGE_EVENT_EXTRACTION_ENABLED: "false",
		});
		let identity: QuiescedTestIdentity | undefined;
		let commitJob: R2IngestInitOutput | undefined;
		let rescueJob: R2IngestInitOutput | undefined;
		let repairJob: R2IngestInitOutput | undefined;
		let terminalJob: R2IngestInitOutput | undefined;
		let resumedServer: ApiTestServer | undefined;
		try {
			identity = await createQuiescedTestIdentity(server.baseUrl);
			const operatorSkillName = `quiesced-operator-${crypto.randomUUID()}`;
			commitJob = await initializeUploadedJobForIdentity(
				crypto.randomUUID(),
				buildRealClaudeTranscript(operatorSkillName),
				identity,
			);
			const commitObjectsBefore = snapshotFakeR2Objects(commitJob);
			const commitEffectsBefore = snapshotFakeR2Effects();
			const commitRowBefore = await readIngestJobRowSnapshot(commitJob.jobId);
			const apiKeyBefore = await readApiKeySnapshot(identity.apiKeyId);
			expect(commitRowBefore).toMatchObject({
				attempts: 0,
				leaseExpiresAt: null,
				leaseToken: null,
				status: "pending",
			});

			const response = await fetch(`${server.baseUrl}/rpc/ingest/commit`, {
				body: JSON.stringify({ json: buildCompletionInput(commitJob) }),
				headers: {
					"Content-Type": "application/json",
					"x-api-key": identity.apiKey,
				},
				method: "POST",
			});

			expect(response.status).toBe(503);
			expect(await readRpcErrorShape(response)).toEqual({
				code: "SERVICE_UNAVAILABLE",
				message:
					"Session uploads are temporarily paused for an analytics rebuild. Retry shortly.",
				reason: "session_ingest_quiesced",
			});
			expect(await readIngestJobRowSnapshot(commitJob.jobId)).toEqual(
				commitRowBefore,
			);
			expect(snapshotFakeR2Objects(commitJob)).toEqual(commitObjectsBefore);
			expect(snapshotFakeR2Effects()).toEqual(commitEffectsBefore);
			// Better Auth records last_request/updated_at while authenticating the API
			// key. Every other API-key field must remain unchanged after rejection.
			expect(await readApiKeySnapshot(identity.apiKeyId)).toBe(apiKeyBefore);

			const operatorResponse = await fetch(
				`${server.baseUrl}/rpc/ingest/commit`,
				{
					body: JSON.stringify({ json: buildCompletionInput(commitJob) }),
					headers: {
						"Content-Type": "application/json",
						"x-api-key": identity.apiKey,
						"x-rudel-session-ingest-operator-token": operatorToken,
					},
					method: "POST",
				},
			);
			expect(operatorResponse.status).toBe(200);
			expect(await operatorResponse.json()).toMatchObject({
				json: {
					jobId: commitJob.jobId,
					result: { sessionId: commitJob.jobId, success: true },
					status: "completed",
				},
			});
			expect(await countQuiescedCanonicalRaw(identity, commitJob.jobId)).toBe(
				1,
			);
			expect(
				await getR2IngestJobStatus(commitJob.jobId, identity.userId),
			).toMatchObject({ attempts: 1, status: "completed" });

			const rescueSkillName = `post-barrier-rescue-${crypto.randomUUID()}`;
			rescueJob = await initializeUploadedJobForIdentity(
				crypto.randomUUID(),
				buildRealClaudeTranscript(rescueSkillName),
				identity,
			);
			await interruptFinalIngestClaim(
				rescueJob,
				new Date("2026-08-25T10:00:00.000Z"),
				identity.userId,
			);
			const rescueRowBefore = await readIngestJobRowSnapshot(rescueJob.jobId);
			const rescueObjectsBefore = snapshotFakeR2Objects(rescueJob);
			const rescueEffectsBefore = snapshotFakeR2Effects();
			expect(rescueRowBefore).toMatchObject({
				lastErrorCode: null,
				status: "running",
			});

			const refusedRescueResponse = await fetch(
				`${server.baseUrl}/rpc/ingest/commit`,
				{
					body: JSON.stringify({ json: buildCompletionInput(rescueJob) }),
					headers: {
						"Content-Type": "application/json",
						"x-api-key": identity.apiKey,
						"x-rudel-session-ingest-operator-token": operatorToken,
					},
					method: "POST",
				},
			);
			expect(refusedRescueResponse.status).toBe(503);
			expect(await readRpcErrorShape(refusedRescueResponse)).toEqual({
				code: "SERVICE_UNAVAILABLE",
				message:
					"Interrupted final-claim rescue is paused while session ingest is quiesced. Lift the barrier, then retry this commit.",
				reason: "R2_INGEST_INTERRUPTED_FINAL_CLAIM_RESCUE_QUIESCED",
			});
			expect(await readIngestJobRowSnapshot(rescueJob.jobId)).toEqual(
				rescueRowBefore,
			);
			expect(snapshotFakeR2Objects(rescueJob)).toEqual(rescueObjectsBefore);
			expect(snapshotFakeR2Effects()).toEqual(rescueEffectsBefore);

			resumedServer = await startApiTestServer({
				R2_ACCESS_KEY_ID: "test-access-key",
				R2_ACCOUNT_ID: "test-account",
				R2_ENDPOINT: fakeR2Endpoint.url.origin,
				R2_SECRET_ACCESS_KEY: "test-secret-key",
				SESSION_INGEST_OPERATOR_TOKEN: operatorToken,
				SESSION_INGEST_QUIESCED: "false",
				SKILL_EXTRACTION_ENABLED: "false",
				TRANSCRIPT_RECORDS_EXTRACTION_ENABLED: "false",
				USAGE_EVENT_EXTRACTION_ENABLED: "false",
			});
			const rescuedResponse = await fetch(
				`${resumedServer.baseUrl}/rpc/ingest/commit`,
				{
					body: JSON.stringify({ json: buildCompletionInput(rescueJob) }),
					headers: {
						"Content-Type": "application/json",
						"x-api-key": identity.apiKey,
						"x-rudel-session-ingest-operator-token": operatorToken,
					},
					method: "POST",
				},
			);
			expect(rescuedResponse.status).toBe(200);
			expect(await rescuedResponse.json()).toMatchObject({
				json: {
					jobId: rescueJob.jobId,
					result: { sessionId: rescueJob.jobId, success: true },
					status: "completed",
				},
			});
			expect(await countQuiescedCanonicalRaw(identity, rescueJob.jobId)).toBe(
				1,
			);
			expect(
				await getR2IngestJobStatus(rescueJob.jobId, identity.userId),
			).toMatchObject({
				attempts: rescueRowBefore.maxAttempts,
				error: null,
				status: "completed",
			});

			repairJob = await initializeUploadedJobForIdentity(
				crypto.randomUUID(),
				"quiesced repair transcript bytes",
				identity,
			);
			terminalJob = await initializeUploadedJobForIdentity(
				crypto.randomUUID(),
				"quiesced terminal cleanup bytes",
				identity,
			);
			await sqlClient`
				UPDATE ingest_job
				SET
					attempts = CASE WHEN id = ${repairJob.jobId} THEN 1 ELSE max_attempts END,
					available_at = clock_timestamp() - interval '1 minute',
					expires_at = clock_timestamp() + interval '2 days'
				WHERE id IN (${repairJob.jobId}, ${terminalJob.jobId})
			`;
			const repairRowsBefore = await Promise.all([
				readIngestJobRowSnapshot(repairJob.jobId),
				readIngestJobRowSnapshot(terminalJob.jobId),
			]);
			expect(repairRowsBefore[0]).toMatchObject({
				attempts: 1,
				leaseExpiresAt: null,
				leaseToken: null,
				status: "pending",
			});
			expect(repairRowsBefore[1]).toMatchObject({
				leaseExpiresAt: null,
				leaseToken: null,
				status: "pending",
			});
			expect(repairRowsBefore[1]?.attempts).toBeGreaterThan(1);
			const repairObjectsBefore = [
				...snapshotFakeR2Objects(repairJob),
				...snapshotFakeR2Objects(terminalJob),
			];
			const repairEffectsBefore = snapshotFakeR2Effects();
			const previousQuiescence = process.env.SESSION_INGEST_QUIESCED;
			process.env.SESSION_INGEST_QUIESCED = "true";
			try {
				await expect(runR2IngestRepairPass(fakeR2)).resolves.toEqual({
					attempted: 0,
					completed: 0,
					hasMore: false,
					nextDueAt: null,
				});
			} finally {
				restoreEnvironmentVariable(
					"SESSION_INGEST_QUIESCED",
					previousQuiescence,
				);
			}
			expect(
				await Promise.all([
					readIngestJobRowSnapshot(repairJob.jobId),
					readIngestJobRowSnapshot(terminalJob.jobId),
				]),
			).toEqual(repairRowsBefore);
			expect([
				...snapshotFakeR2Objects(repairJob),
				...snapshotFakeR2Objects(terminalJob),
			]).toEqual(repairObjectsBefore);
			expect(snapshotFakeR2Effects()).toEqual(repairEffectsBefore);
		} finally {
			await server.stop();
			if (resumedServer) await resumedServer.stop();
			await fakeR2Endpoint.stop(true);
			const jobIds = [
				commitJob?.jobId,
				rescueJob?.jobId,
				repairJob?.jobId,
				terminalJob?.jobId,
			].filter((jobId): jobId is string => jobId !== undefined);
			for (const jobId of jobIds) {
				await sqlClient`DELETE FROM ingest_job WHERE id = ${jobId}`;
			}
			for (const initialized of [
				commitJob,
				rescueJob,
				repairJob,
				terminalJob,
			]) {
				for (const object of initialized?.objects ?? []) {
					fakeR2.objects.delete(object.objectKey);
				}
			}
			if (identity) {
				await deleteQuiescedClickHouseRows(identity.organizationId);
				await sqlClient`DELETE FROM organization WHERE id = ${identity.organizationId}`;
				await sqlClient`DELETE FROM "user" WHERE id = ${identity.userId}`;
			}
		}
	}, 60_000);

	test("recovers one interrupted final claim and bounds a failed rescue", async () => {
		const leaseStartedAt = new Date("2030-01-01T00:00:00.000Z");
		const recoveryAt = new Date("2030-01-01T00:00:02.000Z");
		const recoveredJob = await initializeUploadedJob(
			crypto.randomUUID(),
			"interrupted final claim transcript",
		);
		const recoveredObjectKey = recoveredJob.objects[0]?.objectKey;
		if (!recoveredObjectKey)
			throw new Error("missing interrupted claim object");
		await interruptFinalIngestClaim(recoveredJob, leaseStartedAt, USER_ID);
		const [interrupted] = await sqlClient<
			Array<{
				attempts: number;
				lastErrorCode: string | null;
				maxAttempts: number;
				status: string;
			}>
		>`
			SELECT
				attempts,
				last_error_code AS "lastErrorCode",
				max_attempts AS "maxAttempts",
				status
			FROM ingest_job
			WHERE id = ${recoveredJob.jobId}
		`;
		expect(interrupted).toMatchObject({
			lastErrorCode: null,
			status: "running",
		});
		if (!interrupted) throw new Error("interrupted final claim disappeared");
		expect(interrupted?.attempts).toBe(interrupted?.maxAttempts);

		const previousQuiescence = process.env.SESSION_INGEST_QUIESCED;
		process.env.SESSION_INGEST_QUIESCED = "true";
		try {
			await expect(runR2IngestRepairPass(fakeR2)).resolves.toEqual({
				attempted: 0,
				completed: 0,
				hasMore: false,
				nextDueAt: null,
			});
		} finally {
			restoreEnvironmentVariable("SESSION_INGEST_QUIESCED", previousQuiescence);
		}
		expect(fakeR2.objects.has(recoveredObjectKey)).toBe(true);
		const quiescedRepairRowBefore = await readIngestJobRowSnapshot(
			recoveredJob.jobId,
		);
		const quiescedRepairObjectsBefore = snapshotFakeR2Objects(recoveredJob);
		const quiescedRepairEffectsBefore = snapshotFakeR2Effects();
		let quiescedRepairProcessCalls = 0;
		await expect(
			repairRecoverableR2IngestJobs({
				database: sqlClient,
				leaseDurationMs: 1_000,
				now: () => recoveryAt,
				process: async (input) => {
					quiescedRepairProcessCalls += 1;
					return processorResult(input.sessionId);
				},
				r2: fakeR2,
				sessionIngestQuiesced: true,
			}),
		).resolves.toMatchObject({ attempted: 1, completed: 0 });
		expect(quiescedRepairProcessCalls).toBe(0);
		expect(await readIngestJobRowSnapshot(recoveredJob.jobId)).toEqual(
			quiescedRepairRowBefore,
		);
		expect(snapshotFakeR2Objects(recoveredJob)).toEqual(
			quiescedRepairObjectsBefore,
		);
		expect(snapshotFakeR2Effects()).toEqual(quiescedRepairEffectsBefore);

		let recoveryProcessCalls = 0;
		const recovered = await repairRecoverableR2IngestJobs({
			database: sqlClient,
			leaseDurationMs: 1_000,
			now: () => recoveryAt,
			process: async (input) => {
				recoveryProcessCalls += 1;
				const [running] = await sqlClient<
					Array<{ attempts: number; lastErrorCode: string | null }>
				>`
					SELECT
						attempts,
						last_error_code AS "lastErrorCode"
					FROM ingest_job
					WHERE id = ${recoveredJob.jobId}
				`;
				expect(running).toEqual({
					attempts: interrupted.maxAttempts,
					lastErrorCode: "R2_INGEST_INTERRUPTED_FINAL_CLAIM_RESCUE",
				});
				expect(fakeR2.objects.has(recoveredObjectKey)).toBe(true);
				return processorResult(input.sessionId);
			},
			r2: fakeR2,
		});
		expect(recovered).toMatchObject({ attempted: 1, completed: 1 });
		expect(recoveryProcessCalls).toBe(1);
		expect(
			await getR2IngestJobStatus(recoveredJob.jobId, USER_ID),
		).toMatchObject({
			attempts: interrupted.maxAttempts,
			error: null,
			status: "completed",
		});

		const boundedJob = await initializeUploadedJob(
			crypto.randomUUID(),
			"bounded interrupted final claim transcript",
		);
		const boundedObjectKey = boundedJob.objects[0]?.objectKey;
		if (!boundedObjectKey) throw new Error("missing bounded rescue object");
		await interruptFinalIngestClaim(boundedJob, leaseStartedAt, USER_ID);
		const processingFailure = new Error("simulated rescue processing failure");
		const bounded = await repairRecoverableR2IngestJobs({
			database: sqlClient,
			leaseDurationMs: 1_000,
			now: () => recoveryAt,
			process: async () => {
				throw processingFailure;
			},
			r2: fakeR2,
		});
		expect(bounded).toMatchObject({ attempted: 1, completed: 0 });
		expect(await getR2IngestJobStatus(boundedJob.jobId, USER_ID)).toMatchObject(
			{
				error: { code: "R2_INGEST_TRANSIENT_FAILURE" },
				status: "failed",
			},
		);
		expect(fakeR2.objects.has(boundedObjectKey)).toBe(true);
	});

	test("extends pending expiry by the actual barrier duration before resume", async () => {
		const barrierStartedAt = new Date("2030-01-01T00:00:00.000Z");
		const originalExpiry = new Date("2030-01-01T00:00:01.000Z");
		const resumedAt = new Date("2030-01-01T00:10:00.000Z");
		const unextendedJob = await initializeUploadedJob(
			crypto.randomUUID(),
			"unextended barrier expiry transcript",
		);
		const unextendedObjectKey = unextendedJob.objects[0]?.objectKey;
		if (!unextendedObjectKey)
			throw new Error("missing unextended expiry object");
		await sqlClient`
			UPDATE ingest_job
			SET expires_at = ${originalExpiry.toISOString()}
			WHERE id = ${unextendedJob.jobId}
		`;
		await sweepExpiredR2IngestJobs({
			database: sqlClient,
			now: resumedAt,
			r2: fakeR2,
		});
		expect(
			await getR2IngestJobStatus(unextendedJob.jobId, USER_ID),
		).toMatchObject({
			error: { code: "R2_INGEST_JOB_EXPIRED" },
			status: "failed",
		});
		expect(fakeR2.objects.has(unextendedObjectKey)).toBe(false);

		const extendedJob = await initializeUploadedJob(
			crypto.randomUUID(),
			"extended barrier expiry transcript",
		);
		const extendedObjectKey = extendedJob.objects[0]?.objectKey;
		if (!extendedObjectKey) throw new Error("missing extended expiry object");
		await sqlClient`
			UPDATE ingest_job
			SET expires_at = ${originalExpiry.toISOString()}
			WHERE id = ${extendedJob.jobId}
		`;
		const extendedCount = await extendNonterminalR2IngestJobExpiries(
			barrierStartedAt,
			resumedAt,
			sqlClient,
		);
		expect(extendedCount).toBe(1);
		const [extendedExpiry] = await sqlClient<Array<{ expiresAt: string }>>`
			SELECT expires_at::text AS "expiresAt"
			FROM ingest_job
			WHERE id = ${extendedJob.jobId}
		`;
		expect(new Date(extendedExpiry?.expiresAt ?? "").toISOString()).toBe(
			"2030-01-01T00:10:01.000Z",
		);

		await sweepExpiredR2IngestJobs({
			database: sqlClient,
			now: resumedAt,
			r2: fakeR2,
		});
		expect(fakeR2.objects.has(extendedObjectKey)).toBe(true);
		expect(
			await getR2IngestJobStatus(extendedJob.jobId, USER_ID),
		).toMatchObject({ attempts: 0, status: "pending" });
		const completed = await commitR2IngestJob({
			input: buildCompletionInput(extendedJob),
			leaseDurationMs: 500,
			now: () => resumedAt,
			process: async (input) => processorResult(input.sessionId),
			r2: fakeR2,
			userId: USER_ID,
		});
		expect(completed.status).toBe("completed");
	});

	test("aborts every upload created during partial initialization failure", async () => {
		const mainPresigned = Promise.withResolvers<void>();
		const abortedUploads: string[] = [];
		const partialFailureClient: R2MultipartUploadInitClient = {
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

	test("leaves objects intact through repeated proxy 503s and worker recovery", async () => {
		const initialized = await initializeUploadedJob(
			"00000000-0000-4000-8000-000000000012",
			"retry transcript",
		);
		const completion = buildCompletionInput(initialized);
		let attemptAt = new Date("2030-01-01T00:00:00.000Z");
		const proxy = Bun.serve({
			fetch: () => new Response("upstream unavailable", { status: 503 }),
			hostname: "127.0.0.1",
			port: 0,
		});
		const proxyClickHouse = createClickHouseExecutor({
			url: proxy.url.toString(),
		});
		try {
			for (let failure = 0; failure < 12; failure += 1) {
				await expect(
					commitR2IngestJob({
						input: completion,
						now: () => attemptAt,
						process: async () => {
							await proxyClickHouse.execute({ query: "SELECT 1" });
							return processorResult("unexpected-proxy-success");
						},
						r2: fakeR2,
						userId: USER_ID,
					}),
				).rejects.toMatchObject({ status: 503 });
				const status = await getR2IngestJobStatus(initialized.jobId, USER_ID);
				expect(status).toMatchObject({
					attempts: 0,
					error: { code: "R2_INGEST_DEPENDENCY_UNAVAILABLE" },
					status: "pending",
				});
				if (!status) throw new Error("missing retrying job");
				const delayMs = Date.parse(status.availableAt) - attemptAt.getTime();
				expect(delayMs).toBeGreaterThanOrEqual(1_000);
				expect(delayMs).toBeLessThanOrEqual(300_000);
				expect(await getNextR2IngestWorkDueAt(sqlClient)).toEqual(
					new Date(status.availableAt),
				);
				await expect(
					commitR2IngestJob({
						input: completion,
						now: () => attemptAt,
						process: async (input) => processorResult(input.sessionId),
						r2: fakeR2,
						userId: USER_ID,
					}),
				).rejects.toMatchObject({
					code: "R2_INGEST_JOB_RETRY_LATER",
					retryable: true,
				});
				attemptAt = new Date(Date.parse(status.availableAt) + 3_600_000);
			}
		} finally {
			await proxyClickHouse.close();
			await proxy.stop(true);
		}
		expect(
			initialized.objects.every((object) =>
				fakeR2.objects.has(object.objectKey),
			),
		).toBe(true);

		const retried = await repairRecoverableR2IngestJobs({
			database: sqlClient,
			now: () => attemptAt,
			process: async (input) => processorResult(input.sessionId),
			r2: fakeR2,
		});
		expect(retried).toMatchObject({ attempted: 1, completed: 1 });
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({ status: "completed" });
	});

	test("retries through the final lease window and terminalizes exactly at TTL", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"TTL outage transcript",
		);
		const expiresAt = new Date("2030-01-01T01:00:00.000Z");
		await sqlClient`UPDATE ingest_job SET expires_at = ${expiresAt.toISOString()} WHERE id = ${initialized.jobId}`;
		const outage = Object.assign(new Error("no available server"), {
			status: 503,
		});
		let attemptAt = new Date("2030-01-01T00:00:00.000Z");
		while (attemptAt < expiresAt) {
			await expect(
				commitR2IngestJob({
					input: buildCompletionInput(initialized),
					now: () => attemptAt,
					process: async () => {
						throw outage;
					},
					r2: fakeR2,
					userId: USER_ID,
				}),
			).rejects.toBe(outage);
			const status = await getR2IngestJobStatus(initialized.jobId, USER_ID);
			expect(status).toMatchObject({ attempts: 0, status: "pending" });
			if (!status) throw new Error("missing retrying job");
			expect(Date.parse(status.availableAt)).toBeLessThanOrEqual(
				expiresAt.getTime(),
			);
			attemptAt = new Date(attemptAt.getTime() + 10 * 60_000);
		}
		await sweepExpiredR2IngestJobs({
			database: sqlClient,
			now: expiresAt,
			r2: fakeR2,
		});
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			error: { code: "R2_INGEST_JOB_EXPIRED" },
			status: "failed",
		});
		expect(fakeR2.deletedKeys).toHaveLength(1);
	});

	test("cleanup refuses a retryable job even when passed directly or from a stale terminal candidate", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"retryable cleanup transcript",
		);
		const [job] = await sqlClient<
			Array<{ id: string; objectManifest: unknown; objectsDeletedAt: null }>
		>`
			SELECT id, object_manifest AS "objectManifest", objects_deleted_at AS "objectsDeletedAt"
			FROM ingest_job WHERE id = ${initialized.jobId}
		`;
		if (!job) throw new Error("missing cleanup candidate");
		expect(
			await cleanupIngestJobObjects(job, sqlClient, fakeR2, undefined),
		).toBe(false);
		await repairR2IngestCleanupJobs({ database: sqlClient, r2: fakeR2 });
		expect(fakeR2.deletedKeys).toEqual([]);
		expect(fakeR2.abortedKeys).toEqual([]);
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({ status: "pending" });
	});

	test("a transient failure during processing at TTL stores the expiry code", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"in-flight TTL transcript",
		);
		const expiresAt = new Date("2030-01-01T00:01:00.000Z");
		let now = new Date("2030-01-01T00:00:00.000Z");
		await sqlClient`UPDATE ingest_job SET expires_at = ${expiresAt.toISOString()} WHERE id = ${initialized.jobId}`;
		await expect(
			commitR2IngestJob({
				input: buildCompletionInput(initialized),
				now: () => now,
				process: async () => {
					now = expiresAt;
					throw Object.assign(new Error("ClickHouse unavailable"), {
						status: 503,
					});
				},
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toMatchObject({ status: 503 });
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			status: "failed",
			error: { code: "R2_INGEST_JOB_EXPIRED" },
		});
		expect(fakeR2.deletedKeys).toHaveLength(1);
	});

	test("cleanup keeps unexpired transient failures and repairs only expired ones", async () => {
		const retainedKeys: string[] = [];
		const now = new Date();
		for (const code of [
			"R2_INGEST_DEPENDENCY_UNAVAILABLE",
			"R2_INGEST_SERVICE_UNAVAILABLE",
			"R2_INGEST_GATEWAY_TIMEOUT",
			"R2_INGEST_TRANSIENT_FAILURE",
		]) {
			for (const expired of [false, true]) {
				const initialized = await initializeUploadedJob(
					crypto.randomUUID(),
					"transient cleanup transcript",
				);
				await sqlClient`
					UPDATE ingest_job SET status = 'failed', last_error_code = ${code},
						last_error_message = 'Transient dependency failure',
						failed_at = ${now.toISOString()}, updated_at = ${now.toISOString()},
						expires_at = ${expired ? "2000-01-01T00:00:00.000Z" : "2031-01-01T00:00:00.000Z"}
					WHERE id = ${initialized.jobId}
				`;
				if (!expired) {
					retainedKeys.push(
						...initialized.objects.map((object) => object.objectKey),
					);
					const [candidate] = await sqlClient<
						Array<{
							id: string;
							objectManifest: unknown;
							objectsDeletedAt: null;
						}>
					>`
						SELECT id, object_manifest AS "objectManifest", objects_deleted_at AS "objectsDeletedAt"
						FROM ingest_job WHERE id = ${initialized.jobId}
					`;
					if (!candidate)
						throw new Error("missing transient cleanup candidate");
					expect(
						await cleanupIngestJobObjects(
							candidate,
							sqlClient,
							fakeR2,
							undefined,
						),
					).toBe(false);
				}
			}
		}
		expect(
			await repairR2IngestCleanupJobs({ database: sqlClient, r2: fakeR2 }),
		).toMatchObject({
			attempted: 4,
			completed: 4,
		});
		expect(fakeR2.deletedKeys).toHaveLength(4);
		expect(
			retainedKeys.every(
				(key) => !fakeR2.deletedKeys.includes(key) && fakeR2.objects.has(key),
			),
		).toBe(true);
	});

	test("a commit reports retry-later, status stays pending, and the minute cron completes after recovery", async () => {
		const clickhouseUrl = process.env.CLICKHOUSE_URL;
		if (!clickhouseUrl) throw new Error("CLICKHOUSE_URL is required");
		let unavailable = false;
		const proxy = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: async (request) => {
				if (unavailable)
					return new Response("no available server", { status: 503 });
				const url = new URL(request.url);
				return fetch(
					new Request(`${clickhouseUrl}${url.pathname}${url.search}`, request),
				);
			},
		});
		const fakeR2Endpoint = createFakeR2S3Endpoint();
		const r2Environment = {
			R2_ACCESS_KEY_ID: "test-access-key",
			R2_ACCOUNT_ID: "test-account",
			R2_ENDPOINT: fakeR2Endpoint.url.origin,
			R2_SECRET_ACCESS_KEY: "test-secret-key",
		};
		const server = await startApiTestServer({
			...r2Environment,
			CLICKHOUSE_URL: proxy.url.origin,
			SKILL_EXTRACTION_ENABLED: "false",
			TRANSCRIPT_RECORDS_EXTRACTION_ENABLED: "false",
			USAGE_EVENT_EXTRACTION_ENABLED: "false",
		});
		let identity: QuiescedTestIdentity | undefined;
		const environment = {
			...r2Environment,
			CRON_SECRET: "r2-ingest-test-cron-secret",
		};
		const previousEnvironment = new Map(
			Object.keys(environment).map((name) => [name, process.env[name]]),
		);
		const cron = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: handleR2IngestMaintenanceRequest,
		});
		try {
			identity = await createQuiescedTestIdentity(server.baseUrl);
			const jobId = crypto.randomUUID();
			const initialized = await initializeUploadedJobForIdentity(
				jobId,
				buildRealClaudeTranscript(jobId),
				identity,
			);
			unavailable = true;
			const headers = {
				"Content-Type": "application/json",
				"x-api-key": identity.apiKey,
			};
			const commit = await fetch(`${server.baseUrl}/rpc/ingest/commit`, {
				body: JSON.stringify({ json: buildCompletionInput(initialized) }),
				headers,
				method: "POST",
			});
			expect(commit.status).toBe(503);
			expect(await readRpcErrorShape(commit)).toMatchObject({
				code: "SERVICE_UNAVAILABLE",
				reason: "R2_INGEST_JOB_RETRY_LATER",
			});
			const status = await fetch(`${server.baseUrl}/rpc/ingest/status`, {
				body: JSON.stringify({ json: { jobId } }),
				headers,
				method: "POST",
			});
			expect(status.status).toBe(200);
			expect(await status.json()).toMatchObject({
				json: { attempts: 0, status: "pending" },
			});
			unavailable = false;
			await sqlClient`UPDATE ingest_job SET available_at = NOW() WHERE id = ${jobId}`;
			for (const [name, value] of Object.entries(environment))
				process.env[name] = value;
			const unauthorized = await fetch(cron.url);
			expect(unauthorized.status).toBe(401);
			const recovered = await fetch(cron.url, {
				headers: { Authorization: `Bearer ${environment.CRON_SECRET}` },
			});
			expect(recovered.status).toBe(200);
			expect(await recovered.json()).toMatchObject({
				enabled: true,
				completed: 1,
			});
			expect(await getR2IngestJobStatus(jobId, identity.userId)).toMatchObject({
				status: "completed",
			});
			expect(await countQuiescedCanonicalRaw(identity, jobId)).toBe(1);
		} finally {
			for (const [name, value] of previousEnvironment)
				restoreEnvironmentVariable(name, value);
			await server.stop();
			await cron.stop(true);
			await proxy.stop(true);
			await fakeR2Endpoint.stop(true);
			if (identity) {
				await deleteQuiescedClickHouseRows(identity.organizationId);
				await sqlClient`DELETE FROM organization WHERE id = ${identity.organizationId}`;
				await sqlClient`DELETE FROM "user" WHERE id = ${identity.userId}`;
			}
		}
	}, 60_000);

	test("recovers a durable usage timeout without poisoning its target receipt", async () => {
		const jobId = crypto.randomUUID();
		const initialized = await initializeUploadedJob(
			jobId,
			buildRealClaudeTranscript(`usage-timeout-${jobId}`),
		);
		const completion = buildCompletionInput(initialized);
		const firstAttemptAt = new Date("2030-01-01T00:00:00.000Z");

		await expect(
			commitR2IngestJob({
				input: completion,
				now: () => firstAttemptAt,
				process: createRealProcessor(undefined, {
					awaitLanguageSignals: false,
					extractFacts: async () => {
						throw new UsageExtractionQueueTimeoutError();
					},
				}),
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toMatchObject({ code: "GATEWAY_TIMEOUT" });
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			attempts: 0,
			error: { code: "R2_INGEST_DEPENDENCY_UNAVAILABLE" },
			status: "pending",
		});

		const [beforeRetry] = await sqlClient<
			Array<{
				expectedRowCount: number | null;
				status: string;
				usageGeneration: string | null;
			}>
		>`
			SELECT
				ledger.status,
				ledger.usage_generation::text AS "usageGeneration",
				receipt.expected_row_count AS "expectedRowCount"
			FROM ingest_processing_ledger AS ledger
			LEFT JOIN ingest_processing_target_receipt AS receipt
				ON receipt.ledger_id = ledger.id
				AND receipt.target = 'rudel.usage_events'
			WHERE ledger.organization_id = ${ORGANIZATION_ID}
				AND ledger.session_id = ${jobId}
		`;
		expect(beforeRetry).toEqual({
			expectedRowCount: null,
			status: "processing",
			usageGeneration: expect.any(String),
		});
		const usageGeneration = beforeRetry?.usageGeneration;
		if (!usageGeneration) {
			throw new Error("durable timeout did not reserve a usage generation");
		}
		const [usageBeforeRetry] = await getClickhouse().query<{
			row_count: number | string;
		}>({
			query: `SELECT count() AS row_count
				FROM rudel.usage_events
				WHERE organization_id = {organizationId:String}
					AND session_id = {sessionId:String}`,
			query_params: { organizationId: ORGANIZATION_ID, sessionId: jobId },
		});
		expect(Number(usageBeforeRetry?.row_count ?? 0)).toBe(0);

		const retried = await commitR2IngestJob({
			input: completion,
			now: () => new Date(firstAttemptAt.getTime() + 5_000),
			process: createRealProcessor(undefined, {
				awaitLanguageSignals: false,
			}),
			r2: fakeR2,
			userId: USER_ID,
		});
		expect(retried.status).toBe("completed");

		const [afterRetry] = await sqlClient<
			Array<{
				expectedRowCount: number | null;
				status: string;
				usageGeneration: string | null;
			}>
		>`
			SELECT
				ledger.status,
				ledger.usage_generation::text AS "usageGeneration",
				receipt.expected_row_count AS "expectedRowCount"
			FROM ingest_processing_ledger AS ledger
			LEFT JOIN ingest_processing_target_receipt AS receipt
				ON receipt.ledger_id = ledger.id
				AND receipt.target = 'rudel.usage_events'
			WHERE ledger.organization_id = ${ORGANIZATION_ID}
				AND ledger.session_id = ${jobId}
		`;
		expect(afterRetry).toEqual({
			expectedRowCount: 2,
			status: "completed",
			usageGeneration,
		});
		const [usageAfterRetry] = await getClickhouse().query<{
			event_count: number | string;
			receipt_count: number | string;
		}>({
			query: `SELECT
					countIf(record_kind = 'event') AS event_count,
					countIf(record_kind = 'receipt' AND receipt_is_complete = 1) AS receipt_count
				FROM rudel.usage_events FINAL
				WHERE organization_id = {organizationId:String}
					AND session_id = {sessionId:String}
					AND event_version = {generation:UInt64}`,
			query_params: {
				generation: usageGeneration,
				organizationId: ORGANIZATION_ID,
				sessionId: jobId,
			},
		});
		expect(Number(usageAfterRetry?.event_count ?? 0)).toBe(1);
		expect(Number(usageAfterRetry?.receipt_count ?? 0)).toBe(1);
	}, 180_000);

	test("leaves objects intact on a ClickHouse code 159 timeout", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"server timeout transcript",
		);
		const timeoutError = parseError(
			"Code: 159. DB::Exception: Timeout exceeded. (TIMEOUT_EXCEEDED)",
		);
		expect(timeoutError).toMatchObject({
			code: "159",
			type: "TIMEOUT_EXCEEDED",
		});

		await expect(
			commitR2IngestJob({
				input: buildCompletionInput(initialized),
				process: async () => {
					throw timeoutError;
				},
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toBe(timeoutError);
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			attempts: 0,
			error: { code: "R2_INGEST_DEPENDENCY_UNAVAILABLE" },
			status: "pending",
		});
		expect(
			initialized.objects.every((object) =>
				fakeR2.objects.has(object.objectKey),
			),
		).toBe(true);

		const retried = await commitR2IngestJob({
			input: buildCompletionInput(initialized),
			now: () => new Date("2030-01-01T00:00:00.000Z"),
			process: async (input) => processorResult(input.sessionId),
			r2: fakeR2,
			userId: USER_ID,
		});
		expect(retried.status).toBe("completed");
	});

	test("leaves objects intact when the transcript filter worker crashes", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"worker crash transcript",
		);
		const queue = new IngestFilterQueue(
			{
				globalMaxBytes: 1_000,
				globalMaxJobs: 1,
				perUserMaxBytes: 1_000,
				perUserMaxJobs: 1,
				timeoutMs: 5_000,
			},
			() =>
				new Worker(
					new URL("./fixtures/crashing-ingest-worker.ts", import.meta.url).href,
				),
		);

		await expect(
			commitR2IngestJob({
				input: buildCompletionInput(initialized),
				process: async () => {
					await queue.filter({
						bytes: 23,
						fields: {
							content: "worker crash transcript",
							subagents: undefined,
						},
						signal: new AbortController().signal,
						userId: USER_ID,
					});
					return processorResult("unexpected-worker-success");
				},
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toBeInstanceOf(IngestFilterWorkerOperationalError);
		queue.close();
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			attempts: 0,
			error: { code: "R2_INGEST_DEPENDENCY_UNAVAILABLE" },
			status: "pending",
		});
		expect(
			initialized.objects.every((object) =>
				fakeR2.objects.has(object.objectKey),
			),
		).toBe(true);

		await commitR2IngestJob({
			input: buildCompletionInput(initialized),
			now: () => new Date("2030-01-01T00:00:00.000Z"),
			process: async (input) => processorResult(input.sessionId),
			r2: fakeR2,
			userId: USER_ID,
		});
	});

	test("a lost coordination lease keeps the attempt and leaves the upload retryable", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"lost lease transcript",
		);
		const lost = new PostgresLeaseLostError("ingest-processing:identity");

		await expect(
			commitR2IngestJob({
				input: buildCompletionInput(initialized),
				process: async () => {
					throw lost;
				},
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toBe(lost);
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			attempts: 0,
			error: { code: "R2_INGEST_DEPENDENCY_UNAVAILABLE" },
			status: "pending",
		});
		expect(
			initialized.objects.every((object) =>
				fakeR2.objects.has(object.objectKey),
			),
		).toBe(true);

		const retried = await commitR2IngestJob({
			input: buildCompletionInput(initialized),
			now: () => new Date("2030-01-01T00:00:00.000Z"),
			process: async (input) => processorResult(input.sessionId),
			r2: fakeR2,
			userId: USER_ID,
		});
		expect(retried.status).toBe("completed");
	});

	test("leaves objects intact on an R2 ClientDisconnect service error", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"client disconnect transcript",
		);
		const objectKey = initialized.objects[0]?.objectKey;
		if (!objectKey) throw new Error("missing initialized main object");
		const clientDisconnect = new S3ServiceException({
			$fault: "client",
			$metadata: { httpStatusCode: 400 },
			message: "Client disconnected before request completed",
			name: "ClientDisconnect",
		});
		fakeR2.failNextGetObject(objectKey, clientDisconnect);

		await expect(
			commitR2IngestJob({
				input: buildCompletionInput(initialized),
				process: async (input) => processorResult(input.sessionId),
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toBe(clientDisconnect);
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			attempts: 0,
			error: { code: "R2_INGEST_DEPENDENCY_UNAVAILABLE" },
			status: "pending",
		});
		expect(fakeR2.objects.has(objectKey)).toBe(true);

		await commitR2IngestJob({
			input: buildCompletionInput(initialized),
			now: () => new Date("2030-01-01T00:00:00.000Z"),
			process: async (input) => processorResult(input.sessionId),
			r2: fakeR2,
			userId: USER_ID,
		});
	});

	test("preserves objects for an unknown future processing error", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"novel failure transcript",
		);
		const novelError = new Error("future operational failure channel");

		await expect(
			commitR2IngestJob({
				input: buildCompletionInput(initialized),
				process: async () => {
					throw novelError;
				},
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toBe(novelError);
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			attempts: 1,
			error: { code: "R2_INGEST_TRANSIENT_FAILURE" },
			status: "pending",
		});
		expect(
			initialized.objects.every((object) =>
				fakeR2.objects.has(object.objectKey),
			),
		).toBe(true);

		await commitR2IngestJob({
			input: buildCompletionInput(initialized),
			now: () => new Date("2030-01-01T00:00:00.000Z"),
			process: async (input) => processorResult(input.sessionId),
			r2: fakeR2,
			userId: USER_ID,
		});
	});

	test("repairs expired leases only through the dedicated worker", async () => {
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

		expect(processCalls).toBe(1);
		const recovery = await repairRecoverableR2IngestJobs({
			database: sqlClient,
			limit: 1,
			now: () => new Date("2030-01-01T00:00:00.000Z"),
			process: async (input) => {
				processCalls += 1;
				return processorResult(input.sessionId);
			},
			r2: fakeR2,
		});
		expect(recovery).toMatchObject({ attempted: 1, completed: 1 });
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
		await repairRecoverableR2IngestJobs({
			database: sqlClient,
			limit: 1,
			now: () => new Date("2030-01-01T00:00:00.000Z"),
			process: async (input) => processorResult(input.sessionId),
			r2: fakeR2,
		});
	});

	test("terminal ClickHouse errors clean completed objects immediately", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"terminal processor transcript",
		);
		const objectKey = initialized.objects[0]?.objectKey;
		if (!objectKey) throw new Error("missing initialized main object");
		const syntaxError = parseError(
			"Code: 62. DB::Exception: Syntax error. (SYNTAX_ERROR)",
		);
		expect(syntaxError).toMatchObject({ code: "62", type: "SYNTAX_ERROR" });

		await expect(
			commitR2IngestJob({
				input: buildCompletionInput(initialized),
				process: async () => {
					throw syntaxError;
				},
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toBe(syntaxError);
		expect(fakeR2.completedKeys).toContain(objectKey);
		expect(fakeR2.objects.has(objectKey)).toBe(false);
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			attempts: 1,
			error: { code: "R2_INGEST_PROCESSING_FAILED" },
			status: "failed",
		});
	});

	test("keeps real timestamp validation terminal and cleans R2", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			JSON.stringify({ message: "missing timestamp", type: "user" }),
		);
		const objectKey = initialized.objects[0]?.objectKey;
		if (!objectKey) throw new Error("missing initialized main object");

		await expect(
			commitR2IngestJob({
				input: buildCompletionInput(initialized),
				process: createRealProcessor(undefined),
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toThrow("timestamp");
		expect(fakeR2.completedKeys).toContain(objectKey);
		expect(fakeR2.objects.has(objectKey)).toBe(false);
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			error: { code: "R2_INGEST_BAD_REQUEST" },
			status: "failed",
		});
	});

	test("does not consume an attempt while waiting beyond a lease duration", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"gate wait transcript",
		);
		const gate = createR2IngestMaterializationGate({
			maxBytes: 1_000_000,
			maxJobs: 1,
			maxQueuedJobs: 2,
			operationTimeoutMs: 5_000,
			queueTimeoutMs: 5_000,
		});
		let releaseGate = (): void => {};
		const occupied = gate.run(
			1,
			() =>
				new Promise<void>((resolve) => {
					releaseGate = resolve;
				}),
		);
		const committing = commitR2IngestJob({
			gate,
			input: buildCompletionInput(initialized),
			leaseDurationMs: 60,
			process: async (input) => processorResult(input.sessionId),
			r2: fakeR2,
			userId: USER_ID,
		});
		await Bun.sleep(100);
		const [queued] = await sqlClient<
			Array<{ attempts: number; status: string }>
		>`SELECT attempts, status FROM ingest_job WHERE id = ${initialized.jobId}`;
		expect(queued).toEqual({ attempts: 0, status: "pending" });
		releaseGate();
		await occupied;
		expect((await committing).status).toBe("completed");
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({ attempts: 1, status: "completed" });
	});

	test("renews the lease while processing is still active", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"lease heartbeat transcript",
		);
		let renewedLease: Date | string | null = null;
		const processingStartedAt = Date.now();
		const completed = await commitR2IngestJob({
			input: buildCompletionInput(initialized),
			leaseDurationMs: 120,
			process: async (input) => {
				await Bun.sleep(180);
				const [running] = await sqlClient<
					Array<{ leaseExpiresAt: Date | string | null }>
				>`
					SELECT lease_expires_at AS "leaseExpiresAt"
					FROM ingest_job
					WHERE id = ${initialized.jobId}
				`;
				renewedLease = running?.leaseExpiresAt ?? null;
				return processorResult(input.sessionId);
			},
			r2: fakeR2,
			userId: USER_ID,
		});
		expect(completed.status).toBe("completed");
		expect(new Date(String(renewedLease)).getTime()).toBeGreaterThan(
			processingStartedAt + 120,
		);
	});

	test("caps lease heartbeats at the job absolute expiry", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"lease heartbeat expiry cap transcript",
		);
		const baseTime = new Date("2030-01-01T00:00:00.000Z");
		const absoluteExpiry = new Date(baseTime.getTime() + 325);
		await sqlClient`
			UPDATE ingest_job
			SET expires_at = ${absoluteExpiry.toISOString()}
			WHERE id = ${initialized.jobId}
		`;
		let nowCall = 0;

		const completed = await commitR2IngestJob({
			input: buildCompletionInput(initialized),
			leaseDurationMs: 200,
			now: () => new Date(baseTime.getTime() + Math.min(nowCall++ * 50, 300)),
			process: async (input) => {
				await Bun.sleep(230);
				const [running] = await sqlClient<
					Array<{ leaseExpiresAt: Date | string | null }>
				>`
					SELECT lease_expires_at AS "leaseExpiresAt"
					FROM ingest_job
					WHERE id = ${initialized.jobId}
				`;
				expect(new Date(String(running?.leaseExpiresAt)).toISOString()).toBe(
					absoluteExpiry.toISOString(),
				);
				return processorResult(input.sessionId);
			},
			r2: fakeR2,
			userId: USER_ID,
		});

		expect(completed.status).toBe("completed");
	});

	test("sweeps abandoned pending jobs independently of retry recovery", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"abandoned pending transcript",
		);
		const objectKey = initialized.objects[0]?.objectKey;
		if (!objectKey) throw new Error("missing initialized main object");
		await sqlClient`
			UPDATE ingest_job
			SET expires_at = '2026-08-25T09:00:00.000Z'
			WHERE id = ${initialized.jobId}
		`;

		const swept = await sweepExpiredR2IngestJobs({
			database: sqlClient,
			now: new Date("2026-08-25T10:00:00.000Z"),
			r2: fakeR2,
		});
		expect(swept.attempted).toBeGreaterThan(0);
		expect(fakeR2.objects.has(objectKey)).toBe(false);
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			attempts: 0,
			error: { code: "R2_INGEST_JOB_EXPIRED" },
			status: "failed",
		});
	});

	test("does not sweep an expired running job with an active lease", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"active lease past absolute expiry transcript",
		);
		const objectKey = initialized.objects[0]?.objectKey;
		if (!objectKey) throw new Error("missing initialized main object");
		await sqlClient`
			UPDATE ingest_job
			SET
				status = 'running',
				attempts = 1,
				expires_at = '2030-01-01T09:00:00.000Z',
				lease_token = 'active-expired-job-lease',
				lease_expires_at = '2030-01-01T11:00:00.000Z'
			WHERE id = ${initialized.jobId}
		`;

		await sweepExpiredR2IngestJobs({
			database: sqlClient,
			now: new Date("2030-01-01T10:00:00.000Z"),
			r2: fakeR2,
		});

		expect(fakeR2.objects.has(objectKey)).toBe(true);
		expect(
			await getR2IngestJobStatus(initialized.jobId, USER_ID),
		).toMatchObject({
			attempts: 1,
			leaseExpiresAt: "2030-01-01T11:00:00.000Z",
			status: "running",
		});
	});

	test("deletes a completed object after hash failure and receipts interrupted cleanup on retry", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"declared transcript",
		);
		const objectKey = initialized.objects[0]?.objectKey;
		if (!objectKey) throw new Error("missing initialized main object");
		fakeR2.uploadText(objectKey, "tampered transcript");
		let interrupted = false;

		await expect(
			commitR2IngestJob({
				failpoint: async (boundary) => {
					if (
						!interrupted &&
						boundary.store === "r2" &&
						boundary.target === "delete-objects"
					) {
						interrupted = true;
						throw new Error("simulated cleanup crash after R2 acknowledgement");
					}
				},
				input: buildCompletionInput(initialized),
				process: createRealProcessor(undefined),
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toThrow("integrity verification failed");
		expect(interrupted).toBe(true);
		expect(fakeR2.completedKeys).toContain(objectKey);
		expect(fakeR2.objects.has(objectKey)).toBe(false);
		const [beforeRetry] = await sqlClient<
			Array<{ objectsDeletedAt: Date | null; status: string }>
		>`
			SELECT
				objects_deleted_at AS "objectsDeletedAt",
				status
			FROM ingest_job
			WHERE id = ${initialized.jobId}
		`;
		expect(beforeRetry).toEqual({ objectsDeletedAt: null, status: "failed" });

		await expect(
			commitR2IngestJob({
				input: buildCompletionInput(initialized),
				process: createRealProcessor(undefined),
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toThrow("integrity verification failed");
		const [afterRetry] = await sqlClient<
			Array<{ objectsDeletedAt: Date | string | null }>
		>`
			SELECT objects_deleted_at AS "objectsDeletedAt"
			FROM ingest_job
			WHERE id = ${initialized.jobId}
		`;
		expect(Date.parse(String(afterRetry?.objectsDeletedAt))).not.toBeNaN();
	});

	test("deletes a completed object after invalid UTF-8 is detected", async () => {
		const bytes = new Uint8Array([0xff, 0xfe, 0xfd]);
		const initialized = await initializeUploadedByteJob(
			crypto.randomUUID(),
			bytes,
		);
		const objectKey = initialized.objects[0]?.objectKey;
		if (!objectKey) throw new Error("missing initialized main object");

		await expect(
			commitR2IngestJob({
				input: buildCompletionInput(initialized),
				process: createRealProcessor(undefined),
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toThrow("integrity verification failed");
		expect(fakeR2.completedKeys).toContain(objectKey);
		expect(fakeR2.objects.has(objectKey)).toBe(false);
		const [failed] = await sqlClient<
			Array<{ objectsDeletedAt: Date | string | null; status: string }>
		>`
			SELECT
				objects_deleted_at AS "objectsDeletedAt",
				status
			FROM ingest_job
			WHERE id = ${initialized.jobId}
		`;
		expect(failed?.status).toBe("failed");
		expect(Date.parse(String(failed?.objectsDeletedAt))).not.toBeNaN();
	});

	test("keeps transient multipart abort cleanup pending until the autonomous repair drains it", async () => {
		const initialized = await initializeUploadedJob(
			crypto.randomUUID(),
			"declared transient-abort transcript",
		);
		const objectKey = initialized.objects[0]?.objectKey;
		if (!objectKey) throw new Error("missing initialized main object");
		fakeR2.uploadText(objectKey, "tampered transient-abort transcript");
		fakeR2.failNextAbort(
			objectKey,
			Object.assign(new Error("temporary R2 abort outage"), {
				$metadata: { httpStatusCode: 503 },
				name: "ServiceUnavailable",
			}),
		);

		await expect(
			commitR2IngestJob({
				input: buildCompletionInput(initialized),
				process: createRealProcessor(undefined),
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toThrow("integrity verification failed");
		const [cleanupPending] = await sqlClient<
			Array<{ objectsDeletedAt: Date | string | null; status: string }>
		>`
			SELECT
				objects_deleted_at AS "objectsDeletedAt",
				status
			FROM ingest_job
			WHERE id = ${initialized.jobId}
		`;
		expect(cleanupPending).toEqual({
			objectsDeletedAt: null,
			status: "failed",
		});
		expect(fakeR2.objects.has(objectKey)).toBe(true);
		expect(fakeR2.deletedKeys).not.toContain(objectKey);

		const repair = await repairR2IngestCleanupJobs({
			database: sqlClient,
			r2: fakeR2,
		});
		expect(repair.attempted).toBeGreaterThan(0);
		expect(repair.completed).toBeGreaterThan(0);
		const [cleanupCompleted] = await sqlClient<
			Array<{ objectsDeletedAt: Date | string | null }>
		>`
			SELECT objects_deleted_at AS "objectsDeletedAt"
			FROM ingest_job
			WHERE id = ${initialized.jobId}
		`;
		expect(
			Date.parse(String(cleanupCompleted?.objectsDeletedAt)),
		).not.toBeNaN();
		expect(fakeR2.objects.has(objectKey)).toBe(false);
		expect(fakeR2.deletedKeys).toContain(objectKey);
	});
});

const CRASH_BOUNDARIES: {
	label: string;
	matches: (boundary: IngestProcessingBoundary) => boolean;
}[] = [
	{
		label: "raw ClickHouse",
		matches: (boundary) =>
			boundary.store === "clickhouse" &&
			boundary.target === "rudel.claude_sessions",
	},
	{
		label: "raw Postgres receipt",
		matches: (boundary) =>
			boundary.store === "postgres" && boundary.target === "raw-receipt",
	},
	{
		label: "language-signal ClickHouse",
		matches: (boundary) =>
			boundary.store === "clickhouse" &&
			boundary.target === "rudel.session_language_signals",
	},
	{
		label: "usage generation",
		matches: (boundary) =>
			boundary.store === "postgres" && boundary.target === "usage-generation",
	},
	{
		label: "skill content ClickHouse",
		matches: (boundary) =>
			boundary.store === "clickhouse" &&
			boundary.target === "rudel.skill_version_contents",
	},
	{
		label: "skill use ClickHouse",
		matches: (boundary) =>
			boundary.store === "clickhouse" && boundary.target === "rudel.skill_uses",
	},
	{
		label: "skill receipt ClickHouse",
		matches: (boundary) =>
			boundary.store === "clickhouse" &&
			boundary.target === "rudel.skill_receipts",
	},
	{
		label: "usage ClickHouse",
		matches: (boundary) =>
			boundary.store === "clickhouse" &&
			boundary.target === "rudel.usage_events",
	},
	{
		label: "usage Postgres receipt",
		matches: (boundary) =>
			boundary.store === "postgres" && boundary.target === "usage-receipt",
	},
	{
		label: "completed processing ledger",
		matches: (boundary) =>
			boundary.store === "postgres" && boundary.target === "ledger-completed",
	},
	{
		label: "completed ingest job",
		matches: (boundary) =>
			boundary.store === "postgres" && boundary.target === "job-completed",
	},
];

const SUPERSESSION_BOUNDARIES: {
	label: string;
	matches: (boundary: IngestProcessingBoundary) => boolean;
}[] = [
	{
		label: "before usage reservation",
		matches: (boundary) =>
			boundary.store === "postgres" && boundary.target === "raw-receipt",
	},
	{
		label: "before the final usage receipt",
		matches: (boundary) =>
			boundary.store === "clickhouse" &&
			boundary.target === "rudel.usage_events",
	},
];

describe("R2 ingest real processor crash recovery", () => {
	test("stores inline screenshots from an R2 upload as omission markers", async () => {
		const jobId = crypto.randomUUID();
		const pixels = Buffer.from(
			Array.from({ length: 4_000 }, (_, index) => (index * 13) % 256),
		);
		const content = [
			buildRealClaudeTranscript(`screenshot-${jobId}`),
			JSON.stringify({
				message: {
					content: [
						{
							content: [
								{
									source: {
										data: pixels.toString("base64"),
										media_type: "image/png",
										type: "base64",
									},
									type: "image",
								},
							],
							tool_use_id: "toolu_screenshot",
							type: "tool_result",
						},
					],
					role: "user",
				},
				timestamp: "2026-08-25T10:00:03.000Z",
				type: "user",
			}),
		].join("\n");
		const initialized = await initializeUploadedJob(jobId, content);

		const committed = await commitR2IngestJob({
			input: buildCompletionInput(initialized),
			process: createRealProcessor(undefined),
			r2: fakeR2,
			userId: USER_ID,
		});

		expect(committed.status).toBe("completed");
		const [raw] = await getClickhouse().query<{ content: string }>({
			query: `SELECT content FROM rudel.claude_sessions WHERE organization_id = {organizationId:String} AND session_id = {sessionId:String}`,
			query_params: { organizationId: ORGANIZATION_ID, sessionId: jobId },
		});
		expect(raw?.content).toContain(
			`"data":"opaline-image-omitted:v1;sha256=${createHash("sha256").update(pixels).digest("hex")};bytes=4000;type=image/png"`,
		);
		expect(raw?.content).not.toContain(pixels.toString("base64"));
	}, 180_000);

	test("a stored upload queues its session's run index even when its git observations are skipped", async () => {
		const jobId = crypto.randomUUID();
		const initialized = await initializeUploadedJob(
			jobId,
			buildRealClaudeTranscript(`run-index-${jobId}`),
		);
		const previous = process.env.GIT_OBSERVATION_EXTRACTION_ENABLED;
		process.env.GIT_OBSERVATION_EXTRACTION_ENABLED = "false";
		try {
			const committed = await commitR2IngestJob({
				input: buildCompletionInput(initialized),
				process: createRealProcessor(undefined),
				r2: fakeR2,
				userId: USER_ID,
			});
			expect(committed.status).toBe("completed");
		} finally {
			if (previous === undefined)
				delete process.env.GIT_OBSERVATION_EXTRACTION_ENABLED;
			else process.env.GIT_OBSERVATION_EXTRACTION_ENABLED = previous;
		}
		const queued = await sqlClient<{ scope_kind: string }[]>`
			SELECT scope_kind FROM l1_edge_scope
			WHERE organization_id = ${ORGANIZATION_ID} AND session_id = ${jobId}
		`;
		expect(queued.map((row) => row.scope_kind)).toEqual(["session"]);
	}, 180_000);

	test.each(
		CRASH_BOUNDARIES,
	)("is physically and logically idempotent after $label acknowledgement", async ({
		matches,
	}) => {
		const jobId = crypto.randomUUID();
		const skillName = `crash-skill-${jobId}`;
		const initialized = await initializeUploadedJob(
			jobId,
			buildRealClaudeTranscript(skillName),
		);
		const completion = buildCompletionInput(initialized);
		let tripped = false;
		const failpoint: IngestProcessingFailpoint = async (boundary) => {
			if (!tripped && matches(boundary)) {
				tripped = true;
				throw new IngestProcessingCrashSimulationError(
					"simulated process crash after store acknowledgement",
				);
			}
		};

		await expect(
			commitR2IngestJob({
				failpoint,
				input: completion,
				leaseDurationMs: 1_000,
				now: () => new Date("2030-01-01T00:00:00.000Z"),
				process: createRealProcessor(failpoint),
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toThrow("simulated process crash");
		expect(tripped).toBe(true);

		const crashedStatus = await getR2IngestJobStatus(jobId, USER_ID);
		if (crashedStatus?.status === "completed") {
			expect(
				(
					await commitR2IngestJob({
						input: completion,
						process: createRealProcessor(undefined),
						r2: fakeR2,
						userId: USER_ID,
					})
				).status,
			).toBe("completed");
		} else {
			const repaired = await repairRecoverableR2IngestJobs({
				database: sqlClient,
				leaseDurationMs: 1_000,
				now: () => new Date("2030-01-01T00:00:02.000Z"),
				process: createRealProcessor(undefined),
				r2: fakeR2,
			});
			expect(repaired.completed).toBe(1);
		}
		expect(await getR2IngestJobStatus(jobId, USER_ID)).toMatchObject({
			status: "completed",
		});
		await expectPhysicalAndLogicalIdempotency(jobId, skillName);
	}, 180_000);

	test.each(
		SUPERSESSION_BOUNDARIES,
	)("terminally converges an older job superseded $label", async ({
		matches,
	}) => {
		const sessionId = `superseded-${crypto.randomUUID()}`;
		const olderJobId = crypto.randomUUID();
		const newerJobId = crypto.randomUUID();
		const olderContent = buildRealClaudeTranscript(`superseded-${sessionId}`);
		const newerContent = olderContent.replace(
			"Please use the requested skill.",
			"Please run the requested skill.",
		);
		const olderInitialized = await initializeUploadedJob(
			olderJobId,
			olderContent,
			[],
			sessionId,
		);
		const newerInitialized = await initializeUploadedJob(
			newerJobId,
			newerContent,
			[],
			sessionId,
		);
		const paused = createDeferred();
		const resume = createDeferred();
		let pauseObserved = false;
		const failpoint: IngestProcessingFailpoint = async (boundary) => {
			if (!pauseObserved && matches(boundary)) {
				pauseObserved = true;
				paused.resolve();
				await resume.promise;
			}
		};

		// Each commit gets its own gate: the two jobs model two API instances,
		// and the materialization gate is per-process. A shared gate would
		// deadlock here (older pauses inside the gate, newer queues behind it,
		// older resumes only after newer finishes) — a topology production
		// cannot produce.
		const instanceGate = () =>
			createR2IngestMaterializationGate({
				maxBytes: 1_000_000_000,
				maxJobs: 1,
				maxQueuedJobs: 8,
				operationTimeoutMs: 120_000,
				queueTimeoutMs: 30_000,
			});
		const olderCommit = commitR2IngestJob({
			failpoint,
			gate: instanceGate(),
			input: buildCompletionInput(olderInitialized),
			process: createRealProcessor(failpoint),
			r2: fakeR2,
			userId: USER_ID,
		});
		await paused.promise;
		const newerResult = await commitR2IngestJob({
			gate: instanceGate(),
			input: buildCompletionInput(newerInitialized),
			process: createRealProcessor(undefined),
			r2: fakeR2,
			userId: USER_ID,
		}).finally(resume.resolve);
		const olderResult = await olderCommit;

		expect(pauseObserved).toBe(true);
		expect(newerResult.status).toBe("completed");
		expect(olderResult.status).toBe("completed");
		expect(olderResult.result.usageChecksum).toBeUndefined();
		expect(
			await getR2IngestJobStatus(olderInitialized.jobId, USER_ID),
		).toMatchObject({
			attempts: 1,
			error: null,
			status: "completed",
		});
		const [ledger] = await sqlClient<
			Array<{ completed: number; processing: number }>
		>`
			SELECT
				count(*) FILTER (WHERE status = 'completed')::int AS completed,
				count(*) FILTER (WHERE status = 'processing')::int AS processing
			FROM ingest_processing_ledger
			WHERE organization_id = ${ORGANIZATION_ID}
				AND session_id = ${sessionId}
		`;
		expect(ledger).toEqual({ completed: 2, processing: 0 });
		expect(
			olderInitialized.objects.every(
				(object) => !fakeR2.objects.has(object.objectKey),
			),
		).toBe(true);

		const receipts = await sqlClient<
			Array<{ contentSha256: string; operationId: string; revision: string }>
		>`
			SELECT
				content_sha256 AS "contentSha256",
				operation_id AS "operationId",
				revision::text AS revision
			FROM session_ingest_revision
			WHERE organization_id = ${ORGANIZATION_ID}
				AND session_id = ${sessionId}
		`;
		const olderReceipt = receipts.find(
			(receipt) => receipt.operationId === `r2:${olderJobId}`,
		);
		const newerReceipt = receipts.find(
			(receipt) => receipt.operationId === `r2:${newerJobId}`,
		);
		if (!olderReceipt || !newerReceipt) {
			throw new Error("Supersession revision receipts were not recorded");
		}
		expect(BigInt(olderReceipt.revision)).toBeLessThan(
			BigInt(newerReceipt.revision),
		);
		// Result aliases must not shadow the revision column: ClickHouse's
		// analyzer resolves the alias inside argMax/max and rejects the query
		// with ILLEGAL_AGGREGATION.
		const [rawWinner] = await getClickhouse().query<{
			content: string;
			winner_revision: string;
		}>({
			query: `SELECT
				argMax(content, revision) AS content,
				toString(max(revision)) AS winner_revision
			FROM rudel.claude_sessions
			WHERE organization_id = {organizationId:String}
				AND user_id = {userId:String}
				AND session_id = {sessionId:String}
			HAVING count() > 0`,
			query_params: {
				organizationId: ORGANIZATION_ID,
				sessionId,
				userId: USER_ID,
			},
		});
		expect(rawWinner).toEqual({
			content: newerContent,
			winner_revision: newerReceipt.revision,
		});
		const [analyticsWinner] = await getClickhouse().query<{
			winner_revision: string;
		}>({
			query: `SELECT toString(max(revision)) AS winner_revision
			FROM rudel.session_analytics
			WHERE organization_id = {organizationId:String}
				AND user_id = {userId:String}
				AND source = 'claude_code'
				AND session_id = {sessionId:String}
			HAVING count() > 0`,
			query_params: {
				organizationId: ORGANIZATION_ID,
				sessionId,
				userId: USER_ID,
			},
		});
		expect(analyticsWinner?.winner_revision).toBe(newerReceipt.revision);
		const latestUsage = await readLatestUsageState(sessionId);
		expect(latestUsage.length).toBeGreaterThan(1);
		expect(
			latestUsage.every(
				(row) =>
					row.contentSha256 === newerReceipt.contentSha256 &&
					row.isDeleted === 0,
			),
		).toBe(true);
	}, 180_000);

	test("recovers an expired lease without duplicating an already-consistent MV target", async () => {
		const clickhouse = getClickhouse();
		const table = "rudel.claude_sessions";
		await clickhouse.execute({
			query: `ALTER TABLE ${table} MODIFY SETTING non_replicated_deduplication_window = 1`,
		});
		try {
			const jobId = crypto.randomUUID();
			const skillName = `evicted-dedup-skill-${jobId}`;
			const initialized = await initializeUploadedJob(
				jobId,
				buildRealClaudeTranscript(skillName),
			);
			const completion = buildCompletionInput(initialized);
			const leaseStartedAt = new Date("2030-01-01T00:00:00.000Z");
			let crashedAfterRawAcknowledgement = false;
			const failpoint: IngestProcessingFailpoint = async (boundary) => {
				if (
					!crashedAfterRawAcknowledgement &&
					boundary.store === "clickhouse" &&
					boundary.target === table
				) {
					crashedAfterRawAcknowledgement = true;
					throw new IngestProcessingCrashSimulationError(
						"simulated process death after raw acknowledgement",
					);
				}
			};

			await expect(
				commitR2IngestJob({
					failpoint,
					input: completion,
					now: () => leaseStartedAt,
					process: createRealProcessor(failpoint),
					r2: fakeR2,
					userId: USER_ID,
				}),
			).rejects.toThrow("simulated process death");
			expect(crashedAfterRawAcknowledgement).toBe(true);

			const [ledger] = await sqlClient<
				Array<{ id: string; receiptCount: number }>
			>`
				SELECT
					ledger.id,
					COUNT(receipt.target)::int AS "receiptCount"
				FROM ingest_processing_ledger AS ledger
				LEFT JOIN ingest_processing_target_receipt AS receipt
					ON receipt.ledger_id = ledger.id
					AND receipt.target = ${table}
				WHERE ledger.organization_id = ${ORGANIZATION_ID}
					AND ledger.session_id = ${jobId}
				GROUP BY ledger.id
			`;
			if (!ledger) throw new Error("missing crash-recovery ledger");
			expect(ledger.receiptCount).toBe(0);

			const [rawRow] = await clickhouse.query<Record<string, unknown>>({
				query: `SELECT * FROM ${table} WHERE organization_id = {organizationId:String} AND session_id = {sessionId:String} LIMIT 1`,
				query_params: {
					organizationId: ORGANIZATION_ID,
					sessionId: jobId,
				},
			});
			if (!rawRow) throw new Error("missing acknowledged raw row");
			const rawIngestedAt = await readRawIngestedAt(jobId);
			for (const fillerIndex of [1, 2]) {
				await clickhouse.insert({
					asyncInsert: false,
					deduplicationToken: `eviction-filler-${jobId}-${fillerIndex}`,
					table,
					values: [
						{
							...rawRow,
							ingested_at: `2030-01-01 00:00:0${fillerIndex}.000`,
							session_id: `${jobId}-eviction-filler-${fillerIndex}`,
						},
					],
				});
			}
			expect(await countRawAndAnalyticsRevision(jobId, rawIngestedAt)).toEqual({
				analytics: 1,
				raw: 1,
			});

			const [crashedJob] = await sqlClient<
				Array<{ leaseExpiresAt: Date | string | null; status: string }>
			>`
				SELECT
					lease_expires_at AS "leaseExpiresAt",
					status
				FROM ingest_job
				WHERE id = ${jobId}
			`;
			expect(crashedJob?.status).toBe("running");
			expect(new Date(String(crashedJob?.leaseExpiresAt)).toISOString()).toBe(
				"2030-01-01T00:30:00.000Z",
			);
			const recovered = await repairRecoverableR2IngestJobs({
				database: sqlClient,
				now: () => new Date("2030-01-01T00:30:01.000Z"),
				process: createRealProcessor(undefined),
				r2: fakeR2,
			});
			expect(recovered.completed).toBe(1);
			const [job] = await sqlClient<Array<{ attempts: number }>>`
				SELECT attempts
				FROM ingest_job
				WHERE id = ${jobId}
			`;
			expect(job?.attempts).toBe(2);
			expect(await countRawAndAnalyticsRevision(jobId, rawIngestedAt)).toEqual({
				analytics: 1,
				raw: 1,
			});
			await expectPhysicalAndLogicalIdempotency(jobId, skillName);
		} finally {
			await clickhouse.execute({
				query: `ALTER TABLE ${table} MODIFY SETTING non_replicated_deduplication_window = 1000`,
			});
		}
	}, 180_000);

	test("repairs a missing session analytics target before receipting raw recovery", async () => {
		const clickhouse = getClickhouse();
		const rawTable = "rudel.claude_sessions";
		const jobId = crypto.randomUUID();
		const skillName = `torn-mv-skill-${jobId}`;
		const initialized = await initializeUploadedJob(
			jobId,
			buildRealClaudeTranscript(skillName),
		);
		const completion = buildCompletionInput(initialized);
		let crashedAfterRawAcknowledgement = false;
		const failpoint: IngestProcessingFailpoint = async (boundary) => {
			if (
				!crashedAfterRawAcknowledgement &&
				boundary.store === "clickhouse" &&
				boundary.target === rawTable
			) {
				crashedAfterRawAcknowledgement = true;
				throw new IngestProcessingCrashSimulationError(
					"simulated process death after torn raw commit",
				);
			}
		};

		await expect(
			commitR2IngestJob({
				failpoint,
				input: completion,
				now: () => new Date("2030-01-01T00:00:00.000Z"),
				process: createRealProcessor(failpoint),
				r2: fakeR2,
				userId: USER_ID,
			}),
		).rejects.toThrow("simulated process death");
		expect(crashedAfterRawAcknowledgement).toBe(true);
		const rawIngestedAt = await readRawIngestedAt(jobId);
		expect(await countRawAndAnalyticsRevision(jobId, rawIngestedAt)).toEqual({
			analytics: 1,
			raw: 1,
		});

		await clickhouse.execute({
			query: `DELETE FROM rudel.session_analytics
				WHERE source = 'claude_code'
					AND organization_id = {organizationId:String}
					AND user_id = {userId:String}
					AND session_id = {sessionId:String}
					AND ingested_at = parseDateTime64BestEffort({ingestedAt:String}, 3, 'UTC')
				SETTINGS lightweight_deletes_sync = 3`,
			query_params: {
				ingestedAt: rawIngestedAt,
				organizationId: ORGANIZATION_ID,
				sessionId: jobId,
				userId: USER_ID,
			},
		});
		expect(await countRawAndAnalyticsRevision(jobId, rawIngestedAt)).toEqual({
			analytics: 0,
			raw: 1,
		});

		const recovered = await repairRecoverableR2IngestJobs({
			database: sqlClient,
			now: () => new Date("2030-01-01T00:30:01.000Z"),
			process: createRealProcessor(undefined),
			r2: fakeR2,
		});
		expect(recovered.completed).toBe(1);
		expect(await countRawAndAnalyticsRevision(jobId, rawIngestedAt)).toEqual({
			analytics: 1,
			raw: 1,
		});
		await expectPhysicalAndLogicalIdempotency(jobId, skillName);
	}, 180_000);

	test("an identity whose processor crashed holding its lease resumes once the lease expires", async () => {
		const identity = {
			filteredContentSha256: "d".repeat(64),
			filterVersion: 2,
			organizationId: ORGANIZATION_ID,
			sessionId: `crashed-lease-${crypto.randomUUID()}`,
		};
		const leaseName = `ingest-processing:${JSON.stringify([
			identity.organizationId,
			identity.sessionId,
			identity.filteredContentSha256,
			identity.filterVersion,
		])}`;
		// A processor that took the lease and died never releases or renews it.
		expect(
			await acquirePostgresLease(
				leaseName,
				crypto.randomUUID(),
				1_000,
				sqlClient,
			),
		).toBe(true);
		const blocked = await withIngestProcessingLedger(
			identity,
			(value) => String(value),
			async () => "must-not-run-while-leased",
			createLedgerTestEnvironment(ingestProcessingSqlClient),
		);
		expect(blocked).toEqual({ status: "already_processing" });

		await Bun.sleep(1_500);
		const resumed = await withIngestProcessingLedger(
			identity,
			(value) => String(value),
			async () => "resumed-after-expiry",
			createLedgerTestEnvironment(ingestProcessingSqlClient),
		);
		expect(resumed).toEqual({
			result: "resumed-after-expiry",
			status: "completed",
		});
		const [remaining] = await sqlClient<Array<{ count: number }>>`
			SELECT count(*)::int AS count FROM coordination_lease WHERE name = ${leaseName}
		`;
		expect(remaining?.count).toBe(0);
	});

	test("a processor whose lease was taken over cannot overwrite the successor's ledger result", async () => {
		const identity = {
			filteredContentSha256: "f".repeat(64),
			filterVersion: 2,
			organizationId: ORGANIZATION_ID,
			sessionId: `taken-over-${crypto.randomUUID()}`,
		};
		const leaseName = `ingest-processing:${JSON.stringify([
			identity.organizationId,
			identity.sessionId,
			identity.filteredContentSha256,
			identity.filterVersion,
		])}`;
		const successor = crypto.randomUUID();
		let ledgerId = "";

		await expect(
			withIngestProcessingLedger(
				identity,
				(value) => String(value),
				async (ledger) => {
					ledgerId = ledger.id;
					// The stalled processor's lease expired; a successor took it over
					// and completed the same identity before the stale work returns.
					await sqlClient`
						UPDATE coordination_lease SET holder = ${successor} WHERE name = ${leaseName}
					`;
					await sqlClient`
						UPDATE ingest_processing_ledger
						SET
							status = 'completed',
							result = ${JSON.stringify("successor-result")}::jsonb,
							completed_at = NOW()
						WHERE id = ${ledger.id}
					`;
					return "stale-result";
				},
				createLedgerTestEnvironment(ingestProcessingSqlClient),
			),
		).rejects.toBeInstanceOf(PostgresLeaseLostError);

		const [row] = await sqlClient<Array<{ result: unknown; status: string }>>`
			SELECT status, result FROM ingest_processing_ledger WHERE id = ${ledgerId}
		`;
		expect(row).toEqual({ result: "successor-result", status: "completed" });
		const [lease] = await sqlClient<Array<{ holder: string }>>`
			SELECT holder FROM coordination_lease WHERE name = ${leaseName}
		`;
		expect(lease?.holder).toBe(successor);
	});

	test("returns already_processing across independent instances for the same hash", async () => {
		const connectionString = process.env.PG_CONNECTION_STRING;
		if (!connectionString)
			throw new Error("missing Postgres connection string");
		const firstDatabase = postgres(connectionString, {
			max: 1,
			prepare: false,
		});
		const secondDatabase = postgres(connectionString, {
			max: 1,
			prepare: false,
		});
		const identity = {
			filteredContentSha256: "e".repeat(64),
			filterVersion: 2,
			organizationId: ORGANIZATION_ID,
			sessionId: `cross-instance-${crypto.randomUUID()}`,
		};
		let releaseOperation = (): void => {};
		let markStarted = (): void => {};
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const first = withIngestProcessingLedger(
			identity,
			(value) => String(value),
			async () => {
				markStarted();
				await new Promise<void>((resolve) => {
					releaseOperation = resolve;
				});
				return "first-completed";
			},
			createLedgerTestEnvironment(firstDatabase),
		);
		try {
			await started;
			const waitStartedAt = performance.now();
			const second = await withIngestProcessingLedger(
				identity,
				(value) => String(value),
				async () => "second-must-not-run",
				createLedgerTestEnvironment(secondDatabase),
			);
			expect(second).toEqual({ status: "already_processing" });
			expect(performance.now() - waitStartedAt).toBeLessThan(500);
			releaseOperation();
			expect(await first).toEqual({
				result: "first-completed",
				status: "completed",
			});
		} finally {
			releaseOperation();
			await first.catch(() => undefined);
			await Promise.all([
				firstDatabase.end({ timeout: 1 }),
				secondDatabase.end({ timeout: 1 }),
			]);
		}
	});
});

interface QuiescedTestIdentity {
	apiKey: string;
	apiKeyId: string;
	organizationId: string;
	userId: string;
}

async function createQuiescedTestIdentity(
	baseUrl: string,
): Promise<QuiescedTestIdentity> {
	const signupResponse = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
		body: JSON.stringify({
			email: `r2-quiescence-${crypto.randomUUID()}@example.com`,
			name: "R2 Quiescence Test",
			password: "r2-quiescence-test-password",
		}),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
	expect(signupResponse.ok).toBe(true);
	const signup: unknown = await signupResponse.json();
	if (!isRecord(signup) || typeof signup.token !== "string") {
		throw new Error("Quiescence test signup returned no bearer token");
	}

	const meResponse = await fetch(`${baseUrl}/rpc/me`, {
		body: "{}",
		headers: {
			Authorization: `Bearer ${signup.token}`,
			"Content-Type": "application/json",
		},
		method: "POST",
	});
	expect(meResponse.ok).toBe(true);
	const me: unknown = await meResponse.json();
	if (!isRecord(me) || !isRecord(me.json) || typeof me.json.id !== "string") {
		throw new Error("Quiescence test user lookup returned no user ID");
	}

	const apiKeyResponse = await fetch(`${baseUrl}/api/auth/api-key/create`, {
		body: JSON.stringify({ expiresIn: null, name: "r2-quiescence-test" }),
		headers: {
			Authorization: `Bearer ${signup.token}`,
			"Content-Type": "application/json",
		},
		method: "POST",
	});
	expect(apiKeyResponse.ok).toBe(true);
	const apiKey: unknown = await apiKeyResponse.json();
	if (
		!isRecord(apiKey) ||
		typeof apiKey.id !== "string" ||
		typeof apiKey.key !== "string"
	) {
		throw new Error("Quiescence test API key creation returned no key");
	}

	return {
		apiKey: apiKey.key,
		apiKeyId: apiKey.id,
		organizationId: me.json.id,
		userId: me.json.id,
	};
}

async function readApiKeySnapshot(apiKeyId: string): Promise<string> {
	const [row] = await sqlClient<Array<{ snapshot: string }>>`
		SELECT (
			to_jsonb(api_key) - 'last_request' - 'updated_at'
		)::text AS snapshot
		FROM apikey AS api_key
		WHERE id = ${apiKeyId}
	`;
	if (!row) throw new Error("Quiescence test API key disappeared");
	return row.snapshot;
}

async function countQuiescedCanonicalRaw(
	identity: QuiescedTestIdentity,
	sessionId: string,
): Promise<number> {
	const [row] = await getClickhouse().query<{ count: number | string }>({
		query: `SELECT count() AS count
			FROM rudel.claude_sessions
			WHERE organization_id = {organizationId:String}
				AND session_id = {sessionId:String}
				AND user_id = {userId:String}`,
		query_params: {
			organizationId: identity.organizationId,
			sessionId,
			userId: identity.userId,
		},
	});
	return Number(row?.count ?? 0);
}

async function deleteQuiescedClickHouseRows(
	organizationId: string,
): Promise<void> {
	for (const table of [
		"rudel.claude_sessions",
		"rudel.session_analytics",
		"rudel.session_language_signals",
		"rudel.skill_receipts",
		"rudel.skill_uses",
		"rudel.skill_version_contents",
		"rudel.usage_events",
	]) {
		await getClickhouse().execute({
			query: `DELETE FROM ${getSafeClickHouseTable(table)} WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
			query_params: { organizationId },
		});
	}
}

async function initializeUploadedJobForIdentity(
	jobId: Uuid,
	mainContent: string,
	identity: QuiescedTestIdentity,
): Promise<R2IngestInitOutput> {
	const initialized = await initR2IngestJob({
		database: sqlClient,
		input: {
			objects: [
				{
					byteLength: byteLength(mainContent),
					kind: "main",
					sha256: sha256(mainContent),
				},
			],
			projectPath: "/test/r2-quiescence",
			sessionId: jobId,
			source: "claude_code",
		},
		now: () => new Date("2026-08-25T10:00:00.000Z"),
		organizationId: identity.organizationId,
		r2: fakeR2,
		randomUUID: () => jobId,
		userId: identity.userId,
	});
	await extendTestJobExpiry(initialized.jobId);
	const objectKey = initialized.objects[0]?.objectKey;
	if (!objectKey) throw new Error("Quiescence test job has no main object");
	fakeR2.uploadText(objectKey, mainContent);
	return initialized;
}

async function readRpcErrorShape(
	response: Response,
): Promise<{ code: string; message: string; reason: string | undefined }> {
	const body: unknown = await response.json();
	if (
		!isRecord(body) ||
		!isRecord(body.json) ||
		typeof body.json.code !== "string" ||
		typeof body.json.message !== "string"
	) {
		throw new Error("Quiesced commit returned an invalid RPC error");
	}
	const data = isRecord(body.json.data) ? body.json.data : {};
	return {
		code: body.json.code,
		message: body.json.message,
		reason: typeof data.reason === "string" ? data.reason : undefined,
	};
}

interface IngestJobRowSnapshot {
	attempts: number;
	lastErrorCode: string | null;
	leaseExpiresAt: string | null;
	leaseToken: string | null;
	maxAttempts: number;
	snapshot: string;
	status: string;
}

async function readIngestJobRowSnapshot(
	jobId: string,
): Promise<IngestJobRowSnapshot> {
	const [row] = await sqlClient<IngestJobRowSnapshot[]>`
		SELECT
			attempts,
			last_error_code AS "lastErrorCode",
			lease_expires_at::text AS "leaseExpiresAt",
			lease_token AS "leaseToken",
			max_attempts AS "maxAttempts",
			to_jsonb(job)::text AS snapshot,
			status
		FROM ingest_job AS job
		WHERE id = ${jobId}
	`;
	if (!row) throw new Error("Quiescence test ingest job disappeared");
	return row;
}

function snapshotFakeR2Objects(initialized: R2IngestInitOutput) {
	return initialized.objects.map((initializedObject) => {
		const stored = fakeR2.objects.get(initializedObject.objectKey);
		if (!stored) throw new Error("Quiescence test R2 object disappeared");
		return {
			bytes: stored.bytes ? Array.from(stored.bytes) : null,
			complete: stored.complete,
			metadata: Object.entries(stored.metadata).sort(([left], [right]) =>
				left.localeCompare(right),
			),
			objectKey: initializedObject.objectKey,
			uploadId: stored.uploadId,
		};
	});
}

function snapshotFakeR2Effects() {
	return {
		abortedKeys: [...fakeR2.abortedKeys],
		completedKeys: [...fakeR2.completedKeys],
		deletedKeys: [...fakeR2.deletedKeys],
		getObjectKeys: [...fakeR2.getObjectKeys],
		headObjectKeys: [...fakeR2.headObjectKeys],
	};
}

function restoreEnvironmentVariable(
	name: string,
	previousValue: string | undefined,
): void {
	if (previousValue === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = previousValue;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

async function initializeUploadedJob(
	jobId: Uuid,
	mainContent: string,
	subagents: readonly { agentId: string; content: string }[] = [],
	sessionId: string = jobId,
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
			sessionId,
			source: "claude_code",
		},
		now: () => new Date("2026-08-25T10:00:00.000Z"),
		organizationId: ORGANIZATION_ID,
		r2: fakeR2,
		randomUUID: () => jobId,
		userId: USER_ID,
	});
	await extendTestJobExpiry(initialized.jobId);
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

async function readLatestUsageState(
	sessionId: string,
): Promise<Array<{ contentSha256: string; isDeleted: number }>> {
	return getClickhouse().query({
		query: `SELECT
			content_sha256 AS "contentSha256",
			is_deleted AS "isDeleted"
		FROM (
			SELECT *
			FROM rudel.usage_events
			WHERE organization_id = {organizationId:String}
				AND user_id = {userId:String}
				AND session_id = {sessionId:String}
			ORDER BY event_version DESC
			LIMIT 1 BY event_id
		)`,
		query_params: {
			organizationId: ORGANIZATION_ID,
			sessionId,
			userId: USER_ID,
		},
	});
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
	let resolvePromise: (() => void) | undefined;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve() {
			if (!resolvePromise)
				throw new Error("Deferred promise was not initialized");
			resolvePromise();
		},
	};
}

async function initializeUploadedByteJob(
	jobId: Uuid,
	bytes: Uint8Array,
): Promise<R2IngestInitOutput> {
	const initialized = await initR2IngestJob({
		database: sqlClient,
		input: {
			objects: [
				{
					byteLength: bytes.byteLength,
					kind: "main",
					sha256: sha256(bytes),
				},
			],
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
	await extendTestJobExpiry(initialized.jobId);
	const objectKey = initialized.objects[0]?.objectKey;
	if (!objectKey) throw new Error("missing initialized byte object");
	fakeR2.uploadBytes(objectKey, bytes);
	return initialized;
}

async function extendTestJobExpiry(jobId: string): Promise<void> {
	await sqlClient`
		UPDATE ingest_job
		SET expires_at = '2031-01-01T00:00:00.000Z'
		WHERE id = ${jobId}
	`;
}

function createLedgerTestEnvironment(database: postgres.Sql) {
	return {
		database,
		failpoint: undefined,
		now: () => new Date("2030-01-02T00:00:00.000Z"),
		randomUUID: () => crypto.randomUUID(),
		semaphore: createIngestProcessingSemaphore({
			maxActive: 1,
			maxQueued: 1,
			waitTimeoutMs: 1_000,
		}),
		signal: undefined,
	};
}

function createRealProcessor(
	failpoint: IngestProcessingFailpoint | undefined,
	options: {
		awaitLanguageSignals?: boolean;
		extractFacts?: SessionImportDependencies["workers"]["extractFacts"];
	} = {},
): (
	input: IngestSessionInput,
	identity: { operationId: string; organizationId: string; userId: string },
) => Promise<R2IngestProcessorResult> {
	return (input, identity) =>
		processIngestSession(
			{
				awaitLanguageSignals: options.awaitLanguageSignals ?? true,
				context: {
					apiKeyId: null,
					session: null,
					user: { id: identity.userId },
				},
				durableProcessing: {
					failpoint,
					operationId: identity.operationId,
				},
				enforceRateLimits: false,
				errorFactories: TEST_ERROR_FACTORIES,
				input,
			},
			options.extractFacts
				? { workers: { extractFacts: options.extractFacts } }
				: {},
		);
}

const TEST_ERROR_FACTORIES: IngestErrorFactories = {
	redactionBudgetExceeded: () => new Error("redaction budget exceeded"),
	redactionDidNotConverge: () => new Error("redaction did not converge"),
	secretFilterJsonIntegrity: () => new Error("filter JSON integrity failure"),
	sessionOwnershipConflict: () => new Error("session ownership conflict"),
	sessionUploadShrinkRejected: () => new Error("session upload shrank"),
};

function buildRealClaudeTranscript(skillName: string): string {
	return [
		JSON.stringify({
			message: {
				content: "Please use the requested skill.",
				role: "user",
			},
			timestamp: "2026-08-25T10:00:00.000Z",
			type: "user",
		}),
		JSON.stringify({
			message: {
				content: [
					{
						id: `tool-${skillName}`,
						input: { skill: skillName },
						name: "Skill",
						type: "tool_use",
					},
				],
				role: "assistant",
				usage: { input_tokens: 12, output_tokens: 4 },
			},
			timestamp: "2026-08-25T10:00:01.000Z",
			type: "assistant",
		}),
		JSON.stringify({
			isMeta: true,
			message: {
				content: `Base directory for this skill: /tmp/skills/${skillName}\n\n# ${skillName}\n\nCrash recovery body.\n`,
				role: "user",
			},
			timestamp: "2026-08-25T10:00:02.000Z",
			type: "user",
		}),
	].join("\n");
}

async function readRawIngestedAt(sessionId: string): Promise<string> {
	const [raw] = await getClickhouse().query<{ ingested_at: string }>({
		query: `SELECT ingested_at
			FROM rudel.claude_sessions
			WHERE organization_id = {organizationId:String}
				AND session_date = parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC')
				AND session_id = {sessionId:String}
				AND user_id = {userId:String}
			ORDER BY revision DESC
			LIMIT 1`,
		query_params: {
			organizationId: ORGANIZATION_ID,
			sessionDate: REAL_CLAUDE_SESSION_DATE,
			sessionId,
			userId: USER_ID,
		},
	});
	if (!raw) throw new Error("missing raw ingest revision");
	return raw.ingested_at;
}

async function countRawAndAnalyticsRevision(
	sessionId: string,
	ingestedAt: string,
): Promise<{ analytics: number; raw: number }> {
	const clickhouse = getClickhouse();
	const [[raw], [analytics]] = await Promise.all([
		clickhouse.query<{ physical: number | string }>({
			query: `SELECT count() AS physical
				FROM rudel.claude_sessions
				WHERE organization_id = {organizationId:String}
					AND session_date = parseDateTime64BestEffort({sessionDate:String}, 3, 'UTC')
					AND session_id = {sessionId:String}
					AND user_id = {userId:String}
					AND ingested_at = parseDateTime64BestEffort({ingestedAt:String}, 3, 'UTC')`,
			query_params: {
				ingestedAt,
				organizationId: ORGANIZATION_ID,
				sessionDate: REAL_CLAUDE_SESSION_DATE,
				sessionId,
				userId: USER_ID,
			},
		}),
		clickhouse.query<{ physical: number | string }>({
			query: `SELECT count() AS physical
				FROM rudel.session_analytics
				WHERE source = 'claude_code'
					AND organization_id = {organizationId:String}
					AND user_id = {userId:String}
					AND session_id = {sessionId:String}
					AND ingested_at = parseDateTime64BestEffort({ingestedAt:String}, 3, 'UTC')`,
			query_params: {
				ingestedAt,
				organizationId: ORGANIZATION_ID,
				sessionId,
				userId: USER_ID,
			},
		}),
	]);
	return {
		analytics: Number(analytics?.physical ?? 0),
		raw: Number(raw?.physical ?? 0),
	};
}

async function expectPhysicalAndLogicalIdempotency(
	sessionId: string,
	skillName: string,
): Promise<void> {
	for (const table of [
		"rudel.claude_sessions",
		"rudel.session_analytics",
		"rudel.session_language_signals",
		"rudel.skill_receipts",
		"rudel.skill_uses",
	]) {
		const [row] = await getClickhouse().query<{ physical: number }>({
			query: `SELECT count() AS physical FROM ${getSafeClickHouseTable(table)} WHERE organization_id = {organizationId:String} AND session_id = {sessionId:String}`,
			query_params: { organizationId: ORGANIZATION_ID, sessionId },
		});
		expect(Number(row?.physical), `${table} physical rows`).toBe(1);
	}

	const [skillContent] = await getClickhouse().query<{ physical: number }>({
		query: `SELECT count() AS physical FROM rudel.skill_version_contents WHERE organization_id = {organizationId:String} AND skill_name = {skillName:String}`,
		query_params: { organizationId: ORGANIZATION_ID, skillName },
	});
	expect(Number(skillContent?.physical)).toBe(1);

	const [usage] = await getClickhouse().query<{
		logical: number;
		physical: number;
	}>({
		query: `
			SELECT
				count() AS physical,
				uniqExact(tuple(event_id, event_version, record_kind)) AS logical
			FROM rudel.usage_events
			WHERE organization_id = {organizationId:String}
				AND session_id = {sessionId:String}
		`,
		query_params: { organizationId: ORGANIZATION_ID, sessionId },
	});
	expect(Number(usage?.physical)).toBeGreaterThan(0);
	expect(Number(usage?.physical)).toBe(Number(usage?.logical));

	const [ledger] = await sqlClient<
		Array<{ ledgerCount: number; status: string }>
	>`
		SELECT count(*)::int AS "ledgerCount", max(status) AS status
		FROM ingest_processing_ledger
		WHERE organization_id = ${ORGANIZATION_ID}
			AND session_id = ${sessionId}
	`;
	expect(ledger).toEqual({ ledgerCount: 1, status: "completed" });
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

async function interruptFinalIngestClaim(
	initialized: R2IngestInitOutput,
	leaseStartedAt: Date,
	userId: string,
): Promise<void> {
	// The commit below runs on the injected fixed clock, so the retry window
	// must be rewound relative to that clock, not the database clock.
	await sqlClient`
		UPDATE ingest_job
		SET attempts = max_attempts - 1,
			available_at = ${new Date(
				leaseStartedAt.getTime() - 3_600_000,
			).toISOString()}
		WHERE id = ${initialized.jobId}
	`;
	let interrupted = false;
	await expect(
		commitR2IngestJob({
			failpoint: async (boundary) => {
				if (
					!interrupted &&
					boundary.store === "r2" &&
					boundary.target === "multipart-complete"
				) {
					interrupted = true;
					throw new IngestProcessingCrashSimulationError(
						"simulated interruption after the final claim",
					);
				}
			},
			input: buildCompletionInput(initialized),
			leaseDurationMs: 1_000,
			now: () => leaseStartedAt,
			process: async () => {
				throw new Error(
					"interrupted final claim unexpectedly reached processing",
				);
			},
			r2: fakeR2,
			userId,
		}),
	).rejects.toThrow("simulated interruption after the final claim");
	expect(interrupted).toBe(true);
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

function sha256(content: string | Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}
