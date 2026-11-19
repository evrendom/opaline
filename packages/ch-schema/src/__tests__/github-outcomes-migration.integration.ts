import { expect, setDefaultTimeout, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClickHouseExecutor } from "@chkit/clickhouse";
import { createJournalStore } from "chkit/dist/bin/lib.js";
import {
	assertGitHubOutcomesSchema,
	GITHUB_OUTCOMES_MIGRATION,
	runGitHubOutcomesMigration,
} from "../../scripts/migrate-github-outcomes.js";

setDefaultTimeout(120_000);

test("GitHub outcomes runner validates local schema, replay, checksums and version-engine drift", async () => {
	const url = process.env.CLICKHOUSE_URL;
	if (!url) throw new Error("CLICKHOUSE_URL is required");
	const executor = createClickHouseExecutor({
		url,
		username: process.env.CLICKHOUSE_USERNAME ?? "default",
		password: process.env.CLICKHOUSE_PASSWORD ?? "",
		database: "default",
	});
	const migrationSql = await readFile(
		resolve(import.meta.dir, "../../chx/migrations", GITHUB_OUTCOMES_MIGRATION),
		"utf8",
	);
	const input = {
		executor,
		journalStore: createJournalStore(executor),
		migrationSql,
		local: true,
	};
	try {
		await runGitHubOutcomesMigration(input);
		await runGitHubOutcomesMigration(input);
		const entries = (await input.journalStore.readJournal()).applied.filter(
			(entry) => entry.name === GITHUB_OUTCOMES_MIGRATION,
		);
		expect(entries).toHaveLength(1);
		await expect(
			runGitHubOutcomesMigration({
				...input,
				migrationSql: `${migrationSql}\nSELECT 1;`,
			}),
		).rejects.toThrow("checksum mismatch");
		await expect(assertGitHubOutcomesSchema(executor, false)).rejects.toThrow(
			"schema validation failed",
		);
		await executor.execute(
			"ALTER TABLE rudel.github_ci_jobs COMMENT COLUMN name 'drift'",
		);
		await expect(runGitHubOutcomesMigration(input)).rejects.toThrow(
			"schema validation failed",
		);
	} finally {
		await executor.execute(
			"ALTER TABLE rudel.github_ci_jobs COMMENT COLUMN name 'name from the GitHub provider object.'",
		);
		await executor.close();
	}
});
