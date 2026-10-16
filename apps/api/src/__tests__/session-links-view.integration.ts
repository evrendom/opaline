import type { AgentQueryLimiter } from "../services/analysis/agent-query-slots.js";
import "./helpers/local-integration-guard.js";
import {
	afterAll,
	afterEach,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import { SESSION_LINEAGE_DERIVATION_VERSION } from "@rudel/api-routes";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
} from "@rudel/api-routes/transcript-records";
import { getClickhouse } from "../clickhouse.js";
import {
	runSql,
	type SqlCaller,
	type SqlOutcome,
} from "../services/analysis/sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "../services/analysis/sql-results.js";
import { buildRunIndex } from "../services/l1-edges/run-index.service.js";
import {
	buildTranscriptRecordRow,
	buildTranscriptRecordsReceiptRow,
	hashTranscriptContent,
} from "../services/transcript-records-ingest.service.js";

/**
 * The session_links view against real ClickHouse: Codex subagent threads and
 * forks from their own transcripts, the lineage worker's native parents and
 * delegations, one row per link, both ends readable by the caller.
 */

setDefaultTimeout(120_000);

const RUN = `session_links_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const alice = `${RUN}_alice`;
const bob = `${RUN}_bob`;
const clickhouse = getClickhouse();
const baseMs = Date.now() - 3_600_000;

const unlimited: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};
const reader = (userId: string, ownSessionsOnly: boolean): SqlCaller => ({
	workspaceId: workspace,
	reader: { userId, role: "member", ownSessionsOnly },
});

const at = (seconds: number) =>
	new Date(baseMs + seconds * 1_000).toISOString();
const chTime = (seconds: number) =>
	at(seconds).replace("T", " ").replace("Z", "");

const codexLine = (
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
	codexLine(
		second,
		"response_item",
		{ type: "message", role: "user", content: [{ type: "input_text", text }] },
		ordinal,
	);
const codexSession = (
	id: string,
	second: number,
	meta: Record<string, unknown> = {},
	history: readonly string[] = [],
) =>
	[
		codexLine(second, "session_meta", { id, cli_version: "0.162.0", ...meta }),
		...history,
		typed(second + 1, `work in ${id}`),
	].join("\n");

const session = (name: string) => `${RUN}_${name}`;
const parent = session("parent");
const subagent = session("subagent");
const fork = session("fork");
const orphan = session("orphan");
const claude = session("claude");
const delegated = session("delegated");
const bobParent = session("bob_parent");
const bobChild = session("bob_child");

async function ingest(
	user: string,
	sessionId: string,
	content: string,
	source: "claude_code" | "codex" = "codex",
) {
	const identity = {
		organizationId: workspace,
		userId: user,
		sessionId,
		source,
		revision: "1",
		sessionDate: at(0),
	};
	const stats = createSplitStats();
	const rows = [
		...splitSessionTranscript({ content, sessionDate: at(0), source }, stats),
	].map((draft) => buildTranscriptRecordRow(identity, draft));
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
				session_date: chTime(0),
				last_interaction_date: chTime(60),
				project_path: "/test/session-links",
				git_remote: "github.com/opalinehq/athena",
				model_used: source === "codex" ? "gpt-5.4" : "claude-opus-5-5",
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

/** A session_lineage row as the lineage worker writes it. */
const lineage = (row: {
	user: string;
	child: string;
	childSource: "claude_code" | "codex";
	parent: string;
	parentSource: "claude_code" | "codex" | "";
	carrier: string;
	confidence: string;
	outcome: string;
	countable: number;
	toolUseId?: string;
	version?: number;
}) => ({
	organization_id: workspace,
	user_id: row.user,
	child_source: row.childSource,
	child_session_id: row.child,
	child_session_date: chTime(0),
	child_first_ingested_at: chTime(0),
	child_start_ts: chTime(20),
	child_model: "gpt-5.4",
	parent_source: row.parentSource,
	parent_session_id: row.parent,
	parent_session_date: chTime(0),
	anchor_ts: chTime(19),
	anchor_tool_use_id: row.toolUseId ?? "",
	anchor_operation_ordinal: 0,
	carrier: row.carrier,
	outcome: row.outcome,
	confidence: row.confidence,
	countable: row.countable,
	reason: "test",
	prompt_fingerprint: "0".repeat(64),
	derivation_version: SESSION_LINEAGE_DERIVATION_VERSION,
	input_sequence: "1",
	replacement_version: String(row.version ?? 1),
	derived_at: chTime(30),
});

async function sql(caller: SqlCaller, query: string): Promise<string[]> {
	const outcome: SqlOutcome = await runSql(
		caller,
		{ query, title: "test" },
		{
			executor: clickhouse,
			results: createMemorySqlResultStore(),
			quota: createMemorySqlQuota({ queries: 1_000, windowMs: 3_600_000 }),
			limiter: unlimited,
			githubRepositories: async () => [],
		},
	);
	if (!outcome.ok)
		throw new Error(`Expected a result: ${outcome.error.message}`);
	return outcome.result.table.split("\n");
}

const consumers = process.env.SESSION_LINEAGE_CONSUMERS_ENABLED;
afterEach(() => {
	if (consumers === undefined)
		delete process.env.SESSION_LINEAGE_CONSUMERS_ENABLED;
	else process.env.SESSION_LINEAGE_CONSUMERS_ENABLED = consumers;
});

afterAll(async () => {
	for (const table of [
		"rudel.transcript_records",
		"rudel.run_index",
		"rudel.session_analytics",
		"rudel.session_lineage",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {workspace:String} SETTINGS lightweight_deletes_sync = 2`,
			query_params: { workspace },
		});
});

