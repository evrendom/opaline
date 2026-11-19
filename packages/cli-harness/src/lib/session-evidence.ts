import { rm } from "node:fs/promises";
import type { IngestSessionInput } from "@rudel/api-routes";
import { filterSessionTextFields } from "@rudel/secret-filter";
import type { Credentials } from "./credentials.js";
import { getRudelConfigDir } from "./local-state.js";
import { collectSessionRepositoryContext } from "./repo-context.js";
import {
	createRepositorySpoolBinding,
	createRepositorySpoolEnv,
	markRepositorySpoolCaptureAccepted,
} from "./repo-spool.js";
import {
	deferPendingRepositoryEvidence,
	normalizeRepositoryEvidenceEndpoint,
	readPendingRepositoryEvidence,
	writePendingRepositoryEvidence,
} from "./repository-evidence-pending.js";
import {
	buildRepositoryEvidenceUpload,
	getTranscriptDeliveryBudget,
	isRetryableRepositoryEvidenceError,
	uploadRepositoryEvidence,
} from "./repository-evidence-upload.js";
import {
	continueAcceptedTranscript,
	persistTranscriptSource,
	transcriptSourcePath,
} from "./transcript-continuation.js";
import { planTranscriptRevisionFile } from "./transcript-revision.js";
import {
	advanceTranscriptRevision,
	readTranscriptRevision,
	type TranscriptRevisionDeliveryScope,
} from "./transcript-revision-store.js";
import { allowsInsecureEndpointFromEnv } from "./upload-endpoint.js";

type EvidenceLifecycle = "start" | "resume" | "checkpoint" | "end";

const EVIDENCE_DELIVERY_BUDGET_MS = 20_000;

export async function captureAndUploadSessionEvidence(input: {
	readonly credentials: Credentials;
	readonly lifecycle: EvidenceLifecycle;
	readonly onWarning?: (message: string) => void;
	readonly organizationId: string;
	readonly request: Pick<
		IngestSessionInput,
		"content" | "projectPath" | "sessionId" | "source" | "subagents"
	>;
	readonly terminalTranscript: boolean;
}): Promise<{ readonly contextId: string; readonly receiptId: string }> {
	if (!input.credentials.user) {
		throw new Error("Repository evidence requires an authenticated CLI user.");
	}
	const configDir = getRudelConfigDir();
	const apiBase = process.env.RUDEL_API_BASE ?? input.credentials.apiBaseUrl;
	const endpoint = normalizeRepositoryEvidenceEndpoint(`${apiBase}/rpc`);
	const filtered = filterSessionTextFields({
		content: input.request.content,
		subagents: input.request.subagents,
	});
	const contextCapture = await collectSessionRepositoryContext({
		accountId: input.credentials.user.id,
		endpoint,
		lifecycle: input.lifecycle,
		organizationId: input.organizationId,
		repositoryPath: input.request.projectPath,
	});
	const scope = {
		actorId: input.credentials.user.id,
		provider: input.request.source,
		providerInstanceId: contextCapture.context.localIdentity.installationId,
		sessionId: input.request.sessionId,
	} as const;
	const deliveryScope: TranscriptRevisionDeliveryScope = {
		endpoint,
		organizationId: input.organizationId,
		transcriptScope: scope,
	};
	const previous = await readTranscriptRevision(deliveryScope);
	const sourceId = await persistTranscriptSource(filtered.content, configDir);
	let hasPending = false;
	try {
		const transcriptRevision = await planTranscriptRevisionFile({
			path: transcriptSourcePath(configDir, sourceId),
			limits: {
				maxDeliveryBytes: getTranscriptDeliveryBudget(contextCapture.bundle),
			},
			previous,
			scope,
			terminal: input.terminalTranscript,
		});
		const firstActionAt = findFirstTranscriptTimestamp(filtered.content);
		const timing = getFirstActionTiming(
			input.lifecycle,
			firstActionAt,
			contextCapture.bundle.manifest.completedAt,
		);
		const upload = buildRepositoryEvidenceUpload({
			bundle: contextCapture.bundle,
			captureLifecycle: input.lifecycle,
			context: contextCapture.context,
			firstActionAt: timing.firstActionAt,
			firstActionBasis: timing.firstActionBasis,
			firstActionRelationship: timing.firstActionRelationship,
			organizationId: input.organizationId,
			session: {
				...input.request,
				content: filtered.content,
				subagents: filtered.subagents ? [...filtered.subagents] : undefined,
			},
			terminalTranscript: input.terminalTranscript,
			transcriptLastEventAt: findLastTranscriptTimestamp(filtered.content),
			transcriptRevision,
		});
		const currentPending = {
			continuation: { sourceId, terminal: input.terminalTranscript },
			endpoint,
			transcriptRevision: transcriptRevision.manifest,
			upload,
		};
		if (transcriptRevision.delivery.status !== "complete") {
			input.onWarning?.(
				transcriptRevision.delivery.status === "deferred"
					? `Transcript evidence for session ${input.request.sessionId} exceeds one delivery; ${transcriptRevision.delivery.remainingBytes} bytes continue in later captures.`
					: `Transcript evidence for session ${input.request.sessionId} is blocked by a ${transcriptRevision.delivery.recordBytes}-byte record that exceeds the delivery limit.`,
			);
		}
		await writePendingRepositoryEvidence(currentPending, configDir);
		hasPending = true;
		const deadlineAt = Date.now() + EVIDENCE_DELIVERY_BUDGET_MS;
		const receipt = await uploadWithBoundedRetries(upload, input.credentials, {
			deadlineAt,
			endpoint,
		});
		await markRepositorySpoolCaptureAccepted(
			contextCapture.context.binding,
			contextCapture.stored.capture.captureId,
			"local-context",
			contextCapture.context.spoolEnv,
		);
		await advanceTranscriptRevision(
			transcriptRevision.manifest,
			deliveryScope,
			configDir,
		);
		await continueAcceptedTranscript(currentPending, configDir);
		let pendingError: unknown;
		try {
			pendingError = await retryOnePendingRepositoryEvidence(
				input.credentials,
				input.credentials.user.id,
				endpoint,
				configDir,
				deadlineAt,
				input.onWarning,
			);
		} catch (error) {
			pendingError = error;
		}
		if (pendingError !== undefined) throw pendingError;
		return {
			contextId: receipt.contextId,
			receiptId: receipt.receiptId,
		};
	} catch (error) {
		if (!hasPending)
			await rm(transcriptSourcePath(configDir, sourceId), { force: true });
		throw error;
	}
}

