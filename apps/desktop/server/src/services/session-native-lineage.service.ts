import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import {
	hasMaintenanceTimeRemaining,
	type MaintenanceDeadline,
} from "../lib/bounded-maintenance.js";
import { sessionArrivalChannel } from "./session-arrival-channel.js";
import {
	buildNativeSessionLineageRow,
	insertSessionLineageRows,
} from "./session-lineage-persistence.service.js";
import { markPendingSessionArrival } from "./session-ownership.service.js";

interface NativeLineageDatabaseRow {
	child_ingested_at: Date | string | null;
	child_session_date: Date | string | null;
	child_session_id: string;
	child_subagent_model: string | null;
	child_subagent_path: string | null;
	native_lineage_projected_at: Date | string | null;
	native_lineage_projected_signature: string | null;
	parent_ingested_at: Date | string | null;
	parent_session_date: Date | string | null;
	parent_session_id: string;
	projection_source_at: string | null;
}

const SIGNATURE_SEPARATOR = "\u001f";

export async function projectNativeSessionLineage(input: {
	readonly notifyPendingArrival?: boolean;
	readonly organizationId: string;
	readonly sessionId: string;
	readonly userId: string;
}): Promise<readonly string[]> {
	const rows = await sqlClient<NativeLineageDatabaseRow[]>`
		SELECT
			child.session_id AS child_session_id,
			child.last_session_date AS child_session_date,
			child.last_ingested_at AS child_ingested_at,
			child.native_subagent_model AS child_subagent_model,
			child.native_subagent_path AS child_subagent_path,
			child.native_lineage_projected_at,
			child.native_lineage_projected_signature,
			parent.session_id AS parent_session_id,
			parent.last_session_date AS parent_session_date,
			parent.last_ingested_at AS parent_ingested_at,
			GREATEST(
				child.last_ingested_at,
				parent.last_ingested_at
			)::text AS projection_source_at
		FROM session_ownership child
		JOIN session_ownership parent
			ON parent.organization_id = child.organization_id
			AND parent.user_id = child.user_id
			AND parent.session_id = child.native_parent_session_id
			AND parent.agent_source = 'codex'
		WHERE child.organization_id = ${input.organizationId}
			AND child.user_id = ${input.userId}
			AND child.agent_source = 'codex'
			AND (
				child.session_id = ${input.sessionId}
				OR parent.session_id = ${input.sessionId}
			)
	`;
	const derivedAt = new Date();
	const projections = rows.flatMap((row) => {
		const childSessionDate = row.child_session_date;
		const childIngestedAt = row.child_ingested_at;
		if (!childSessionDate || !childIngestedAt || !row.projection_source_at) {
			return [];
		}
		const parentSessionDate = row.parent_session_date ?? childSessionDate;
		const countable = row.parent_ingested_at !== null;
		const childModel = row.child_subagent_model ?? "codex";
		const signature = buildProjectionSignature(
			countable,
			row.parent_session_id,
			childModel,
			row.child_subagent_path,
		);
		const freshnessPending =
			row.native_lineage_projected_at === null ||
			timestampMillis(row.native_lineage_projected_at) <
				timestampMillis(row.projection_source_at);
		if (
			!freshnessPending &&
			row.native_lineage_projected_signature === signature
		) {
			return [];
		}
		return [
			{
				lineage: buildNativeSessionLineageRow({
					childIngestedAt,
					childModel,
					childSessionDate,
					childSessionId: row.child_session_id,
					countable,
					derivedAt,
					evidenceAt: row.projection_source_at,
					organizationId: input.organizationId,
					parentSessionDate,
					parentSessionId: row.parent_session_id,
					userId: input.userId,
				}),
				projectionSignature: signature,
				projectionSourceAt: row.projection_source_at,
			},
		];
	});
	const projected = projections.map((projection) => projection.lineage);
	await insertSessionLineageRows(getClickhouse(), projected);
	const acknowledged: string[] = [];
	await sqlClient.begin(async (transaction) => {
		// Metadata updates use the same organization lock. Serializing the whole
		// acknowledgement set prevents parent/child projectors from locking the
		// same rows in opposite orders.
		await transaction.unsafe(
			"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
			[`session-native-lineage:${input.organizationId}`],
		);
		let shouldNotify = false;
		for (const projection of projections) {
			const [current] = await transaction.unsafe<NativeLineageDatabaseRow[]>(
				`${buildLockedNativeLineageStateQuery()}
				 AND child.session_id = $3
				 FOR UPDATE OF child, parent`,
				[
					input.organizationId,
					input.userId,
					projection.lineage.child_session_id,
				],
			);
			if (!current) continue;
			const currentSignature = buildProjectionSignature(
				current.parent_ingested_at !== null,
				current.parent_session_id,
				current.child_subagent_model ?? "codex",
				current.child_subagent_path,
			);
			if (
				current.projection_source_at === null ||
				currentSignature !== projection.projectionSignature ||
				timestampMillis(current.projection_source_at) >
					timestampMillis(projection.projectionSourceAt) ||
				(current.native_lineage_projected_at !== null &&
					timestampMillis(current.native_lineage_projected_at) >
						timestampMillis(projection.projectionSourceAt))
			) {
				continue;
			}
			await transaction.unsafe(
				`UPDATE session_ownership
				 SET native_lineage_projected_at = $1::timestamptz,
					native_lineage_projected_signature = $2
				 WHERE organization_id = $3
					AND user_id = $4
					AND session_id = $5`,
				[
					projection.projectionSourceAt,
					projection.projectionSignature,
					input.organizationId,
					input.userId,
					projection.lineage.child_session_id,
				],
			);
			acknowledged.push(projection.lineage.child_session_id);
			shouldNotify ||=
				current.native_lineage_projected_signature !==
					projection.projectionSignature &&
				(isVisibleProjectionSignature(
					current.native_lineage_projected_signature,
				) ||
					isVisibleProjectionSignature(projection.projectionSignature));
		}
		const arrivalPayload = input.notifyPendingArrival
			? await markPendingSessionArrival(
					input.organizationId,
					input.sessionId,
					input.userId,
					transaction,
				)
			: null;
		const notificationPayload =
			arrivalPayload ?? (shouldNotify ? "lineage-refresh" : null);
		if (notificationPayload !== null) {
			// Commit the semantic projection acknowledgement and cache wake-up
			// with the durable arrival claim. Root arrivals take precedence so the
			// same event can both show the toast and refresh lineage-dependent caches.
			await transaction.unsafe("SELECT pg_notify($1, $2)", [
				sessionArrivalChannel(input.organizationId),
				notificationPayload,
			]);
		}
	});
	return acknowledged;
}