const LINKS = `SELECT replaceAll(from_session_id, '${RUN}_', '') AS from_id, from_source,
		replaceAll(to_session_id, '${RUN}_', '') AS to_id, to_source, kind, copies_history,
		ifNull(toString(fork_ordinal), '-') AS ordinal, arrayStringConcat(basis, ',') AS bases,
		carrier, outcome, from_call_id, at = toDateTime64('${chTime(20)}', 3, 'UTC') AS at_child_start
	FROM session_links ORDER BY to_id`;

describe("the session_links view", () => {
	test("one row per link from what each store recorded, both ends readable, scoped to the caller", async () => {
		// Alice: a parent thread, a subagent thread forked from it, a user
		// fork, a thread whose parent was never uploaded, and a Claude Code
		// session that ran codex exec. Bob: a parent and its subagent.
		const replayed = [
			codexLine(0, "session_meta", { id: parent, cli_version: "0.162.0" }, 0),
			typed(1, `work in ${parent}`, 1),
		];
		await ingest(alice, parent, codexSession(parent, 0));
		await ingest(
			alice,
			subagent,
			codexSession(
				subagent,
				20,
				{
					parent_thread_id: parent,
					forked_from_id: parent,
					subagent_history_start_ordinal: 2,
					source: {
						subagent: { thread_spawn: { parent_thread_id: parent, depth: 1 } },
					},
				},
				replayed,
			),
		);
		await ingest(
			alice,
			fork,
			codexSession(fork, 20, { forked_from_id: parent }),
		);
		await ingest(
			alice,
			orphan,
			codexSession(orphan, 20, { parent_thread_id: session("never_uploaded") }),
		);
		await ingest(
			alice,
			claude,
			[
				{
					type: "user",
					timestamp: at(0),
					message: { role: "user", content: "ask codex" },
				},
				{
					type: "assistant",
					timestamp: at(19),
					message: {
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_delegate",
								name: "Bash",
								input: { command: "codex exec 'review the diff'" },
							},
						],
					},
				},
			]
				.map((record) => JSON.stringify(record))
				.join("\n"),
			"claude_code",
		);
		await ingest(alice, delegated, codexSession(delegated, 20));
		await ingest(bob, bobParent, codexSession(bobParent, 0));
		await ingest(
			bob,
			bobChild,
			codexSession(bobChild, 20, { parent_thread_id: bobParent }),
		);
		await clickhouse.insert({
			table: "rudel.session_lineage",
			asyncInsert: false,
			values: [
				// The worker read the subagent's native parent too: one link, two bases.
				lineage({
					user: alice,
					child: subagent,
					childSource: "codex",
					parent,
					parentSource: "codex",
					carrier: "codex_native_subagent",
					confidence: "native_parent_id",
					outcome: "unknown",
					countable: 1,
				}),
				// An older derivation of the delegation named another parent.
				lineage({
					user: alice,
					child: delegated,
					childSource: "codex",
					parent: fork,
					parentSource: "codex",
					carrier: "claude_bash",
					confidence: "prompt_echo",
					outcome: "successful",
					countable: 1,
					version: 1,
				}),
				lineage({
					user: alice,
					child: delegated,
					childSource: "codex",
					parent: claude,
					parentSource: "claude_code",
					carrier: "claude_bash",
					confidence: "prompt_echo",
					outcome: "successful",
					countable: 1,
					toolUseId: "toolu_delegate",
					version: 2,
				}),
				// No parent matched: no link.
				lineage({
					user: alice,
					child: fork,
					childSource: "codex",
					parent: "",
					parentSource: "",
					carrier: "unmatched",
					confidence: "ambiguous",
					outcome: "successful",
					countable: 0,
				}),
			],
		});

		const header =
			"from_id | from_source | to_id | to_source | kind | copies_history | ordinal | bases | carrier | outcome | from_call_id | at_child_start";
		const native: readonly string[] = [
			"bob_parent | codex | bob_child | codex | parent_thread | 0 | - | session_meta.parent_thread_id |  |  |  | 1",
			"parent | codex | fork | codex | fork | 1 | - | session_meta.forked_from_id |  |  |  | 1",
			"parent | codex | subagent | codex | parent_thread | 1 | 2 | session_lineage.native_parent_id,session_meta.forked_from_id,session_meta.parent_thread_id | codex_native_subagent |  |  | 1",
		];
		const delegation =
			"claude | claude_code | delegated | codex | delegation | 0 | - | session_lineage.prompt_echo | claude_bash | successful | toolu_delegate | 1";

		process.env.SESSION_LINEAGE_CONSUMERS_ENABLED = "false";
		expect(await sql(reader(alice, false), LINKS)).toEqual([header, ...native]);

		process.env.SESSION_LINEAGE_CONSUMERS_ENABLED = "true";
		expect(await sql(reader(alice, false), LINKS)).toEqual([
			header,
			...native.slice(0, 1),
			delegation,
			...native.slice(1),
		]);
		// A workspace that keeps members to their own sessions: each sees only theirs.
		expect(await sql(reader(bob, true), LINKS)).toEqual([
			header,
			...native.slice(0, 1),
		]);
		expect(
			await sql(
				reader(alice, true),
				"SELECT count() AS links, countIf(user_id != '') AS owned FROM session_links",
			),
		).toEqual(["links | owned", "3 | 3"]);

		// A link joins runs at both ends: from the parent's runs to the subagent's.
		expect(
			await sql(
				reader(alice, false),
				`SELECT replaceAll(l.to_session_id, '${RUN}_', '') AS child, count() > 0 AS has_runs
				FROM session_links AS l INNER JOIN runs AS r ON r.session_id = l.to_session_id
				WHERE l.from_session_id = '${parent}' AND l.kind = 'parent_thread'
				GROUP BY child`,
			),
		).toEqual(["child | has_runs", "subagent | 1"]);
	});
});
