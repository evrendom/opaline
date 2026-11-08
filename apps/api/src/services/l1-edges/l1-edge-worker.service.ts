import { getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import { readBooleanEnv } from "../../lib/env.js";
import {
	loadGitHubAccessForEdges,
	postgresGitHubSource,
} from "../analysis/github-access.js";
import { writeSessionContextSnapshot } from "../session-context-snapshot.service.js";
import { runL1EdgePass } from "./l1-edge-reconciliation.service.js";

/** Whether this deployment builds L1 edges; requests are queued either way. */
export function isL1EdgeWorkerEnabled(): boolean {
	return readBooleanEnv("L1_EDGES_WORKER_ENABLED", false);
}

/** One budgeted pass over due edge scopes with the production sources. */
export function runConfiguredL1EdgePass(budgetMs: number): Promise<number> {
	return runL1EdgePass({
		sql: sqlClient,
		budgetMs,
		sources: {
			executor: getClickhouse(),
			access: loadGitHubAccessForEdges,
			evidence: postgresGitHubSource.evidence,
		},
		afterRunIndexBuilt: (session) =>
			writeSessionContextSnapshot(getClickhouse(), session),
	});
}
