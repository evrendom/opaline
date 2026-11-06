import {
	type ClickHouseExecutor,
	createClickHouseExecutor,
} from "@chkit/clickhouse";
import { resolveClickHouseUsername } from "../src/clickhouse-connection.js";
import {
	STRING_DEFAULTS,
	stringDefaultExpression,
} from "./migrate-string-defaults.js";

export const QUOTED_ARCHETYPE = "'standard'";
export const QUOTED_ERROR_PATTERN = "''";

export const AFFECTED_ROWS = `session_archetype = ${stringDefaultExpression(QUOTED_ARCHETYPE)} AND error_pattern = ${stringDefaultExpression(QUOTED_ERROR_PATTERN)}`;

const ORGANIZATION_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const TABLE = "rudel.session_analytics";

export interface RepairOptions {
	apply: boolean;
	organizations: readonly string[] | "all";
	maxRowsPerOrganization: number;
}

export function parseRepairArgs(argv: readonly string[]): RepairOptions {
	const organizations: string[] = [];
	let all = false;
	let apply = false;
	let maxRowsPerOrganization = 2_000;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--apply") apply = true;
		else if (arg === "--all") all = true;
		else if (arg === "--organization") {
			const id = argv[++index] ?? "";
			if (!ORGANIZATION_ID.test(id))
				throw new Error(`Invalid --organization: ${id}`);
			organizations.push(id);
		} else if (arg === "--max-rows") {
			maxRowsPerOrganization = Number(argv[++index]);
			if (
				!Number.isSafeInteger(maxRowsPerOrganization) ||
				maxRowsPerOrganization < 1
			)
				throw new Error("--max-rows must be a positive integer");
		} else throw new Error(`Unknown argument: ${arg}`);
	}
	if (all && organizations.length > 0)
		throw new Error("Pass --all or --organization, not both");
	if (apply && !all && organizations.length === 0)
		throw new Error("--apply needs --organization <id> or --all");
	return {
		apply,
		organizations: all || organizations.length === 0 ? "all" : organizations,
		maxRowsPerOrganization,
	};
}

function organizationFilter(organizations: RepairOptions["organizations"]) {
	return organizations === "all"
		? ""
		: ` AND organization_id IN (${organizations.map((id) => `'${id}'`).join(", ")})`;
}

export function dryRunSql(
	organizations: RepairOptions["organizations"],
	table = TABLE,
) {
	return `SELECT organization_id, count() AS rows, countIf(session_date >= '2026-10-31') AS since_oct_31
FROM ${table} FINAL
WHERE ${AFFECTED_ROWS}${organizationFilter(organizations)}
GROUP BY organization_id
ORDER BY rows DESC
SETTINGS max_execution_time = 30`;
}

export function affectedRowsSql(
	organizationId: string,
	limit: number,
	table = TABLE,
) {
	if (!ORGANIZATION_ID.test(organizationId))
		throw new Error(`Invalid organization: ${organizationId}`);
	return `SELECT * FROM ${table} FINAL
WHERE organization_id = '${organizationId}' AND ${AFFECTED_ROWS}
ORDER BY session_id
LIMIT ${limit + 1}
SETTINGS max_execution_time = 30`;
}

export function stripDefaultQuotes(
	row: Record<string, unknown>,
): Record<string, unknown> {
	if (
		row.session_archetype !== QUOTED_ARCHETYPE ||
		row.error_pattern !== QUOTED_ERROR_PATTERN
	)
		throw new Error(`Row ${String(row.session_id)} is not affected`);
	return {
		...row,
		session_archetype: STRING_DEFAULTS.session_analytics.session_archetype,
		error_pattern: STRING_DEFAULTS.session_analytics.error_pattern,
	};
}

/**
 * ClickHouse Cloud-style hosts silently write nothing for INSERT ... SELECT
 * from the same table, so rows are read and written back. Under
 * ReplacingMergeTree the row inserted last wins among equal versions, so the
 * repaired row replaces the affected one without changing `revision`, which
 * session detail joins to the raw session's revision.
 */
export function insertSql(
	rows: readonly Record<string, unknown>[],
	table = TABLE,
) {
	return `INSERT INTO ${table} SETTINGS async_insert = 0 FORMAT JSONEachRow
${rows.map((row) => JSON.stringify(row)).join("\n")}`;
}

export async function repairOrganization(
	executor: ClickHouseExecutor,
	organizationId: string,
	maxRows: number,
	table = TABLE,
): Promise<number> {
	const rows = await executor.query<Record<string, unknown>>(
		affectedRowsSql(organizationId, maxRows, table),
	);
	if (rows.length > maxRows)
		throw new Error(
			`${organizationId}: more than ${maxRows} affected rows; raise --max-rows`,
		);
	if (rows.length === 0) return 0;
	await executor.execute(insertSql(rows.map(stripDefaultQuotes), table));
	const [left] = await executor.query<{ rows: string }>(
		`SELECT count() AS rows FROM ${table} FINAL WHERE organization_id = '${organizationId}' AND ${AFFECTED_ROWS} SETTINGS max_execution_time = 30`,
	);
	if (Number(left?.rows) !== 0)
		throw new Error(
			`${organizationId}: ${left?.rows ?? "?"} rows still affected after repairing ${rows.length}`,
		);
	return rows.length;
}

async function liveDefaultsFixed(
	executor: ClickHouseExecutor,
): Promise<boolean> {
	const rows = await executor.query<{
		name: string;
		default_expression: string;
	}>(`
		SELECT name, default_expression FROM clusterAllReplicas('default', system.columns)
		WHERE database = 'rudel' AND table = 'session_analytics'
			AND name IN ('session_archetype', 'error_pattern')
		SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`);
	return (
		rows.length > 0 &&
		rows.every(
			(row) =>
				row.default_expression ===
				stringDefaultExpression(
					STRING_DEFAULTS.session_analytics[
						row.name as "session_archetype" | "error_pattern"
					],
				),
		)
	);
}

async function main(): Promise<void> {
	const options = parseRepairArgs(process.argv.slice(2));
	const url = process.env.CLICKHOUSE_URL;
	if (!url) throw new Error("CLICKHOUSE_URL is required");
	const executor = createClickHouseExecutor({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		database: "default",
	});
	try {
		const counts = await executor.query<{
			organization_id: string;
			rows: string;
			since_oct_31: string;
		}>(dryRunSql(options.organizations));
		console.table(counts);
		if (!options.apply) return;
		if (!(await liveDefaultsFixed(executor)))
			throw new Error(
				"Apply 20261106120000_string_defaults.sql on every replica first, or new rows keep the quotes",
			);
		for (const { organization_id: organizationId } of counts) {
			const repaired = await repairOrganization(
				executor,
				organizationId,
				options.maxRowsPerOrganization,
			);
			console.log(`${organizationId}: repaired ${repaired} rows`);
		}
	} finally {
		await executor.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
