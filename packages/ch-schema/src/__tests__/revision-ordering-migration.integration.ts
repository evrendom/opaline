import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTestExecutor } from "./helpers/executor.js";

setDefaultTimeout(300_000);

const DDL_MIGRATION = readFileSync(
	resolve(import.meta.dir, "../../chx/migrations/20260826090551_auto.sql"),
	"utf8",
);
const BACKFILL_MIGRATION = readFileSync(
	resolve(
		import.meta.dir,
		"../../chx/migrations/20260826090600_f16_backfill.sql",
	),
	"utf8",
);
const CODEX_CONTENT = readFileSync(
	resolve(import.meta.dir, "fixtures/codex-session.jsonl"),
	"utf8",
);
const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const DATABASE_PREFIX = `rudel_f16_rehearsal_${RUN_ID}`;
const INGESTED_AT = "2026-08-20T10:00:00.123";
const SESSION_DATE = "2026-08-20T09:00:00.000";
const FILTERED_SESSION_ID = `filtered_${RUN_ID}`;
const CLAUDE_TIE_SESSION_ID = `claude_tie_${RUN_ID}`;
const CODEX_TIE_SESSION_ID = `codex_tie_${RUN_ID}`;
const executor = createTestExecutor();
const databases: string[] = [];
const VERIFIED_GENERATED_DOUBLED_QUOTE_LITERALS = new Set([
	"''''''",
	"'''claude_code'''",
	"'''standard'''",
]);

interface WinnerRow {
	filter_version: number;
	revision: string;
	session_id: string;
	tag: string | null;
}

interface RehearsalResult {
	analyticsCoverage: number;
	invalidSuffixes: number;
	minimumRevision: string;
	signalEngine: string;
	signalRawRevision: string;
	winners: WinnerRow[];
}

function databaseName(suffix: string): string {
	const database = `${DATABASE_PREFIX}_${suffix}`;
	if (!/^[a-zA-Z0-9_]+$/u.test(database)) {
		throw new Error(`Unsafe ClickHouse rehearsal database: ${database}`);
	}
	databases.push(database);
	return database;
}

