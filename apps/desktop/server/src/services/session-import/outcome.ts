import { ORPCError } from "@orpc/server";
import type { SessionImportOverrides } from "./dependencies.js";
import type { IngestErrorFactories } from "./errors.js";
import {
	processIngestSession,
	type SessionImportRequest,
} from "./import-session.js";

export type RejectionReason =
	| "redaction_budget_exceeded"
	| "redaction_did_not_converge"
	| "json_integrity"
	| "ownership_conflict"
	| "shorter_than_stored";

export type SessionImportOutcome =
	| { readonly kind: "stored"; readonly usage: "complete" | "incomplete" }
	| {
			readonly kind: "kept";
			readonly reason: "shorter_than_stored";
			readonly message: string;
	  }
	| {
			readonly kind: "skipped";
			readonly reason:
				| Exclude<RejectionReason, "shorter_than_stored">
				| "invalid";
			readonly message: string;
	  }
	| {
			readonly kind: "retry";
			readonly reason: "queue_full" | "failed";
			readonly message: string;
	  };

export class SessionImportRejected extends Error {
	constructor(
		readonly reason: RejectionReason,
		message: string,
	) {
		super(message);
		this.name = "SessionImportRejected";
	}
}

const rejections: IngestErrorFactories = {
	redactionBudgetExceeded: () =>
		new SessionImportRejected(
			"redaction_budget_exceeded",
			"Transcript redaction exceeded the safety budget",
		),
	redactionDidNotConverge: () =>
		new SessionImportRejected(
			"redaction_did_not_converge",
			"Transcript redaction did not converge",
		),
	secretFilterJsonIntegrity: () =>
		new SessionImportRejected(
			"json_integrity",
			"Transcript redaction changed JSON structure",
		),
	sessionOwnershipConflict: () =>
		new SessionImportRejected(
			"ownership_conflict",
			"Session belongs to another organization member",
		),
	sessionUploadShrinkRejected: () =>
		new SessionImportRejected(
			"shorter_than_stored",
			"Replacement transcript is unexpectedly smaller",
		),
};

const QUEUE_FULL = new Set([
	"ingest_filter_queue_full",
	"usage_extraction_queue_full",
]);
const MESSAGE_LIMIT = 500;

function dataReason(error: ORPCError<string, unknown>): unknown {
	return (error.data as { reason?: unknown } | undefined)?.reason;
}

export function outcomeOfError(error: unknown): SessionImportOutcome {
	const message = (
		error instanceof Error ? error.message : String(error)
	).slice(0, MESSAGE_LIMIT);
	if (error instanceof SessionImportRejected)
		return error.reason === "shorter_than_stored"
			? { kind: "kept", reason: error.reason, message }
			: { kind: "skipped", reason: error.reason, message };
	if (error instanceof ORPCError) {
		const reason = dataReason(error);
		if (error.code === "SERVICE_UNAVAILABLE") {
			if (reason === "usage_extraction_incomplete")
				return { kind: "stored", usage: "incomplete" };
			if (typeof reason === "string" && QUEUE_FULL.has(reason))
				return { kind: "retry", reason: "queue_full", message };
		}
		if (error.code === "BAD_REQUEST" || error.code === "CONFLICT")
			return { kind: "skipped", reason: "invalid", message };
	}
	return { kind: "retry", reason: "failed", message };
}

export async function importSession(
	request: Omit<SessionImportRequest, "errorFactories">,
	overrides: SessionImportOverrides = {},
): Promise<SessionImportOutcome> {
	try {
		await processIngestSession(
			{ ...request, errorFactories: rejections },
			overrides,
		);
		return { kind: "stored", usage: "complete" };
	} catch (error) {
		return outcomeOfError(error);
	}
}
