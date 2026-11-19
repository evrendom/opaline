import { describe, expect, test } from "bun:test";
import { splitSessionTranscript } from "@rudel/api-routes/transcript-records";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import type { AgentQueryLimiter } from "./agent-query-slots.js";
import {
	CODEX_PROVIDER_ERROR_KIND_SQL,
	RUN_EVENT_RECORDS,
	runFactsCtes,
} from "./run-index-sql.js";
import { EVENT_RECORD_KINDS } from "./sql-event-views.js";
import { runSql } from "./sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "./sql-results.js";
import { findSqlView } from "./sql-views.js";

/** Every query gets a slot at once. */
const unlimited: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};

/** The statement the agent's query runs as, with ClickHouse answering nothing. */
async function sent(query: string): Promise<string> {
	const statements: ClickHouseStatement[] = [];
	const executor: ClickHouseExecutor = {
		close: async () => {},
		execute: async () => {},
		insert: async () => {},
		query: async <T>(statement: ClickHouseStatement) => {
			statements.push(statement);
			return [] as T[];
		},
	};
	const outcome = await runSql(
		{
			workspaceId: "ws-1",
			reader: { userId: "member-1", role: "member", ownSessionsOnly: false },
		},
		{ query, title: "Events" },
		{
			executor,
			results: createMemorySqlResultStore(),
			quota: createMemorySqlQuota({ queries: 10, windowMs: 3_600_000 }),
			limiter: unlimited,
			githubRepositories: async () => [],
		},
	);
	if (!outcome.ok)
		throw new Error(`Expected a result: ${outcome.error.message}`);
	const statement = statements.find(
		(item) =>
			item.clickhouse_settings?.readonly === "1" &&
			!item.query.startsWith("EXPLAIN AST "),
	);
	return statement?.query ?? "";
}

const events = () => {
	const view = findSqlView("events");
	if (!view) throw new Error("Expected the events view");
	return view;
};

describe("the events view adds up to the runs columns", () => {
	test("it counts with the run index's own record predicates, over the same fact columns", () => {
		const fact = (key: string) => `f_${key}`;
		const view = events().sql(false);
		const runIndex = runFactsCtes({ literal: true });
		for (const predicate of [
			CODEX_PROVIDER_ERROR_KIND_SQL,
			RUN_EVENT_RECORDS.isApiError(fact, "provider_error_kind"),
			RUN_EVENT_RECORDS.isRetry(fact),
			RUN_EVENT_RECORDS.hooks(fact),
			RUN_EVENT_RECORDS.isCompaction(fact),
		]) {
			expect(view).toContain(predicate);
			expect(runIndex).toContain(predicate);
		}
		// The run index joins its records to their calls, so it names the
		// stream column by its table; the predicate is otherwise the same.
		expect(view).toContain(RUN_EVENT_RECORDS.isRefusal(fact));
		expect(runIndex).toContain(RUN_EVENT_RECORDS.isRefusal(fact, "w.agent_id"));
	});

	test("every record the parser stores an event fact on is one the view reads", async () => {
		const eventFacts = [
			"api_error",
			"api_error_status",
			"api_errors_components",
			"retry_attempt",
			"refusal_category",
			"hook_count",
			"hook_runs",
			"hook_errors",
		] as const;
		const read = (kind: string, subtype: string, isError: boolean) =>
			kind === "compaction" ||
			(kind === "meta" &&
				(subtype.startsWith(EVENT_RECORD_KINDS.subtypePrefix) ||
					(EVENT_RECORD_KINDS.subtypes as readonly string[]).includes(
						subtype,
					) ||
					((EVENT_RECORD_KINDS.errorSubtypes as readonly string[]).includes(
						subtype,
					) &&
						isError)));
		const carrying = new Set<string>();
		for (const [name, source] of [
			["claude-2.1.jsonl", "claude_code"],
			["claude-v9.jsonl", "claude_code"],
			["codex-0.156.jsonl", "codex"],
			["codex-v9.jsonl", "codex"],
		] as const) {
			const content = await Bun.file(
				new URL(
					`../../../../../../packages/api-routes/src/session-transcript/__fixtures__/l1-facts/${name}`,
					import.meta.url,
				),
			).text();
			for (const row of splitSessionTranscript({
				content,
				sessionDate: "2026-10-01T09:00:00.000Z",
				source,
			})) {
				if (
					row.kind !== "compaction" &&
					!eventFacts.some((key) => row.facts.extra[key] !== undefined)
				)
					continue;
				carrying.add(`${row.kind}:${row.subtype}`);
				expect(
					`${row.kind}:${row.subtype}:${read(row.kind, row.subtype, row.isError)}`,
				).toBe(`${row.kind}:${row.subtype}:true`);
			}
		}
		// The fixtures hold every kind of event record, so the check covers them.
		for (const record of [
			"meta:api_error_message",
			"meta:system:api_error",
			"meta:system:model_refusal_fallback",
			"meta:task_complete",
		])
			expect(carrying).toContain(record);
		expect(
			[...carrying].some((record) =>
				record.startsWith("meta:system:stop_hook_summary"),
			),
		).toBe(true);
	});

	test("the scan picks its records by kind and subtype before it reads any fact or text", () => {
		const view = events().sql(false);
		const prewhere = view.match(/PREWHERE ([\s\S]*?)\n\s*WHERE /u)?.[1] ?? "";
		expect(prewhere).toContain("kind = 'compaction'");
		expect(prewhere).toContain("startsWith(subtype, 'system:')");
		expect(prewhere).not.toContain("facts");
		expect(prewhere).not.toContain("head");
		// Never the whole stored text: only its first excerpt (head).
		const scan = view.match(
			/SELECT user_id, session_id, revision[\s\S]*?\n\s*FROM /u,
		)?.[0];
		expect(scan).toContain("head, text_chars");
		expect(scan).not.toMatch(/\btext\b/u);
	});

	test("its traps say which agents and parser versions record each event", () => {
		const traps = events().traps.join("\n");
		expect(traps).toContain(
			"api_error by Claude Code from parser 7 and Codex from parser 9",
		);
		expect(traps).toContain("retry by Claude Code from parser 7");
		expect(traps).toContain("countIf(event = 'hook_run') = hook_count");
	});
});

describe("the events view reads only the time range a query keeps", () => {
	const window =
		/AND \(kind = 'compaction' OR [\s\S]*?\) AND (ts [^\n]*?)\) AS opaline_window_sessions/u;

	test("a range ANDed into the WHERE that reads events bounds the sessions read, records and runs alike", async () => {
		const statement = await sent(
			`SELECT event, count() FROM events
			WHERE at >= '2026-10-09 00:00:00' AND at < '2026-10-16 00:00:00' AND agent_id = ''
			GROUP BY event`,
		);
		expect(statement).not.toMatch(/FROM events\b/u);
		expect(statement.match(window)?.[1]).toBe(
			"ts >= ('2026-10-09 00:00:00') AND ts <= ('2026-10-16 00:00:00')",
		);
		expect(
			statement.match(/IN \(SELECT arrayJoin\(opaline_window_sessions\)\)/gu),
		).toHaveLength(2);
	});

	test("a range behind OR reads every session", async () => {
		const statement = await sent(
			"SELECT count() FROM events WHERE at >= '2026-10-09 00:00:00' OR event = 'retry'",
		);
		expect(statement).not.toContain("opaline_window_sessions");
	});
});
