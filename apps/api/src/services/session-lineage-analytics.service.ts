import { SESSION_LINEAGE_DERIVATION_VERSION } from "@rudel/api-routes";
import { getSafeClickHouseTable } from "../clickhouse.js";
import { shouldReadSessionLineage } from "../lib/env.js";

const SESSION_LINEAGE_TABLE = "rudel.session_lineage";
const LINKED_SUBAGENT_ARRAY_TYPE =
	"Array(Tuple(String, String, String, String, String))";
const NATIVE_CHILD_ARRAY_TYPE = "Array(Tuple(String, String))";

export function buildSessionHasSubagentsSql(alias?: string): string {
	const prefix = alias ? `${alias}.` : "";
	return `((${prefix}subagent_count + ${prefix}linked_subagent_count) > 0 OR length(${prefix}native_child_sessions) > 0)`;
}

export const SESSION_HAS_SUBAGENTS_SQL = buildSessionHasSubagentsSql();

export function buildSessionLineageCteDefinitions(
	enabled = shouldReadSessionLineage(),
): string {
	return `
		session_lineage_current AS (
			SELECT
				organization_id,
				user_id,
				child_source,
				child_session_id,
				argMax(parent_source, replacement_version) AS parent_source,
				argMax(parent_session_id, replacement_version) AS parent_session_id,
				argMax(child_model, replacement_version) AS child_model,
				argMax(confidence, replacement_version) AS confidence,
				argMax(outcome, replacement_version) AS outcome,
				argMax(countable, replacement_version) AS countable
			FROM ${getSafeClickHouseTable(SESSION_LINEAGE_TABLE)}
			WHERE organization_id = {orgId:String}
				AND derivation_version = ${SESSION_LINEAGE_DERIVATION_VERSION}
			GROUP BY organization_id, user_id, child_source, child_session_id
		),
		session_native_parents AS (
			SELECT
				organization_id,
				user_id,
				child_source,
				child_session_id,
				parent_session_id
			FROM session_lineage_current
			WHERE confidence = 'native_parent_id'
				AND countable = 1
				AND child_source = 'codex'
				AND parent_source = 'codex'
		),
		session_native_children AS (
			SELECT
				organization_id,
				user_id,
				parent_session_id,
				arraySort(
					child -> tupleElement(child, 1),
					groupArray(tuple(child_session_id, child_model))
				) AS native_child_sessions
			FROM session_lineage_current
			WHERE confidence = 'native_parent_id'
				AND countable = 1
				AND child_source = 'codex'
				AND parent_source = 'codex'
			GROUP BY organization_id, user_id, parent_session_id
		),
		session_lineage_counts AS (
			SELECT
				organization_id,
				user_id,
				parent_source,
				parent_session_id,
				countIf(
					${enabled ? "" : "0 AND"}
					countable = 1
					AND outcome = 'successful'
					AND confidence IN ('id_echo', 'prompt_echo', 'attested_temporal')
				) AS linked_subagent_count,
				arraySort(
					child -> (tupleElement(child, 2), tupleElement(child, 1)),
					groupArrayIf(
						tuple(
							child_session_id,
							if(child_source = 'codex', 'codex', 'claude'),
							if(child_source = 'codex', 'openai', 'claude'),
							child_model,
							confidence
						),
						${enabled ? "" : "0 AND"}
						countable = 1
							AND outcome = 'successful'
							AND confidence IN ('id_echo', 'prompt_echo', 'attested_temporal')
					)
				) AS linked_subagents
			FROM session_lineage_current
			GROUP BY organization_id, user_id, parent_source, parent_session_id
		)`;
}

export function buildLineageEnrichedMetadataCte(input: {
	readonly baseRelation: string;
	readonly outputRelation: string;
}): string {
	return `
		${input.outputRelation} AS (
			SELECT
				sa.* EXCEPT (organization_id, user_id),
				sa.organization_id AS organization_id,
				sa.user_id AS user_id,
				toUInt8(ifNull(native_parent.parent_session_id, '') = '') AS is_top_level_session,
				ifNull(native_parent.parent_session_id, '') AS native_parent_session_id,
				ifNull(
					native_children.native_child_sessions,
					CAST([], '${NATIVE_CHILD_ARRAY_TYPE}')
				) AS native_child_sessions,
				ifNull(lineage.linked_subagent_count, 0) AS linked_subagent_count,
				ifNull(
					lineage.linked_subagents,
					CAST([], '${LINKED_SUBAGENT_ARRAY_TYPE}')
				) AS linked_subagents
			FROM ${input.baseRelation} AS sa
			ANY LEFT JOIN session_native_parents AS native_parent
				ON native_parent.organization_id = sa.organization_id
				AND native_parent.user_id = sa.user_id
				AND native_parent.child_source = sa.source
				AND native_parent.child_session_id = sa.session_id
			ANY LEFT JOIN session_native_children AS native_children
				ON native_children.organization_id = sa.organization_id
				AND native_children.user_id = sa.user_id
				AND sa.source = 'codex'
				AND native_children.parent_session_id = sa.session_id
			ANY LEFT JOIN session_lineage_counts AS lineage
				ON lineage.organization_id = sa.organization_id
				AND lineage.user_id = sa.user_id
				AND lineage.parent_source = sa.source
				AND lineage.parent_session_id = sa.session_id
		)`;
}
