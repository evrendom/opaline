import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	type ClickHouseExecutor,
	createClickHouseExecutor,
} from "@chkit/clickhouse";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import { resolveClickHouseUsername } from "../src/clickhouse-connection.js";
import { RETIRED_SESSION_ANALYTICS_COLUMNS } from "../src/session-analytics-mv.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";

/**
 * Retirement step 3 (docs/l1-literal-schema.md): both session analytics
 * views stop writing interpretations no one reads. `MODIFY QUERY` replaces
 * each view's query in place, so ingestion is never interrupted; the columns
 * keep their defaults until a later migration drops them.
 */
export const SESSION_ANALYTICS_RETIREMENT_MIGRATION =
	"20261008120000_session_analytics_retired_writes.sql";
const VIEWS = ["session_analytics_mv", "codex_session_analytics_mv"] as const;

export async function runSessionAnalyticsRetirementMigration(options: {
	executor: ClickHouseExecutor;
	journalStore: MigrationJournalStore;
	migrationSql: string;
	targetDatabase: string;
	/**
	 * ClickHouse Cloud applies DDL to replicas asynchronously, so a read right
	 * after MODIFY QUERY can see the old view; the check retries this often.
	 */
	readBack?: { attempts: number; delayMs: number };
}): Promise<void> {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.targetDatabase))
		throw new Error("Unsafe ClickHouse database");
	const checksum = checksumSQL(options.migrationSql);
	const applied = (await options.journalStore.readJournal()).applied.filter(
		(entry) => entry.name === SESSION_ANALYTICS_RETIREMENT_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error("Session analytics retirement migration checksum mismatch");
	const apply = async () => {
		for (const statement of extractExecutableStatements(options.migrationSql))
			await options.executor.execute(statement);
	};
	if (applied.length === 0) await apply();
	const { attempts, delayMs } = options.readBack ?? {
		attempts: 13,
		delayMs: 10_000,
	};
	for (let attempt = 1; ; attempt++) {
		const stale = await staleViews(options.executor, options.targetDatabase);
		if (stale.length === 0) break;
		if (attempt >= attempts)
			throw new Error(
				`Session analytics views still write retired columns or lost their revision dedupe after ${attempts} reads: ${stale.join("; ")}`,
			);
		// Halfway, apply the idempotent MODIFY QUERY again in case it did not land.
		if (applied.length === 0 && attempt === Math.ceil(attempts / 2))
			await apply();
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	if (applied.length === 0)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: SESSION_ANALYTICS_RETIREMENT_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
}

/** Views that still name a retired column or lost `_dedupe_rank`, with why. */
async function staleViews(
	executor: ClickHouseExecutor,
	database: string,
): Promise<string[]> {
	const views = await executor.query<{ name: string; as_select: string }>(`
		SELECT name, as_select FROM system.tables
		WHERE database = '${database}'
			AND name IN (${VIEWS.map((view) => `'${view}'`).join(", ")})
		LIMIT 4 SETTINGS max_execution_time = 10`);
	return VIEWS.flatMap((view) => {
		const query = views.find((row) => row.name === view)?.as_select;
		const retired = RETIRED_SESSION_ANALYTICS_COLUMNS.filter((column) =>
			new RegExp(`\\b${column}\\b`, "u").test(query ?? ""),
		);
		return !query?.includes("_dedupe_rank") || retired.length > 0
			? [`${view}: ${retired.join(", ") || "missing view or dedupe"}`]
			: [];
	});
}

async function main(): Promise<void> {
	const url = process.env.CLICKHOUSE_URL;
	if (!url) throw new Error("CLICKHOUSE_URL is required");
	const executor = createClickHouseExecutor({
		url,
		username: resolveClickHouseUsername(process.env, url),
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		database: "default",
	});
	try {
		await runSessionAnalyticsRetirementMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(
					import.meta.dir,
					"../chx/migrations",
					SESSION_ANALYTICS_RETIREMENT_MIGRATION,
				),
				"utf8",
			),
			targetDatabase: "rudel",
		});
		console.log(`Applied/validated: ${SESSION_ANALYTICS_RETIREMENT_MIGRATION}`);
	} finally {
		await executor.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