export async function retryPendingSessionEvidence(
	credentials: Credentials,
	options: {
		readonly allowInsecureEndpoint?: boolean;
		readonly endpoint?: string;
		readonly maxItems?: number;
		readonly onWarning?: (message: string) => void;
	} = {},
): Promise<number> {
	if (!credentials.user) {
		throw new Error("Repository evidence requires an authenticated CLI user.");
	}
	const configDir = getRudelConfigDir();
	const requestedEndpoint = normalizeRepositoryEvidenceEndpoint(
		options.endpoint ??
			`${process.env.RUDEL_API_BASE ?? credentials.apiBaseUrl}/rpc`,
	);
	let completed = 0;
	const failures: unknown[] = [];
	const maxItems = options.maxItems ?? 25;
	const attemptedOperationIds = new Set<string>();
	for (let attempted = 0; attempted < maxItems; attempted++) {
		const readErrors: unknown[] = [];
		const [pending] = await readPendingRepositoryEvidence(configDir, {
			actorId: credentials.user.id,
			endpoint: requestedEndpoint,
			excludeOperationIds: attemptedOperationIds,
			maxItems: 1,
			onError: (error) => readErrors.push(error),
			onWarning: (warning) => options.onWarning?.(warning.message),
		});
		failures.push(...readErrors);
		if (!pending) {
			if (readErrors.length > 0) continue;
			break;
		}
		attemptedOperationIds.add(pending.upload.input.operationId);
		try {
			await uploadWithBoundedRetries(pending.upload, credentials, {
				allowInsecureEndpoint: options.allowInsecureEndpoint,
				endpoint: pending.endpoint,
			});
			await markPendingRepositoryCaptureAccepted(pending, configDir);
			await advanceTranscriptRevision(
				pending.transcriptRevision,
				getPendingDeliveryScope(pending),
				configDir,
			);
			await continueAcceptedTranscript(pending, configDir);
			completed++;
		} catch (error) {
			failures.push(error);
			await deferPendingRepositoryEvidence(pending, configDir);
		}
	}
	if (failures.length > 0) {
		throw new AggregateError(
			failures,
			`${failures.length} pending repository evidence capture(s) remain.`,
		);
	}
	return completed;
}

async function retryOnePendingRepositoryEvidence(
	credentials: Credentials,
	actorId: string,
	endpoint: string,
	configDir: string,
	deadlineAt: number,
	onWarning: ((message: string) => void) | undefined,
): Promise<unknown | undefined> {
	if (Date.now() >= deadlineAt) return undefined;
	const failures: unknown[] = [];
	for (const pending of await readPendingRepositoryEvidence(configDir, {
		actorId,
		endpoint,
		maxItems: 1,
		onError: (error) => failures.push(error),
		onWarning: (warning) => onWarning?.(warning.message),
	})) {
		try {
			await uploadWithBoundedRetries(pending.upload, credentials, {
				deadlineAt,
				endpoint: pending.endpoint,
			});
			await markPendingRepositoryCaptureAccepted(pending, configDir);
			await advanceTranscriptRevision(
				pending.transcriptRevision,
				getPendingDeliveryScope(pending),
				configDir,
			);
			await continueAcceptedTranscript(pending, configDir);
		} catch (error) {
			failures.push(error);
			await deferPendingRepositoryEvidence(pending, configDir);
		}
	}
	return failures[0];
}

