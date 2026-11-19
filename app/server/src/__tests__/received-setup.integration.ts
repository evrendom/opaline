import "./helpers/local-integration-guard.js";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
} from "@rudel/api-routes/transcript-records";
import { getClickhouse } from "../clickhouse.js";
import type { AgentQueryLimiter } from "../services/analysis/agent-query-slots.js";
import { openRun } from "../services/analysis/run-view.service.js";
import {
	describeSchema,
	runSql,
	type SqlCaller,
} from "../services/analysis/sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "../services/analysis/sql-results.js";
import { runNodeId } from "../services/l1-edges/l1-edge-ids.js";
import { buildRunIndex } from "../services/l1-edges/run-index.service.js";
import { deleteUserSessions } from "../services/org-session.service.js";
import {
	hashTranscriptContent,
	writeTranscriptRecords,
} from "../services/transcript-records-ingest.service.js";

/**
 * Received setup end to end against real ClickHouse (OPL-391): two members
 * run the same repository from different clones (one a worktree), with the
 * same skill and their own CLAUDE.md, one of them uncommitted. Uploads store
 * each distinct setup text once per member; the run index ties every run to
 * the setup file versions it had; sql lists runs per version across members;
 * the run view opens a run's setup at the version it received; deleting an
 * account removes its rows.
 */

setDefaultTimeout(180_000);

const RUN = `received_setup_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const ana = `${RUN}_ana`;
const ben = `${RUN}_ben`;
const anaSession = `${RUN}_ana_session`;
const benSession = `${RUN}_ben_session`;
const clickhouse = getClickhouse();
const baseMs = Date.now() - 3_600_000;
const sessionDate = new Date(baseMs).toISOString();

const unlimited: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};
const teammate: SqlCaller = {
	workspaceId: workspace,
	reader: { userId: ana, role: "member", ownSessionsOnly: false },
};
const sqlEnv = () => ({
	executor: clickhouse,
	results: createMemorySqlResultStore(),
	quota: createMemorySqlQuota({ queries: 1_000, windowMs: 3_600_000 }),
	limiter: unlimited,
	githubRepositories: async () => [],
});
const runEnv = {
	executor: clickhouse,
	ownerOf: async (sessionId: string) => (sessionId === anaSession ? ana : ben),
	quota: createMemorySqlQuota({ queries: 1_000, windowMs: 3_600_000 }),
};

/** A system prompt longer than the old 65,536-character fact cap. */
const SYSTEM_PROMPT = `You are Claude Code.\n\n${"Read the code before you change it. ".repeat(3_000)}`;
const SKILL =
	"# Fix tests\nRun the failing test alone first, then fix the code, not the test.";
const CLAUDE_COMMITTED = "# Shop\nRun `bun test` before every commit.";
const CLAUDE_UNCOMMITTED = `${CLAUDE_COMMITTED}\nNever touch the payments module.`;
const PERSONAL = "Answer in short sentences.";
const ANA_ENVIRONMENT =
	"# Environment\nWorking directory: /Users/ana/code/shop";

const sha = (text: string) =>
	createHash("sha256").update(text, "utf8").digest("hex");
const short = (text: string) => sha(text).slice(0, 12);

/** One member's session: setup at its start, a run that uses the skill, and a second run. */
function transcript(input: {
	home: string;
	cwd: string;
	status: string;
	claudeMd: string;
}): string {
	let second = 0;
	const line = (body: Record<string, unknown>) =>
		JSON.stringify({
			sessionId: "s",
			cwd: input.cwd,
			version: "2.1.300",
			entrypoint: "cli",
			timestamp: new Date(baseMs + ++second * 1_000).toISOString(),
			...body,
		});
	const attachment = (value: Record<string, unknown>) =>
		line({ type: "attachment", attachment: value });
	const user = (content: unknown, extra: Record<string, unknown> = {}) =>
		line({ type: "user", message: { role: "user", content }, ...extra });
	const assistant = (content: unknown[]) =>
		line({ type: "assistant", message: { role: "assistant", content } });
	return [
		attachment({
			type: "session_context",
			context: {
				gitStatus: `Current branch: main\n\nStatus:\n${input.status}\n\nRecent commits:\nabc123 init`,
			},
		}),
		attachment({
			type: "prompt_snapshot",
			systemPrompt: [
				SYSTEM_PROMPT,
				"__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__",
				`# Environment\nWorking directory: ${input.cwd}`,
			],
		}),
		attachment({
			type: "instructions",
			files: [
				{
					path: `${input.home}/.claude/CLAUDE.md`,
					type: "User",
					content: PERSONAL,
				},
				{
					path: `${input.cwd}/CLAUDE.md`,
					type: "Project",
					content: input.claudeMd,
				},
			],
		}),
		user("fix the failing login test"),
		assistant([
			{
				type: "tool_use",
				id: "skill_1",
				name: "Skill",
				input: { skill: "fix-tests" },
			},
		]),
		user([
			{
				type: "tool_result",
				tool_use_id: "skill_1",
				content: "Launching skill: fix-tests",
			},
		]),
		user(
			[
				{
					type: "text",
					text: `Base directory for this skill: ${input.cwd}/.claude/skills/fix-tests\n\n${SKILL}\n\n\nARGUMENTS: login`,
				},
			],
			{ isMeta: true },
		),
		assistant([{ type: "text", text: "Fixed: the login test passes." }]),
		user("thanks"),
		assistant([{ type: "text", text: "You're welcome." }]),
	].join("\n");
}

