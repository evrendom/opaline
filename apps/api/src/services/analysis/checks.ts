import { randomBytes } from "node:crypto";
import {
	type Check,
	type CheckDefinition,
	CheckDefinitionSchema,
} from "@rudel/api-routes";
import type postgres from "postgres";
import type { MeasureParams } from "./retro-measure-sql.js";
import { sqlString, windowEnd, windowStart } from "./retro-measure-sql.js";
import {
	cohortSelect,
	findRetroMeasure,
	MEASURE_MAX_DAYS,
	measureParams,
} from "./retro-measures.js";

export interface CheckRecord {
	readonly workspaceId: string;
	readonly authorId: string;
	readonly name: string;
	readonly definition: CheckDefinition;
}

export interface CheckStore {
	create(record: CheckRecord): Promise<Check>;
	list(owner: { workspaceId: string; authorId: string }): Promise<Check[]>;
	get(
		owner: { workspaceId: string; authorId: string },
		id: string,
	): Promise<Check | null>;
}

export const CHECK_ID_PREFIX = "ck_";
export const CHECKS_PER_MEMBER = 100;

export function newCheckId(): string {
	return `${CHECK_ID_PREFIX}${randomBytes(12).toString("base64url")}`;
}

export function createMemoryCheckStore(
	now: () => Date = () => new Date(),
): CheckStore & { readonly rows: (CheckRecord & Check)[] } {
	const rows: (CheckRecord & Check)[] = [];
	const own = (owner: { workspaceId: string; authorId: string }) =>
		rows.filter(
			(row) =>
				row.workspaceId === owner.workspaceId &&
				row.authorId === owner.authorId,
		);
	return {
		rows,
		async create(record) {
			const check = {
				...record,
				id: newCheckId(),
				enabled: false,
				createdAt: now().toISOString(),
			};
			rows.push(check);
			return publicCheck(check);
		},
		async list(owner) {
			return own(owner).map(publicCheck).reverse();
		},
		async get(owner, id) {
			const found = own(owner).find((row) => row.id === id);
			return found ? publicCheck(found) : null;
		},
	};
}

function publicCheck(check: Check): Check {
	return {
		id: check.id,
		name: check.name,
		definition: check.definition,
		enabled: check.enabled,
		createdAt: check.createdAt,
	};
}

interface CheckRow {
	id: string;
	name: string;
	definition: unknown;
	enabled: boolean;
	created_at: Date | string;
}

function fromRow(row: CheckRow): Check {
	return {
		id: row.id,
		name: row.name,
		definition: CheckDefinitionSchema.parse(row.definition),
		enabled: row.enabled,
		createdAt: new Date(row.created_at).toISOString(),
	};
}

export function createPostgresCheckStore(sql: postgres.Sql): CheckStore {
	return {
		async create(record) {
			const [row] = await sql<CheckRow[]>`
				INSERT INTO analysis_check (id, organization_id, author_id, name, definition)
				VALUES (${newCheckId()}, ${record.workspaceId}, ${record.authorId}, ${record.name},
					${JSON.stringify(record.definition)}::jsonb)
				RETURNING id, name, definition, enabled, created_at
			`;
			if (!row) throw new Error("analysis_check insert returned no row");
			return fromRow(row);
		},
		async list(owner) {
			const rows = await sql<CheckRow[]>`
				SELECT id, name, definition, enabled, created_at FROM analysis_check
				WHERE organization_id = ${owner.workspaceId} AND author_id = ${owner.authorId}
				ORDER BY created_at DESC, id
			`;
			return rows.map(fromRow);
		},
		async get(owner, id) {
			const [row] = await sql<CheckRow[]>`
				SELECT id, name, definition, enabled, created_at FROM analysis_check
				WHERE id = ${id} AND organization_id = ${owner.workspaceId} AND author_id = ${owner.authorId}
			`;
			return row ? fromRow(row) : null;
		},
	};
}

export type CheckScope =
	| { readonly kind: "last"; readonly last: number; readonly today: Date }
	| {
			readonly kind: "window";
			readonly from?: string;
			readonly to?: string;
			readonly today: Date;
	  };

