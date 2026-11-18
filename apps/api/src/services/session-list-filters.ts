import type {
	RepoIdentity,
	SessionFilterCatalog,
	SessionListFilters,
} from "@rudel/api-routes";
import {
	buildDateFilter,
	buildInclusiveDateRangeFilter,
	queryClickhouse,
} from "../clickhouse.js";
import { toRepoIdentityInput } from "./repo-identity-rows.js";
import { getWorkspaceRepoIdentities } from "./repository-filter.service.js";
import { buildSessionFamilyCostCte } from "./session-family-cost.service.js";
import {
	buildSessionAnalyticsWindowSql,
	getUsageAnalyticsQueryContext,
} from "./usage-event-analytics.service.js";

const NO_SKILLS = "__no_skills_used__";
type RangeKey = keyof SessionListFilters["ranges"];
const RANGE_KEYS: readonly RangeKey[] = [
	"cost",
	"duration",
	"errors",
	"input",
	"output",
	"subagents",
];

const RANGE_COLUMNS: Record<RangeKey, string> = {
	cost: "if(sa.cost_is_complete > 0, sa.estimated_cost, NULL)",
	duration: "sa.actual_duration_min",
	errors: "if(sa.error_count >= 0, sa.error_count, NULL)",
	input: "sa.input_tokens",
	output: "sa.output_tokens",
	subagents: "sa.subagent_count + sa.linked_subagent_count",
};

export async function getSessionFilterCatalog(
	organizationId: string,
	params: { days?: number; start_date?: string; end_date?: string },
): Promise<SessionFilterCatalog> {
	const queryParams = {
		orgId: organizationId,
		days: params.days ?? 30,
		startDate: params.start_date,
		endDate: params.end_date,
	};
	const dateFilter =
		params.start_date && params.end_date
			? buildInclusiveDateRangeFilter("startDate", "endDate", "sa.session_date")
			: buildDateFilter("days", "sa.session_date");
	const usage = await getUsageAnalyticsQueryContext(organizationId, {
		window: {
			includeNativeDescendants: true,
			sessionsSql: buildSessionAnalyticsWindowSql(dateFilter),
		},
	});

	type CatalogRow = {
		repositories: [string, string, string][];
		models: string[];
		skills: string[];
		users: string[];
		no_skills: number;
		session_count: number;
		ranges: [number | null, number | null][];
	};
	const [row] = await queryClickhouse<CatalogRow>({
		clickhouse_settings: {
			...usage.clickhouseSettings,
			log_comment: "analytics.sessions.filterCatalog",
		},
		query: `WITH RECURSIVE ${usage.cteDefinitions},
   ${buildSessionFamilyCostCte({
			inputRelation: usage.sessionsRelation,
			outputRelation: "session_filter_costs",
			rootFilterSql: `sa.is_top_level_session = 1 AND ${dateFilter}`,
			rootRelation: usage.metadataRelation,
		})}
   SELECT groupUniqArray(tuple(sa.git_remote, sa.package_name, sa.project_path)) AS repositories,
    groupUniqArray(sa.model_used) AS models, groupUniqArrayArray(sa.skills) AS skills,
    groupUniqArray(sa.user_id) AS users, countIf(empty(sa.skills)) AS no_skills, count() AS session_count,
    [${RANGE_KEYS.map((key) => `tuple(min(${RANGE_COLUMNS[key]}), max(${RANGE_COLUMNS[key]}))`).join(", ")}] AS ranges
   FROM session_filter_costs AS sa
   WHERE sa.organization_id = {orgId:String}
    AND sa.is_top_level_session = 1
    AND ${dateFilter}`,
		query_params: queryParams,
	});
	if (!row) throw new Error("Session filter catalog was not returned");
	const repositoryRows = row.repositories.map(
		([git_remote, package_name, project_path]) =>
			toRepoIdentityInput({ git_remote, package_name, project_path }),
	);
	const resolver = await getWorkspaceRepoIdentities(
		organizationId,
		repositoryRows,
	);
	const repositories = new Map<string, RepoIdentity>();
	for (const input of repositoryRows) {
		const identity = resolver.resolve(input);
		repositories.set(identity.repoKey, { ...identity, worktree: null });
	}
	const bounds = (key: RangeKey) => {
		const range = row.ranges[RANGE_KEYS.indexOf(key)];
		return normalizeBounds(range?.[0] ?? 0, range?.[1] ?? 0, key);
	};
	return {
		repositories: [...repositories.values()],
		models: row.models,
		skills: row.no_skills ? [...row.skills, NO_SKILLS] : row.skills,
		users: row.users,
		sessionCount: row.session_count,
		ranges: {
			cost: bounds("cost"),
			duration: bounds("duration"),
			errors: bounds("errors"),
			input: bounds("input"),
			output: bounds("output"),
			subagents: bounds("subagents"),
		},
	};
}

export async function getSessionCostMaximum(
	organizationId: string,
): Promise<number> {
	const usage = await getUsageAnalyticsQueryContext(organizationId, {
		window: {
			includeNativeDescendants: true,
			sessionsSql: buildSessionAnalyticsWindowSql("1"),
		},
	});
	const [row] = await queryClickhouse<{ maximum: number | null }>({
		clickhouse_settings: {
			...usage.clickhouseSettings,
			log_comment: "analytics.sessions.costMaximum",
		},
		query: `WITH RECURSIVE ${usage.cteDefinitions},
   ${buildSessionFamilyCostCte({
			inputRelation: usage.sessionsRelation,
			outputRelation: "session_max_costs",
			rootFilterSql: "sa.is_top_level_session = 1",
			rootRelation: usage.metadataRelation,
		})}
   SELECT max(${RANGE_COLUMNS.cost}) AS maximum
   FROM session_max_costs AS sa
   WHERE sa.organization_id = {orgId:String}
    AND sa.is_top_level_session = 1`,
		query_params: { orgId: organizationId },
	});
	return Math.max(row?.maximum ?? 0, 0);
}

function normalizeBounds(minimum: number, maximum: number, key: RangeKey) {
	const step = key === "cost" ? 0.0001 : key === "duration" ? 0.1 : 1;
	const precision = Math.max(0, Math.ceil(-Math.log10(step)));
	return {
		minimum: Number((Math.floor(minimum / step) * step).toFixed(precision)),
		maximum: Number((Math.ceil(maximum / step) * step).toFixed(precision)),
		step,
	};
}

export function appendSessionListSqlFilters(
	input: SessionListFilters,
	clauses: string[],
	params: Record<string, unknown>,
) {
	for (const [key, column] of [
		["model", "sa.model_used"],
		["user", "sa.user_id"],
	] as const) {
		if (input.excluded[key].length) {
			clauses.push(`${column} NOT IN {excluded_${key}:Array(String)}`);
			params[`excluded_${key}`] = input.excluded[key];
		}
	}
	if (input.excluded.skills.length) {
		clauses.push(
			`NOT hasAny(if(empty(sa.skills), ['${NO_SKILLS}'], sa.skills), {excluded_skills:Array(String)})`,
		);
		params.excluded_skills = input.excluded.skills;
	}

	for (const key of RANGE_KEYS) {
		const range = input.ranges[key];
		for (const [bound, operator] of [
			["minimum", ">="],
			["maximum", "<="],
		] as const) {
			if (range[bound] !== null) {
				clauses.push(
					`${RANGE_COLUMNS[key]} ${operator} {filter_${key}_${bound}:Float64}`,
				);
				params[`filter_${key}_${bound}`] = range[bound];
			}
		}
	}
}