async function upload(
	userId: string,
	sessionId: string,
	gitRemote: string,
	content: string,
): Promise<void> {
	const stats = createSplitStats();
	await writeTranscriptRecords(clickhouse, {
		organizationId: workspace,
		userId,
		sessionId,
		source: "claude_code",
		revision: "1",
		sessionDate,
		contentSha256: hashTranscriptContent(content),
		assertWritable: async () => {},
		drafts: splitSessionTranscript(
			{ content, sessionDate, source: "claude_code" },
			stats,
		),
		summary: () => summarizeSplit(stats),
	});
	await clickhouse.insert({
		table: "rudel.session_analytics",
		asyncInsert: false,
		values: [
			{
				organization_id: workspace,
				user_id: userId,
				session_id: sessionId,
				source: "claude_code",
				session_date: sessionDate.replace("T", " ").replace("Z", ""),
				last_interaction_date: sessionDate.replace("T", " ").replace("Z", ""),
				project_path: "/shop",
				git_remote: gitRemote,
				model_used: "claude-opus-5-5",
				revision: "1",
			},
		],
	});
	await buildRunIndex({
		executor: clickhouse,
		organizationId: workspace,
		session: { userId, source: "claude_code", sessionId },
		buildRevision: 1,
		beforeWrite: async () => {},
	});
}

async function sql(query: string): Promise<string[]> {
	const outcome = await runSql(teammate, { query, title: "setup" }, sqlEnv());
	if (!outcome.ok) throw new Error(outcome.error.message);
	return outcome.result.table.split("\n");
}

async function firstRun(userId: string, sessionId: string): Promise<string> {
	const [row] = await clickhouse.query<{ start_record: number }>({
		query: `SELECT start_record FROM rudel.run_index FINAL
			WHERE organization_id = {workspace:String} AND session_id = {sessionId:String}
				AND row_kind = 'run' AND agent_id = ''
			ORDER BY start_record LIMIT 1`,
		query_params: { workspace, sessionId },
	});
	expect(row).toBeDefined();
	return runNodeId(
		{ userId, source: "claude_code", sessionId },
		"",
		row?.start_record ?? 0,
	);
}

async function countRows(table: string, userId: string): Promise<number> {
	const [row] = await clickhouse.query<{ rows: string }>({
		query: `SELECT count() AS rows FROM ${table}
			WHERE organization_id = {workspace:String} AND user_id = {userId:String}`,
		query_params: { workspace, userId },
	});
	return Number(row?.rows ?? 0);
}

