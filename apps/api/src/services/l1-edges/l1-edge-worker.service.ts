import { getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import { readBooleanEnv } from "../../lib/env.js";
import {
	loadGitHubAccessForEdges,
	postgresGitHubSource,
} from "../analysis/github-access.js";
import { precomputeEnv } from "../run-questions/env.js";
import { precomputeSessionAnswers } from "../run-questions/precompute.js";
import { runL1EdgePass } from "./l1-edge-reconciliation.service.js";

/** Whether this deployment builds L1 edges; requests are queued either way. */
export function isL1EdgeWorkerEnabled(): boolean {
	return readBooleanEnv("L1_EDGES_WORKER_ENABLED", false);
}

/**
 * One budgeted pass over due edge scopes with the production sources; each
 * run index build that commits queues its runs' answers to the run questions
 * that are on (only where a provider is configured and the workspace may
 * have them answered).
 */
export function runConfiguredL1EdgePass(budgetMs: number): Promise<number> {
	const runQuestions = precomputeEnv();
	return runL1EdgePass({
		sql: sqlClient,
		budgetMs,
		afterRunIndexBuilt: (session) =>
			precomputeSessionAnswers(runQuestions, session),
		sources: {
			executor: getClickhouse(),
			access: loadGitHubAccessForEdges,
			evidence: postgresGitHubSource.evidence,
		},
	});
}
