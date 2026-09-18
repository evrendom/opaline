import { getLogger } from "@logtape/logtape";
import {
	correlateSessionLineage,
	extractChildLineageEvidence,
	extractLaunchAnchors,
	extractNativeCodexLineageEvidence,
	type NativeCodexLineageEvidence,
	type RawLineageSession,
	SESSION_LINEAGE_DERIVATION_VERSION,
} from "@rudel/api-routes";
import type { RudelSessionLineageRow } from "@rudel/ch-schema/generated";
import { getClickhouse } from "../clickhouse.js";
import {
	readPositiveSafeIntegerEnv,
	readRequiredSecretEnv,
	shouldDeriveSessionLineage,
} from "../lib/env.js";
import {
	buildSessionLineageRow,
	buildUnmatchedSessionLineageRow,
	insertSessionLineageRows,
} from "./session-lineage-persistence.service.js";

const logger = getLogger(["rudel", "api", "session-lineage-reconciliation"]);
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_MAX_BATCHES_PER_RUN = 20;
const QUERY_SETTINGS = {
	join_use_nulls: 0,
	max_bytes_to_read: "10000000000",
	max_execution_time: 45,
	timeout_before_checking_execution_speed: 0,
} as const;

export interface StaleSessionLineageChildRow {
	readonly child_latest_ingested_at: string;
	readonly child_session_id: string;
	readonly child_source: RawLineageSession["source"];
	readonly organization_id: string;
	readonly user_id: string;
}

export interface SessionLineageScope {
	readonly organizationId: string;
	readonly userId: string;
}

interface SessionLineageLagCountRow {
	readonly count: number | string;
}

export interface SessionLineageReconciliationEnvironment {
	readonly fingerprintKey: string;
	readonly insertRows: (
		rows: readonly RudelSessionLineageRow[],
	) => Promise<void>;
	readonly now: () => Date;
	readonly recordAgentMetadata?: (
		session: RawLineageSession,
		evidence: NativeCodexLineageEvidence | undefined,
	) => Promise<void>;
	readonly projectNativeLineage?: (
		session: RawLineageSession,
		evidence: NativeCodexLineageEvidence,
	) => Promise<boolean>;
	readonly queryLagCount: (derivationVersion: number) => Promise<number>;
	readonly repairNativeLineage?: (batchSize: number) => Promise<number>;
	readonly queryScopeSessions: (
		scope: SessionLineageScope,
	) => Promise<readonly RawLineageSession[]>;
	readonly queryStaleChildren: (
		derivationVersion: number,
		batchSize: number,
		offset: number,
	) => Promise<readonly StaleSessionLineageChildRow[]>;
}

export interface SessionLineageReconciliationResult {
	readonly anchors: number;
	readonly candidates: number;
	readonly edges: number;
	readonly failedEdges: number;
	readonly remainingLag: number;
	readonly unmatchedAnchors: number;
	readonly unmatchedChildren: number;
}

export interface SessionLineageReconciliationWorker {
	readonly stop: () => Promise<void>;
}

