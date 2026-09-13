import { SESSION_LINEAGE_DERIVATION_VERSION } from "@rudel/api-routes";
import { getSafeClickHouseTable } from "../clickhouse.js";
import { shouldReadSessionLineage } from "../lib/env.js";

const SESSION_LINEAGE_TABLE = "rudel.session_lineage";
const LINKED_SUBAGENT_ARRAY_TYPE =
	"Array(Tuple(String, String, String, String, String))";

export const SESSION_HAS_SUBAGENTS_SQL =
	"(subagent_count + linked_subagent_count) > 0";

export function buildSessionLineageCteDefinitions(
	enabled = shouldReadSessionLineage(),
): string {
	if (!enabled) {
		return `
		session_lineage_counts AS (
			SELECT
				CAST('', 'String') AS organization_id,
				CAST('', 'String') AS user_id,
				CAST('', 'String') AS parent_source,
				CAST('', 'String') AS parent_session_id,
				toUInt64(0) AS linked_subagent_count,
				CAST([], '${LINKED_SUBAGENT_ARRAY_TYPE}') AS linked_subagents
			WHERE 0
		)`;
	}

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
		session_lineage_counts AS (
			SELECT
				organization_id,
				user_id,
				parent_source,
				parent_session_id,
				countIf(
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
				sa.*,
				ifNull(lineage.linked_subagent_count, 0) AS linked_subagent_count,
				ifNull(
					lineage.linked_subagents,
					CAST([], '${LINKED_SUBAGENT_ARRAY_TYPE}')
				) AS linked_subagents
			FROM ${input.baseRelation} AS sa
			ANY LEFT JOIN session_lineage_counts AS lineage
				ON lineage.organization_id = sa.organization_id
				AND lineage.user_id = sa.user_id
				AND lineage.parent_source = sa.source
				AND lineage.parent_session_id = sa.session_id
		)`;
}
