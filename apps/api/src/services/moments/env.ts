import { getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import { readRunQuestionProviders } from "../run-questions/provider.js";
import { workspaceFeatureEnabled } from "../workspace-features.js";
import type { FrustrationEnv } from "./frustration.js";
import { type MomentsEnv, observationsDailyLimit } from "./moments.service.js";
import { observationModelFromEnv } from "./observer.js";

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
	};
}

/** The frustration check as the cron runs it: SubQ when its key is set. */
export function frustrationEnv(): FrustrationEnv {
	const providers = readRunQuestionProviders();
	return {
		executor: getClickhouse(),
		sql: sqlClient,
		provider: providers.byName.get("subq") ?? providers.default,
		featureEnabled: (feature, workspaceId) =>
			workspaceFeatureEnabled(sqlClient, feature, workspaceId),
	};
}