const STALE_LINEAGE_CTES = `
	raw_children AS (
		SELECT
			source,
			organization_id,
			user_id,
			session_id,
			max(ingested_at) AS child_latest_ingested_at
		FROM (
			SELECT
				'claude_code' AS source,
				organization_id,
				user_id,
				session_id,
				ingested_at
			FROM rudel.claude_sessions
			WHERE match(content, '\\"entrypoint\\"\\s*:\\s*\\"sdk-cli\\"')

			UNION ALL

			SELECT
				'codex' AS source,
				organization_id,
				user_id,
				session_id,
				ingested_at
			FROM rudel.codex_sessions
			WHERE match(content, '\\"originator\\"\\s*:\\s*\\"codex_exec\\"')
				OR match(content, '\\"thread_source\\"\\s*:\\s*\\"subagent\\"')
		)
		GROUP BY source, organization_id, user_id, session_id
	),
	raw_parent_scopes AS (
		SELECT
			target_child_source,
			organization_id,
			user_id,
			max(ingested_at) AS parent_latest_ingested_at
		FROM (
			SELECT
				'codex' AS target_child_source,
				organization_id,
				user_id,
				ingested_at
			FROM rudel.claude_sessions
			WHERE positionCaseInsensitive(content, 'codex') > 0

			UNION ALL

			SELECT
				'claude_code' AS target_child_source,
				organization_id,
				user_id,
				ingested_at
			FROM rudel.codex_sessions
			WHERE positionCaseInsensitive(content, 'claude') > 0
		)
		GROUP BY target_child_source, organization_id, user_id
	),
	current_lineage AS (
		SELECT
			organization_id,
			user_id,
			child_source,
				child_session_id,
				argMax(derivation_version, replacement_version) AS derivation_version,
				argMax(input_sequence, replacement_version) AS input_sequence,
				argMax(confidence, replacement_version) AS confidence
		FROM rudel.session_lineage
		GROUP BY organization_id, user_id, child_source, child_session_id
	),
	stale_children AS (
		SELECT
			raw.source AS child_source,
			raw.organization_id AS organization_id,
			raw.user_id AS user_id,
			raw.session_id AS child_session_id,
				if(
					lineage.confidence = 'native_parent_id',
					raw.child_latest_ingested_at,
					greatest(
						raw.child_latest_ingested_at,
						parents.parent_latest_ingested_at
					)
				) AS child_latest_ingested_at
		FROM raw_children AS raw
		LEFT ANY JOIN raw_parent_scopes AS parents
			ON parents.organization_id = raw.organization_id
			AND parents.user_id = raw.user_id
			AND parents.target_child_source = raw.source
		LEFT ANY JOIN current_lineage AS lineage
			ON lineage.organization_id = raw.organization_id
			AND lineage.user_id = raw.user_id
			AND lineage.child_source = raw.source
			AND lineage.child_session_id = raw.session_id
		WHERE lineage.derivation_version = 0
			OR lineage.derivation_version < {derivationVersion:UInt16}
			OR lineage.input_sequence < toUInt64(toUnixTimestamp64Milli(if(
				lineage.confidence = 'native_parent_id',
				raw.child_latest_ingested_at,
				greatest(
					raw.child_latest_ingested_at,
					parents.parent_latest_ingested_at
				)
			)))
	)`;

export function buildStaleSessionLineageQuery(): string {
	return `
		WITH ${STALE_LINEAGE_CTES}
		SELECT
			child_source,
			organization_id,
			user_id,
			child_session_id,
			formatDateTime(child_latest_ingested_at, '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS child_latest_ingested_at
		FROM stale_children
		ORDER BY
			child_latest_ingested_at DESC,
			organization_id ASC,
			user_id ASC,
			child_source ASC,
			child_session_id ASC
		LIMIT {batchSize:UInt32}
		OFFSET {offset:UInt32}
	`;
}

export function buildSessionLineageLagCountQuery(): string {
	return `
		WITH ${STALE_LINEAGE_CTES}
		SELECT count() AS count
		FROM stale_children
	`;
}

export function buildSessionLineageScopeSessionsQuery(): string {
	return `
		SELECT
			source,
			organization_id AS organizationId,
			argMax(user_id, ingested_at) AS userId,
			session_id AS sessionId,
			argMax(content, ingested_at) AS content,
			argMax(project_path, ingested_at) AS projectPath,
			formatDateTime(argMax(session_date, ingested_at), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS sessionDate,
			formatDateTime(min(ingested_at), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS firstIngestedAt,
			formatDateTime(max(ingested_at), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS latestIngestedAt
		FROM (
			SELECT
				'claude_code' AS source,
				organization_id,
				user_id,
				session_id,
				content,
				project_path,
				session_date,
				ingested_at
			FROM rudel.claude_sessions
			WHERE organization_id = {orgId:String}
				AND user_id = {userId:String}
				AND (
					positionCaseInsensitive(content, 'codex') > 0
					OR match(content, '\\"entrypoint\\"\\s*:\\s*\\"sdk-cli\\"')
				)

			UNION ALL

			SELECT
				'codex' AS source,
				organization_id,
				user_id,
				session_id,
				content,
				project_path,
				session_date,
				ingested_at
			FROM rudel.codex_sessions
			WHERE organization_id = {orgId:String}
				AND user_id = {userId:String}
		)
		GROUP BY source, organization_id, session_id
	`;
}

