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
import { DROPPED_SESSION_ANALYTICS_COLUMNS } from "../src/session-analytics-mv.js";
import { countReplicas } from "./cluster-replicas.js";
import {
	appendJournalEntryWithReconciliation,
	type MigrationJournalStore,
} from "./migrate-f16.js";
import { staleViews } from "./migrate-session-analytics-retirement.js";

export const SESSION_ANALYTICS_DROP_RETIRED_MIGRATION =
	"20261109150000_session_analytics_drop_retired.sql";

/**
 * Drops the retired columns only while no session analytics view on any
 * replica names them: a restart reloaded both views with their old queries
 * once (2026-10-20). Every deploy checks the views again and drops the
 * columns again if a replica serves them.
 */
export async function runSessionAnalyticsDropRetiredMigration(options: {
	executor: ClickHouseExecutor;
	journalStore: MigrationJournalStore;
	migrationSql: string;
	targetDatabase: string;
	readBack?: { attempts: number; delayMs: number };
}): Promise<void> {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(options.targetDatabase))
		throw new Error("Unsafe ClickHouse database");
	const checksum = checksumSQL(options.migrationSql);
	const applied = (await options.journalStore.readJournal()).applied.filter(
		(entry) => entry.name === SESSION_ANALYTICS_DROP_RETIRED_MIGRATION,
	);
	if (applied.some((entry) => entry.checksum !== checksum))
		throw new Error(
			"Session analytics drop retired migration checksum mismatch",
		);
	const replicas = await countReplicas(
		options.executor,
		"the session analytics columns",
	);
	const stale = await staleViews(
		options.executor,
		options.targetDatabase,
		replicas,
	);
	if (stale.length > 0)
		throw new Error(
			`Refusing to drop ${DROPPED_SESSION_ANALYTICS_COLUMNS.join(", ")}: session analytics views are not retired on every replica (${stale.join("; ")}); run ch:migrate:session-analytics-retirement first`,
		);
	const apply = async () => {
		for (const statement of extractExecutableStatements(options.migrationSql))
			await options.executor.execute(statement);
	};
	const journaled = applied.length > 0;
	if (!journaled) await apply();
	else {
		const remaining = await remainingColumns(options, replicas);
		if (remaining !== null) {
			console.warn(
				`${SESSION_ANALYTICS_DROP_RETIRED_MIGRATION}: columns back since the migration was journaled; dropping again (${remaining})`,
			);
			await apply();
		}
	}

	const { attempts, delayMs } = options.readBack ?? {
		attempts: 13,
		delayMs: 10_000,
	};
	for (let attempt = 1; ; attempt++) {
		const remaining = await remainingColumns(options, replicas);
		if (remaining === null) break;
		if (attempt >= attempts) throw new Error(remaining);
		if (attempt === Math.ceil(attempts / 2)) await apply();
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	if (!journaled)
		await appendJournalEntryWithReconciliation(options.journalStore, {
			name: SESSION_ANALYTICS_DROP_RETIRED_MIGRATION,
			checksum,
			appliedAt: new Date().toISOString().replace("Z", ""),
		});
}

/** Why a replica still serves a dropped column, or null when none does. */
async function remainingColumns(
	options: { executor: ClickHouseExecutor; targetDatabase: string },
	replicas: number,
): Promise<string | null> {
	// `session_id` shows that a replica answered after the drop.
	const columns = await options.executor.query<{ host: string; name: string }>(`
		SELECT hostName() AS host, name
		FROM ${replicas > 1 ? "clusterAllReplicas('default', system.columns)" : "system.columns"}
		WHERE database = '${options.targetDatabase}'
			AND table = 'session_analytics'
			AND name IN (${["session_id", ...DROPPED_SESSION_ANALYTICS_COLUMNS].map((name) => `'${name}'`).join(", ")})
		ORDER BY host, name LIMIT 8 BY host
		SETTINGS max_execution_time = 10, skip_unavailable_shards = 0`);
	const hosts = new Set(
		columns.filter((row) => row.name === "session_id").map((row) => row.host),
	);
	if (hosts.size < replicas)
		return `session_analytics visible on ${hosts.size} of ${replicas} replicas`;
	const remaining = columns.filter((row) => row.name !== "session_id");
	return remaining.length > 0
		? `Retired session analytics columns still present: ${remaining
				.map((row) =>
					replicas > 1 ? `${row.name} on replica ${row.host}` : row.name,
				)
				.join(", ")}`
		: null;
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
		await runSessionAnalyticsDropRetiredMigration({
			executor,
			journalStore: createJournalStore(executor),
			migrationSql: await readFile(
				resolve(
					import.meta.dir,
					"../chx/migrations",
					SESSION_ANALYTICS_DROP_RETIRED_MIGRATION,
				),
				"utf8",
			),
			targetDatabase: "rudel",
		});
		console.log(
			`Applied/validated: ${SESSION_ANALYTICS_DROP_RETIRED_MIGRATION}`,
		);
	} finally {
		await executor.close();
	}
}

if (import.meta.main)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