interface NativeLineageRepairCandidate {
	organization_id: string;
	session_id: string;
	user_id: string;
}

export interface NativeSessionLineageRepairPassResult {
	readonly hasMore: boolean;
	readonly repaired: number;
}

export async function repairNativeSessionLineage(
	batchSize: number,
): Promise<number> {
	return (await repairNativeSessionLineagePass(batchSize)).repaired;
}

export async function repairNativeSessionLineagePass(
	batchSize: number,
	deadline?: MaintenanceDeadline,
): Promise<NativeSessionLineageRepairPassResult> {
	if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
		throw new Error("batchSize must be a positive safe integer");
	}
	if (!hasMaintenanceTimeRemaining(deadline)) {
		return { hasMore: true, repaired: 0 };
	}
	const candidates = await sqlClient<NativeLineageRepairCandidate[]>`
		SELECT
			child.organization_id,
			child.session_id,
			child.user_id
		FROM session_ownership child
		JOIN session_ownership parent
			ON parent.organization_id = child.organization_id
			AND parent.user_id = child.user_id
			AND parent.session_id = child.native_parent_session_id
			AND parent.agent_source = 'codex'
		WHERE child.agent_source = 'codex'
			AND child.last_ingested_at IS NOT NULL
			AND (
				child.native_lineage_projected_at IS NULL
				OR child.native_lineage_projected_at < GREATEST(
					child.last_ingested_at,
					parent.last_ingested_at
				)
				OR child.native_lineage_projected_signature IS DISTINCT FROM concat(
					CASE WHEN parent.last_ingested_at IS NULL THEN '0' ELSE '1' END,
					chr(31),
					child.native_parent_session_id,
					chr(31),
					COALESCE(child.native_subagent_model, 'codex'),
					chr(31),
					COALESCE(child.native_subagent_path, '')
				)
			)
		ORDER BY child.organization_id, child.user_id, child.session_id
		LIMIT ${batchSize + 1}
	`;
	let repaired = 0;
	let processed = 0;
	for (const candidate of candidates.slice(0, batchSize)) {
		if (!hasMaintenanceTimeRemaining(deadline)) break;
		const projected = await projectNativeSessionLineage({
			organizationId: candidate.organization_id,
			sessionId: candidate.session_id,
			userId: candidate.user_id,
		});
		if (projected.includes(candidate.session_id)) repaired += 1;
		processed += 1;
	}
	return { hasMore: processed < candidates.length, repaired };
}

