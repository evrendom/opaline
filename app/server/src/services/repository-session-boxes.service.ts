import {
	REPOSITORY_SESSION_BOXES_LIMIT,
	type RepositorySessionBoxes,
	SESSION_STEP_KINDS,
	type SessionBoxContext,
	type SessionStepKind,
} from "@rudel/api-routes";
import { ContextKindSchema } from "@rudel/api-routes/session-context-snapshot";
import { SESSION_CONTEXT_SNAPSHOTS_TABLE } from "@rudel/ch-schema/session-context-snapshots";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../clickhouse.js";
import { committedBuildSql } from "./analysis/run-index-reader.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "./analysis/sql.js";
import {
	L1_EDGES_BY_TARGET_TABLE,
	RUN_INDEX_TABLE,
	RUN_REQUESTS_TABLE,
} from "./l1-edges/l1-edge-tables.js";
import { type RepoRange, repoScopeOf } from "./repository-setup.service.js";
import type { SessionRunCiScope } from "./run-ci/session-run-ci.js";

const REPO_OWNER = `organization_id = {workspaceId:String}
	AND (user_id, session_id) IN (SELECT user_id, session_id FROM repo_sessions)`;

const VERIFY_CLASSES = "('build', 'lint', 'test', 'typecheck')";

const STEP_SQL: Record<SessionStepKind, string> = {
	model: "countIf(length(call_records) = 0)",
	search: "sum(arrayCount(g -> g = 'search', call_groups))",
	read: "sum(arrayCount(g -> g = 'read', call_groups))",
	edit: "sum(arrayCount(g -> g = 'edit', call_groups))",
	skill: "sum(arrayCount(t -> t = 'Skill', call_tools))",
	verify: `sum(arrayCount((g, c) -> g = 'shell' AND c IN ${VERIFY_CLASSES}, call_groups, call_classes))`,
	shell: `sum(arrayCount((g, c) -> g = 'shell' AND c NOT IN ${VERIFY_CLASSES} AND c != 'git', call_groups, call_classes))`,
	git: "sum(arrayCount((g, c) -> g = 'shell' AND c = 'git', call_groups, call_classes))",
	tools:
		"sum(arrayCount((g, t) -> g IN ('mcp', 'web', 'browser', 'other') AND t != 'Skill', call_groups, call_tools))",
	agent: "sum(arrayCount(g -> g = 'subagent', call_groups))",
};

