import { getLogger } from "@logtape/logtape";
import type { R2IngestProcessorResult } from "../r2-ingest-commit.service.js";
import { SKILL_PARSER_VERSION } from "../skill-extraction.js";
import { hasMatchingSkillExtractionReceipt } from "../skill-extraction-ingest.service.js";
import { hasMatchingUsageExtractionReceipt } from "../usage-event-ingest.service.js";
import { type ImportRun, importedSession, storedResult } from "./scope.js";

const logger = getLogger(["rudel", "api", "router"]);

export async function duplicateExit(
	run: ImportRun,
): Promise<R2IngestProcessorResult | null> {
	const { deps, enabled, prepared, request } = run;
	const { contentHash, filteredInput, orgId, ownership, transcriptHash } =
		prepared;
	const { context, input, signal } = request;
	// This is a best-effort cost optimization, not a cross-instance
	// security control. Concurrent identical requests can both reach the
	// ClickHouse insert before either records its successful hash.
	if (
		ownership.lastContentSha256 !== contentHash ||
		!hasMatchingUsageExtractionReceipt(ownership, contentHash) ||
		!(await deps.stores.hasRawRow(deps.stores.executor(), {
			organizationId: orgId,
			sessionDate: ownership.lastSessionDate,
			sessionId: input.sessionId,
			table: prepared.adapter.rawTableName,
			userId: context.user.id,
		}))
	) {
		return null;
	}
	const skillReceiptMatches =
		!enabled.skills ||
		hasMatchingSkillExtractionReceipt(
			await deps.stores.readSkillReceipt(run.clickhouse, {
				agent: filteredInput.source === "claude_code" ? "claude" : "codex",
				organizationId: orgId,
				sessionId: input.sessionId,
				userId: context.user.id,
			}),
			{
				parserVersion: SKILL_PARSER_VERSION,
				sourceContentSha256: transcriptHash,
			},
		);
	// Off (and so current) for a hot import, which owes them to a full one.
	const transcriptRecordsCurrent =
		!enabled.records.enabled ||
		(await deps.stores.recordsCurrent(deps.stores.executor(), {
			config: enabled.records,
			content: filteredInput.content,
			contentSha256: transcriptHash,
			organizationId: orgId,
			sessionId: input.sessionId,
			subagents: prepared.subagents,
			userId: context.user.id,
		}));
	if (!skillReceiptMatches || !transcriptRecordsCurrent) {
		logger.info(
			"Reprocessing duplicate session with a missing or stale derived-data receipt (organization_id={organizationId} session_id={sessionId} skills_current={skillsCurrent} transcript_records_current={transcriptRecordsCurrent})",
			{
				organizationId: orgId,
				sessionId: input.sessionId,
				skillsCurrent: skillReceiptMatches,
				transcriptRecordsCurrent,
			},
		);
		return null;
	}
	// Records are current, but their git observations may have been
	// skipped (no admission slot) or failed; extraction is a no-op when its
	// receipt is current and is best-effort, never failing the upload.
	if (enabled.records.enabled) {
		const derived = {
			organizationId: orgId,
			sessionId: input.sessionId,
			signal,
			source: filteredInput.source,
			userId: context.user.id,
		};
		if (
			(await deps.stores.persistGitObservations(
				deps.stores.executor(),
				derived,
			)) === "written"
		)
			await deps.runIndex.enqueue(importedSession(run));
		// Goes on where an earlier pass stopped (time, chunk cap or quota).
		await deps.stores.indexSearch(deps.stores.executor(), derived);
	}
	logger.info(
		"Skipping duplicate session ingest (organization_id={organizationId} session_id={sessionId})",
		{ organizationId: orgId, sessionId: input.sessionId },
	);
	return storedResult(run);
}
