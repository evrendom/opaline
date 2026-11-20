import type { SessionSetupFile, SessionSetupRuns } from "@rudel/api-routes";
import {
	type SessionContextSnapshot,
	sessionContextSnapshot,
} from "@rudel/api-routes/session-context/session-context-snapshot";
import { SESSION_CONTEXT_SNAPSHOTS_TABLE } from "@rudel/ch-schema/session-context-snapshots";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { clickHouseTime } from "./analysis/git-links.js";
import { RUN_INDEX_VERSION } from "./analysis/run-index-sql.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./analysis/sql.js";
import {
	type SessionRunCiScope,
	sessionOwnerParams,
	sessionOwnerSql,
} from "./run-ci/session-run-ci.js";
import { getCurrentSessionDetailDerivation } from "./session-detail.service.js";
import type { SessionDetailDerivation } from "./session-detail-derivation.service.js";
import {
	readSetupFiles,
	sessionSetupRuns,
} from "./session-summary-links.service.js";

type SessionKey = { organizationId: string; userId: string; sessionId: string };

export function contextSnapshotOf(
	derivation: Pick<
		SessionDetailDerivation,
		"overviewBase" | "turnBodies" | "turnSummaries"
	>,
	setup: readonly SessionSetupFile[],
	setupRuns: SessionSetupRuns,
): SessionContextSnapshot | null {
	return sessionContextSnapshot({
		bodyOf: (turnId) => derivation.turnBodies.get(turnId) ?? null,
		model: derivation.overviewBase.session.modelUsed,
		sessionCost: derivation.overviewBase.session.estimatedCost,
		setup,
		setupRuns: setupRuns.runs,
		subagentCosts: new Map(
			(derivation.overviewBase.subagents ?? []).map((each) => [
				each.subagentId,
				each.estimatedCost,
			]),
		),
		turns: derivation.turnSummaries,
	});
}

export function contextSnapshotRow(
	session: SessionKey,
	revision: string,
	snapshot: SessionContextSnapshot,
	builtAt: Date,
) {
	const map = snapshot.views[0]?.map;
	const parts = map?.parts ?? [];
	return {
		organization_id: session.organizationId,
		user_id: session.userId,
		session_id: session.sessionId,
		revision,
		index_version: RUN_INDEX_VERSION,
		model: map?.model ?? "",
		used_tokens: Math.round(map?.used ?? 0),
		window_tokens: Math.round(map?.window ?? 0),
		part_keys: parts.map((part) => part.key),
		part_kinds: parts.map((part) => part.kind),
		part_labels: parts.map((part) => part.label),
		part_tokens: parts.map((part) => Math.max(0, Math.round(part.tokens))),
		snapshot: JSON.stringify(snapshot),
		built_at: clickHouseTime(builtAt.getTime()),
	};
}

export async function writeSessionContextSnapshot(
	executor: ClickHouseExecutor,
	session: SessionKey,
	now: () => Date = () => new Date(),
	beforeWrite: () => Promise<void> = async () => {},
): Promise<boolean> {
	const derivation = await getCurrentSessionDetailDerivation({
		organizationId: session.organizationId,
		ownerId: session.userId,
		sessionId: session.sessionId,
	});
	if (!derivation) return false;
	const scope = { workspaceId: session.organizationId, member: session.userId };
	const [setup, setupRuns] = await Promise.all([
		readSetupFiles({ executor }, scope, session.sessionId),
		sessionSetupRuns({ executor }, scope, session.sessionId),
	]);
	const snapshot = contextSnapshotOf(derivation, setup, setupRuns);
	if (!snapshot) return false;
	await beforeWrite();
	await executor.insert({
		table: SESSION_CONTEXT_SNAPSHOTS_TABLE,
		values: [contextSnapshotRow(session, derivation.revision, snapshot, now())],
		asyncInsert: false,
	});
	return true;
}

export async function readSessionContextSnapshot(
	executor: ClickHouseExecutor,
	scope: SessionRunCiScope,
	sessionId: string,
): Promise<SessionContextSnapshot | null> {
	const [row] = await query(executor, SnapshotRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT snapshot
			FROM ${getSafeClickHouseTable(SESSION_CONTEXT_SNAPSHOTS_TABLE)} FINAL
			WHERE ${sessionOwnerSql(scope)}
			ORDER BY built_at DESC
			LIMIT 1`,
		query_params: sessionOwnerParams(scope, sessionId),
	});
	return row ? (JSON.parse(row.snapshot) as SessionContextSnapshot) : null;
}

const SnapshotRowSchema = z.object({ snapshot: z.string() });
