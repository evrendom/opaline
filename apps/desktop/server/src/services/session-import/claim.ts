import { getLogger } from "@logtape/logtape";
import { ORPCError } from "@orpc/server";
import { extractNativeCodexLineageEvidence } from "@rudel/api-routes";
import { SESSION_INGEST_FILTER_VERSION } from "@rudel/api-routes/transcript-slim";
import {
	getIngestContentShape,
	isComparableIngestShapeVersion,
	isUnexpectedIngestShrink,
	resolvePreviousIngestContentShape,
} from "../../lib/ingest-content-shape.js";
import { getActiveOrganizationId } from "../cli-workspace.service.js";
import { SessionAgentMetadataConflictError } from "../session-ownership.service.js";
import type { SessionImportDependencies } from "./dependencies.js";
import type { SessionImportRequest } from "./import-session.js";
import type { AdmittedSession, ClaimedSession } from "./scope.js";

const logger = getLogger(["rudel", "api", "router"]);

export async function claimSession(
	{ context, errorFactories, input }: SessionImportRequest,
	deps: SessionImportDependencies,
	admitted: AdmittedSession,
): Promise<ClaimedSession> {
	const { filteredInput, timestamps } = admitted;
	const { organizationId: orgId, ownership } = await deps.control.claim({
		requestedOrganizationId:
			input.organizationId ?? getActiveOrganizationId(context.session),
		sessionId: input.sessionId,
		userId: context.user.id,
	});
	if (!ownership.owned) {
		throw errorFactories.sessionOwnershipConflict();
	}
	const contentShape = getIngestContentShape(filteredInput);
	const previousContentShape = resolvePreviousIngestContentShape(ownership);
	if (
		!input.force_replace &&
		previousContentShape !== null &&
		isUnexpectedIngestShrink(previousContentShape, contentShape, {
			// Only byte sizes are re-baselined across a filter version bump;
			// lost assistant records or subagent streams are always refused.
			compareBytes: isComparableIngestShapeVersion(
				ownership.lastFilterVersion,
				SESSION_INGEST_FILTER_VERSION,
			),
			compareTotalsOnly: ownership.lastContentShape === null,
		})
	) {
		logger.warn(
			"Refusing smaller session re-upload (organization_id={organizationId} session_id={sessionId} previous_content_bytes={previousContentBytes} current_content_bytes={currentContentBytes} previous_assistant_lines={previousAssistantLineCount} current_assistant_lines={currentAssistantLineCount})",
			{
				currentAssistantLineCount: contentShape.assistantLineCount,
				currentContentBytes: contentShape.contentBytes,
				organizationId: orgId,
				previousAssistantLineCount: previousContentShape.assistantLineCount,
				previousContentBytes: previousContentShape.contentBytes,
				sessionId: input.sessionId,
			},
		);
		throw errorFactories.sessionUploadShrinkRejected({
			currentAssistantLineCount: contentShape.assistantLineCount,
			currentContentBytes: contentShape.contentBytes,
			previousAssistantLineCount: previousContentShape.assistantLineCount,
			previousContentBytes: previousContentShape.contentBytes,
		});
	}
	const nativeLineage = extractNativeCodexLineageEvidence({
		content: filteredInput.content,
		sessionDate: timestamps.sessionDate,
		sessionId: input.sessionId,
		source: filteredInput.source,
	});
	try {
		await deps.control.recordAgentMetadata(
			orgId,
			input.sessionId,
			context.user.id,
			{
				nativeParentSessionId: nativeLineage?.parentSessionId,
				nativeSubagentModel: nativeLineage?.model,
				nativeSubagentPath: nativeLineage?.agentPath,
				source: filteredInput.source,
			},
		);
	} catch (error) {
		if (error instanceof SessionAgentMetadataConflictError) {
			throw new ORPCError("BAD_REQUEST", { message: error.message });
		}
		throw error;
	}
	if (filteredInput.source === "codex") {
		// This runs before both idempotency exits so retries repair lineage even
		// when the raw transcript and usage receipt are already complete. The
		// durable arrival marker makes the wake-up below a one-time recovery.
		await deps.control.projectLineage({
			organizationId: orgId,
			sessionId: input.sessionId,
			userId: context.user.id,
		});
	}
	return { ...admitted, contentShape, orgId, ownership };
}