afterAll(async () => {
	for (const table of [
		"rudel.transcript_records",
		"rudel.run_index",
		"rudel.run_requests",
		"rudel.run_setup",
		"rudel.setup_texts",
		"rudel.session_analytics",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {workspace:String} SETTINGS lightweight_deletes_sync = 2`,
			query_params: { workspace },
		});
});

test("received setup is named by where it lives, versioned by its text, listed per run in sql and opened by the run view", async () => {
	await upload(
		ana,
		anaSession,
		"git@github.com:acme/shop.git",
		transcript({
			home: "/Users/ana",
			cwd: "/Users/ana/code/shop",
			status: " M src/app.ts",
			claudeMd: CLAUDE_COMMITTED,
		}),
	);
	await upload(
		ben,
		benSession,
		"https://github.com/acme/shop",
		transcript({
			home: "/home/ben",
			cwd: "/home/ben/wt/shop-login",
			status: " M CLAUDE.md",
			claudeMd: CLAUDE_UNCOMMITTED,
		}),
	);

	// The same skill in two clones is one setup file with one version; the
	// CLAUDE.md versions are told apart, the uncommitted one named after Ben.
	const rows = [
		`member:${ana}:~/.claude/CLAUDE.md | ${short(PERSONAL)} | 2 | 1`,
		`member:${ben}:~/.claude/CLAUDE.md | ${short(PERSONAL)} | 2 | 1`,
		`repository:github.com/acme/shop:.claude/skills/fix-tests/SKILL.md | ${short(SKILL)} | 4 | 2`,
		`repository:github.com/acme/shop:CLAUDE.md | ${short(CLAUDE_COMMITTED)} | 2 | 1`,
		`repository:github.com/acme/shop:CLAUDE.md | ${short(CLAUDE_UNCOMMITTED)} uncommitted by ${ben} | 2 | 1`,
	].sort();
	expect(
		await sql(
			`SELECT setup_file, version_name, count(DISTINCT run_id) AS runs, uniqExact(user_id) AS members
			FROM setup_files
			WHERE session_id IN ('${anaSession}', '${benSession}') AND kind IN ('instructions', 'skill_body')
			GROUP BY setup_file, version_name
			ORDER BY setup_file, version_name`,
		),
	).toEqual(["setup_file | version_name | runs | members", ...rows]);

	// The system prompt is one version for both members (its fixed part) and
	// is stored whole.
	expect(
		await sql(
			`SELECT version, uniqExact(user_id) AS members FROM setup_files
			WHERE session_id IN ('${anaSession}', '${benSession}') AND setup_file = 'harness:claude_code:system_prompt'
			GROUP BY version`,
		),
	).toEqual(["version | members", `${sha(SYSTEM_PROMPT)} | 2`]);
	const [stored] = await clickhouse.query<{ chars: number; length: string }>({
		query: `SELECT chars, toString(lengthUTF8(text)) AS length FROM rudel.setup_texts FINAL
			WHERE organization_id = {workspace:String} AND user_id = {ana:String} AND version = {version:String}`,
		query_params: { workspace, ana, version: sha(SYSTEM_PROMPT) },
	});
	expect(stored).toEqual({
		chars: SYSTEM_PROMPT.length,
		length: String(SYSTEM_PROMPT.length),
	});

	// The view returns the columns schema describes, with their types.
	const described = await describeSchema(
		teammate,
		{ view: "setup_files" },
		sqlEnv(),
	);
	if (!described.ok || described.result.level !== "columns")
		throw new Error("Expected the columns of setup_files");
	const columns = described.result.columns;
	const where = `session_id = '${anaSession}'`;
	expect(
		(await sql(`SELECT * FROM setup_files WHERE ${where} LIMIT 1`))[0],
	).toBe(columns.map((column) => column.name).join(" | "));
	expect(
		(
			await sql(
				`SELECT ${columns.map((column, index) => `toTypeName(${column.name}) AS type_${index}`).join(", ")}
				FROM setup_files WHERE ${where} LIMIT 1`,
			)
		)[1],
	).toBe(columns.map((column) => column.type).join(" | "));

	// Every run's received setup was read: none is unknown.
	expect(
		await sql(
			`SELECT countIf(has(coverage_gaps, 'received_setup')) AS unknown, count() AS runs FROM runs
			WHERE session_id IN ('${anaSession}', '${benSession}')`,
		),
	).toEqual(["unknown | runs", "0 | 4"]);

	// The run view lists the setup of Ana's first run with ids, and opens
	// CLAUDE.md and the skill at the versions that run received.
	const anaRun = await firstRun(ana, anaSession);
	const listed = await openRun(
		workspace,
		{ id: anaRun, sections: ["setup"], maxChars: 12_000 },
		runEnv,
	);
	expect(listed.text.split("\n")).toEqual([
		`SETUP s1  system_prompt harness:claude_code:system_prompt · version ${short(SYSTEM_PROMPT)} · ${SYSTEM_PROMPT.length} chars · received earlier`,
		`      s2  system_prompt harness:claude_code:system_prompt_dynamic · version ${short(ANA_ENVIRONMENT)} · ${ANA_ENVIRONMENT.length} chars · received earlier`,
		`      s3  instructions member:${ana}:~/.claude/CLAUDE.md · version ${short(PERSONAL)} · ${PERSONAL.length} chars · received earlier`,
		`      s4  instructions repository:github.com/acme/shop:CLAUDE.md · version ${short(CLAUDE_COMMITTED)} · ${CLAUDE_COMMITTED.length} chars · received earlier`,
		`      s5  skill_body repository:github.com/acme/shop:.claude/skills/fix-tests/SKILL.md · version ${short(SKILL)} · ${SKILL.length} chars`,
	]);
	const opened = await openRun(
		workspace,
		{
			id: anaRun,
			sections: ["header"],
			expand: ["s4", "s5"],
			maxChars: 12_000,
		},
		runEnv,
	);
	expect(opened.text).toContain(
		`▸ s4 instructions repository:github.com/acme/shop:CLAUDE.md version ${short(CLAUDE_COMMITTED)}, ${CLAUDE_COMMITTED.length} characters\n${CLAUDE_COMMITTED}`,
	);
	expect(opened.text).toContain(
		`▸ s5 skill_body repository:github.com/acme/shop:.claude/skills/fix-tests/SKILL.md version ${short(SKILL)}, ${SKILL.length} characters\n${SKILL}`,
	);

	// Ben's run opens his uncommitted CLAUDE.md.
	const benOpened = await openRun(
		workspace,
		{
			id: await firstRun(ben, benSession),
			sections: ["header"],
			expand: ["s4"],
			maxChars: 12_000,
		},
		runEnv,
	);
	expect(benOpened.text).toContain(
		`▸ s4 instructions repository:github.com/acme/shop:CLAUDE.md version ${short(CLAUDE_UNCOMMITTED)} uncommitted by ${ben}, ${CLAUDE_UNCOMMITTED.length} characters\n${CLAUDE_UNCOMMITTED}`,
	);

	// Deleting Ben's account removes his received setup and leaves Ana's.
	expect(await countRows("rudel.run_setup", ben)).toBeGreaterThan(0);
	expect(await countRows("rudel.setup_texts", ben)).toBeGreaterThan(0);
	await deleteUserSessions(ben);
	expect(await countRows("rudel.run_setup", ben)).toBe(0);
	expect(await countRows("rudel.setup_texts", ben)).toBe(0);
	expect(await countRows("rudel.run_setup", ana)).toBeGreaterThan(0);
	expect(await countRows("rudel.setup_texts", ana)).toBeGreaterThan(0);
});
