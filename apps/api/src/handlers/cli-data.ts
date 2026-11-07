import { getClickhouse } from "../clickhouse.js";
import { getClickHouseLines } from "../clickhouse-lines.js";
import { sqlClient } from "../db.js";
import { ingestAuthMiddleware, os } from "../middleware.js";
import {
	type AgentQueryLimiter,
	createAgentQueryLimiter,
	createPostgresAgentQuerySlots,
} from "../services/analysis/agent-query-slots.js";
import { analysisLimiter } from "../services/analysis/concurrency.js";
import {
	postgresGitHubSource,
	visibleGitHubRepositories,
} from "../services/analysis/github-access.js";
import { withCallQuota } from "../services/analysis/sql-gateway.js";
import {
	createPostgresSqlQuota,
	type SqlQuota,
} from "../services/analysis/sql-results.js";
import { pullPlan } from "../services/cli-data/pull-plan.js";
import { pullTable } from "../services/cli-data/pull-table.js";
import { exportSql } from "../services/cli-data/sql-export.js";
import {
	type CliDataContext,
	type CliDataEnv,
	FREE_QUOTA,
	watchedQuota,
} from "../services/cli-data/statements.js";
import {
	type CliWorkspace,
	resolveCliWorkspace,
} from "../services/cli-workspace.service.js";
import {
	createSearchAccess,
	postgresSubscriptions,
} from "../services/transcript-search/access.js";
import {
	readEmbeddingQuotaLimits,
	transcriptEmbedder,
} from "../services/transcript-search/config.js";
import { createPostgresEmbeddingQuota } from "../services/transcript-search/quota.js";
import { createSqlSearchFunction } from "../services/transcript-search/search.js";
import { requireRetroTools } from "./analysis/retro-tools.js";

export interface CliDataRouterEnv extends Omit<CliDataEnv, "quota"> {
	readonly quota: SqlQuota;
	readonly workspace?: typeof resolveCliWorkspace;
}

export function defaultCliDataEnv(): CliDataRouterEnv {
	const executor = getClickhouse();
	const quota = createPostgresSqlQuota(sqlClient);
	const limiter: AgentQueryLimiter = createAgentQueryLimiter(
		createPostgresAgentQuerySlots(sqlClient),
	);
	return {
		executor,
		lines: getClickHouseLines(),
		quota,
		limiter,
		githubRepositories: visibleGitHubRepositories,
		githubBindings: async (workspaceId) =>
			(await postgresGitHubSource.access(workspaceId)).bindings,
		functions: [
			createSqlSearchFunction({
				executor,
				quota: createPostgresEmbeddingQuota(
					sqlClient,
					readEmbeddingQuotaLimits(),
				),
				embedderFor: transcriptEmbedder,
				access: createSearchAccess(postgresSubscriptions(sqlClient)),
			}),
		],
	};
}

export function createCliDataRouter(
	env: CliDataRouterEnv = defaultCliDataEnv(),
) {
	const resolve = env.workspace ?? resolveCliWorkspace;
	const open = async (
		context: { user: { id: string }; session: unknown },
		workspace: string | undefined,
		charged: boolean,
		signal: AbortSignal | undefined,
	): Promise<{ workspace: CliWorkspace; data: CliDataContext }> => {
		const resolved = await resolve(workspace, context.session, context.user.id);
		requireRetroTools({
			organizationId: resolved.id,
			workspaceCreatedAt: resolved.workspaceCreatedAt,
		});
		const watched = watchedQuota(charged ? env.quota : FREE_QUOTA);
		return {
			workspace: resolved,
			data: {
				caller: { workspaceId: resolved.id, reader: resolved.reader },
				env: withCallQuota({ ...env, quota: watched.quota }),
				signal,
				quotaRefusedAt: watched.refusedAt,
			},
		};
	};

	return {
		sql: os.cli.data.sql
			.use(ingestAuthMiddleware)
			.handler(async ({ input, context, signal }) => {
				const { data } = await open(context, input.workspace, true, signal);
				return exportSql(data, input.query, input.format);
			}),
		pullPlan: os.cli.data.pullPlan
			.use(ingestAuthMiddleware)
			.handler(async ({ input, context, signal }) => {
				const { workspace, data } = await open(
					context,
					input.workspace,
					true,
					signal,
				);
				return analysisLimiter.run(
					context.user.id,
					() =>
						pullPlan(data, { id: workspace.id, slug: workspace.slug }, input),
					signal,
				);
			}),
		pullTable: os.cli.data.pullTable
			.use(ingestAuthMiddleware)
			.handler(async ({ input, context, signal }) => {
				const { data } = await open(context, input.workspace, false, signal);
				return pullTable(data, input.table, input.sessions);
			}),
	};
}
