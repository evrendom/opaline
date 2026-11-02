import { createHmac } from "node:crypto";
import { getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import {
	createAgentQueryLimiter,
	createPostgresAgentQuerySlots,
} from "../analysis/agent-query-slots.js";
import { visibleGitHubRepositories } from "../analysis/github-access.js";
import { createPostgresSqlQuota } from "../analysis/sql-results.js";
import { workspaceFeatureEnabled } from "../workspace-features.js";
import type { AgentRunsEnv } from "./agent-runs.js";
import { findRunQuestions, listRunQuestions } from "./catalogue.js";
import {
	readRunQuestionProviders,
	readRunQuestionWorkspaces,
} from "./provider.js";
import type { RunQuestionsEnv } from "./run-questions.service.js";
import type { SessionAnswersEnv } from "./session-answers.js";

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

/**
 * What the dashboard's answer reads need: the workspace gate and the
 * catalogue's labels. A workspace sees tags only when its runs are answered
 * and the run question tags feature is on for it (`workspace-features.ts`:
 * its admin switch, else RUN_QUESTION_TAGS_WORKSPACES).
 */
export function sessionAnswersEnv(): SessionAnswersEnv {
	const answered = readRunQuestionWorkspaces();
	return {
		executor: getClickhouse(),
		mayAnswer: async (workspaceId) =>
			answered(workspaceId) &&
			(await workspaceFeatureEnabled(
				sqlClient,
				"run_question_tags",
				workspaceId,
			)),
		labelsOf: async (ids) =>
			new Map(
				(await findRunQuestions(sqlClient, ids)).map((question) => [
					question.id,
					question.label,
				]),
			),
	};
}

/** What the Agent traces page needs: the dashboard's gate and the questions answered now. */
export function agentRunsEnv(): AgentRunsEnv {
	const { executor, mayAnswer } = sessionAnswersEnv();
	return {
		executor,
		mayAnswer,
		onQuestions: async () =>
			(await listRunQuestions(sqlClient)).filter(
				(question) => question.state === "on",
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