function assertMigrationUsesSupportedGrammar(
	sql: string,
	migrationName: string,
): void {
	if (/\$[a-zA-Z0-9_]*\$/u.test(sql)) {
		throw new Error(
			`${migrationName} contains an unsupported heredoc delimiter`,
		);
	}
	if (/["`]rudel["`]\s*\./iu.test(sql)) {
		throw new Error(
			`${migrationName} contains an unsupported quoted rudel qualifier`,
		);
	}
	for (const qualifier of sql.matchAll(/\brudel\s*\./giu)) {
		if (qualifier[0] !== "rudel.") {
			throw new Error(
				`${migrationName} contains an unsupported cased or spaced rudel qualifier`,
			);
		}
	}
	for (const blockComment of sql.matchAll(/\/\*[\s\S]*?\*\//gu)) {
		if (blockComment[0].includes(";")) {
			throw new Error(
				`${migrationName} contains a semicolon inside a block comment`,
			);
		}
	}
	for (const line of sql.split("\n")) {
		const lineCommentIndex = line.indexOf("--");
		if (
			lineCommentIndex >= 0 &&
			line.slice(0, lineCommentIndex).trim().length > 0
		) {
			throw new Error(
				`${migrationName} contains an unsupported inline line comment`,
			);
		}
	}
	for (const literal of sql.matchAll(/'(?:\\.|''|[^'])*'/gu)) {
		const value = literal[0];
		if (value.includes("\\'")) {
			throw new Error(
				`${migrationName} contains an unsupported backslash-escaped quote`,
			);
		}
		if (
			value.slice(1, -1).includes("''") &&
			!VERIFIED_GENERATED_DOUBLED_QUOTE_LITERALS.has(value)
		) {
			throw new Error(
				`${migrationName} contains an unsupported doubled-quote string`,
			);
		}
	}
}

function scopeMigration(sql: string, database: string): string {
	let scoped = "";
	let state:
		| "backtick-identifier"
		| "block-comment"
		| "code"
		| "double-quoted-identifier"
		| "line-comment"
		| "single-quoted-string" = "code";
	for (let index = 0; index < sql.length; index += 1) {
		const character = sql[index] ?? "";
		const nextCharacter = sql[index + 1] ?? "";
		if (state === "code") {
			if (character === "-" && nextCharacter === "-") {
				scoped += "--";
				index += 1;
				state = "line-comment";
				continue;
			}
			if (character === "#") {
				scoped += character;
				state = "line-comment";
				continue;
			}
			if (character === "/" && nextCharacter === "*") {
				scoped += "/*";
				index += 1;
				state = "block-comment";
				continue;
			}
			if (character === "'") {
				scoped += character;
				state = "single-quoted-string";
				continue;
			}
			if (sql.startsWith('"rudel".', index)) {
				scoped += `"${database}".`;
				index += '"rudel".'.length - 1;
				continue;
			}
			if (sql.startsWith("`rudel`.", index)) {
				scoped += `\`${database}\`.`;
				index += "`rudel`.".length - 1;
				continue;
			}
			if (character === '"') {
				scoped += character;
				state = "double-quoted-identifier";
				continue;
			}
			if (character === "`") {
				scoped += character;
				state = "backtick-identifier";
				continue;
			}
			if (
				sql.startsWith("rudel.", index) &&
				!isSqlIdentifierCharacter(sql[index - 1])
			) {
				scoped += `${database}.`;
				index += "rudel.".length - 1;
				continue;
			}
			scoped += character;
			continue;
		}

		scoped += character;
		if (state === "line-comment") {
			if (character === "\n") state = "code";
			continue;
		}
		if (state === "block-comment") {
			if (character === "*" && nextCharacter === "/") {
				scoped += "/";
				index += 1;
				state = "code";
			}
			continue;
		}
		if (character === "\\" && nextCharacter) {
			scoped += nextCharacter;
			index += 1;
			continue;
		}
		const closingCharacter =
			state === "single-quoted-string"
				? "'"
				: state === "double-quoted-identifier"
					? '"'
					: "`";
		if (character !== closingCharacter) continue;
		if (nextCharacter === closingCharacter) {
			scoped += nextCharacter;
			index += 1;
			continue;
		}
		state = "code";
	}
	if (state !== "code" && state !== "line-comment") {
		throw new Error(`F16 migration ended inside ${state}`);
	}
	return scoped;
}

function isSqlIdentifierCharacter(character: string | undefined): boolean {
	return character !== undefined && /[a-zA-Z0-9_]/u.test(character);
}

function parseStatements(sql: string): string[] {
	const withoutComments = sql
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("--"))
		.join("\n");
	const statements: string[] = [];
	let current = "";
	let insideString = false;
	for (let index = 0; index < withoutComments.length; index += 1) {
		const character = withoutComments[index];
		if (character === "'") {
			current += character;
			if (insideString && withoutComments[index + 1] === "'") {
				current += "'";
				index += 1;
				continue;
			}
			insideString = !insideString;
			continue;
		}
		if (character === ";" && !insideString) {
			if (current.trim()) statements.push(current.trim());
			current = "";
			continue;
		}
		current += character;
	}
	if (insideString) throw new Error("F16 migration has an unclosed SQL string");
	if (current.trim()) statements.push(current.trim());
	return statements;
}

async function executeMigration(sql: string, database: string): Promise<void> {
	for (const statement of parseStatements(scopeMigration(sql, database))) {
		if (statement.startsWith("SELECT")) {
			await executor.query(statement);
		} else {
			await executor.execute(statement);
		}
	}
}

