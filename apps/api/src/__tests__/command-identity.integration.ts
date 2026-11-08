import "./helpers/local-integration-guard.js";
import { expect, test } from "bun:test";
import { COMMAND_SIMHASH_NEAR_BITS } from "@rudel/api-routes";
import { getClickhouse } from "../clickhouse.js";
import {
	buildCommandRecordsStatement,
	type CommandColumns,
	type CommandRecord,
	MERGE,
	NEAR_DUPLICATES,
	PROGRAMS,
	SEPARATE,
} from "./helpers/command-identity-cases.js";

const clickhouse = getClickhouse();

function columns(records: readonly CommandRecord[]): Promise<CommandColumns[]> {
	return clickhouse.query<CommandColumns>(
		buildCommandRecordsStatement(records),
	);
}

/** The rows of each group, computed in one statement. */
async function groupColumns(
	groups: readonly (readonly [string, readonly CommandRecord[]])[],
): Promise<(readonly [string, CommandRecord[], CommandColumns[]])[]> {
	const rows = await columns(groups.flatMap(([, records]) => records));
	let start = 0;
	return groups.map(([name, records]) => {
		start += records.length;
		return [name, [...records], rows.slice(start - records.length, start)];
	});
}

test("commands that differ only in incidental values share a fingerprint", async () => {
	for (const [name, , rows] of await groupColumns(MERGE)) {
		expect({
			name,
			fingerprints: new Set(rows.map((row) => row.command_fingerprint)).size,
			unknown: rows.some((row) => row.command_fingerprint === null),
		}).toEqual({ name, fingerprints: 1, unknown: false });
	}
});

test("different commands keep fingerprints of their own", async () => {
	for (const [name, records, rows] of await groupColumns(SEPARATE)) {
		expect({
			name,
			fingerprints: new Set(rows.map((row) => row.command_fingerprint)).size,
		}).toEqual({ name, fingerprints: records.length });
	}
});

test("argv0 and prefix name the program a command runs, never a script's", async () => {
	const rows = await columns(PROGRAMS.map(([record]) => record));
	expect(
		rows.map((row) => [
			row.command_from,
			row.command_argv0,
			row.command_prefix,
		]),
	).toEqual(PROGRAMS.map(([, from, argv0, prefix]) => [from, argv0, prefix]));
});

test("a compound command keeps each program it runs, the first one first", async () => {
	const rows = await columns([
		{
			text: "cd ~/repo && bun test x.test.ts && bun run check-types 2>&1 | tail -3",
		},
		{ text: "git add -A; git commit -qm 'a && b' && git push -q origin HEAD" },
		{ text: "echo == types; FOO=1 timeout 60 uv run pytest -q | grep error" },
		{ text: "python3 - <<'EOF'\nimport os\nEOF" },
		{
			tool: "exec",
			text: "await tools.exec_command({cmd: 'ls'}); await tools.exec_command({cmd: 'pwd'})",
		},
	]);
	expect(
		rows.map((row) => [
			row.command_argv0,
			row.command_programs,
			row.command_prefixes,
		]),
	).toEqual([
		["bun", ["bun", "tail"], ["bun test", "bun run", "tail"]],
		["git", ["git"], ["git add", "git commit", "git push"]],
		["pytest", ["pytest", "grep"], ["pytest", "grep error"]],
		["python3", ["python3"], ["python3"]],
		[null, [], []],
	]);
});

test("a near-duplicate script is within the simhash distance, and a one-liner has no simhash", async () => {
	const [first, second, short] = await columns([
		...NEAR_DUPLICATES,
		{ tool: "Bash", text: "git status --short" },
	]);
	expect(first?.command_fingerprint).not.toBe(second?.command_fingerprint);
	const distance = [
		...(
			BigInt(first?.command_simhash ?? -1) ^
			BigInt(second?.command_simhash ?? 0)
		).toString(2),
	].filter((bit) => bit === "1").length;
	expect(distance).toBeLessThanOrEqual(COMMAND_SIMHASH_NEAR_BITS);
	expect(short?.command_simhash).toBeNull();
	expect(short?.command_fingerprint).not.toBeNull();
});

test("only part of a stored text has no fingerprint", async () => {
	const [row] = await clickhouse.query<CommandColumns>({
		...buildCommandRecordsStatement([{ tool: "Bash", text: "bun test" }]),
		query: buildCommandRecordsStatement([
			{ tool: "Bash", text: "bun test" },
		]).query.replace(
			"lengthUTF8(r.6) AS text_chars",
			"lengthUTF8(r.6) + 1 AS text_chars",
		),
	});
	expect(row).toMatchObject({
		command_from: "command",
		command_argv0: null,
		command_fingerprint: null,
	});
});
