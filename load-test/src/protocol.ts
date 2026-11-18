import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ClickHousePartSnapshot } from "./clickhouse-observer.ts";
import { readClickHousePartSnapshot } from "./clickhouse-observer.ts";
import {
	type JsonRequestResult,
	postRpc,
	putR2Part,
	type RequestContext,
	type RequestMeasurement,
} from "./http.ts";
import type {
	LoadedTranscriptManifest,
	ResolvedTranscriptObject,
} from "./manifest.ts";
import { startRssMonitor } from "./rss.ts";
import type { RunOptions, UploadResult } from "./run-types.ts";
import { isLoopbackHostname } from "./safety.ts";
import { type ScheduledStart, scheduleOpenLoop } from "./scheduler.ts";
import { buildLoadTestSummary, printLoadTestTables } from "./summary.ts";

interface InitPart {
	readonly byteLength: number;
	readonly contentLength: string;
	readonly partNumber: number;
	readonly uploadUrl: string;
}

interface InitObject {
	readonly agentId: string | null;
	readonly byteLength: number;
	readonly kind: "main" | "subagent";
	readonly objectKey: string;
	readonly parts: readonly InitPart[];
	readonly sha256: string;
	readonly uploadId: string;
}

interface InitOutput {
	readonly jobId: string;
	readonly objects: readonly InitObject[];
	readonly protocol: "r2_multipart_v1";
}

interface CompletedPart {
	readonly etag: string;
	readonly partNumber: number;
}

interface CompletedObject {
	readonly objectKey: string;
	readonly parts: readonly CompletedPart[];
	readonly uploadId: string;
}

interface StatusOutput {
	readonly errorCode: string | null;
	readonly errorMessage: string | null;
	readonly jobId: string;
	readonly status: "completed" | "failed" | "pending" | "running";
}

type PreparedJob =
	| {
			readonly completionObjects: readonly CompletedObject[];
			readonly index: number;
			readonly initMs: number;
			readonly jobId: string;
			readonly kind: "prepared";
			readonly multipartMs: number;
			readonly sessionId: string;
			readonly start: UploadStart;
	  }
	| { readonly kind: "finished"; readonly result: UploadResult };

interface UploadStart {
	readonly actualStartMs: number;
	readonly plannedStartOffsetMs: number | null;
	readonly scheduleDriftMs: number | null;
	readonly startedOffsetMs: number;
}

