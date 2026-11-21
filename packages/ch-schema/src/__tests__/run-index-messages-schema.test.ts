import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import {
	RUN_INDEX_MESSAGES_MIGRATION,
	runIndexMessagesStatement,
	runIndexMessagesVisible,
	runRunIndexMessagesMigration,
} from "../../scripts/migrate-run-index-messages.js";
import { runIndexTable } from "../db/schema/run-index.js";

const sql = readFileSync(
	new URL(
		`../../chx/migrations/${RUN_INDEX_MESSAGES_MIGRATION}`,
		import.meta.url,
	),
	"utf8",
);
const column = (name: string) => {
	const found = (
		runIndexTable as unknown as {
			columns: { name: string; type: string; comment: string }[];
		}
	).columns.find((candidate) => candidate.name === name);
	if (!found) throw new Error(`no column ${name}`);
	return found;
};
const ADDED = [
	"prompt_reactions",
	"final_message",
	"final_message_cut",
	"system_prompt_recorded",
].map(column);
const rows = (hosts: string[]) =>
	hosts.flatMap((host) => ADDED.map((added) => ({ host, ...added })));

describe("run index messages migration", () => {
	test("only adds its columns, as the table defines them and the run index runner adds them", () => {
		const statements = extractExecutableStatements(sql);
		const flat = (statement: string) => statement.replaceAll(/\s+/gu, " ");
		expect(statements.map(flat)).toEqual([
			`${flat(runIndexMessagesStatement("rudel"))};`,
		]);
		expect(sql).not.toMatch(
			/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b|\bMODIFY\b/u,
		);
		expect(
			readFileSync(
				new URL("../../scripts/migrate-run-index.ts", import.meta.url),
				"utf8",
			),
		).toContain("runIndexMessagesStatement(options.targetDatabase)");
	});

	test("the snapshot holds the added columns", () => {
		const snapshot = JSON.parse(
			readFileSync(
				new URL("../../chx/meta/snapshot.json", import.meta.url),
				"utf8",
			),
		) as {
			definitions: {
				name: string;
				columns: { name: string; type: string; comment: string }[];
			}[];
		};
		const runIndex = snapshot.definitions.find(
			(definition) => definition.name === "run_index",
		);
		for (const added of ADDED)
			expect(
				runIndex?.columns.find((candidate) => candidate.name === added.name),
			).toEqual(added);
	});

	test("bootstrap runs its runner", () => {
		expect(
			readFileSync(
				new URL("../../scripts/bootstrap.ts", import.meta.url),
				"utf8",
			),
		).toContain(
			'["20261012170000_run_index_messages.sql", "migrate-run-index-messages.ts"]',
		);
	});

	test("publication proof rejects lagging replicas and other definitions", () => {
		expect(runIndexMessagesVisible(rows(["a", "b"]), 2)).toBe(true);
		expect(runIndexMessagesVisible(rows(["a"]), 2)).toBe(false);
		expect(
			runIndexMessagesVisible(
				rows(["a", "b"]).map((row) =>
					row.host === "b" && row.name === "final_message"
						? { ...row, comment: "old" }
						: row,
				),
				2,
			),
		).toBe(false);
		expect(runIndexMessagesVisible([], 1)).toBe(false);
	});

	test("applies the migration once and journals it after every replica serves it", async () => {
		const executed: string[] = [];
		const journal: { name: string; checksum: string }[] = [];
		let reads = 0;
		const executor = {
			execute: async (statement: string) => {
				executed.push(statement);
			},
			query: async (query: string) => {
				if (query.includes("system.clusters")) return [{ replicas: 2 }];
				reads++;
				// Replica b lags on the first read.
				return rows(reads === 1 ? ["a"] : ["a", "b"]);
			},
		} as unknown as ClickHouseExecutor;
		const journalStore = {
			readJournal: async () => ({ applied: journal }),
			appendEntry: async (entry: { name: string; checksum: string }) => {
				journal.push(entry);
			},
		} as never;
		const run = (migrationSql = sql) =>
			runRunIndexMessagesMigration({
				executor,
				journalStore,
				migrationSql,
				targetDatabase: "rudel",
				readBack: { attempts: 3, delayMs: 0 },
			});
		await run();
		await run();
		expect(executed).toEqual(extractExecutableStatements(sql));
		expect(reads).toBe(3);
		expect(journal).toEqual([
			expect.objectContaining({
				name: RUN_INDEX_MESSAGES_MIGRATION,
				checksum: checksumSQL(sql),
			}),
		]);
		await expect(run(`${sql}\nSELECT 1;\n`)).rejects.toThrow(
			"checksum mismatch",
		);
	});

	test("when the cluster list is denied, it still waits for every replica and never journals one replica's columns", async () => {
		const journal: { name: string; checksum: string }[] = [];
		const denied = (what: string) =>
			new Error(
				`Code: 497. DB::Exception: default: Not enough privileges. To execute this query, it's necessary to have the grant ${what}. (ACCESS_DENIED)`,
			);
		const runWith = (query: (statement: string) => Promise<unknown>) =>
			runRunIndexMessagesMigration({
				executor: {
					execute: async () => {},
					query,
				} as unknown as ClickHouseExecutor,
				journalStore: {
					readJournal: async () => ({ applied: journal }),
					appendEntry: async (entry: { name: string; checksum: string }) => {
						journal.push(entry);
					},
				} as never,
				migrationSql: sql,
				targetDatabase: "rudel",
				readBack: { attempts: 2, delayMs: 0 },
			});
		// Two replicas answer, but replica b never serves the columns.
		const twoReplicas = async (statement: string) => {
			if (statement.includes("system.clusters"))
				throw denied("SELECT(cluster) ON system.clusters");
			if (!statement.includes("system.columns"))
				return [{ host: "a" }, { host: "b" }].map((row) => ({
					...row,
					replicas: 2,
				}));
			// The endpoint is replica a; b lags.
			return rows(["a"]);
		};
		await expect(runWith(twoReplicas)).rejects.toThrow("every replica");
		expect(journal).toEqual([]);

		// Nothing can list the replicas: refuse rather than trust one endpoint.
		const unlisted = async (statement: string) => {
			if (
				statement.includes("system.columns") &&
				!statement.includes("clusterAllReplicas")
			)
				return rows(["a"]);
			throw denied("REMOTE ON *.*");
		};
		await expect(runWith(unlisted)).rejects.toThrow("replicas");
		expect(journal).toEqual([]);
	});
});
