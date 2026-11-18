import { getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import { postgresGitHubSource } from "../analysis/github-access.js";
import { workspaceFeatureEnabled } from "../workspace-features.js";
import { runCiDemoFromEnvironment } from "./demo-run-ci.js";
import type { SessionRunCiEnv } from "./session-run-ci.js";

export function sessionRunCiEnv(): SessionRunCiEnv {
	const demo = runCiDemoFromEnvironment(process.env);
	return {
		executor: getClickhouse(),
		enabled: (workspaceId) =>
			workspaceFeatureEnabled(sqlClient, "run_ci", workspaceId),
		repositories: async (workspaceId) =>
			(await postgresGitHubSource.access(workspaceId)).bindings,
		...(demo ? { demo } : {}),
	};
}
