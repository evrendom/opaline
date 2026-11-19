import { getLogger } from "@logtape/logtape";
import { ORPCError } from "@orpc/server";
import type { Source } from "@rudel/api-routes";
import type postgres from "postgres";
import { sqlClient } from "../../db.js";
import { canSee } from "./analysis-log.service.js";
import { getAnalysisLog, getConfiguredAnalysisLog } from "./config.js";
import { AnalysisFullError, loggableError } from "./errors.js";
import type { AnalysisLog } from "./types.js";

const logger = getLogger(["rudel", "api", "analysis-log", "uploads"]);

/** Why an upload naming an analysis is refused where the log is off; the CLI shows it. */
export const ANALYSIS_UPLOAD_LOG_OFF =
	"Analysis history is off for this workspace, so a chat cannot be attached to an analysis. Upload without --analysis.";
export const ANALYSIS_UPLOAD_NOT_FOUND =
	"Analysis not found, or not visible to you. Check the analysis id, and that you are its author or it is shared with your workspace.";

/**
 * Uploads that name an analysis (`analysisId`): the chat in which an analysis
 * ran is uploaded into that analysis's workspace and listed with it.
 */
export interface AnalysisUploadEnv {
	/** The configured log, used before the analysis's workspace is known. */
	log: AnalysisLog | null;
	/** Whether the log is on for the workspace (`ANALYSIS_LOG_WORKSPACES`). */
	enabledFor: (workspaceId: string) => boolean;
	isMember: (workspaceId: string, userId: string) => Promise<boolean>;
}

export function createAnalysisUploadEnv(
	database: postgres.Sql = sqlClient,
): AnalysisUploadEnv {
	return {
		log: getConfiguredAnalysisLog(),
		enabledFor: (workspaceId) => getAnalysisLog(workspaceId) !== null,
		isMember: async (workspaceId, userId) => {
			const rows = await database<Array<{ id: string }>>`
				SELECT id FROM member
				WHERE organization_id = ${workspaceId} AND user_id = ${userId}
				LIMIT 1
			`;
			return rows.length > 0;
		},
	};
}

/**
 * The workspace an upload for `analysisId` goes to, whatever the CLI's
 * default. Unknown analyses, analyses of workspaces the caller is not a
 * member of and analyses the caller may not see are all NOT_FOUND, so ids of
 * other workspaces stay unconfirmed; a log that is off is PRECONDITION_FAILED.
 */
export async function resolveAnalysisUploadWorkspace(
	analysisId: string,
	userId: string,
	env: AnalysisUploadEnv,
): Promise<string> {
	if (!env.log)
		throw new ORPCError("PRECONDITION_FAILED", {
			message: ANALYSIS_UPLOAD_LOG_OFF,
		});
	const analysis = await env.log.store
		.getAnalysis(analysisId)
		.catch((error: unknown) => {
			logger.error(
				"Looking up an upload's analysis failed (analysis_id={analysisId} error={error})",
				{ analysisId, error: loggableError(error) },
			);
			throw new ORPCError("SERVICE_UNAVAILABLE", {
				data: { reason: "analysis_log_unavailable", retryAfterMs: 1_000 },
				message: "The analysis log is unavailable. Retry shortly.",
			});
		});
	if (
		!analysis ||
		!(await env.isMember(analysis.workspaceId, userId)) ||
		!canSee(analysis, { workspaceId: analysis.workspaceId, userId })
	)
		throw new ORPCError("NOT_FOUND", { message: ANALYSIS_UPLOAD_NOT_FOUND });
	if (!env.enabledFor(analysis.workspaceId))
		throw new ORPCError("PRECONDITION_FAILED", {
			message: ANALYSIS_UPLOAD_LOG_OFF,
		});
	return analysis.workspaceId;
}

/**
 * Links an ingested session to its analysis and reports whether it is
 * linked. The upload is already stored: an analysis that was deleted, moved
 * out of reach or is full since the upload began is skipped (false); a store
 * outage is SERVICE_UNAVAILABLE, so the client or the R2 recovery retries and
 * the identical re-upload links it.
 */
export async function linkUploadedSession(
	upload: {
		analysisId: string;
		organizationId: string;
		userId: string;
		sessionId: string;
		source: Source;
		uploadedAt: string;
	},
	env: AnalysisUploadEnv,
): Promise<boolean> {
	if (!env.log || !env.enabledFor(upload.organizationId)) {
		logger.warn(
			"Analysis log is off; uploaded session not linked (analysis_id={analysisId} session_id={sessionId})",
			{ analysisId: upload.analysisId, sessionId: upload.sessionId },
		);
		return false;
	}
	try {
		const analysis = await env.log.store.getAnalysis(upload.analysisId);
		if (
			!analysis ||
			analysis.workspaceId !== upload.organizationId ||
			!canSee(analysis, {
				workspaceId: upload.organizationId,
				userId: upload.userId,
			})
		) {
			logger.warn(
				"Analysis is gone or out of reach; uploaded session not linked (analysis_id={analysisId} session_id={sessionId})",
				{ analysisId: upload.analysisId, sessionId: upload.sessionId },
			);
			return false;
		}
		await env.log.store.linkSession({
			analysisId: analysis.id,
			sessionId: upload.sessionId,
			source: upload.source,
			ownerId: upload.userId,
			uploadedAt: upload.uploadedAt,
		});
		return true;
	} catch (error) {
		if (error instanceof AnalysisFullError) {
			logger.warn(
				"Analysis holds the most chat sessions it may; uploaded session not linked (analysis_id={analysisId} session_id={sessionId})",
				{ analysisId: upload.analysisId, sessionId: upload.sessionId },
			);
			return false;
		}
		logger.error(
			"Linking an uploaded session to its analysis failed (analysis_id={analysisId} session_id={sessionId} error={error})",
			{
				analysisId: upload.analysisId,
				error: loggableError(error),
				sessionId: upload.sessionId,
			},
		);
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			data: { reason: "analysis_link_unavailable", retryAfterMs: 1_000 },
			message:
				"The session was uploaded but could not be attached to its analysis yet. Retry shortly.",
		});
	}
}