function createDefaultEnvironment(): SessionLineageReconciliationEnvironment {
	const clickhouse = getClickhouse();
	return {
		fingerprintKey: readRequiredSecretEnv(
			"SESSION_LINEAGE_FINGERPRINT_KEY",
			32,
		),
		insertRows: (rows) => insertSessionLineageRows(clickhouse, rows),
		now: () => new Date(),
		recordAgentMetadata: async (session, evidence) => {
			const { recordSessionAgentMetadata } = await import(
				"./session-ownership.service.js"
			);
			await recordSessionAgentMetadata(
				session.organizationId,
				session.sessionId,
				session.userId,
				{
					nativeParentSessionId: evidence?.parentSessionId,
					nativeSubagentModel: evidence?.model,
					nativeSubagentPath: evidence?.agentPath,
					rawIngestedAt: session.latestIngestedAt,
					rawSessionDate: session.sessionDate,
					source: session.source,
				},
			);
		},
		projectNativeLineage: async (session, evidence) => {
			const { projectNativeSessionLineage } = await import(
				"./session-native-lineage.service.js"
			);
			const projected = await projectNativeSessionLineage({
				organizationId: session.organizationId,
				sessionId: session.sessionId,
				userId: session.userId,
			});
			return projected.includes(evidence.childSessionId);
		},
		repairNativeLineage: async (batchSize) => {
			const { repairNativeSessionLineage } = await import(
				"./session-native-lineage.service.js"
			);
			return repairNativeSessionLineage(batchSize);
		},
		queryLagCount: async (derivationVersion) => {
			const rows = await clickhouse.query<SessionLineageLagCountRow>({
				clickhouse_settings: QUERY_SETTINGS,
				query: buildSessionLineageLagCountQuery(),
				query_params: { derivationVersion },
			});
			return Number(rows[0]?.count ?? 0);
		},
		queryScopeSessions: (scope) =>
			clickhouse.query<RawLineageSession>({
				clickhouse_settings: QUERY_SETTINGS,
				query: buildSessionLineageScopeSessionsQuery(),
				query_params: {
					orgId: scope.organizationId,
					userId: scope.userId,
				},
			}),
		queryStaleChildren: (derivationVersion, batchSize, offset) =>
			clickhouse.query<StaleSessionLineageChildRow>({
				clickhouse_settings: QUERY_SETTINGS,
				query: buildStaleSessionLineageQuery(),
				query_params: { batchSize, derivationVersion, offset },
			}),
	};
}

export async function reconcileSessionLineageOnce(
	batchSize: number,
	env: SessionLineageReconciliationEnvironment = createDefaultEnvironment(),
): Promise<SessionLineageReconciliationResult> {
	const repairedNative = (await env.repairNativeLineage?.(batchSize)) ?? 0;
	const staleChildren = await env.queryStaleChildren(
		SESSION_LINEAGE_DERIVATION_VERSION,
		batchSize,
		0,
	);
	if (staleChildren.length === 0) {
		return addNativeRepairs(emptyResult(), repairedNative);
	}

	const result = await reconcileStaleChildren(staleChildren, env);
	return {
		...addNativeRepairs(result, repairedNative),
		remainingLag: await env.queryLagCount(SESSION_LINEAGE_DERIVATION_VERSION),
	};
}

export async function reconcileSessionLineageUntilCaughtUp(
	batchSize: number,
	env: SessionLineageReconciliationEnvironment = createDefaultEnvironment(),
): Promise<SessionLineageReconciliationResult> {
	let aggregate = addNativeRepairs(
		emptyResult(),
		await repairNativeLineageUntilBounded(batchSize, env),
	);
	let offset = 0;
	const processedBatches = new Set<string>();
	for (
		let batchIndex = 0;
		batchIndex < DEFAULT_MAX_BATCHES_PER_RUN;
		batchIndex += 1
	) {
		const staleChildren = await env.queryStaleChildren(
			SESSION_LINEAGE_DERIVATION_VERSION,
			batchSize,
			offset,
		);
		if (staleChildren.length === 0) break;
		const identity = staleChildren
			.map(
				(row) =>
					`${row.organization_id}\u0000${row.user_id}\u0000${row.child_source}\u0000${row.child_session_id}\u0000${row.child_latest_ingested_at}`,
			)
			.join("\u0001");
		if (processedBatches.has(identity)) break;
		processedBatches.add(identity);

		const batch = await reconcileStaleChildren(staleChildren, env);
		aggregate = addResults(aggregate, batch);
		// Children without a confirmed edge remain in the stale prefix. Page past
		// them for this bounded pass while retaining them for future reconciliation.
		offset += batch.unmatchedChildren;
	}

	const result = {
		...aggregate,
		remainingLag: await env.queryLagCount(SESSION_LINEAGE_DERIVATION_VERSION),
	};
	if (result.edges > 0 || result.unmatchedChildren > 0) {
		logger.info(
			"Session-lineage reconciliation completed (anchors={anchors} candidates={candidates} edges={edges} failed_edges={failedEdges} unmatched_anchors={unmatchedAnchors} unmatched_children={unmatchedChildren} remaining_lag={remainingLag})",
			result,
		);
	}
	return result;
}

