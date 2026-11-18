import { getClickhouse } from "../clickhouse.js";
import {
	readPositiveSafeIntegerEnv,
	shouldDeriveSessionLineage,
} from "../lib/env.js";
import { reconcileSessionLineageUntilCaughtUp } from "../services/session-lineage-reconciliation.service.js";

interface SessionLineageCensusRow {
	readonly confirmed_edges: number | string;
	readonly countable_edges: number | string;
	readonly distinct_children: number | string;
}

if (!shouldDeriveSessionLineage()) {
	throw new Error(
		"SESSION_LINEAGE_ENABLED=true is required for the lineage backfill",
	);
}

const batchSize = readPositiveSafeIntegerEnv(
	"SESSION_LINEAGE_RECONCILE_BATCH_SIZE",
	25,
);
const result = await reconcileSessionLineageUntilCaughtUp(batchSize);
const clickhouse = getClickhouse();
const census = await clickhouse.query<SessionLineageCensusRow>({
	clickhouse_settings: {
		max_bytes_to_read: "10000000000",
		max_execution_time: 30,
		timeout_before_checking_execution_speed: 0,
	},
	query: `
		WITH current_edges AS (
			SELECT
				organization_id,
				user_id,
				child_source,
				child_session_id,
				argMax(countable, replacement_version) AS countable,
				argMax(outcome, replacement_version) AS outcome,
				argMax(confidence, replacement_version) AS confidence
			FROM rudel.session_lineage
			WHERE derivation_version = 1
			GROUP BY organization_id, user_id, child_source, child_session_id
		)
		SELECT
			count() AS confirmed_edges,
			uniqExact(tuple(organization_id, user_id, child_source, child_session_id)) AS distinct_children,
			countIf(
				countable = 1
				AND outcome = 'successful'
				AND confidence IN ('id_echo', 'prompt_echo', 'attested_temporal')
			) AS countable_edges
		FROM current_edges
	`,
});
await clickhouse.close();

const row = census[0];
console.log(
	JSON.stringify(
		{
			conservation: {
				confirmedEdges: Number(row?.confirmed_edges ?? 0),
				countableEdges: Number(row?.countable_edges ?? 0),
				distinctChildren: Number(row?.distinct_children ?? 0),
			},
			derivationVersion: 1,
			reconciliation: result,
		},
		null,
		2,
	),
);