export async function repositorySessionBoxes(
	env: { executor: ClickHouseExecutor },
	scope: SessionRunCiScope,
	repoKey: string,
	range?: RepoRange,
): Promise<RepositorySessionBoxes> {
	const repo = await repoScopeOf(env.executor, scope, repoKey, range);
	if (!repo) return { sessions: [], truncated: false };
	const runIndex = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const requests = getSafeClickHouseTable(RUN_REQUESTS_TABLE);
	const edges = getSafeClickHouseTable(L1_EDGES_BY_TARGET_TABLE);
	const committed = committedBuildSql(runIndex, REPO_OWNER, [
		"user_id",
		"session_id",
	]);
	const rows = await query(env.executor, BoxRowSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `WITH ${repo.sessionsCte},
			runs AS (
				SELECT user_id, session_id, run_id, started_at, model, cost_usd
				FROM ${runIndex}
				WHERE ${REPO_OWNER} AND row_kind = 'run' AND ${committed}
			),
			per_session AS (
				SELECT user_id, session_id,
					toUnixTimestamp64Milli(min(started_at)) AS started_ms,
					argMinIf(model, started_at, model IS NOT NULL AND model != '<synthetic>') AS model,
					sum(ifNull(cost_usd, 0)) AS cost,
					countIf(cost_usd IS NULL) AS unpriced,
					count() AS agent_runs
				FROM runs
				GROUP BY user_id, session_id
				ORDER BY cost DESC, agent_runs DESC
				LIMIT ${REPOSITORY_SESSION_BOXES_LIMIT + 1}
			),
			session_models AS (
				SELECT user_id, session_id, any(model_used) AS session_model
				FROM ${getSafeClickHouseTable("rudel.session_analytics")} FINAL
				WHERE ${REPO_OWNER}
					AND (user_id, session_id) IN (SELECT user_id, session_id FROM per_session)
					AND model_used NOT IN ('', '<synthetic>', 'unknown')
				GROUP BY user_id, session_id
			),
			steps AS (
				SELECT user_id, session_id,
					${SESSION_STEP_KINDS.map((kind) => `${STEP_SQL[kind]} AS step_${kind}`).join(",\n\t\t\t\t\t")}
				FROM ${requests} FINAL
				WHERE ${REPO_OWNER} AND ${committed}
					AND (user_id, session_id) IN (SELECT user_id, session_id FROM per_session)
				GROUP BY user_id, session_id
			),
			signals AS (
				SELECT user_id, session_id, sum(
						arraySum(mapValues(model_apology_counts))
						+ arraySum(mapValues(member_negative_counts))) AS signals
				FROM ${getSafeClickHouseTable("rudel.session_language_signals")} FINAL
				WHERE ${REPO_OWNER}
					AND (user_id, session_id) IN (SELECT user_id, session_id FROM per_session)
				GROUP BY user_id, session_id
			),
			links AS (
				SELECT DISTINCT user_id, session_id, to_kind, to_id
				FROM ${edges} FINAL
				WHERE ${REPO_OWNER} AND from_kind = 'run' AND is_active = 1
					AND to_kind IN ('pull_request', 'ci_run')
					AND (user_id, session_id) IN (SELECT user_id, session_id FROM per_session)
					AND from_id IN (SELECT run_id FROM runs)
			),
			merged AS (
				SELECT concat(repository_id, '/', toString(number)) AS pr
				FROM ${getSafeClickHouseTable("rudel.github_pull_requests")} FINAL
				WHERE workspace_id = {workspaceId:String} AND provider = 'github'
					AND merged_at IS NOT NULL
					AND concat(repository_id, '/', toString(number))
						IN (SELECT to_id FROM links WHERE to_kind = 'pull_request')
			),
			contexts AS (
				SELECT user_id, session_id,
					argMax(used_tokens, built_at) AS used_tokens,
					argMax(window_tokens, built_at) AS window_tokens,
					argMax(part_keys, built_at) AS part_keys,
					argMax(part_kinds, built_at) AS part_kinds,
					argMax(part_labels, built_at) AS part_labels,
					argMax(part_tokens, built_at) AS part_tokens
				FROM ${getSafeClickHouseTable(SESSION_CONTEXT_SNAPSHOTS_TABLE)} FINAL
				WHERE organization_id = {workspaceId:String}
					AND (user_id, session_id) IN (SELECT user_id, session_id FROM per_session)
				GROUP BY user_id, session_id
			),
			outcomes AS (
				SELECT user_id, session_id,
					countIf(to_kind = 'pull_request' AND to_id IN (SELECT pr FROM merged)) AS merged_prs,
					countIf(to_kind = 'ci_run') AS ci_runs
				FROM links
				GROUP BY user_id, session_id
			)
			SELECT p.user_id AS user_id, p.session_id AS session_id,
				p.started_ms AS started_ms,
				if(m.session_model != '', m.session_model, p.model) AS model,
				p.cost AS cost,
				p.unpriced AS unpriced, p.agent_runs AS agent_runs,
				ifNull(g.signals, 0) AS signals,
				ifNull(o.merged_prs, 0) AS merged_prs, ifNull(o.ci_runs, 0) AS ci_runs,
				c.used_tokens AS used_tokens, c.window_tokens AS window_tokens,
				c.part_keys AS part_keys, c.part_kinds AS part_kinds,
				c.part_labels AS part_labels,
				c.part_tokens AS part_tokens,
				${SESSION_STEP_KINDS.map((kind) => `ifNull(s.step_${kind}, 0) AS step_${kind}`).join(", ")}
			FROM per_session AS p
			LEFT JOIN steps AS s ON s.user_id = p.user_id AND s.session_id = p.session_id
			LEFT JOIN signals AS g ON g.user_id = p.user_id AND g.session_id = p.session_id
			LEFT JOIN session_models AS m ON m.user_id = p.user_id AND m.session_id = p.session_id
			LEFT JOIN outcomes AS o ON o.user_id = p.user_id AND o.session_id = p.session_id
			LEFT JOIN contexts AS c ON c.user_id = p.user_id AND c.session_id = p.session_id
			ORDER BY cost DESC, agent_runs DESC
			LIMIT ${REPOSITORY_SESSION_BOXES_LIMIT + 1}`,
		query_params: repo.params,
	});
	return {
		sessions: rows.slice(0, REPOSITORY_SESSION_BOXES_LIMIT).map((row) => ({
			sessionId: row.session_id,
			userId: row.user_id,
			startedAt: new Date(row.started_ms).toISOString(),
			model: row.model && row.model !== "<synthetic>" ? row.model : null,
			cost: row.cost,
			unpricedRuns: row.unpriced,
			agentRuns: row.agent_runs,
			signals: row.signals,
			mergedPullRequests: row.merged_prs,
			ciRuns: row.ci_runs,
			context: contextOf(row),
			steps: Object.fromEntries(
				SESSION_STEP_KINDS.map((kind) => [kind, row[`step_${kind}`]]),
			) as Record<SessionStepKind, number>,
		})),
		truncated: rows.length > REPOSITORY_SESSION_BOXES_LIMIT,
	};
}

function contextOf(
	row: z.infer<typeof BoxRowSchema>,
): SessionBoxContext | null {
	if (row.part_kinds.length === 0) return null;
	return {
		used: row.used_tokens,
		window: row.window_tokens,
		parts: row.part_kinds.flatMap((kind, index) => {
			const parsed = ContextKindSchema.safeParse(kind);
			return parsed.success
				? [
						{
							key: row.part_keys[index] ?? "",
							kind: parsed.data,
							label: row.part_labels[index] ?? "",
							tokens: row.part_tokens[index] ?? 0,
						},
					]
				: [];
		}),
	};
}

const BoxRowSchema = z.object({
	user_id: z.string(),
	session_id: z.string(),
	started_ms: z.coerce.number(),
	model: z.string().nullable(),
	cost: z.coerce.number(),
	unpriced: z.coerce.number(),
	agent_runs: z.coerce.number(),
	signals: z.coerce.number(),
	merged_prs: z.coerce.number(),
	ci_runs: z.coerce.number(),
	used_tokens: z.coerce.number(),
	window_tokens: z.coerce.number(),
	part_keys: z.array(z.string()),
	part_kinds: z.array(z.string()),
	part_labels: z.array(z.string()),
	part_tokens: z.array(z.coerce.number()),
	...(Object.fromEntries(
		SESSION_STEP_KINDS.map((kind) => [`step_${kind}`, z.coerce.number()]),
	) as Record<`step_${SessionStepKind}`, z.ZodNumber>),
});