export interface CheckQuery {
	readonly query: string;
	readonly title: string;
	readonly over: string;
	readonly cohort?: string;
}

export function checkQuery(
	name: string,
	definition: CheckDefinition,
	scope: CheckScope,
): CheckQuery | { error: string } {
	return definition.kind === "runs"
		? runsCheckQuery(name, definition, scope)
		: measureCheckQuery(name, definition, scope);
}

function runsCheckQuery(
	name: string,
	definition: Extract<CheckDefinition, { kind: "runs" }>,
	scope: CheckScope,
): CheckQuery | { error: string } {
	let range: string;
	let over: string;
	if (scope.kind === "last") {
		range = `run_id IN (SELECT run_id FROM runs ORDER BY started_at DESC, run_id LIMIT ${scope.last})`;
		over = `the last ${scope.last} runs`;
	} else {
		const params = measureParams(scope, scope.today);
		if ("error" in params) return params;
		range = `started_at >= ${windowStart(params)} AND started_at < ${windowEnd(params)}`;
		over = `runs that started ${params.from}..${params.to}`;
	}
	const where = `${range}
		AND (
${definition.where}
		)`;
	const query =
		definition.target === "run"
			? `SELECT session_id, agent_id, turn_idx, run_id, started_at, active_minutes, cost_usd, prompt_head,
		count() OVER () AS matches
	FROM runs
	WHERE ${where}
	ORDER BY started_at DESC, run_id
	LIMIT 200`
			: `SELECT sid AS session_id, aid AS agent_id, turn AS turn_idx, matching_runs, first_match, active_time,
		count() OVER () AS matches
	FROM (
		SELECT session_id AS sid, argMin(agent_id, (started_at, run_id)) AS aid,
			argMin(turn_idx, (started_at, run_id)) AS turn, count() AS matching_runs,
			min(started_at) AS first_match, round(sum(active_minutes), 1) AS active_time
		FROM runs
		WHERE ${where}
		GROUP BY user_id, session_id
	)
	ORDER BY first_match DESC, session_id
	LIMIT 200`;
	return { query, title: `check ${name}`.slice(0, 120), over };
}

function measureCheckQuery(
	name: string,
	definition: Extract<CheckDefinition, { kind: "measure" }>,
	scope: CheckScope,
): CheckQuery | { error: string } {
	const measure = findRetroMeasure(definition.measure);
	if (!measure)
		return {
			error: `${definition.measure} is not a measure measures action=run can run`,
		};
	const columns = measure.columns.flatMap((column) => column.name.split(", "));
	if (!columns.includes(definition.column))
		return {
			error: `${definition.measure} has no column ${definition.column}; it has ${columns.join(", ")}`,
		};
	const params: MeasureParams | { error: string } =
		scope.kind === "last"
			? measureParams(
					{
						latest: Math.min(scope.last, 500),
						from: new Date(
							scope.today.getTime() - (MEASURE_MAX_DAYS - 1) * 86_400_000,
						)
							.toISOString()
							.slice(0, 10),
						...(definition.repository
							? { repository: definition.repository }
							: {}),
						limit: 200,
					},
					scope.today,
				)
			: measureParams(
					{
						from: scope.from,
						to: scope.to,
						...(definition.repository
							? { repository: definition.repository }
							: {}),
						limit: 200,
					},
					scope.today,
				);
	if ("error" in params) return params;
	const query = `SELECT *, count() OVER () AS matches
	FROM (
${measure.build(params)}
	)
	WHERE ${definition.column} >= ${definition.min}
	ORDER BY ${definition.column} DESC
	LIMIT 200`;
	return {
		query,
		title: `check ${name}`.slice(0, 120),
		over:
			scope.kind === "last"
				? `the last ${params.latest} sessions${definition.repository ? ` in ${sqlString(definition.repository)}` : ""}`
				: `sessions that started ${params.from}..${params.to}`,
		cohort: cohortSelect(params),
	};
}
