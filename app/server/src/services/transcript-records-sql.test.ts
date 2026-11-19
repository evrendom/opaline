import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

const sourceColumns = new Set(
	["base-sessions.ts", "claude-sessions.ts", "transcript-records.ts"].flatMap(
		(file) =>
			[
				...readFileSync(
					new URL(
						`../../../../packages/ch-schema/src/db/schema/${file}`,
						import.meta.url,
					),
					"utf8",
				).matchAll(/\bname:\s*"([a-z_]\w*)"/gu),
			].map((match) => match[1] ?? ""),
	),
);

function findShadowingAliases(sql: string): string[] {
	const normalized = sql
		.replace(/\$\{[\s\S]*?\}/gu, "")
		.replace(/'(?:''|\\.|[^'])*'/gu, "")
		.replace(/\{[^{}]*\}/gu, "");
	const collisions = new Set<string>();
	for (const select of normalized.matchAll(/\bSELECT\b/giu)) {
		const projectionTokens: string[] = [];
		const scopeTokens: string[] = [];
		let depth = 0;
		let nestedSelectDepth: number | undefined;
		let inProjection = true;
		for (const token of normalized
			.slice(select.index + select[0].length)
			.matchAll(/[a-z_]\w*|[().,]|\S/giu)) {
			const value = token[0];
			if ((value.toUpperCase() === "SELECT" || value === ")") && depth === 0)
				break;
			if (value === "(") depth++;
			if (value === ")") depth--;
			if (value.toUpperCase() === "SELECT" && nestedSelectDepth === undefined)
				nestedSelectDepth = depth;
			if (nestedSelectDepth !== undefined) {
				if (depth < nestedSelectDepth) nestedSelectDepth = undefined;
				else continue;
			}
			if (value.toUpperCase() === "FROM" && depth === 0) inProjection = false;
			scopeTokens.push(value);
			if (inProjection) projectionTokens.push(value);
		}
		const projection = projectionTokens.join(" ");
		const aliases = [...projection.matchAll(/\bAS\s+([a-z_]\w*)/giu)].map(
			(match) => match[1]?.toLowerCase() ?? "",
		);
		const references = new Set(
			[
				...scopeTokens
					.join(" ")
					.replace(/\bAS\s+[a-z_]\w*/giu, "")
					.matchAll(/\b[a-z_]\w*\b/giu),
			].map((match) => match[0].toLowerCase()),
		);
		for (const alias of aliases) {
			if (sourceColumns.has(alias) && references.has(alias))
				collisions.add(alias);
		}
	}
	return [...collisions].sort();
}

describe("transcript records SQL alias safety", () => {
	test.each([
		"SELECT toString(max(revision)) AS revision, argMax(content, revision) AS content_bytes FROM raw",
		"SELECT toString(max(raw.revision)) AS revision, argMax(raw.content, raw.revision) AS content_bytes FROM raw",
		"SELECT max(revision) AS max_revision, argMax(content, revision) AS revision FROM raw",
		"SELECT toString(revision) AS revision FROM raw ORDER BY revision DESC",
		"SELECT max(record_idx) AS revision FROM raw WHERE raw.revision > 0",
	])("detects census and snapshot revision shadowing: %s", (sql) => {
		expect(findShadowingAliases(sql)).toEqual(["revision"]);
	});

	test.each([
		[
			"SELECT min(byte_start) AS byte_start, max(byte_start + byte_len) AS byte_end FROM records",
			"byte_start",
		],
		["SELECT max(toUInt8(is_error)) AS is_error FROM records", "is_error"],
		[
			"SELECT argMax(exit_code, record_idx) AS exit_code FROM records",
			"exit_code",
		],
		[
			"SELECT toString(argMax(session_date, revision)) AS session_date FROM raw",
			"session_date",
		],
	])("detects reader/source column shadowing: %s", (sql, alias) => {
		expect(findShadowingAliases(sql)).toEqual([alias]);
	});

	test("keeps aliases scoped to their SELECT, including tuple-derived columns", () => {
		expect(
			findShadowingAliases(`
				SELECT newest_generation.2 AS parser_version FROM (
					SELECT max((records.revision, records.parser_version)) AS newest_generation FROM records
				)
			`),
		).toEqual([]);
	});

	test("does not confuse strings, parameters, or derived alias references with source columns", () => {
		expect(
			findShadowingAliases(
				"SELECT max(revision) AS max_revision FROM raw HAVING max_revision > {revision:UInt64} AND 'max_revision' != ''",
			),
		).toEqual([]);
	});

	for (const file of readdirSync(import.meta.dir).filter(
		(name) =>
			name.startsWith("transcript-records") &&
			name.endsWith(".ts") &&
			!name.endsWith(".test.ts"),
	)) {
		test(`${file} never aliases a referenced source column`, () => {
			const source = readFileSync(new URL(file, import.meta.url), "utf8");
			const sqlTemplates = [...source.matchAll(/`([^`]*)`/gu)]
				.map((match) => match[1] ?? "")
				.filter((template) => /\bSELECT\b/iu.test(template));
			for (const sql of sqlTemplates) {
				expect(findShadowingAliases(sql)).toEqual([]);
			}
		});
	}
});
