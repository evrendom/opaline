import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ClickHouseExecutor } from "@chkit/clickhouse";
import {
	checksumSQL,
	extractExecutableStatements,
} from "chkit/dist/bin/lib.js";
import {
	type InstalledColumn,
	type InstalledIndex,
	runTranscriptRecordUuidMigration,
	TRANSCRIPT_RECORD_UUID_MIGRATION,
	transcriptRecordUuidStatements,
	transcriptRecordUuidVisible,
} from "../../scripts/migrate-transcript-record-uuid.js";
import transcriptRecordsSchema from "../db/schema/transcript-records.js";

const sql = readFileSync(
	new URL(
		`../../chx/migrations/${TRANSCRIPT_RECORD_UUID_MIGRATION}`,
		import.meta.url,
	),
	"utf8",
);
const table = (
	transcriptRecordsSchema as unknown as {
		columns: { name: string; type: string; comment?: string }[];
		indexes?: unknown[];
	}[]
)[0];
const column = table?.columns.find((found) => found.name === "record_uuid");
const columns = (hosts: string[]): InstalledColumn[] =>
	hosts.map((host) => ({
		host,
		name: "record_uuid",
		type: "String",
		comment: column?.comment ?? "",
	}));
const indexes = (hosts: string[]): InstalledIndex[] =>
	hosts.map((host) => ({
		host,
		name: "record_uuid_bloom",
		type_full: "bloom_filter(0.01)",
		expr: "record_uuid",
		granularity: "1",
	}));

describe("transcript record uuid migration", () => {
	test("only adds the column after call_id and its bloom filter index, as the table defines them", () => {
		const flat = (statement: string) => statement.replaceAll(/\s+/gu, " ");
		expect(extractExecutableStatements(sql).map(flat)).toEqual(
			transcriptRecordUuidStatements("rudel").map(
				(statement) => `${flat(statement)};`,
			),
		);
		expect(extractExecutableStatements(sql).join("\n")).not.toMatch(
			/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b|\bMODIFY\b|\bMATERIALIZE\b/u,
		);
		const names = table?.columns.map((found) => found.name) ?? [];
		expect(names[names.indexOf("call_id") + 1]).toBe("record_uuid");
		expect(column?.type).toBe("String");
		expect(column?.comment).toContain("unknown, not missing");
		expect(table?.indexes).toEqual([
			{
				name: "record_uuid_bloom",
				expression: "record_uuid",
				type: "bloom_filter",
				typeArgs: "0.01",
				granularity: 1,
			},
		]);
	});

	test("the snapshot holds the column and the index", () => {
		const snapshot = JSON.parse(
			readFileSync(
				new URL("../../chx/meta/snapshot.json", import.meta.url),
				"utf8",
			),
		) as {
			definitions: {
				name: string;
				columns: { name: string }[];
				indexes?: unknown[];
			}[];
		};
		const records = snapshot.definitions.find(
			(definition) => definition.name === "transcript_records",
		);
		expect(records?.columns.map((found) => found.name)).toEqual(
			table?.columns.map((found) => found.name),
		);
		expect(
			records?.columns.find((found) => found.name === "record_uuid"),
		).toEqual(column as never);
		expect(records?.indexes).toEqual(table?.indexes);
	});

	test("bootstrap runs its runner", () => {
		expect(
			readFileSync(
				new URL("../../scripts/bootstrap.ts", import.meta.url),
				"utf8",
			),
		).toMatch(
			/\[\s*"20261016120000_transcript_record_uuid\.sql",\s*"migrate-transcript-record-uuid\.ts",?\s*\]/u,
		);
		const manifest = JSON.parse(
			readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
		) as { scripts: Record<string, string> };
		expect(manifest.scripts["ch:migrate:transcript-record-uuid"]).toBe(
			"bun scripts/migrate-transcript-record-uuid.ts",
		);
	});

	test("publication proof needs the column and the index on every replica, as defined", () => {
		expect(
			transcriptRecordUuidVisible(columns(["a", "b"]), indexes(["a", "b"]), 2),
		).toBe(true);
		// ClickHouse may report the expression in parentheses.
		expect(
			transcriptRecordUuidVisible(
				columns(["a"]),
				indexes(["a"]).map((row) => ({ ...row, expr: "(record_uuid)" })),
				1,
			),
		).toBe(true);
		expect(transcriptRecordUuidVisible(columns(["a"]), indexes(["a"]), 2)).toBe(
			false,
		);
		expect(
			transcriptRecordUuidVisible(columns(["a", "b"]), indexes(["a"]), 2),
		).toBe(false);
		expect(
			transcriptRecordUuidVisible(
				columns(["a", "b"]).map((row) =>
					row.host === "b" ? { ...row, comment: "old" } : row,
				),
				indexes(["a", "b"]),
				2,
			),
		).toBe(false);
		expect(
			transcriptRecordUuidVisible(
				columns(["a"]),
				indexes(["a"]).map((row) => ({
					...row,
					type_full: "bloom_filter(0.025)",
				})),
				1,
			),
		).toBe(false);
		expect(transcriptRecordUuidVisible([], [], 1)).toBe(false);
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
				if (query.includes("data_skipping_indices"))
					// Replica b lags on the first read.
					return indexes(reads === 1 ? ["a"] : ["a", "b"]);
				reads++;
				return columns(["a", "b"]);
			},
		} as unknown as ClickHouseExecutor;
		const journalStore = {
			readJournal: async () => ({ applied: journal }),
			appendEntry: async (entry: { name: string; checksum: string }) => {
				journal.push(entry);
			},
		} as never;
		const run = (migrationSql = sql) =>
			runTranscriptRecordUuidMigration({
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
				name: TRANSCRIPT_RECORD_UUID_MIGRATION,
				checksum: checksumSQL(sql),
			}),
		]);
		await expect(run(`${sql}\nSELECT 1;\n`)).rejects.toThrow(
			"checksum mismatch",
		);
	});

	test("when no replica serves the index, it refuses and journals nothing", async () => {
		const journal: { name: string; checksum: string }[] = [];
		await expect(
			runTranscriptRecordUuidMigration({
				executor: {
					execute: async () => {},
					query: async (query: string) => {
						if (query.includes("system.clusters")) return [{ replicas: 1 }];
						if (query.includes("data_skipping_indices")) return [];
						return columns(["a"]);
					},
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
			}),
		).rejects.toThrow("every replica");
		expect(journal).toEqual([]);
		await expect(
			runTranscriptRecordUuidMigration({
				executor: {} as ClickHouseExecutor,
				journalStore: {} as never,
				migrationSql: sql,
				targetDatabase: "rudel; DROP",
			}),
		).rejects.toThrow("Unsafe");
	});
});
