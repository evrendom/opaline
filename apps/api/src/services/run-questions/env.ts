import { createHmac } from "node:crypto";
import { getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import {
	createAgentQueryLimiter,
	createPostgresAgentQuerySlots,
} from "../analysis/agent-query-slots.js";
import { visibleGitHubRepositories } from "../analysis/github-access.js";
import { createPostgresSqlQuota } from "../analysis/sql-results.js";
import { findRunQuestions } from "./catalogue.js";
import type { PrecomputeEnv } from "./precompute.js";
import {
	readRunQuestionProviders,
	readRunQuestionWorkspaces,
} from "./provider.js";
import type { RunQuestionsEnv } from "./run-questions.service.js";
import type { SessionAnswersEnv } from "./session-answers.js";
import { runQuestionTagsEnabled } from "./tags-rollout.js";

/** Run questions as the API runs them, configured from the environment. */
export function runQuestionsEnv(): RunQuestionsEnv {
	const providers = readRunQuestionProviders();
	return {
		executor: getClickhouse(),
		sql: sqlClient,
		provider: providers.default,
		providers: providers.byName,
		mayAnswer: readRunQuestionWorkspaces(),
		sqlQuota: createPostgresSqlQuota(sqlClient),
		limiter: createAgentQueryLimiter(createPostgresAgentQuerySlots(sqlClient)),
		githubRepositories: visibleGitHubRepositories,
		estimateKey: estimateKey(process.env.BETTER_AUTH_SECRET),
	};
}

/** What queuing precomputed answers needs: the default provider and the workspace gate. */
export function precomputeEnv(): PrecomputeEnv {
	return {
		executor: getClickhouse(),
		sql: sqlClient,
		provider: readRunQuestionProviders().default,
		mayAnswer: readRunQuestionWorkspaces(),
	};
}

/**
 * What the dashboard's answer reads need: the workspace gate and the
 * catalogue's labels. A workspace sees tags only when its runs are answered
 * and it is on the tags rollout (`runQuestionTagsEnabled`).
 */
export function sessionAnswersEnv(): SessionAnswersEnv {
	const answered = readRunQuestionWorkspaces();
	return {
		executor: getClickhouse(),
		mayAnswer: (workspaceId) =>
			answered(workspaceId) && runQuestionTagsEnabled(workspaceId),
		labelsOf: async (ids) =>
			new Map(
				(await findRunQuestions(sqlClient, ids)).map((question) => [
					question.id,
					question.label,
				]),
			),
	};
}

/** The key estimate tokens are signed with, derived from the server's auth secret. */
function estimateKey(secret: string | undefined): string | null {
	return secret?.trim()
		? createHmac("sha256", secret)
				.update("run-questions-estimate")
				.digest("hex")
		: null;
}