async function repairNativeLineageUntilBounded(
	batchSize: number,
	env: SessionLineageReconciliationEnvironment,
): Promise<number> {
	if (!env.repairNativeLineage) return 0;
	return drainNativeLineageRepairs(batchSize, env.repairNativeLineage);
}

async function drainNativeLineageRepairs(
	batchSize: number,
	repair: (batchSize: number) => Promise<number>,
): Promise<number> {
	let repaired = 0;
	for (
		let batchIndex = 0;
		batchIndex < DEFAULT_MAX_BATCHES_PER_RUN;
		batchIndex += 1
	) {
		const batch = await repair(batchSize);
		repaired += batch;
		if (batch < batchSize) break;
	}
	return repaired;
}

function addNativeRepairs(
	result: SessionLineageReconciliationResult,
	repaired: number,
): SessionLineageReconciliationResult {
	return {
		...result,
		candidates: result.candidates + repaired,
		edges: result.edges + repaired,
	};
}

async function reconcileStaleChildren(
	staleChildren: readonly StaleSessionLineageChildRow[],
	env: SessionLineageReconciliationEnvironment,
): Promise<SessionLineageReconciliationResult> {
	let aggregate = emptyResult();
	for (const scope of uniqueScopes(staleChildren)) {
		const sessions = await env.queryScopeSessions(scope);
		const staleChildIds = new Set(
			staleChildren
				.filter(
					(row) =>
						row.organization_id === scope.organizationId &&
						row.user_id === scope.userId,
				)
				.map((row) => `${row.child_source}\u0000${row.child_session_id}`),
		);
		const nativeEvidence = sessions.flatMap((session) => {
			const evidence = extractNativeCodexLineageEvidence(session);
			return evidence ? [{ evidence, session }] : [];
		});
		const relevantNativeEvidence = nativeEvidence.filter((native) =>
			staleChildIds.has(`codex\u0000${native.evidence.childSessionId}`),
		);
		if (env.recordAgentMetadata) {
			for (const session of sessions) {
				try {
					await env.recordAgentMetadata(
						session,
						extractNativeCodexLineageEvidence(session),
					);
				} catch (error) {
					logger.warn(
						"Skipping historical session ownership metadata during lineage reconciliation (organization_id={organizationId} session_id={sessionId} error={error})",
						{
							error: error instanceof Error ? error.message : String(error),
							organizationId: session.organizationId,
							sessionId: session.sessionId,
						},
					);
				}
			}
		}
		const projectedNativeChildIds = new Set<string>();
		if (env.projectNativeLineage) {
			for (const native of relevantNativeEvidence) {
				if (await env.projectNativeLineage(native.session, native.evidence)) {
					projectedNativeChildIds.add(native.evidence.childSessionId);
				}
			}
		}
		const anchors = sessions.flatMap(extractLaunchAnchors);
		const children = sessions.flatMap((session) => {
			const evidence = extractChildLineageEvidence(session);
			return evidence ? [evidence] : [];
		});
		const correlation = correlateSessionLineage(anchors, children);
		const relevantEdges = correlation.edges.filter((edge) =>
			staleChildIds.has(
				`${edge.child.childSource}\u0000${edge.child.childSessionId}`,
			),
		);
		const matchedChildIds = new Set(
			relevantEdges.map(
				(edge) => `${edge.child.childSource}\u0000${edge.child.childSessionId}`,
			),
		);
		for (const native of relevantNativeEvidence) {
			if (projectedNativeChildIds.has(native.evidence.childSessionId)) {
				matchedChildIds.add(`codex\u0000${native.evidence.childSessionId}`);
			}
		}
		const scopeEvidenceAt = sessions.reduce(
			(latest, session) =>
				Date.parse(session.latestIngestedAt) > Date.parse(latest)
					? session.latestIngestedAt
					: latest,
			sessions[0]?.latestIngestedAt ?? new Date(0).toISOString(),
		);
		const childrenById = new Map(
			children.map((child) => [
				`${child.childSource}\u0000${child.childSessionId}`,
				child,
			]),
		);
		const diagnosticRows = [...staleChildIds].flatMap((childId) => {
			if (matchedChildIds.has(childId)) return [];
			const child = childrenById.get(childId);
			if (!child) return [];
			return [
				buildUnmatchedSessionLineageRow({
					child,
					derivedAt: env.now(),
					fingerprintKey: env.fingerprintKey,
					inputEvidenceAt: scopeEvidenceAt,
				}),
			];
		});
		await env.insertRows([
			...relevantEdges.map((edge) =>
				buildSessionLineageRow({
					derivedAt: env.now(),
					edge,
					fingerprintKey: env.fingerprintKey,
					inputEvidenceAt: scopeEvidenceAt,
				}),
			),
			...diagnosticRows,
		]);
		const scopeStaleCount = [...staleChildIds].length;
		aggregate = addResults(aggregate, {
			anchors: anchors.length,
			candidates: children.length + relevantNativeEvidence.length,
			edges:
				relevantEdges.filter((edge) => edge.countable).length +
				projectedNativeChildIds.size,
			failedEdges: relevantEdges.filter((edge) => !edge.countable).length,
			remainingLag: 0,
			unmatchedAnchors: correlation.unmatchedAnchorIds.length,
			unmatchedChildren: scopeStaleCount - matchedChildIds.size,
		});
	}
	return aggregate;
}