async function createPreF16Tables(database: string): Promise<void> {
	await executor.execute(`CREATE DATABASE ${database}`);
	const rawColumns = `
		session_date DateTime64(3, 'UTC') DEFAULT now64(3),
		last_interaction_date DateTime64(3, 'UTC') DEFAULT now64(3),
		session_id String,
		organization_id String,
		project_path String,
		git_remote String DEFAULT '',
		package_name String DEFAULT '',
		package_type String DEFAULT '',
		content String,
		filter_version UInt8 DEFAULT 0,
		ingested_at DateTime64(3, 'UTC') DEFAULT now64(3),
		user_id String,
		git_branch Nullable(String),
		git_sha Nullable(String),
		tag Nullable(String)`;
	for (const [table, extra] of [
		["claude_sessions", ", subagents Map(String, String) DEFAULT map()"],
		["codex_sessions", ""],
	] as const) {
		await executor.execute(`
			CREATE TABLE ${database}.${table} (${rawColumns}${extra})
			ENGINE = ReplacingMergeTree(ingested_at)
			PARTITION BY toYYYYMM(toDate(session_date))
			ORDER BY (organization_id, session_date, session_id)
		`);
	}
	await executor.execute(`
		CREATE TABLE ${database}.session_analytics
		(
			session_date DateTime64(3, 'UTC'),
			last_interaction_date DateTime64(3, 'UTC'),
			session_id String,
			organization_id String,
			project_path String,
			git_remote String,
			package_name String,
			package_type String,
			filter_version UInt8,
			ingested_at DateTime64(3, 'UTC'),
			user_id String,
			git_branch Nullable(String),
			git_sha Nullable(String),
			tag Nullable(String),
			source LowCardinality(String),
			skills Array(String),
			slash_commands Array(String),
			subagent_types Array(String),
			input_tokens UInt64,
			output_tokens UInt64,
			cache_read_input_tokens UInt64,
			cache_creation_input_tokens UInt64,
			total_tokens UInt64,
			total_interactions UInt32,
			actual_duration_min UInt32,
			avg_period_sec Float64,
			median_period_sec Float64,
			quick_responses UInt32,
			normal_responses UInt32,
			long_pauses UInt32,
			error_count UInt32,
			error_pattern LowCardinality(String),
			model_used String,
			has_commit UInt8,
			session_archetype String,
			success_score UInt8,
			used_plan_mode UInt8,
			inference_duration_sec UInt32,
			human_duration_sec UInt32
		)
		ENGINE = ReplacingMergeTree(ingested_at)
		ORDER BY (organization_id, session_date, session_id)
	`);
	await executor.execute(`
		CREATE TABLE ${database}.session_language_signals
		(
			organization_id String,
			session_date DateTime64(3, 'UTC'),
			session_id String,
			user_id String,
			source LowCardinality(String),
			raw_ingested_at DateTime64(3, 'UTC'),
			scan_version UInt16,
			member_swears UInt32,
			member_apologies UInt32,
			member_positive UInt32,
			model_swears UInt32,
			model_apologies UInt32,
			model_positive UInt32,
			scanned_at DateTime64(3, 'UTC')
		)
		ENGINE = ReplacingMergeTree(scanned_at)
		PARTITION BY toYYYYMM(toDate(session_date))
		ORDER BY (organization_id, session_date, session_id, source)
	`);
	for (const table of [
		"skill_receipts",
		"skill_uses",
		"skill_version_contents",
	]) {
		await executor.execute(`
			CREATE TABLE ${database}.${table} (extraction_seq UInt64)
			ENGINE = MergeTree
			ORDER BY tuple()
		`);
	}
}

function claudeContent(): string {
	return [
		JSON.stringify({
			message: { content: "migration rehearsal", role: "user" },
			timestamp: "2026-08-20T09:00:00.000Z",
			type: "user",
		}),
		JSON.stringify({
			message: {
				content: "done",
				id: "message-f16",
				model: "claude-sonnet-4-5",
				role: "assistant",
				usage: { input_tokens: 10, output_tokens: 5 },
			},
			timestamp: "2026-08-20T09:00:01.000Z",
			type: "assistant",
		}),
	].join("\n");
}

function rawRow(
	sessionId: string,
	content: string,
	filterVersion: number,
	tag: string,
) {
	return {
		content,
		filter_version: filterVersion,
		git_branch: "main",
		git_remote: "github.com/rudel/rehearsal",
		git_sha: null,
		ingested_at: INGESTED_AT,
		last_interaction_date: "2026-08-20T09:00:01.000",
		organization_id: "org-f16",
		package_name: "rehearsal",
		package_type: "package.json",
		project_path: "/tmp/rehearsal",
		session_date: SESSION_DATE,
		session_id: sessionId,
		tag,
		user_id: "user-f16",
	};
}

