import type { AgentQueryLimiter } from "../services/analysis/agent-query-slots.js";
import "./helpers/local-integration-guard.js";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
	AnalysisFindInputSchema,
	type AnalysisFindOutput,
} from "@rudel/api-routes";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
} from "@rudel/api-routes/transcript-records";
import { getClickhouse } from "../clickhouse.js";
import { findAnalysis } from "../services/analysis/find.service.js";
import {
	describeSchema,
	runSql,
	type SqlCaller,
	type SqlOutcome,
} from "../services/analysis/sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "../services/analysis/sql-results.js";
import {
	baseRow,
	type GitObservationRecord,
	parseGitObservations,
} from "../services/git-observation-parser.js";
import { evidenceIdOf } from "../services/l1-edges/l1-edge-ids.js";
import { buildRunIndex } from "../services/l1-edges/run-index.service.js";
import {
	buildTranscriptRecordRow,
	buildTranscriptRecordsReceiptRow,
	hashTranscriptContent,
} from "../services/transcript-records-ingest.service.js";

/** Every query gets a slot at once. */
const unlimited: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};

/**
 * The calls, prompts, git_events, edges and ci_jobs views through the SQL
 * gateway against real ClickHouse: sessions are ingested as uploads store
 * them (transcript records of a committed generation, git observations, the
 * run index the worker builds), then read only with the agent's SQL.
 */

setDefaultTimeout(120_000);

