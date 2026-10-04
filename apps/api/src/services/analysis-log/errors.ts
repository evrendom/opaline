import { ORPCError } from "@orpc/server";

/**
 * An error whose message names what failed and nothing else, so it may be
 * logged and persisted: store arguments and results can quote transcripts.
 */
export class SanitizedError extends Error {
	override name = "SanitizedError";
}

/** A store refused a query, step or session link because its analysis holds the most it may. */
export class AnalysisFullError extends SanitizedError {
	override name = "AnalysisFullError";
	constructor(readonly child: "queries" | "steps" | "sessions") {
		super(`The analysis already holds the most ${child} it may`);
	}
}

/** What may be logged about an error: a sanitized message, or only its class and code. */
export function loggableError(error: unknown): string {
	if (error instanceof SanitizedError) return error.message;
	if (error instanceof ORPCError) return `ORPCError ${error.code}`;
	return error instanceof Error ? error.name : typeof error;
}
