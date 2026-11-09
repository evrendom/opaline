import { getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import { readBooleanEnv } from "../../lib/env.js";
import { isSelfHosted } from "../../lib/self-hosted.js";
import {
	materializeSessionCallCommands,
	storedCallCommandsEnabled,
} from "../analysis/call-commands.js";
import {
	loadGitHubAccessForEdges,
	postgresGitHubSource,
} from "../analysis/github-access.js";
import { timedIngestPhase } from "../ingest-phase-timings.js";
import { writeSessionContextSnapshot } from "../session-context-snapshot.service.js";
import { runL1EdgePass } from "./l1-edge-reconciliation.service.js";

const SELF_HOSTED_L1_CONCURRENCY = 6;

/** Whether this deployment builds L1 edges; requests are queued either way. */
export function isL1EdgeWorkerEnabled(): boolean {
	return isSelfHosted() || readBooleanEnv("L1_EDGES_WORKER_ENABLED", false);
}

/** One budgeted pass over due edge scopes with the production sources. */
export function runConfiguredL1EdgePass(budgetMs: number): Promise<number> {
	return runL1EdgePass({
		sql: sqlClient,
		budgetMs,
		concurrency: isSelfHosted() ? SELF_HOSTED_L1_CONCURRENCY : 1,
		sources: {
			executor: getClickhouse(),
			access: loadGitHubAccessForEdges,
			evidence: postgresGitHubSource.evidence,
		},
		afterRunIndexBuilt: (session) =>
			Promise.all([
				writeSessionContextSnapshot(getClickhouse(), session),
				storedCallCommandsEnabled()
					? timedIngestPhase("jobs.call_commands", () =>
							materializeSessionCallCommands(getClickhouse(), session),
						)
					: undefined,
			]),
	});
}