async function markPendingRepositoryCaptureAccepted(
	pending: Awaited<ReturnType<typeof readPendingRepositoryEvidence>>[number],
	configDir: string,
): Promise<void> {
	const binding = await createRepositorySpoolBinding({
		accountId: pending.transcriptRevision.scope.actorId,
		apiBaseUrl: pending.endpoint,
		localIdentity: pending.upload.input.repository.local,
		workspaceId: pending.upload.input.organizationId,
	});
	await markRepositorySpoolCaptureAccepted(
		binding,
		pending.upload.input.capture.contextId,
		"local-context",
		createRepositorySpoolEnv(configDir),
	);
}

async function uploadWithBoundedRetries(
	upload: ReturnType<typeof buildRepositoryEvidenceUpload>,
	credentials: Credentials,
	overrides: {
		readonly allowInsecureEndpoint?: boolean;
		readonly deadlineAt?: number;
		readonly endpoint?: string;
	} = {},
) {
	const apiBase = process.env.RUDEL_API_BASE ?? credentials.apiBaseUrl;
	const config = {
		allowInsecureEndpoint:
			overrides.allowInsecureEndpoint ?? allowsInsecureEndpointFromEnv(),
		authType: credentials.authType,
		endpoint: overrides.endpoint ?? `${apiBase}/rpc`,
		token: credentials.token,
	};
	let lastError: unknown;
	for (let attempt = 1; attempt <= 3; attempt++) {
		const remainingMs = overrides.deadlineAt
			? overrides.deadlineAt - Date.now()
			: undefined;
		if (remainingMs !== undefined && remainingMs <= 0) {
			throw deliveryBudgetExceeded();
		}
		try {
			return await uploadRepositoryEvidence(upload, {
				...config,
				operationTimeoutMs: remainingMs,
			});
		} catch (error) {
			lastError = error;
			if (!isRetryableRepositoryEvidenceError(error) || attempt === 3) break;
			const retryDelayMs = overrides.deadlineAt
				? Math.min(attempt * 100, overrides.deadlineAt - Date.now())
				: attempt * 100;
			if (retryDelayMs <= 0) throw deliveryBudgetExceeded();
			await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
		}
	}
	throw lastError;
}

function getPendingDeliveryScope(
	pending: Awaited<ReturnType<typeof readPendingRepositoryEvidence>>[number],
): TranscriptRevisionDeliveryScope {
	return {
		endpoint: pending.endpoint,
		organizationId: pending.upload.input.organizationId,
		transcriptScope: pending.transcriptRevision.scope,
	};
}

function deliveryBudgetExceeded(): Error {
	return new Error(
		`Repository evidence delivery exceeded its ${EVIDENCE_DELIVERY_BUDGET_MS}ms budget.`,
	);
}

function getFirstActionTiming(
	lifecycle: EvidenceLifecycle,
	firstActionAt: string | null,
	captureCompletedAt: string,
) {
	if (lifecycle === "start") {
		return {
			firstActionAt: null,
			firstActionBasis: "unavailable" as const,
			firstActionRelationship: "unknown" as const,
		};
	}
	if (
		firstActionAt !== null &&
		Date.parse(captureCompletedAt) >= Date.parse(firstActionAt)
	) {
		return {
			firstActionAt,
			firstActionBasis: "transcript-watermark" as const,
			firstActionRelationship: "after-first-action" as const,
		};
	}
	return {
		firstActionAt: null,
		firstActionBasis: "unavailable" as const,
		firstActionRelationship: "unknown" as const,
	};
}

function findFirstTranscriptTimestamp(content: string): string | null {
	for (const line of transcriptLines(content)) {
		const timestamp = readTimestamp(line);
		if (timestamp !== null) return timestamp;
	}
	return null;
}

function findLastTranscriptTimestamp(content: string): string | null {
	let latest: string | null = null;
	for (const line of transcriptLines(content)) {
		const timestamp = readTimestamp(line);
		if (timestamp !== null) latest = timestamp;
	}
	return latest;
}

function* transcriptLines(content: string): Generator<string> {
	for (let cursor = 0; cursor < content.length; ) {
		const newline = content.indexOf("\n", cursor);
		const end = newline < 0 ? content.length : newline + 1;
		yield content.slice(cursor, end);
		cursor = end;
	}
}

function readTimestamp(line: string): string | null {
	if (!line.trim()) return null;
	try {
		const value: unknown = JSON.parse(line);
		if (
			typeof value === "object" &&
			value !== null &&
			"timestamp" in value &&
			typeof value.timestamp === "string" &&
			!Number.isNaN(Date.parse(value.timestamp))
		) {
			return value.timestamp;
		}
	} catch {
		return null;
	}
	return null;
}