function uniqueScopes(
	rows: readonly StaleSessionLineageChildRow[],
): readonly SessionLineageScope[] {
	return [
		...new Map(
			rows.map((row) => [
				`${row.organization_id}\u0000${row.user_id}`,
				{
					organizationId: row.organization_id,
					userId: row.user_id,
				},
			]),
		).values(),
	];
}

function emptyResult(): SessionLineageReconciliationResult {
	return {
		anchors: 0,
		candidates: 0,
		edges: 0,
		failedEdges: 0,
		remainingLag: 0,
		unmatchedAnchors: 0,
		unmatchedChildren: 0,
	};
}

function addResults(
	left: SessionLineageReconciliationResult,
	right: SessionLineageReconciliationResult,
): SessionLineageReconciliationResult {
	return {
		anchors: left.anchors + right.anchors,
		candidates: left.candidates + right.candidates,
		edges: left.edges + right.edges,
		failedEdges: left.failedEdges + right.failedEdges,
		remainingLag: right.remainingLag,
		unmatchedAnchors: left.unmatchedAnchors + right.unmatchedAnchors,
		unmatchedChildren: left.unmatchedChildren + right.unmatchedChildren,
	};
}

export function startSessionLineageReconciliationWorker(input?: {
	readonly batchSize?: number;
	readonly initialDelayMs?: number;
	readonly intervalMs?: number;
}): SessionLineageReconciliationWorker {
	const batchSize =
		input?.batchSize ??
		readPositiveSafeIntegerEnv(
			"SESSION_LINEAGE_RECONCILE_BATCH_SIZE",
			DEFAULT_BATCH_SIZE,
		);
	const intervalMs =
		input?.intervalMs ??
		readPositiveSafeIntegerEnv(
			"SESSION_LINEAGE_RECONCILE_INTERVAL_MS",
			DEFAULT_INTERVAL_MS,
		);
	const initialDelayMs =
		input?.initialDelayMs ??
		Math.max(1_000, Math.floor(intervalMs * (0.5 + Math.random())));
	const deriveHeuristicLineage = shouldDeriveSessionLineage();
	let env: SessionLineageReconciliationEnvironment | undefined;
	let activeRun = Promise.resolve();
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const scheduleNextRun = (delayMs = intervalMs) => {
		if (stopped) return;
		timer = setTimeout(() => {
			activeRun = runWorkerPass();
		}, delayMs);
		timer.unref();
	};
	const runWorkerPass = async () => {
		try {
			if (deriveHeuristicLineage) {
				const activeEnv = env ?? createDefaultEnvironment();
				env = activeEnv;
				await reconcileSessionLineageUntilCaughtUp(batchSize, activeEnv);
			} else {
				const { repairNativeSessionLineage } = await import(
					"./session-native-lineage.service.js"
				);
				await drainNativeLineageRepairs(batchSize, repairNativeSessionLineage);
			}
		} catch (error) {
			logger.error("Session-lineage reconciliation failed: {error}", {
				error: String(error),
			});
		} finally {
			scheduleNextRun();
		}
	};

	scheduleNextRun(initialDelayMs);
	return {
		async stop() {
			stopped = true;
			if (timer) clearTimeout(timer);
			await activeRun;
		},
	};
}