const RUN = `sql_views_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const alice = `${RUN}_alice`;
const bob = `${RUN}_bob`;
const clickhouse = getClickhouse();
const baseMs = Date.now() - 3_600_000;

/** A member of a workspace with the default visibility: every member's sessions. */
const teammate: SqlCaller = {
	workspaceId: workspace,
	reader: { userId: alice, role: "member", ownSessionsOnly: false },
};

/** GitHub repositories the workspace binds and may see; another one holds facts too. */
const repository = `${Date.now() % 1_000_000_000}`;
const unbound = `${repository}9`;

const ownOnlyOf = (userId: string): SqlCaller => ({
	workspaceId: workspace,
	reader: { userId, role: "member", ownSessionsOnly: true },
});

/** A member of a workspace that keeps members to their own sessions. */
const ownOnly = ownOnlyOf(bob);

const env = () => ({
	executor: clickhouse,
	results: createMemorySqlResultStore(),
	quota: createMemorySqlQuota({ queries: 1_000, windowMs: 3_600_000 }),
	limiter: unlimited,
	githubRepositories: async (workspaceId: string) =>
		workspaceId === workspace ? [repository] : [],
});

const at = (seconds: number) =>
	new Date(baseMs + seconds * 1_000).toISOString();

const jsonl = (lines: readonly unknown[]) =>
	lines.map((line) => JSON.stringify(line)).join("\n");
const prompt = (text: string, seconds = 0) => ({
	type: "user",
	timestamp: at(seconds),
	message: { role: "user", content: text },
});
const bash = (id: string, command: string, seconds = 1) => ({
	type: "assistant",
	timestamp: at(seconds),
	message: {
		role: "assistant",
		content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
	},
});
const write = (id: string, path: string, content: string, seconds = 1) => ({
	type: "assistant",
	timestamp: at(seconds),
	message: {
		role: "assistant",
		content: [
			{
				type: "tool_use",
				id,
				name: "Write",
				input: { file_path: path, content },
			},
		],
	},
});
const result = (id: string, content: string, isError = false, seconds = 2) => ({
	type: "user",
	timestamp: at(seconds),
	message: {
		role: "user",
		content: [
			{ type: "tool_result", tool_use_id: id, content, is_error: isError },
		],
	},
});

/**
 * Stores a session as an upload does (Claude Code unless `source` says
 * otherwise): its transcript records committed by a receipt (revision 1),
 * records of a newer upload whose receipt never arrived (revision 2), its git
 * observations, its session row and the run index the worker builds.
 */
async function ingest(
	user: string,
	sessionId: string,
	content: string,
	{
		source = "claude_code",
		sessionDate = at(0),
	}: { source?: "claude_code" | "codex"; sessionDate?: string } = {},
) {
	const identity = {
		organizationId: workspace,
		userId: user,
		sessionId,
		source,
		revision: "1",
		sessionDate,
	};
	const stats = createSplitStats();
	const drafts = [
		...splitSessionTranscript({ content, sessionDate, source }, stats),
	];
	const rows = drafts.map((draft) => buildTranscriptRecordRow(identity, draft));
	await clickhouse.insert({
		table: "rudel.transcript_records",
		asyncInsert: false,
		values: [
			...rows,
			buildTranscriptRecordsReceiptRow(identity, {
				...summarizeSplit(stats),
				contentSha256: hashTranscriptContent(content),
				parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
				publishedAt: new Date().toISOString(),
				rowCount: rows.length,
			}),
			...rows.map((row) => ({ ...row, revision: "2" })),
		],
	});
	const observed = {
		organizationId: workspace,
		userId: user,
		sessionId,
		source,
		revision: "1",
		transcriptParserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
	};
	await clickhouse.insert({
		table: "rudel.session_git_observations",
		asyncInsert: false,
		values: [
			...parseGitObservations({
				...observed,
				records: drafts.map(
					(draft): GitObservationRecord => ({
						agent_id: draft.agentId,
						record_idx: draft.recordIdx,
						block_idx: draft.blockIdx,
						call_id: draft.callId,
						kind: draft.kind,
						subtype: draft.subtype,
						tool_name: draft.toolName,
						is_error: draft.isError,
						exit_code: draft.exitCode,
						ts: draft.ts,
						text: draft.text,
						text_chars: draft.textChars,
						byte_start: String(draft.byteStart),
						byte_len: draft.byteLen,
						raw: Buffer.from(content)
							.subarray(draft.byteStart, draft.byteStart + draft.byteLen)
							.toString(),
					}),
				),
			}),
			{
				...baseRow(observed, {
					agent_id: "",
					record_idx: 4_294_967_295,
					block_idx: 0,
					call_id: "",
					ts: at(0),
				}),
				kind: "receipt",
				label: "",
			},
		],
	});
	await clickhouse.insert({
		table: "rudel.session_analytics",
		asyncInsert: false,
		values: [
			{
				organization_id: workspace,
				user_id: user,
				session_id: sessionId,
				source,
				session_date: sessionDate.replace("T", " ").replace("Z", ""),
				last_interaction_date: at(60).replace("T", " ").replace("Z", ""),
				project_path: "/test/sql-views",
				git_remote: "github.com/opalinehq/athena",
				model_used: "claude-opus-5-5",
				revision: "1",
			},
		],
	});
	await buildRunIndex({
		executor: clickhouse,
		organizationId: workspace,
		session: { userId: user, source, sessionId },
		buildRevision: 1,
		beforeWrite: async () => {},
	});
}

async function sql(caller: SqlCaller, query: string): Promise<string[]> {
	const outcome: SqlOutcome = await runSql(
		caller,
		{ query, title: "test" },
		env(),
	);
	if (!outcome.ok)
		throw new Error(`Expected a result: ${outcome.error.message}`);
	return outcome.result.table.split("\n");
}

afterAll(async () => {
	for (const table of ["rudel.github_ci_jobs", "rudel.github_ci_runs"])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE workspace_id = {workspace:String} SETTINGS lightweight_deletes_sync = 2`,
			query_params: { workspace },
		});
	for (const table of [
		"rudel.transcript_records",
		"rudel.run_index",
		"rudel.session_git_observations",
		"rudel.session_analytics",
		"rudel.l1_edges",
		"rudel.l1_edges_by_target",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {workspace:String} SETTINGS lightweight_deletes_sync = 2`,
			query_params: { workspace },
		});
});

describe("the calls view", () => {
	const aliceSession = `${RUN}_calls_alice`;
	const bobSession = `${RUN}_calls_bob`;

	test("groups failing calls by command fingerprint across members' sessions, each call once", async () => {
		await ingest(
			alice,
			aliceSession,
			jsonl([
				prompt("run the tests"),
				bash("a1", "cd /Users/alice/app && bun test src/login.test.ts"),
				result("a1", "1 fail", true),
				bash("a2", "git status"),
				result("a2", "clean"),
			]),
		);
		await ingest(
			bob,
			bobSession,
			jsonl([
				prompt("fix login"),
				bash("b1", "cd /home/bob/app && bun test src/login.test.ts 2>&1"),
				result("b1", "1 fail", true),
				bash("b2", "bun test src/login.test.ts"),
				result("b2", "pass"),
			]),
		);

		expect(
			await sql(
				teammate,
				`SELECT command_prefix, count() AS calls, countIf(failed) AS failed,
					uniqExact(session_id) AS sessions, uniqExact(user_id) AS members
				FROM calls
				WHERE session_id IN ('${aliceSession}', '${bobSession}')
				GROUP BY command_fingerprint, command_prefix
				ORDER BY failed DESC, calls DESC`,
			),
		).toEqual([
			"command_prefix | calls | failed | sessions | members",
			"bun test | 3 | 2 | 2 | 2",
			"git status | 1 | 0 | 1 | 1",
		]);
	});

	test("each call joins its run by run_id", async () => {
		const session = `${RUN}_calls_runs`;
		await ingest(
			alice,
			session,
			jsonl([
				prompt("write a deploy script"),
				bash("w0", "ls scripts"),
				result("w0", "build.sh"),
				write(
					"w1",
					"/Users/alice/app/scripts/deploy.sh",
					"#!/bin/sh\nbun run build\n",
				),
				result("w1", "File created"),
				prompt("run it", 10),
				bash("w2", "sh scripts/deploy.sh", 11),
				result("w2", "Exit code 1\nbuild failed", true, 12),
			]),
		);

		expect(
			await sql(
				teammate,
				`SELECT r.turn_idx AS turn, r.tool_calls AS run_calls, count() AS calls,
					countIf(c.failed) AS failed, arraySort(groupArray(c.command_from)) AS carried
				FROM calls AS c JOIN runs AS r ON c.run_id = r.run_id
				WHERE c.session_id = '${session}'
				GROUP BY r.turn_idx, r.tool_calls ORDER BY turn`,
			),
		).toEqual([
			"turn | run_calls | calls | failed | carried",
			'1 | 2 | 2 | 0 | ["","command"]',
			'2 | 1 | 1 | 1 | ["command"]',
		]);
	});
});

describe("a forked Codex session", () => {
	test("its calls and prompts copied from the parent are the parent's, as its runs count them", async () => {
		const parent = `${RUN}_fork_parent`;
		const fork = `${RUN}_fork_child`;
		const line = (
			second: number,
			type: string,
			payload: Record<string, unknown>,
			ordinal?: number,
		) =>
			JSON.stringify({
				timestamp: at(second),
				...(ordinal === undefined ? {} : { ordinal }),
				type,
				payload,
			});
		const typed = (second: number, text: string, ordinal?: number) =>
			line(
				second,
				"response_item",
				{
					type: "message",
					role: "user",
					content: [{ type: "input_text", text }],
				},
				ordinal,
			);
		const exec = (
			second: number,
			id: string,
			exit: number,
			ordinal?: number,
		) => [
			line(
				second,
				"response_item",
				{
					type: "function_call",
					name: "exec_command",
					arguments: JSON.stringify({ cmd: "bun test" }),
					call_id: id,
				},
				ordinal,
			),
			line(
				second + 1,
				"response_item",
				{
					type: "function_call_output",
					call_id: id,
					output: `Process exited with code ${exit}\nOutput:\n${exit === 0 ? "pass" : "1 fail"}`,
				},
				ordinal === undefined ? undefined : ordinal + 1,
			),
		];
		// The parent's history, numbered as a fork replays it (ordinals 0 to 3).
		const history = (ordinals: boolean) => [
			line(
				0,
				"session_meta",
				{ id: parent, cli_version: "0.156.0" },
				ordinals ? 0 : undefined,
			),
			typed(1, "run the tests", ordinals ? 1 : undefined),
			...exec(2, "call_parent", 1, ordinals ? 2 : undefined),
		];
		await ingest(alice, parent, history(false).join("\n"), {
			source: "codex",
		});
		await ingest(
			alice,
			fork,
			[
				line(10, "session_meta", {
					id: fork,
					cli_version: "0.156.0",
					forked_from_id: parent,
					forked_from_ordinal_exclusive: 4,
				}),
				...history(true),
				typed(11, "now fix them", 4),
				...exec(12, "call_fork", 0, 5),
			].join("\n"),
			{ source: "codex" },
		);

		const sessions = `session_id IN ('${parent}', '${fork}')`;
		expect(
			await sql(
				teammate,
				`SELECT session_id = '${fork}' AS forked, call_id, failed, run_id != '' AS in_run
				FROM calls WHERE ${sessions} ORDER BY forked, call_id`,
			),
		).toEqual([
			"forked | call_id | failed | in_run",
			"0 | call_parent | 1 | 1",
			"1 | call_fork | 0 | 1",
		]);
		expect(
			await sql(
				teammate,
				`SELECT session_id = '${fork}' AS forked, groupArray(text) AS typed
				FROM prompts WHERE ${sessions} AND genuine = 1 GROUP BY forked ORDER BY forked`,
			),
		).toEqual([
			"forked | typed",
			'0 | ["run the tests"]',
			'1 | ["now fix them"]',
		]);
		expect(
			await sql(
				teammate,
				`SELECT sum(genuine_prompts) AS typed, sum(tool_calls) AS calls, sum(failed_calls) AS failed
				FROM runs WHERE session_id = '${fork}'`,
			),
		).toEqual(["typed | calls | failed", "1 | 1 | 0"]);
	});
});

describe("the prompts view", () => {
	test("one row per prompt of the committed generation, joined to the run it starts", async () => {
		const session = `${RUN}_prompts`;
		await ingest(
			bob,
			session,
			jsonl([
				prompt("why does login fail?"),
				bash("p1", "bun test"),
				result("p1", "pass"),
				prompt("it still fails", 10),
				bash("p2", "bun test", 11),
				result("p2", "fail", true, 12),
				prompt(`paste: ${"x".repeat(69_993)}`, 20),
			]),
		);

		expect(
			await sql(
				teammate,
				`SELECT p.turn_idx, p.kind, p.genuine, substring(p.text, 1, 20) AS text, p.text_chars,
					p.text_cut, startsWith(r.prompt_head, substring(p.text, 1, 20)) AS starts_run
				FROM prompts AS p LEFT JOIN runs AS r ON p.run_id = r.run_id
				WHERE p.session_id = '${session}' ORDER BY p.record_idx`,
			),
		).toEqual([
			"turn_idx | kind | genuine | text | text_chars | text_cut | starts_run",
			"1 | user_prompt | 1 | why does login fail? | 20 | 0 | 1",
			"2 | user_prompt | 1 | it still fails | 14 | 0 | 1",
			"3 | user_prompt | 1 | paste: xxxxxxxxxxxxx | 70000 | 0 | 1",
		]);
	});
	test("a time range keeps every prompt sent in it, in sessions that started before it too", async () => {
		const session = `${RUN}_prompts_resumed`;
		const daysAgo = -10 * 86_400;
		await ingest(
			bob,
			session,
			jsonl([
				prompt("start the migration", daysAgo),
				bash("m1", "bun run migrate", daysAgo + 1),
				result("m1", "done", false, daysAgo + 2),
				prompt("finish the migration", 10),
			]),
			{ sessionDate: at(daysAgo) },
		);

		for (const [range, text] of [
			[">=", "finish the migration"],
			["<", "start the migration"],
		] as const)
			expect(
				await sql(
					teammate,
					`SELECT text FROM prompts
					WHERE at ${range} now() - INTERVAL 1 DAY AND session_id = '${session}'`,
				),
			).toEqual(["text", text]);
	});
});

describe("the git_events view", () => {
	test("pushes with no CI check after them are the pushes find source=git reports with no checks after, on the same window", async () => {
		const session = `${RUN}_git`;
		await ingest(
			alice,
			session,
			jsonl([
				prompt("ship it"),
				bash("g1", "git push -u origin feat/a"),
				result(
					"g1",
					"To github.com:opalinehq/athena.git\n   a1b2c3d..d4e5f6a  feat/a -> feat/a",
				),
				bash("g2", "gh pr checks 133 --repo opalinehq/athena"),
				result(
					"g2",
					[
						"build\tpass\t1m\thttps://github.com/opalinehq/athena/actions/runs/8801/job/1",
						"deploy\tpass\t2m\thttps://github.com/opalinehq/athena/actions/runs/8802/job/2",
					].join("\n"),
				),
				// A check in the same call as the push is not after it.
				bash(
					"g5",
					"git push origin feat/a; gh pr checks 133 --repo opalinehq/athena",
					2,
				),
				result(
					"g5",
					"To github.com:opalinehq/athena.git\n   f6a7b8c..a7b8c9d  feat/a -> feat/a\nbuild\tpass",
					false,
					3,
				),
				bash("g3", "git push origin feat/a", 3),
				result(
					"g3",
					"To github.com:opalinehq/athena.git\n   d4e5f6a..e5f6a7b  feat/a -> feat/a",
					false,
					4,
				),
				prompt("and the fix", 10),
				bash("g4", "git push origin feat/a", 11),
				result(
					"g4",
					"To github.com:opalinehq/athena.git\n   e5f6a7b..f6a7b8c  feat/a -> feat/a",
					false,
					12,
				),
			]),
		);
		// A newer upload's extraction, of a transcript generation not indexed:
		// find reads the indexed one, and so does the view.
		const newer = {
			organizationId: workspace,
			userId: alice,
			sessionId: session,
			source: "claude_code" as const,
			revision: "3",
			transcriptParserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
		};
		await clickhouse.insert({
			table: "rudel.session_git_observations",
			asyncInsert: false,
			values: [
				{
					...baseRow(newer, {
						agent_id: "",
						record_idx: 30,
						block_idx: 0,
						call_id: "g9",
						ts: at(30),
					}),
					kind: "push_range",
					label: "observed",
					push_to_sha: "9999999",
				},
				{
					...baseRow(newer, {
						agent_id: "",
						record_idx: 4_294_967_295,
						block_idx: 0,
						call_id: "",
						ts: at(30),
					}),
					kind: "receipt",
					label: "",
				},
			],
		});
		const day = at(0).slice(0, 10);
		const found: AnalysisFindOutput = await findAnalysis(
			{ organizationId: workspace, userId: null },
			AnalysisFindInputSchema.parse({
				source: "git",
				sessionId: session,
				from: day,
				to: day,
			}),
			{
				executor: clickhouse,
				github: {
					access: async () => ({
						visibility: "hidden" as const,
						bindings: [],
						repositories: new Map(),
					}),
					evidence: async () => ({ snapshots: [], captures: [] }),
				},
			},
		);
		if (found.source !== "git") throw new Error("Expected git events");
		const unchecked = found.events
			.filter(
				(event) =>
					event.kind === "push_range" && event.checksAfter?.count === 0,
			)
			.sort((left, right) => left.record - right.record)
			.map((event) => `${event.turn} | ${event.record} | ${event.pushTo}`);
		expect(unchecked).toHaveLength(3);

		expect(
			await sql(
				teammate,
				`SELECT r.turn_idx AS turn_idx, e.record_idx, e.push_to_sha
				FROM git_events AS e JOIN runs AS r ON e.run_id = r.run_id
				WHERE e.kind = 'push_range' AND e.checks_after = 0
					AND e.session_id = '${session}'
					AND toDate(e.session_date) BETWEEN '${day}' AND '${day}'
				ORDER BY e.record_idx`,
			),
		).toEqual(["turn_idx | record_idx | push_to_sha", ...unchecked]);

		expect(
			found.events.find(
				(event) => event.kind === "push_range" && event.pushTo === "d4e5f6a",
			)?.checksAfter,
		).toMatchObject({ count: 2, unconfirmed: 0 });
		expect(
			await sql(
				teammate,
				`SELECT e.checks_after, e.unconfirmed_checks_after
				FROM git_events AS e
				WHERE e.kind = 'push_range' AND e.push_to_sha = 'd4e5f6a'
					AND e.session_id = '${session}'
					AND toDate(e.session_date) BETWEEN '${day}' AND '${day}'`,
			),
		).toEqual(["checks_after | unconfirmed_checks_after", "2 | 0"]);
	});
});

/**
 * Rows of several versions, one insert per version as their writers make
 * them, so a reader that skips FINAL sees every version.
 */
async function insertBuilds<TRow extends Record<string, unknown>>(
	table: string,
	version: keyof TRow & string,
	rows: readonly TRow[],
) {
	for (const value of [...new Set(rows.map((row) => String(row[version])))])
		await clickhouse.insert({
			table,
			asyncInsert: false,
			values: rows.filter((row) => String(row[version]) === value),
		});
}

/** An edge as the reconciliation worker writes it: a full row per revision. */
function edge(row: {
	from_kind: string;
	from_id: string;
	relation: string;
	to_kind: string;
	to_id: string;
	repository_id: string;
	revision: number;
	is_active?: number;
	user_id?: string;
	session_id?: string;
	match_rule?: string;
}) {
	return {
		organization_id: workspace,
		evidence_id: `ev_${row.relation}_${row.to_id}`,
		basis: row.user_id ? "transcript" : "github",
		source: row.user_id ? "claude_code" : "",
		agent_id: "",
		turn_idx: row.from_kind === "run" ? 1 : 0,
		observed_at: at(5).replace("T", " ").replace("Z", ""),
		matched_value: row.to_id.split("/").at(-1) ?? "",
		match_rule: "full_sha",
		candidate_count: 1,
		details: "{}",
		resolver_version: 2,
		written_at: at(6).replace("T", " ").replace("Z", ""),
		is_active: 1,
		user_id: "",
		session_id: "",
		...row,
	};
}

describe("the edges view", () => {
	test("follows a run to its commits, their PRs and CI runs through the active edges of the latest revision, in bound repositories only", async () => {
		const session = `${RUN}_edges`;
		await ingest(
			alice,
			session,
			jsonl([prompt("push"), bash("e1", "git status"), result("e1", "ok")]),
		);
		const [, runId = ""] = await sql(
			teammate,
			`SELECT run_id FROM runs WHERE session_id = '${session}'`,
		);
		const commit = `${repository}/${"a".repeat(40)}`;
		const own = { user_id: alice, session_id: session };
		await insertBuilds("rudel.l1_edges", "revision", [
			edge({
				...own,
				from_kind: "run",
				from_id: runId,
				relation: "commit_pushed",
				to_kind: "commit",
				to_id: commit,
				repository_id: repository,
				revision: 1,
			}),
			// Created in revision 1, retracted in revision 2.
			edge({
				...own,
				from_kind: "run",
				from_id: runId,
				relation: "commit_created",
				to_kind: "commit",
				to_id: `${repository}/${"b".repeat(40)}`,
				repository_id: repository,
				revision: 1,
			}),
			edge({
				...own,
				from_kind: "run",
				from_id: runId,
				relation: "commit_created",
				to_kind: "commit",
				to_id: `${repository}/${"b".repeat(40)}`,
				repository_id: repository,
				revision: 2,
				is_active: 0,
			}),
			// A repository the workspace does not bind (or no longer may see).
			edge({
				...own,
				from_kind: "run",
				from_id: runId,
				relation: "commit_pushed",
				to_kind: "commit",
				to_id: `${unbound}/${"c".repeat(40)}`,
				repository_id: unbound,
				revision: 1,
			}),
			edge({
				from_kind: "commit",
				from_id: commit,
				relation: "commit_in_pr",
				to_kind: "pull_request",
				to_id: `${repository}/7`,
				repository_id: repository,
				revision: 1,
				match_rule: "membership",
			}),
			// Rewritten in revision 3: read once, as revision 3 wrote it.
			edge({
				from_kind: "commit",
				from_id: commit,
				relation: "ci_on_sha",
				to_kind: "ci_run",
				to_id: `${repository}/actions_run/900/1`,
				repository_id: repository,
				revision: 1,
			}),
			edge({
				from_kind: "commit",
				from_id: commit,
				relation: "ci_on_sha",
				to_kind: "ci_run",
				to_id: `${repository}/actions_run/900/1`,
				repository_id: repository,
				revision: 3,
				match_rule: "head_sha",
			}),
		]);

		expect(
			await sql(
				teammate,
				`SELECT run.relation AS pushed, next.relation AS relation, next.to_id AS target, next.match_rule AS rule
				FROM edges AS run
				JOIN runs AS r ON run.run_id = r.run_id
				LEFT JOIN edges AS next ON next.from_id = run.to_id
				WHERE r.session_id = '${session}'
				ORDER BY pushed, relation`,
			),
		).toEqual([
			"pushed | relation | target | rule",
			`commit_pushed | ci_on_sha | ${repository}/actions_run/900/1 | head_sha`,
			`commit_pushed | commit_in_pr | ${repository}/7 | membership`,
		]);
	});
});

describe("the ci_jobs view", () => {
	test("a run's CI jobs, through its pushed commit's CI runs: each job once, as GitHub last reported it, in bound repositories only", async () => {
		const session = `${RUN}_ci`;
		await ingest(
			bob,
			session,
			jsonl([prompt("push"), bash("c1", "git status"), result("c1", "ok")]),
		);
		const [, runId = ""] = await sql(
			teammate,
			`SELECT run_id FROM runs WHERE session_id = '${session}'`,
		);
		const commit = `${repository}/${"d".repeat(40)}`;
		await clickhouse.insert({
			table: "rudel.l1_edges",
			asyncInsert: false,
			values: [
				edge({
					user_id: bob,
					session_id: session,
					from_kind: "run",
					from_id: runId,
					relation: "commit_pushed",
					to_kind: "commit",
					to_id: commit,
					repository_id: repository,
					revision: 1,
				}),
				edge({
					from_kind: "commit",
					from_id: commit,
					relation: "ci_on_sha",
					to_kind: "ci_run",
					to_id: `${repository}/actions_run/901/2`,
					repository_id: repository,
					revision: 1,
				}),
			],
		});
		const github = (repositoryId: string, version: number) => ({
			workspace_id: workspace,
			provider: "github",
			repository_id: repositoryId,
			version: String(version),
			synced_at: at(30).replace("T", " ").replace("Z", ""),
		});
		const job = (
			repositoryId: string,
			jobId: string,
			name: string,
			status: string,
			conclusion: string | null,
			version: number,
		) => ({
			...github(repositoryId, version),
			run_id: "901",
			attempt: 2,
			job_id: jobId,
			name,
			status,
			conclusion,
			created_at: at(20).replace("T", " ").replace("Z", ""),
			started_at: at(21).replace("T", " ").replace("Z", ""),
			completed_at: conclusion
				? at(81).replace("T", " ").replace("Z", "")
				: null,
			runner_name: "ubuntu",
			labels: ["ubuntu-latest"],
		});
		await insertBuilds("rudel.github_ci_jobs", "version", [
			job(repository, "1", "lint", "completed", "success", 1),
			job(repository, "2", "e2e", "in_progress", null, 1),
			job(repository, "2", "e2e", "completed", "failure", 2),
			job(unbound, "3", "deploy", "completed", "failure", 1),
		]);
		await clickhouse.insert({
			table: "rudel.github_ci_runs",
			asyncInsert: false,
			values: [
				{
					...github(repository, 1),
					kind: "actions_run",
					run_id: "901",
					attempt: 2,
					created_at: at(20).replace("T", " ").replace("Z", ""),
					workflow_name: "CI",
					event: "push",
					head_sha: "d".repeat(40),
					head_branch: "feat/ci",
					status: "completed",
					conclusion: "failure",
				},
			],
		});

		expect(
			await sql(
				teammate,
				`SELECT j.name AS job, j.conclusion AS conclusion, j.seconds AS seconds,
					j.workflow_name AS workflow, j.head_branch AS branch, j.run_conclusion AS run
				FROM edges AS pushed
				JOIN runs AS r ON pushed.run_id = r.run_id
				JOIN edges AS ci ON ci.from_id = pushed.to_id AND ci.to_kind = 'ci_run'
				JOIN ci_jobs AS j ON j.ci_run_id = ci.to_id
				WHERE r.session_id = '${session}'
				ORDER BY job`,
			),
		).toEqual([
			"job | conclusion | seconds | workflow | branch | run",
			"e2e | failure | 60 | CI | feat/ci | failure",
			"lint | success | 60 | CI | feat/ci | failure",
		]);
		expect(
			await sql(
				teammate,
				"SELECT count() AS jobs FROM ci_jobs WHERE name = 'deploy'",
			),
		).toEqual(["jobs", "0"]);
	});
});

test("where the workspace keeps members to their own sessions, a member's views hold only their sessions, and the workspace's GitHub facts", async () => {
	const session = `${RUN}_own`;
	const pushing = jsonl([
		prompt("push"),
		bash("o1", "git push origin main"),
		result(
			"o1",
			"To github.com:opalinehq/athena.git\n   1111111..2222222  main -> main",
		),
	]);
	await ingest(alice, session, pushing);
	await ingest(bob, `${RUN}_own_bob`, pushing);
	const commit = `${repository}/${"e".repeat(40)}`;
	await clickhouse.insert({
		table: "rudel.l1_edges",
		asyncInsert: false,
		values: [
			edge({
				user_id: alice,
				session_id: session,
				from_kind: "session",
				from_id: `${alice}/claude_code/${session}/`,
				relation: "commit_captured",
				to_kind: "commit",
				to_id: commit,
				repository_id: repository,
				revision: 1,
			}),
			edge({
				user_id: bob,
				session_id: `${RUN}_own_bob`,
				from_kind: "session",
				from_id: `${bob}/claude_code/${RUN}_own_bob/`,
				relation: "commit_captured",
				to_kind: "commit",
				to_id: commit,
				repository_id: repository,
				revision: 1,
			}),
			edge({
				from_kind: "commit",
				from_id: commit,
				relation: "commit_in_pr",
				to_kind: "pull_request",
				to_id: `${repository}/8`,
				repository_id: repository,
				revision: 1,
			}),
		],
	});
	await clickhouse.insert({
		table: "rudel.github_ci_jobs",
		asyncInsert: false,
		values: [
			{
				workspace_id: workspace,
				provider: "github",
				repository_id: repository,
				run_id: "902",
				attempt: 1,
				job_id: "9",
				name: "own",
				status: "queued",
				version: "1",
			},
		],
	});
	for (const view of ["calls", "prompts", "git_events"]) {
		expect(
			await sql(
				teammate,
				`SELECT count() > 0 AS rows FROM ${view} WHERE session_id = '${session}'`,
			),
		).toEqual(["rows", "1"]);
		expect(
			await sql(
				ownOnly,
				`SELECT arraySort(groupUniqArray(user_id)) AS members FROM ${view}`,
			),
		).toEqual(["members", `["${bob}"]`]);
	}
	expect(
		await sql(
			ownOnly,
			"SELECT arraySort(groupUniqArray(user_id)) AS members FROM edges",
		),
	).toEqual(["members", `["","${bob}"]`]);
	expect(
		await sql(
			ownOnly,
			"SELECT count() AS jobs FROM ci_jobs WHERE github_run_id = '902'",
		),
	).toEqual(["jobs", "1"]);
	// A workspace without visible GitHub repositories reads no GitHub facts.
	const elsewhere: SqlCaller = {
		workspaceId: `${RUN}_no_github`,
		reader: { userId: bob, role: "member", ownSessionsOnly: false },
	};
	for (const view of ["edges", "ci_jobs"])
		expect(await sql(elsewhere, `SELECT count() AS n FROM ${view}`)).toEqual([
			"n",
			"0",
		]);
});

test("schema lists a column's top values over the view's own time column", async () => {
	const session = `${RUN}_schema`;
	const carol = `${RUN}_carol`;
	await ingest(
		carol,
		session,
		jsonl([
			prompt("check"),
			bash("s1", "gh pr view 1"),
			result("s1", "open"),
			bash("s2", "gh pr view 2"),
			result("s2", "open"),
			bash("s3", "git log"),
			result("s3", "a"),
		]),
	);
	const outcome = await describeSchema(
		ownOnlyOf(carol),
		{ view: "calls", column: "command_prefix" },
		env(),
	);
	expect(outcome).toMatchObject({
		ok: true,
		result: {
			over: "calls made in the last 30 days",
			values: [
				{ value: "gh pr", rows: 2 },
				{ value: "git log", rows: 1 },
			],
		},
	});
});

test("schema describes every view as sql returns it: the same columns, in order, with their types", async () => {
	const session = `${RUN}_described`;
	const dave = `${RUN}_dave`;
	await ingest(
		dave,
		session,
		jsonl([
			prompt("push"),
			bash("d1", "git push origin main"),
			result(
				"d1",
				"To github.com:opalinehq/athena.git\n   1111111..2222222  main -> main",
			),
		]),
	);
	const [, runId = ""] = await sql(
		teammate,
		`SELECT run_id FROM runs WHERE session_id = '${session}'`,
	);
	await clickhouse.insert({
		table: "rudel.l1_edges",
		asyncInsert: false,
		values: [
			edge({
				user_id: dave,
				session_id: session,
				from_kind: "run",
				from_id: runId,
				relation: "commit_pushed",
				to_kind: "commit",
				to_id: `${repository}/${"f".repeat(40)}`,
				repository_id: repository,
				revision: 1,
			}),
		],
	});
	await clickhouse.insert({
		table: "rudel.github_ci_jobs",
		asyncInsert: false,
		values: [
			{
				workspace_id: workspace,
				provider: "github",
				repository_id: repository,
				run_id: "903",
				attempt: 1,
				job_id: "10",
				name: "described",
				status: "completed",
				version: "1",
			},
		],
	});
	const views = await describeSchema(teammate, {}, env());
	if (!views.ok || views.result.level !== "views")
		throw new Error("Expected views");
	const narrow: Record<string, string> = {
		runs: `session_id = '${session}'`,
		calls: `session_id = '${session}'`,
		prompts: `session_id = '${session}'`,
		git_events: `session_id = '${session}'`,
		edges: `session_id = '${session}'`,
		ci_jobs: "github_run_id = '903'",
	};
	for (const { name } of views.result.views) {
		// finding_runs and run_answers hold saved analyses' rows and stored answers; their own tests cover them.
		const where = narrow[name];
		if (!where) continue;
		const described = await describeSchema(teammate, { view: name }, env());
		if (!described.ok || described.result.level !== "columns")
			throw new Error(`Expected the columns of ${name}`);
		const columns = described.result.columns;
		const [header] = await sql(
			teammate,
			`SELECT * FROM ${name} WHERE ${where} LIMIT 1`,
		);
		expect(header?.split(" | ")).toEqual(columns.map((column) => column.name));
		const [, types] = await sql(
			teammate,
			`SELECT ${columns.map((column, index) => `toTypeName(${column.name}) AS type_${index}`).join(", ")}
			FROM ${name} WHERE ${where} LIMIT 1`,
		);
		expect({ name, types: types?.split(" | ") }).toEqual({
			name,
			types: columns.map((column) => column.type),
		});
	}
});

test("git_events evidence ids are the edges' evidence ids, whatever the stream is called", async () => {
	const session = `${RUN}_evidence`;
	const erin = `${RUN}_erin`;
	await ingest(
		erin,
		session,
		jsonl([prompt("push"), bash("v1", "git status"), result("v1", "ok")]),
	);
	const observed = {
		organizationId: workspace,
		userId: erin,
		sessionId: session,
		source: "claude_code" as const,
		revision: "1",
		transcriptParserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
	};
	const stream = "sub(1)!*'";
	await clickhouse.insert({
		table: "rudel.session_git_observations",
		asyncInsert: false,
		values: [
			{
				...baseRow(observed, {
					agent_id: stream,
					record_idx: 2,
					block_idx: 0,
					call_id: "v1",
					ts: at(1),
				}),
				kind: "push_range",
				label: "observed",
				push_to_sha: "2222222",
			},
		],
	});
	await clickhouse.insert({
		table: "rudel.l1_edges",
		asyncInsert: false,
		values: [
			edge({
				user_id: erin,
				session_id: session,
				from_kind: "session",
				from_id: `${erin}/claude_code/${session}/${encodeURIComponent(stream)}`,
				relation: "commit_pushed",
				to_kind: "commit",
				to_id: `${repository}/${"9".repeat(40)}`,
				repository_id: repository,
				revision: 1,
			}),
		].map((row) => ({
			...row,
			agent_id: stream,
			evidence_id: evidenceIdOf({
				generation: {},
				call: "v1",
				agentId: stream,
				record: 2,
				block: 0,
				kind: "push_range",
			}),
		})),
	});

	expect(
		await sql(
			teammate,
			`SELECT g.push_to_sha AS pushed, e.relation AS relation
			FROM git_events AS g
			JOIN edges AS e ON e.evidence_id = g.evidence_id AND e.session_id = g.session_id
			WHERE g.session_id = '${session}'`,
		),
	).toEqual(["pushed | relation", "2222222 | commit_pushed"]);
});
