import { getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import { workspaceFeatureEnabled } from "../workspace-features.js";
import { type MomentsEnv, observationsDailyLimit } from "./moments.service.js";
import { observationModelFromEnv } from "./observer.js";
import { runEvidencePages } from "./run-evidence-pages.js";

/** Moments as the API runs them, configured from the environment. */
export function momentsEnv(): MomentsEnv {
	return {
		executor: getClickhouse(),
		sql: sqlClient,
		featureEnabled: (feature, workspaceId) =>
			workspaceFeatureEnabled(sqlClient, feature, workspaceId),
		model: observationModelFromEnv(),
		dailyLimit: observationsDailyLimit(),
		now: () => new Date(),
		evidencePages: runEvidencePages,
	};
}