function historicalAnalyticsRow() {
	return {
		actual_duration_min: 7,
		avg_period_sec: 1,
		cache_creation_input_tokens: "0",
		cache_read_input_tokens: "0",
		error_count: 0,
		error_pattern: "",
		filter_version: 4,
		git_branch: "main",
		git_remote: "github.com/rudel/historical",
		git_sha: null,
		has_commit: 0,
		human_duration_sec: 0,
		inference_duration_sec: 0,
		ingested_at: INGESTED_AT,
		input_tokens: "10",
		last_interaction_date: "2026-08-20T09:00:01.000",
		long_pauses: 0,
		median_period_sec: 1,
		model_used: "historical-model",
		normal_responses: 0,
		organization_id: "org-f16",
		output_tokens: "5",
		package_name: "historical",
		package_type: "package.json",
		project_path: "/historical-analytics-survives",
		quick_responses: 0,
		session_archetype: "standard",
		session_date: SESSION_DATE,
		session_id: FILTERED_SESSION_ID,
		skills: [],
		slash_commands: [],
		source: "claude_code",
		subagent_types: [],
		success_score: 50,
		tag: "historical",
		total_interactions: 1,
		total_tokens: "15",
		used_plan_mode: 0,
		user_id: "user-f16",
	};
}

async function seedFixtures(database: string, reverse: boolean): Promise<void> {
	const claudeTies = [
		{
			...rawRow(CLAUDE_TIE_SESSION_ID, claudeContent(), 4, "tag-a"),
			subagents: {},
		},
		{
			...rawRow(CLAUDE_TIE_SESSION_ID, claudeContent(), 5, "tag-b"),
			subagents: {},
		},
	];
	const codexTies = [
		rawRow(CODEX_TIE_SESSION_ID, CODEX_CONTENT, 4, "tag-a"),
		rawRow(CODEX_TIE_SESSION_ID, CODEX_CONTENT, 5, "tag-b"),
	];
	await executor.insert({
		table: `${database}.claude_sessions`,
		values: reverse ? [...claudeTies].reverse() : claudeTies,
	});
	await executor.insert({
		table: `${database}.codex_sessions`,
		values: reverse ? [...codexTies].reverse() : codexTies,
	});
	await executor.insert({
		table: `${database}.claude_sessions`,
		values: [
			{
				...rawRow(
					FILTERED_SESSION_ID,
					"raw row filtered by the MV",
					5,
					"filtered",
				),
				subagents: {},
			},
		],
	});
	await executor.insert({
		table: `${database}.session_analytics`,
		values: [historicalAnalyticsRow()],
	});
	await executor.insert({
		table: `${database}.session_language_signals`,
		values: [
			{
				member_apologies: 0,
				member_positive: 0,
				member_swears: 1,
				model_apologies: 0,
				model_positive: 0,
				model_swears: 0,
				organization_id: "org-f16",
				raw_ingested_at: INGESTED_AT,
				scan_version: 1,
				scanned_at: INGESTED_AT,
				session_date: SESSION_DATE,
				session_id: FILTERED_SESSION_ID,
				source: "claude_code",
				user_id: "user-f16",
			},
		],
	});
}