interface NativeRelationshipRow {
	agent_path: string | null;
	model: string | null;
	relationship: "child" | "parent";
	session_id: string;
}

export async function readNativeSessionRelationships(input: {
	readonly organizationId: string;
	readonly sessionId: string;
	readonly userId: string;
}) {
	const rows = await sqlClient<NativeRelationshipRow[]>`
		SELECT
			'parent' AS relationship,
			parent.session_id,
			NULL::text AS model,
			NULL::text AS agent_path
		FROM session_ownership child
		JOIN session_ownership parent
			ON parent.organization_id = child.organization_id
			AND parent.user_id = child.user_id
			AND parent.session_id = child.native_parent_session_id
			AND parent.agent_source = 'codex'
			AND parent.last_ingested_at IS NOT NULL
		WHERE child.organization_id = ${input.organizationId}
			AND child.user_id = ${input.userId}
			AND child.session_id = ${input.sessionId}
			AND child.agent_source = 'codex'
			AND child.last_ingested_at IS NOT NULL

		UNION ALL

		SELECT
			'child' AS relationship,
			child.session_id,
			child.native_subagent_model AS model,
			child.native_subagent_path AS agent_path
		FROM session_ownership parent
		JOIN session_ownership child
			ON child.organization_id = parent.organization_id
			AND child.user_id = parent.user_id
			AND child.native_parent_session_id = parent.session_id
			AND child.agent_source = 'codex'
			AND child.last_ingested_at IS NOT NULL
		WHERE parent.organization_id = ${input.organizationId}
			AND parent.user_id = ${input.userId}
			AND parent.session_id = ${input.sessionId}
			AND parent.agent_source = 'codex'
			AND parent.last_ingested_at IS NOT NULL
		ORDER BY relationship DESC, session_id
	`;
	const map = (row: NativeRelationshipRow) => ({
		agentPath: row.agent_path,
		model: row.model,
		sessionId: row.session_id,
	});
	const parent = rows.find((row) => row.relationship === "parent");
	return {
		children: rows.filter((row) => row.relationship === "child").map(map),
		parent: parent ? map(parent) : null,
	};
}

function buildProjectionSignature(
	countable: boolean,
	parentSessionId: string,
	model: string,
	agentPath: string | null,
): string {
	return [countable ? "1" : "0", parentSessionId, model, agentPath ?? ""].join(
		SIGNATURE_SEPARATOR,
	);
}

function isVisibleProjectionSignature(signature: string | null): boolean {
	return signature?.startsWith(`1${SIGNATURE_SEPARATOR}`) ?? false;
}

function timestampMillis(value: Date | string): number {
	return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function buildLockedNativeLineageStateQuery(): string {
	return `
		SELECT
			child.session_id AS child_session_id,
			child.last_session_date AS child_session_date,
			child.last_ingested_at AS child_ingested_at,
			child.native_subagent_model AS child_subagent_model,
			child.native_subagent_path AS child_subagent_path,
			child.native_lineage_projected_at,
			child.native_lineage_projected_signature,
			parent.session_id AS parent_session_id,
			parent.last_session_date AS parent_session_date,
			parent.last_ingested_at AS parent_ingested_at,
			GREATEST(
				child.last_ingested_at,
				parent.last_ingested_at
			)::text AS projection_source_at
		FROM session_ownership child
		JOIN session_ownership parent
			ON parent.organization_id = child.organization_id
			AND parent.user_id = child.user_id
			AND parent.session_id = child.native_parent_session_id
			AND parent.agent_source = 'codex'
		WHERE child.organization_id = $1
			AND child.user_id = $2
			AND child.agent_source = 'codex'`;
}
