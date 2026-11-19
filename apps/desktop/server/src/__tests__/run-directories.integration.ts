import "./helpers/local-integration-guard.js";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
} from "@rudel/api-routes/transcript-records";
import { getClickhouse } from "../clickhouse.js";
import type { AgentQueryLimiter } from "../services/analysis/agent-query-slots.js";
import { readCommittedRunIndex } from "../services/analysis/run-index-reader.js";
import { runSql, type SqlCaller } from "../services/analysis/sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "../services/analysis/sql-results.js";
import { buildRunIndex } from "../services/l1-edges/run-index.service.js";
import {
	hashTranscriptContent,
	writeTranscriptRecords,
} from "../services/transcript-records-ingest.service.js";

/**
 * Each run's working directory and repository end to end against real
 * ClickHouse: a coordinator session started in a folder outside any
 * repository, which the upload put on one repository, whose main stream and
 * subagent work in other checkouts, next to a session started inside its
 * repository. The run index names each run's directory and the repository
 * only the session's own records tie it to; the session repository stays as
 * uploaded; the runs view shows both.
 */

setDefaultTimeout(180_000);

const RUN = `run_directories_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const ana = `${RUN}_ana`;
const coordinatorSession = `${RUN}_coordinator`;
const repoSession = `${RUN}_repo`;
const clickhouse = getClickhouse();
const baseMs = Date.now() - 3_600_000;
const sessionDate = new Date(baseMs).toISOString();
const LAUNCH = "/Users/ana/launch";
const SHOP = "/Users/ana/code/shop";

const unlimited: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};
const caller: SqlCaller = {
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

/** A Claude Code stream: lines one second apart, at `cwd` on `gitBranch`. */
function stream(input: {
	cwd: string;
	gitBranch: string;
	agentId?: string;
	startSecond: number;
}) {
	let second = input.startSecond;
	const line = (body: Record<string, unknown>) =>
		JSON.stringify({
			sessionId: "s",
			cwd: input.cwd,
			gitBranch: input.gitBranch,
			version: "2.1.300",
			entrypoint: "cli",
			...(input.agentId === undefined
				? {}
				: { isSidechain: true, agentId: input.agentId }),
			timestamp: new Date(baseMs + ++second * 1_000).toISOString(),
			...body,
		});
	return {
		prompt: (text: string) =>
			line({ type: "user", message: { role: "user", content: text } }),
		bash: (id: string, command: string, output: string) => [
			line({
				type: "assistant",
				message: {
					role: "assistant",
					content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
				},
			}),
			line({
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: id,
							content: output,
							is_error: false,
						},
					],
				},
			}),
		],
		say: (text: string) =>
			line({
				type: "assistant",
				message: { role: "assistant", content: [{ type: "text", text }] },
			}),
	};
}

async function upload(input: {
	sessionId: string;
	content: string;
	subagents?: Record<string, string>;
	projectPath: string;
	gitRemote: string;
	gitBranch: string;
}): Promise<void> {
	const stats = createSplitStats();
	await writeTranscriptRecords(clickhouse, {
		organizationId: workspace,
		userId: ana,
		sessionId: input.sessionId,
		source: "claude_code",
		revision: "1",
		sessionDate,
		contentSha256: hashTranscriptContent(input.content),
		assertWritable: async () => {},
		drafts: splitSessionTranscript(
			{
				content: input.content,
				sessionDate,
				source: "claude_code",
				subagents: input.subagents,
			},
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
				user_id: ana,
				session_id: input.sessionId,
				source: "claude_code",
				session_date: sessionDate.replace("T", " ").replace("Z", ""),
				last_interaction_date: sessionDate.replace("T", " ").replace("Z", ""),
				project_path: input.projectPath,
				git_remote: input.gitRemote,
				git_branch: input.gitBranch,
				model_used: "claude-opus-5-5",
				revision: "1",
			},
		],
	});
	await buildRunIndex({
		executor: clickhouse,
		organizationId: workspace,
		session: { userId: ana, source: "claude_code", sessionId: input.sessionId },
		buildRevision: 1,
		beforeWrite: async () => {},
	});
}

const runsOf = async (sessionId: string) =>
	(
		await readCommittedRunIndex(
			clickhouse,
			{ organizationId: workspace, userId: ana },
			[sessionId],
		)
	)
		.filter((row) => row.row_kind === "run")
		.sort(
			(a, b) => a.agent_id.localeCompare(b.agent_id) || a.turn_idx - b.turn_idx,
		)
		.map((row) => ({
			agent: row.agent_id,
			turn: row.turn_idx,
			repository: row.repository,
			cwd: row.cwd,
			cwd_repository: row.cwd_repository,
			cwd_repository_basis: row.cwd_repository_basis,
		}));

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

test("a coordinator session's runs name the checkout they worked in, and its repository only where the session's records tie it", async () => {
	const main = stream({ cwd: LAUNCH, gitBranch: "master", startSecond: 0 });
	const sub = stream({
		cwd: LAUNCH,
		gitBranch: "master",
		agentId: "a1b2c3d4e5f6a7b8c",
		startSecond: 100,
	});
	await upload({
		sessionId: coordinatorSession,
		projectPath: LAUNCH,
		// The upload named the busiest checkout's remote and branch.
		gitRemote: "github.com/acme/shop",
		gitBranch: "feat/login",
		content: [
			// Run 1: pushes from the CLI checkout, whose push names its remote.
			main.prompt("ship the cli fix"),
			...main.bash(
				"toolu_push",
				"cd ~/code/cli && git push -u origin fix/x",
				"To github.com:acme/cli.git\n * [new branch]      fix/x -> fix/x",
			),
			...main.bash(
				"toolu_status",
				"cd ~/code/cli/apps/cli && bun test",
				"12 pass",
			),
			main.say("Pushed."),
			// Run 2: works in the coordinator folder only.
			main.prompt("what is in the folder"),
			...main.bash("toolu_ls", "ls", "athena\nnotes.md"),
			main.say("Two entries."),
		].join("\n"),
		subagents: {
			// The subagent works in a scratch checkout nothing ties to a repository.
			a1b2c3d4e5f6a7b8c: [
				sub.prompt("probe the scratch checkout"),
				...sub.bash(
					"toolu_s1",
					"cd /Users/ana/code/scratch && git status",
					"On branch main",
				),
				...sub.bash(
					"toolu_s2",
					"cd /Users/ana/code/scratch && git log -1",
					"abc init",
				),
				...sub.bash(
					"toolu_s3",
					"cat /Users/ana/code/scratch/README.md",
					"# scratch",
				),
				sub.say("Clean."),
			].join("\n"),
		},
	});
	expect(await runsOf(coordinatorSession)).toEqual([
		{
			agent: "",
			turn: 1,
			repository: "github.com/acme/shop",
			cwd: "/Users/ana/code/cli",
			cwd_repository: "github.com/acme/cli",
			cwd_repository_basis: "transfer_remote",
		},
		{
			agent: "",
			turn: 2,
			repository: "github.com/acme/shop",
			// The coordinator folder: the upload's branch was never recorded there.
			cwd: LAUNCH,
			cwd_repository: null,
			cwd_repository_basis: "",
		},
		{
			agent: "a1b2c3d4e5f6a7b8c",
			turn: 1,
			repository: "github.com/acme/shop",
			cwd: "/Users/ana/code/scratch",
			cwd_repository: null,
			cwd_repository_basis: "",
		},
	]);
});

test("a session started inside its repository names it where the upload's branch was recorded", async () => {
	const main = stream({ cwd: SHOP, gitBranch: "feat/login", startSecond: 0 });
	await upload({
		sessionId: repoSession,
		projectPath: SHOP,
		gitRemote: "github.com/acme/shop",
		gitBranch: "feat/login",
		content: [
			main.prompt("fix the login test"),
			...main.bash("toolu_test", "bun test src/login.test.ts", "1 pass"),
			main.say("Fixed."),
		].join("\n"),
	});
	expect(await runsOf(repoSession)).toEqual([
		{
			agent: "",
			turn: 1,
			repository: "github.com/acme/shop",
			cwd: SHOP,
			cwd_repository: "github.com/acme/shop",
			cwd_repository_basis: "session_branch",
		},
	]);

	const outcome = await runSql(
		caller,
		{
			query: `SELECT session_id = '${repoSession}' AS repo_session, repository, cwd, cwd_repository, cwd_repository_basis
				FROM runs WHERE started_at >= now() - INTERVAL 1 DAY ORDER BY repo_session, agent_id, turn_idx`,
			title: "directories",
		},
		sqlEnv(),
	);
	if (!outcome.ok) throw new Error(outcome.error.message);
	const table = outcome.result.table;
	expect(table).toContain("github.com/acme/cli");
	expect(table).toContain("transfer_remote");
	expect(table).toContain("session_branch");
	expect(table).toContain("/Users/ana/code/scratch");
});
