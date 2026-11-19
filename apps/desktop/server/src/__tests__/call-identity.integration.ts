import "./helpers/local-integration-guard.js";
import { expect, test } from "bun:test";
import { getClickhouse } from "../clickhouse.js";
import { commandIdentityOf } from "../services/analysis/call-identity.js";
import {
	buildCommandRecordsStatement,
	type CommandColumns,
	MERGE,
	NEAR_DUPLICATES,
	PROGRAMS,
	SEPARATE,
} from "./helpers/command-identity-cases.js";

test("the build computes every case's command identity as the SQL definition does", async () => {
	const records = [
		...MERGE.flatMap(([, group]) => group),
		...SEPARATE.flatMap(([, group]) => group),
		...PROGRAMS.map(([record]) => record),
		...NEAR_DUPLICATES,
	];
	const rows = await getClickhouse().query<CommandColumns>(
		buildCommandRecordsStatement(records),
	);
	expect(rows).toHaveLength(records.length);
	const differences = rows.flatMap((row, index) => {
		const built = commandIdentityOf(row.command_from, row.command_text);
		const sql = {
			argv0: row.command_argv0,
			prefix: row.command_prefix,
			fingerprint: row.command_fingerprint,
			simhash: row.command_simhash,
			programs: row.command_programs,
			prefixes: row.command_prefixes,
		};
		const ts = {
			...built,
			simhash: built.simhash === null ? null : String(built.simhash),
		};
		return Bun.deepEquals(sql, ts)
			? []
			: [{ text: records[index]?.text, sql, ts }];
	});
	expect(differences).toEqual([]);
});