async function runRehearsal(
	database: string,
	reverse: boolean,
): Promise<RehearsalResult> {
	await createPreF16Tables(database);
	await seedFixtures(database, reverse);
	await executeMigration(DDL_MIGRATION, database);
	await executeMigration(BACKFILL_MIGRATION, database);

	const winners = await executor.query<WinnerRow>(`
		SELECT
			session_id,
			argMax(filter_version, revision) AS filter_version,
			argMax(tag, revision) AS tag,
			toString(max(revision)) AS revision
		FROM (
			SELECT session_id, filter_version, tag, revision
			FROM ${database}.claude_sessions
			WHERE session_id = '${CLAUDE_TIE_SESSION_ID}'
			UNION ALL
			SELECT session_id, filter_version, tag, revision
			FROM ${database}.codex_sessions
			WHERE session_id = '${CODEX_TIE_SESSION_ID}'
		)
		GROUP BY session_id
		ORDER BY session_id
	`);
	const [coverage] = await executor.query<{ count: string | number }>(`
		SELECT count() AS count
		FROM ${database}.session_analytics
		WHERE source = 'claude_code'
			AND organization_id = 'org-f16'
			AND user_id = 'user-f16'
			AND session_id = '${FILTERED_SESSION_ID}'
			AND project_path = '/historical-analytics-survives'
	`);
	const [suffixes] = await executor.query<{ count: string | number }>(`
		SELECT count() AS count
		FROM (
			SELECT revision, ingested_at FROM ${database}.claude_sessions
			UNION ALL
			SELECT revision, ingested_at FROM ${database}.codex_sessions
			UNION ALL
			SELECT revision, ingested_at FROM ${database}.session_analytics
		)
		WHERE
			toInt128(revision)
				- bitShiftLeft(toInt128(toUnixTimestamp64Milli(ingested_at)), 16)
			NOT BETWEEN 0 AND 65535
	`);
	const [minimum] = await executor.query<{ revision: string }>(`
		SELECT toString(min(revision)) AS revision
		FROM (
			SELECT revision FROM ${database}.claude_sessions
			UNION ALL
			SELECT revision FROM ${database}.codex_sessions
			UNION ALL
			SELECT revision FROM ${database}.session_analytics
		)
	`);
	const [signal] = await executor.query<{
		engine_full: string;
		raw_revision: string;
	}>(`
		SELECT
			any(system_tables.engine_full) AS engine_full,
			toString(max(signals.raw_revision)) AS raw_revision
		FROM ${database}.session_language_signals AS signals
		CROSS JOIN system.tables AS system_tables
		WHERE system_tables.database = '${database}'
			AND system_tables.name = 'session_language_signals'
	`);
	return {
		analyticsCoverage: Number(coverage?.count ?? 0),
		invalidSuffixes: Number(suffixes?.count ?? 0),
		minimumRevision: minimum?.revision ?? "0",
		signalEngine: signal?.engine_full ?? "",
		signalRawRevision: signal?.raw_revision ?? "missing",
		winners,
	};
}

afterAll(async () => {
	for (const database of databases) {
		await executor.execute(`DROP DATABASE IF EXISTS ${database} SYNC`);
	}
});

describe("F16 destructive migration execution rehearsal", () => {
	test("executes both checked-in migrations deterministically on adversarial history", async () => {
		assertMigrationUsesSupportedGrammar(DDL_MIGRATION, "F16 DDL migration");
		assertMigrationUsesSupportedGrammar(
			BACKFILL_MIGRATION,
			"F16 backfill migration",
		);
		for (const [unsupportedSql, expectedFailure] of [
			["SELECT $$rudel.literal$$", "heredoc"],
			['SELECT * FROM "rudel" .table', "quoted rudel qualifier"],
			["SELECT * FROM RUDEL.table", "cased or spaced rudel qualifier"],
			["SELECT 1 /* unsupported; split */", "block comment"],
			["SELECT 'it''s rudel.literal'", "doubled-quote string"],
			[String.raw`SELECT 'it\'s;still one literal'`, "backslash-escaped quote"],
			["SELECT 1 -- unsupported; split", "inline line comment"],
		] as const) {
			expect(() =>
				assertMigrationUsesSupportedGrammar(
					unsupportedSql,
					"synthetic migration",
				),
			).toThrow(expectedFailure);
		}
		expect(
			scopeMigration(
				`SELECT 'rudel.literal', rudel.table, \`rudel\`.backtick_table, "rudel".double_quoted_table -- rudel.comment
/* rudel.block */`,
				"isolated_database",
			),
		).toBe(
			`SELECT 'rudel.literal', isolated_database.table, \`isolated_database\`.backtick_table, "isolated_database".double_quoted_table -- rudel.comment
/* rudel.block */`,
		);
		const first = await runRehearsal(databaseName("forward"), false);
		const second = await runRehearsal(databaseName("reverse"), true);

		expect(first.winners).toHaveLength(2);
		expect(first.winners).toEqual(second.winners);
		expect(first.analyticsCoverage).toBe(1);
		expect(second.analyticsCoverage).toBe(1);
		expect(first.invalidSuffixes).toBe(0);
		expect(second.invalidSuffixes).toBe(0);
		expect(BigInt(first.minimumRevision)).toBeGreaterThan(
			BigInt(Number.MAX_SAFE_INTEGER),
		);
		expect(second.minimumRevision).toBe(first.minimumRevision);
		expect(first.signalEngine).toContain("ReplacingMergeTree(signal_version)");
		expect(second.signalEngine).toBe(first.signalEngine);
		expect(first.signalRawRevision).toBe("0");
		expect(second.signalRawRevision).toBe("0");
	}, 300_000);
});