export async function executeLoadTest(options: RunOptions): Promise<boolean> {
	const runStartedAt = performance.now();
	const measurements: RequestMeasurement[] = [];
	const rssMonitor = startRssMonitor(options.processingPids);
	let clickHouseBefore: ClickHousePartSnapshot | null = null;
	let clickHouseAfter: ClickHousePartSnapshot | null = null;
	let results: readonly UploadResult[] = [];
	let unexpectedError: unknown = null;

	try {
		if (options.clickHouseObserver) {
			clickHouseBefore = await readClickHousePartSnapshot(
				options.clickHouseObserver,
			);
		}
		results =
			options.barrierBeforeCommit || options.sameSessionHash
				? await runWithCommitBarrier(options, measurements, runStartedAt)
				: await runStreaming(options, measurements, runStartedAt);
		if (options.clickHouseObserver) {
			await Bun.sleep(options.clickHouseSettleMs);
			clickHouseAfter = await readClickHousePartSnapshot(
				options.clickHouseObserver,
			);
		}
	} catch (error) {
		unexpectedError = error;
	}
	const rss = await rssMonitor.stop();
	const summary = buildLoadTestSummary({
		clickHouseAfter,
		clickHouseBefore,
		durationMs: performance.now() - runStartedAt,
		measurements,
		options,
		results,
		rss,
	});
	await mkdir(dirname(options.summaryPath), { recursive: true });
	await Bun.write(options.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
	printLoadTestTables(summary, options.summaryPath);
	if (unexpectedError !== null) throw unexpectedError;
	return summary.passed;
}

async function runWithCommitBarrier(
	options: RunOptions,
	measurements: RequestMeasurement[],
	runStartedAt: number,
): Promise<readonly UploadResult[]> {
	const indices = Array.from({ length: options.uploads }, (_, index) => index);
	const prepared = await mapBounded(indices, options.concurrency, (index) => {
		const start = createUnscheduledStart(runStartedAt);
		return prepareJob(index, options, measurements, runStartedAt, start);
	});
	return mapBounded(prepared, options.concurrency, (job) =>
		job.kind === "finished"
			? Promise.resolve(job.result)
			: commitPreparedJob(job, options, measurements, runStartedAt),
	);
}

async function runStreaming(
	options: RunOptions,
	measurements: RequestMeasurement[],
	runStartedAt: number,
): Promise<readonly UploadResult[]> {
	const indices = Array.from({ length: options.uploads }, (_, index) => index);
	if (options.ratePerSecond === null) {
		return mapBounded(indices, options.concurrency, (index) =>
			runJob(
				index,
				options,
				measurements,
				runStartedAt,
				createUnscheduledStart(runStartedAt),
			),
		);
	}
	const scheduled = await scheduleOpenLoop(
		{
			maxInFlight: options.maxInFlight,
			operationCount: options.uploads,
			ratePerSecond: options.ratePerSecond,
		},
		(start) =>
			runJob(
				start.index,
				options,
				measurements,
				runStartedAt,
				createScheduledStart(start, runStartedAt),
			),
	);
	return scheduled.map((operation) => operation.value);
}

async function runJob(
	index: number,
	options: RunOptions,
	measurements: RequestMeasurement[],
	runStartedAt: number,
	start: UploadStart,
): Promise<UploadResult> {
	const prepared = await prepareJob(
		index,
		options,
		measurements,
		runStartedAt,
		start,
	);
	return prepared.kind === "finished"
		? prepared.result
		: commitPreparedJob(prepared, options, measurements, runStartedAt);
}

async function prepareJob(
	index: number,
	options: RunOptions,
	measurements: RequestMeasurement[],
	runStartedAt: number,
	start: UploadStart,
): Promise<PreparedJob> {
	const sessionId = resolveSessionId(options, index);
	const context = createRequestContext(
		index,
		options.requestTimeoutMs,
		runStartedAt,
		measurements,
	);
	const init = await postRpc({
		apiKey: options.apiKey,
		attempt: 1,
		baseUrl: options.baseUrl,
		context,
		parse: parseInitOutput,
		path: "ingest/init",
		payload: buildInitPayload(
			options.manifest,
			sessionId,
			options.organizationId,
		),
	});
	if (init.kind === "failure") {
		return {
			kind: "finished",
			result: createEarlyFailure({
				classification: "init_failed",
				errorCode: init.errorCode,
				errorMessage: init.errorMessage,
				index,
				initMs: init.durationMs,
				jobId: null,
				multipartMs: 0,
				nonTerminal: false,
				nonTerminalReason: null,
				sessionId,
				start,
			}),
		};
	}

	const multipartStartedAt = performance.now();
	const completion = await uploadMultipartObjects(
		init.data,
		options.manifest,
		options.partConcurrency,
		context,
	);
	const multipartMs = performance.now() - multipartStartedAt;
	if (completion.kind === "failure") {
		const status = await readStatusOnce(init.data.jobId, options, context, 1);
		return {
			kind: "finished",
			result: createEarlyFailure({
				classification: "multipart_failed",
				errorCode: status?.errorCode ?? null,
				errorMessage: completion.message,
				finalStatus: status?.status,
				index,
				initMs: init.durationMs,
				jobId: init.data.jobId,
				multipartMs,
				nonTerminal: !isTerminalStatus(status?.status),
				nonTerminalReason: isTerminalStatus(status?.status)
					? null
					: "Multipart state exists but the job was not observed in a terminal status",
				sessionId,
				start,
			}),
		};
	}

	return {
		completionObjects: completion.objects,
		index,
		initMs: init.durationMs,
		jobId: init.data.jobId,
		kind: "prepared",
		multipartMs,
		sessionId,
		start,
	};
}

async function commitPreparedJob(
	job: Extract<PreparedJob, { kind: "prepared" }>,
	options: RunOptions,
	measurements: RequestMeasurement[],
	runStartedAt: number,
): Promise<UploadResult> {
	const context = createRequestContext(
		job.index,
		options.requestTimeoutMs,
		runStartedAt,
		measurements,
	);
	let firstCommitMs: number | null = null;
	let lastFailure: JsonRequestResult<unknown> | null = null;
	for (let attempt = 1; attempt <= options.commitAttempts; attempt += 1) {
		const commit = await postRpc({
			apiKey: options.apiKey,
			attempt,
			baseUrl: options.baseUrl,
			context,
			parse: (value) => parseCommitOutput(value, job.jobId),
			path: "ingest/commit",
			payload: { jobId: job.jobId, objects: job.completionObjects },
		});
		if (firstCommitMs === null) firstCommitMs = commit.durationMs;
		if (commit.kind === "success") {
			const status = await readStatusOnce(job.jobId, options, context, attempt);
			return status?.status === "completed"
				? createCompletedResult(job, firstCommitMs, attempt)
				: createCommitFailureResult({
						attempt,
						classification: "status_failed",
						errorCode: status?.errorCode ?? "STATUS_NOT_COMPLETED",
						errorMessage:
							status?.errorMessage ??
							"Status endpoint did not confirm completion",
						firstCommitMs,
						job,
						status: status?.status,
					});
		}

		lastFailure = commit;
		const status = await readStatusOnce(job.jobId, options, context, attempt);
		if (status?.status === "completed") {
			return createCompletedResult(job, firstCommitMs, attempt);
		}
		if (status?.status === "failed" || !isRetryableCommitFailure(commit)) {
			return createCommitFailureResult({
				attempt,
				classification: "commit_failed",
				errorCode: status?.errorCode ?? commit.errorCode,
				errorMessage: status?.errorMessage ?? commit.errorMessage,
				firstCommitMs,
				job,
				status: status?.status,
			});
		}
		if (attempt < options.commitAttempts) {
			await Bun.sleep(commit.retryAfterMs ?? getRetryDelayMs(attempt));
		}
	}

	const finalStatus = await waitForTerminalStatus(job.jobId, options, context);
	if (finalStatus?.status === "completed") {
		return createCompletedResult(job, firstCommitMs, options.commitAttempts);
	}
	const failure =
		lastFailure?.kind === "failure"
			? lastFailure
			: {
					errorCode: "COMMIT_ATTEMPTS_EXHAUSTED",
					errorMessage: "Commit attempts were exhausted",
				};
	return createCommitFailureResult({
		attempt: options.commitAttempts,
		classification: "commit_failed",
		errorCode: finalStatus?.errorCode ?? failure.errorCode,
		errorMessage: finalStatus?.errorMessage ?? failure.errorMessage,
		firstCommitMs,
		job,
		status: finalStatus?.status,
	});
}

async function uploadMultipartObjects(
	initialized: InitOutput,
	manifest: LoadedTranscriptManifest,
	partConcurrency: number,
	context: RequestContext,
): Promise<
	| { readonly kind: "success"; readonly objects: readonly CompletedObject[] }
	| { readonly kind: "failure"; readonly message: string }
> {
	const work = initialized.objects.flatMap((object) => {
		const transcript = findTranscriptObject(manifest.objects, object);
		validateInitializedObject(object, transcript);
		let offset = 0;
		return object.parts.map((part) => {
			const start = offset;
			offset += part.byteLength;
			return { object, part, start, transcript };
		});
	});
	const uploaded = await mapBounded(work, partConcurrency, async (item) => {
		const file = Bun.file(item.transcript.absolutePath);
		const result = await putR2Part({
			attempt: 1,
			body: file.slice(item.start, item.start + item.part.byteLength),
			byteLength: item.part.byteLength,
			contentLength: item.part.contentLength,
			context,
			objectKey: item.object.objectKey,
			partNumber: item.part.partNumber,
			uploadUrl: item.part.uploadUrl,
		});
		return { item, result };
	});
	const failure = uploaded.find((upload) => upload.result.kind === "failure");
	if (failure?.result.kind === "failure") {
		return { kind: "failure", message: failure.result.errorMessage };
	}

	const objects: CompletedObject[] = [];
	for (const object of initialized.objects) {
		const parts: CompletedPart[] = [];
		for (const upload of uploaded) {
			if (upload.item.object.objectKey !== object.objectKey) continue;
			if (upload.result.kind !== "success") {
				throw new Error("Successful multipart result contains a failed part");
			}
			parts.push({
				etag: upload.result.etag,
				partNumber: upload.item.part.partNumber,
			});
		}
		parts.sort((left, right) => left.partNumber - right.partNumber);
		objects.push({
			objectKey: object.objectKey,
			parts,
			uploadId: object.uploadId,
		});
	}
	return { kind: "success", objects };
}

async function waitForTerminalStatus(
	jobId: string,
	options: RunOptions,
	context: RequestContext,
): Promise<StatusOutput | null> {
	const deadline = performance.now() + options.statusWaitMs;
	let attempt = 1;
	let lastStatus: StatusOutput | null = null;
	do {
		lastStatus = await readStatusOnce(jobId, options, context, attempt);
		if (lastStatus?.status === "completed" || lastStatus?.status === "failed") {
			return lastStatus;
		}
		attempt += 1;
		if (performance.now() < deadline) await Bun.sleep(1_000);
	} while (performance.now() < deadline);
	return lastStatus;
}

async function readStatusOnce(
	jobId: string,
	options: RunOptions,
	context: RequestContext,
	attempt: number,
): Promise<StatusOutput | null> {
	const status = await postRpc({
		apiKey: options.apiKey,
		attempt,
		baseUrl: options.baseUrl,
		context,
		parse: (value) => parseStatusOutput(value, jobId),
		path: "ingest/status",
		payload: { jobId },
	});
	return status.kind === "success" ? status.data : null;
}

function buildInitPayload(
	manifest: LoadedTranscriptManifest,
	sessionId: string,
	organizationId: string | undefined,
): Record<string, unknown> {
	return {
		...manifest.manifest.metadata,
		...(organizationId ? { organizationId } : {}),
		cli_version: "opaline-r2-load-test-v1",
		objects: manifest.objects.map((object) => ({
			...(object.agentId ? { agentId: object.agentId } : {}),
			byteLength: object.byteLength,
			kind: object.kind,
			sha256: object.sha256,
		})),
		sessionId,
	};
}

function resolveSessionId(options: RunOptions, index: number): string {
	const base = options.manifest.manifest.metadata.sessionId;
	return options.sameSessionHash
		? base
		: `${base}-${index.toString().padStart(6, "0")}`;
}

function findTranscriptObject(
	objects: readonly ResolvedTranscriptObject[],
	initialized: InitObject,
): ResolvedTranscriptObject {
	const found = objects.find(
		(object) =>
			object.kind === initialized.kind &&
			object.agentId === initialized.agentId,
	);
	if (!found) {
		throw new Error(
			`Init response returned an unknown ${initialized.kind} object (${initialized.agentId ?? "main"})`,
		);
	}
	return found;
}

function validateInitializedObject(
	initialized: InitObject,
	transcript: ResolvedTranscriptObject,
): void {
	if (
		initialized.byteLength !== transcript.byteLength ||
		initialized.sha256 !== transcript.sha256
	) {
		throw new Error(
			`Init response changed the declared size or SHA-256 for ${transcript.path}`,
		);
	}
	const partBytes = initialized.parts.reduce(
		(total, part) => total + part.byteLength,
		0,
	);
	if (partBytes !== transcript.byteLength) {
		throw new Error(`Init response part sizes do not cover ${transcript.path}`);
	}
}

function createCompletedResult(
	job: Extract<PreparedJob, { kind: "prepared" }>,
	firstCommitMs: number | null,
	commitAttempts: number,
): UploadResult {
	return {
		classification: "completed",
		commitAttempts,
		e2eMs: performance.now() - job.start.actualStartMs,
		errorCode: null,
		errorMessage: null,
		finalStatus: "completed",
		firstCommitMs,
		index: job.index,
		initMs: job.initMs,
		jobId: job.jobId,
		multipartMs: job.multipartMs,
		nonTerminal: false,
		nonTerminalReason: null,
		plannedStartOffsetMs: job.start.plannedStartOffsetMs,
		scheduleDriftMs: job.start.scheduleDriftMs,
		sessionId: job.sessionId,
		startedOffsetMs: job.start.startedOffsetMs,
	};
}

function createCommitFailureResult(input: {
	readonly attempt: number;
	readonly classification: "commit_failed" | "status_failed";
	readonly errorCode: string | null;
	readonly errorMessage: string;
	readonly firstCommitMs: number | null;
	readonly job: Extract<PreparedJob, { kind: "prepared" }>;
	readonly status: StatusOutput["status"] | undefined;
}): UploadResult {
	const terminal = isTerminalStatus(input.status);
	return {
		classification: input.classification,
		commitAttempts: input.attempt,
		e2eMs: performance.now() - input.job.start.actualStartMs,
		errorCode: input.errorCode,
		errorMessage: input.errorMessage,
		finalStatus: input.status ?? "unavailable",
		firstCommitMs: input.firstCommitMs,
		index: input.job.index,
		initMs: input.job.initMs,
		jobId: input.job.jobId,
		multipartMs: input.job.multipartMs,
		nonTerminal: !terminal,
		nonTerminalReason: terminal
			? null
			: "Uploaded multipart objects belong to a job that was not observed in a terminal status",
		plannedStartOffsetMs: input.job.start.plannedStartOffsetMs,
		scheduleDriftMs: input.job.start.scheduleDriftMs,
		sessionId: input.job.sessionId,
		startedOffsetMs: input.job.start.startedOffsetMs,
	};
}

function createEarlyFailure(input: {
	readonly classification: "init_failed" | "multipart_failed";
	readonly errorCode: string | null;
	readonly errorMessage: string;
	readonly finalStatus?: StatusOutput["status"];
	readonly index: number;
	readonly initMs: number;
	readonly jobId: string | null;
	readonly multipartMs: number;
	readonly nonTerminal: boolean;
	readonly nonTerminalReason: string | null;
	readonly sessionId: string;
	readonly start: UploadStart;
}): UploadResult {
	return {
		classification: input.classification,
		commitAttempts: 0,
		e2eMs: performance.now() - input.start.actualStartMs,
		errorCode: input.errorCode,
		errorMessage: input.errorMessage,
		finalStatus: input.finalStatus ?? "unavailable",
		firstCommitMs: null,
		index: input.index,
		initMs: input.initMs,
		jobId: input.jobId,
		multipartMs: input.multipartMs,
		nonTerminal: input.nonTerminal,
		nonTerminalReason: input.nonTerminalReason,
		plannedStartOffsetMs: input.start.plannedStartOffsetMs,
		scheduleDriftMs: input.start.scheduleDriftMs,
		sessionId: input.sessionId,
		startedOffsetMs: input.start.startedOffsetMs,
	};
}

function createUnscheduledStart(runStartedAt: number): UploadStart {
	const actualStartMs = performance.now();
	return {
		actualStartMs,
		plannedStartOffsetMs: null,
		scheduleDriftMs: null,
		startedOffsetMs: actualStartMs - runStartedAt,
	};
}

function createScheduledStart(
	start: ScheduledStart,
	runStartedAt: number,
): UploadStart {
	return {
		actualStartMs: start.actualStartMs,
		plannedStartOffsetMs: start.plannedStartMs - runStartedAt,
		scheduleDriftMs: start.scheduleDriftMs,
		startedOffsetMs: start.actualStartMs - runStartedAt,
	};
}

function isTerminalStatus(status: StatusOutput["status"] | undefined): boolean {
	return status === "completed" || status === "failed";
}

function createRequestContext(
	uploadIndex: number,
	requestTimeoutMs: number,
	runStartedAt: number,
	measurements: RequestMeasurement[],
): RequestContext {
	return {
		record: (measurement) => measurements.push(measurement),
		requestTimeoutMs,
		runStartedAt,
		uploadIndex,
	};
}

function isRetryableCommitFailure(
	result: Extract<JsonRequestResult<unknown>, { kind: "failure" }>,
): boolean {
	if (result.status === null) return true;
	return result.status === 408 || result.status === 429 || result.status >= 500;
}

function getRetryDelayMs(attempt: number): number {
	return Math.min(1_000 * 2 ** (attempt - 1), 10_000);
}

async function mapBounded<TInput, TOutput>(
	inputs: readonly TInput[],
	concurrency: number,
	operation: (input: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
	const results: Array<TOutput | undefined> = Array.from({
		length: inputs.length,
	});
	let nextIndex = 0;
	const workers = Array.from(
		{ length: Math.min(concurrency, inputs.length) },
		async () => {
			while (nextIndex < inputs.length) {
				const index = nextIndex;
				nextIndex += 1;
				const input = inputs[index];
				if (input === undefined)
					throw new Error("Bounded work item is missing");
				results[index] = await operation(input);
			}
		},
	);
	await Promise.all(workers);
	return results.map((result) => {
		if (result === undefined) throw new Error("Bounded work result is missing");
		return result;
	});
}

function parseInitOutput(value: unknown): InitOutput {
	if (!isRecord(value)) throw new Error("init output must be an object");
	if (value.protocol !== "r2_multipart_v1") {
		throw new Error("init output has an unsupported protocol");
	}
	const objectsValue = value.objects;
	if (!Array.isArray(objectsValue) || objectsValue.length === 0) {
		throw new Error("init output objects must be a non-empty array");
	}
	return {
		jobId: readString(value, "jobId"),
		objects: objectsValue.map(parseInitObject),
		protocol: "r2_multipart_v1",
	};
}

function parseInitObject(value: unknown): InitObject {
	if (!isRecord(value)) throw new Error("init object must be an object");
	const kind = readString(value, "kind");
	if (kind !== "main" && kind !== "subagent") {
		throw new Error("init object kind is invalid");
	}
	const agentId = kind === "subagent" ? readString(value, "agentId") : null;
	const partsValue = value.parts;
	if (!Array.isArray(partsValue) || partsValue.length === 0) {
		throw new Error("init object parts must be a non-empty array");
	}
	return {
		agentId,
		byteLength: readPositiveInteger(value, "byteLength"),
		kind,
		objectKey: readString(value, "objectKey"),
		parts: partsValue.map(parseInitPart),
		sha256: readSha256(value, "sha256"),
		uploadId: readString(value, "uploadId"),
	};
}

function parseInitPart(value: unknown): InitPart {
	if (!isRecord(value)) throw new Error("init part must be an object");
	const headers = value.headers;
	if (!isRecord(headers)) throw new Error("init part headers are invalid");
	return {
		byteLength: readPositiveInteger(value, "byteLength"),
		contentLength: readString(headers, "Content-Length"),
		partNumber: readPositiveInteger(value, "partNumber"),
		uploadUrl: readSafeUploadUrl(value),
	};
}

function parseCommitOutput(value: unknown, expectedJobId: string): unknown {
	if (
		!isRecord(value) ||
		value.status !== "completed" ||
		value.protocol !== "r2_multipart_v1" ||
		value.jobId !== expectedJobId ||
		!isRecord(value.result) ||
		value.result.success !== true
	) {
		throw new Error("commit output did not report completed");
	}
	return value;
}

function readSafeUploadUrl(value: Record<string, unknown>): string {
	const rawUrl = readString(value, "uploadUrl");
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error("uploadUrl must be a valid URL");
	}
	if (url.username || url.password) {
		throw new Error("uploadUrl must not contain embedded credentials");
	}
	if (
		url.protocol !== "https:" &&
		!(url.protocol === "http:" && isLoopbackHostname(url.hostname))
	) {
		throw new Error("uploadUrl must use HTTPS unless it targets loopback");
	}
	return rawUrl;
}

function parseStatusOutput(
	value: unknown,
	expectedJobId: string,
): StatusOutput {
	if (!isRecord(value)) throw new Error("status output must be an object");
	const status = readString(value, "status");
	if (
		status !== "completed" &&
		status !== "failed" &&
		status !== "pending" &&
		status !== "running"
	) {
		throw new Error("status output has an invalid status");
	}
	const error = value.error;
	const jobId = readString(value, "jobId");
	if (jobId !== expectedJobId) {
		throw new Error("status output returned a different job ID");
	}
	return {
		errorCode: isRecord(error) ? readString(error, "code") : null,
		errorMessage: isRecord(error) ? readString(error, "message") : null,
		jobId,
		status,
	};
}

function readString(value: Record<string, unknown>, key: string): string {
	const field = value[key];
	if (typeof field !== "string" || !field) {
		throw new Error(`${key} must be a non-empty string`);
	}
	return field;
}

function readPositiveInteger(
	value: Record<string, unknown>,
	key: string,
): number {
	const field = value[key];
	if (typeof field !== "number" || !Number.isSafeInteger(field) || field <= 0) {
		throw new Error(`${key} must be a positive integer`);
	}
	return field;
}

function readSha256(value: Record<string, unknown>, key: string): string {
	const field = readString(value, key);
	if (!/^[a-f0-9]{64}$/u.test(field)) throw new Error(`${key} must be SHA-256`);
	return field;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
