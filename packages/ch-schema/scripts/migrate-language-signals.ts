import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	checksumSQL,
	createJournalStore,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import { appendJournalEntryWithReconciliation } from "./migrate-f16.js";
import { openMigrationTarget } from "./migration-target.js";

// Apply only the additive columns required by the Dashboard and Repos.
// Never replay historical migrations against an existing database.
const names = [
	"20260916193000_member_negative_signals.sql",
	"20260916210000_signal_phrase_counts.sql",
	"20260918120000_agent_run_summaries.sql",
];
const target = await openMigrationTarget();
const { executor } = target;
try {
	for (const name of names) {
		const sql = await readFile(
			resolve(import.meta.dir, "../chx/migrations", name),
			"utf8",
		);
		const checksum = checksumSQL(sql);
		const journal = createJournalStore(executor);
		const applied = (await journal.readJournal()).applied.find(
			(entry) => entry.name === name,
		);
		if (applied && applied.checksum !== checksum)
			throw new Error(`Language signal migration checksum mismatch: ${name}`);
		if (!applied) {
			for (const statement of extractExecutableStatements(sql))
				await executor.execute(statement);
		}
		// IF NOT EXISTS and the journal alone cannot detect a conflicting column.
		// Check both fresh applies and reruns before recording success.
		if (name === "20260918120000_agent_run_summaries.sql") {
			const [column] = await executor.query<{
				type: string;
				default_kind: string;
				default_expression: string;
			}>(`
				SELECT type, default_kind, default_expression FROM system.columns
				WHERE database = 'rudel' AND table = 'session_language_signals'
				 AND name = 'agent_runs'
				LIMIT 1 SETTINGS max_execution_time = 10
			`);
			const expectedType =
				"Array(Tuple(String, DateTime64(3, 'UTC'), Float64, String, UInt8, String))";
			if (
				column?.type !== expectedType ||
				column.default_kind !== "DEFAULT" ||
				column.default_expression !== "[]"
			)
				throw new Error(
					`Agent-run schema validation failed: expected agent_runs ${expectedType} DEFAULT []; observed ${JSON.stringify(column ?? null)}. Do not deploy the API until schema drift is resolved.`,
				);
		}
		if (!applied) {
			await appendJournalEntryWithReconciliation(journal, {
				name,
				checksum,
				appliedAt: new Date().toISOString().replace("Z", ""),
			});
		}
		console.log(`${applied ? "Already applied" : "Applied"}: ${name}`);
	}
} finally {
	await target.close();
}
