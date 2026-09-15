import {
	resolveRepoIdentity,
	type SessionFilterCatalog,
	type SessionListFilters,
} from "@rudel/api-routes";
import {
	buildDateFilter,
	buildInclusiveDateRangeFilter,
	queryClickhouse,
} from "../clickhouse.js";
import type { SessionAnalyticsListRow } from "./session-analytics.service.js";
import { getUsageAnalyticsQueryContext } from "./usage-event-analytics.service.js";

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
	const usage = await getUsageAnalyticsQueryContext(organizationId);
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
		query: `WITH ${usage.cteDefinitions}
   SELECT groupUniqArray(tuple(git_remote, package_name, project_path)) AS repositories,
    groupUniqArray(model_used) AS models, groupUniqArrayArray(sa.skills) AS skills,
    groupUniqArray(user_id) AS users, countIf(empty(sa.skills)) AS no_skills, count() AS session_count,
    [${RANGE_KEYS.map((key) => `tuple(min(${RANGE_COLUMNS[key]}), max(${RANGE_COLUMNS[key]}))`).join(", ")}] AS ranges
   FROM ${usage.sessionsRelation} AS sa WHERE sa.organization_id = {orgId:String} AND ${dateFilter}`,
		query_params: queryParams,
	});
	if (!row) throw new Error("Session filter catalog was not returned");
	const repositories = new Map<
		string,
		ReturnType<typeof resolveRepoIdentity>
	>();
	for (const [gitRemote, packageName, projectPath] of row.repositories) {
		const identity = resolveRepoIdentity({
			gitRemote: gitRemote || null,
			packageName: packageName || null,
			projectPath,
		});
		repositories.set(identity.repoKey, identity);
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

export function getSessionListRepositoryKey(row: SessionAnalyticsListRow) {
	return resolveRepoIdentity({
		gitRemote: row.git_remote || null,
		packageName: row.package_name || null,
		projectPath: row.project_path,
	}).repoKey;
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
