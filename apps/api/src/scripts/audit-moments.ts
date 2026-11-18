import { z } from "zod";
import { getClickhouse } from "../clickhouse.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "../services/analysis/sql.js";
import { readOnlyClickHouse } from "../services/l1-audit.service.js";
import {
	MOMENT_RUNS_MAX,
	type RunEvidence,
	RunEvidenceSchema,
	runEvidenceStatement,
} from "../services/moments/moment-rules.js";

// Read-only moment census for one workspace (Compass, ADR 0006): how often
// each rule fires at today's thresholds and at looser ones, the
// distributions behind them, run text sizes (for model cost), the model mix
// and runs without tool activity. Prints aggregates only, never prompts or
// transcript text, and writes nothing.
//   bun run audit:moments <workspaceId> [days=28]
const workspaceId = Bun.argv[2];
const days = Number(Bun.argv[3] ?? 28);
if (!workspaceId || !Number.isInteger(days) || days < 1 || days > 366)
	throw new Error("usage: bun run audit:moments <workspaceId> [days=28]");
const executor = readOnlyClickHouse(getClickhouse());
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// One week per query, so the 5,000-run cap is visible instead of silent.
const runs: RunEvidence[] = [];
const capped: string[] = [];
const end = Date.now();
for (let from = end - days * DAY; from < end; from += 7 * DAY) {
	const range = {
		startDate: iso(from),
		endDate: iso(Math.min(end, from + 6 * DAY)),
	};
	const rows = await query(executor, RunEvidenceSchema, {
		...runEvidenceStatement({ workspaceId, member: null }, range),
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
	});
	if (rows.length >= MOMENT_RUNS_MAX) capped.push(range.startDate);
	runs.push(...rows);
}

function longestStreak(results: number[], failed: number[]) {
	const failing = new Set(failed);
	let best = 0;
	let length = 0;
	for (const record of results) {
		length = failing.has(record) ? length + 1 : 0;
		best = Math.max(best, length);
	}
	return best;
}
function repeats(run: RunEvidence) {
	const failed = new Set(run.failed_call_ids);
	const byCommand = new Map<string, { runs: number; failures: number }>();
	for (const [, callId, command] of run.shell_calls) {
		if (!command) continue;
		const entry = byCommand.get(command) ?? { runs: 0, failures: 0 };
		entry.runs++;
		if (callId && failed.has(callId)) entry.failures++;
		byCommand.set(command, entry);
	}
	return [...byCommand.values()];
}

const metrics = runs.map((run) => {
	const explore =
		run.first_edit === null
			? null
			: run.explore_records.filter((record) => record < (run.first_edit ?? 0))
					.length;
	const reps = repeats(run);
	return {
		model: run.model ?? "unknown",
		records: run.end_record - run.start_record,
		minutes: run.minutes,
		cost: run.cost_usd ?? 0,
		explore,
		exploreNoEdit: run.first_edit === null ? run.explore_records.length : null,
		streak: longestStreak(run.result_records, run.failed_records),
		repeat3fail2: reps.some((r) => r.runs >= 3 && r.failures >= 2),
		repeat2fail2: reps.some((r) => r.runs >= 2 && r.failures >= 2),
		maxRepeat: Math.max(0, ...reps.map((r) => r.runs)),
		queued: run.first_queued !== null,
		interrupted: run.aborted === "true" || run.interrupted_calls > 0,
		compacted: run.compactions > 0,
		unhappy:
			run.has_final_message > 0 &&
			run.next_reactions.some((r) => r === "negative" || r === "swear"),
		denied: run.denied_calls,
		results: run.result_records.length,
		// No tool activity at all: a chat-only run, or a run whose transcript records are missing.
		noActivity:
			run.result_records.length === 0 &&
			run.explore_records.length === 0 &&
			run.shell_calls.length === 0 &&
			run.first_edit === null,
	};
});

const n = metrics.length;
const share = (count: number) =>
	`${count} (${n ? ((100 * count) / n).toFixed(1) : 0}%)`;
const quantiles = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	const at = (q: number) =>
		sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
	return {
		n: sorted.length,
		p50: at(0.5),
		p75: at(0.75),
		p90: at(0.9),
		p99: at(0.99),
		max: sorted.at(-1) ?? 0,
	};
};
const count = (predicate: (m: (typeof metrics)[number]) => boolean) =>
	metrics.filter(predicate).length;

const current = {
	search_before_edit: count((m) => (m.explore ?? 0) >= 15),
	failing_streak: count((m) => m.streak >= 4),
	repeated_command: count((m) => m.repeat3fail2),
	mid_run_redirect: count((m) => m.queued),
	interrupted: count((m) => m.interrupted),
	compaction: count((m) => m.compacted),
	unhappy_reply: count((m) => m.unhappy),
	denied_calls: count((m) => m.denied >= 2),
};
const looser = {
	"search_before_edit (>=8)": count((m) => (m.explore ?? 0) >= 8),
	"search, never edited (>=15)": count((m) => (m.exploreNoEdit ?? 0) >= 15),
	"failing_streak (>=3)": count((m) => m.streak >= 3),
	"repeated_command (>=2, 2 failed)": count((m) => m.repeat2fail2),
	"denied_calls (>=1)": count((m) => m.denied >= 1),
};
const anyCurrent = count(
	(m) =>
		(m.explore ?? 0) >= 15 ||
		m.streak >= 4 ||
		m.repeat3fail2 ||
		m.queued ||
		m.interrupted ||
		m.compacted ||
		m.unhappy ||
		m.denied >= 2,
);
const anyLooser = count(
	(m) =>
		(m.explore ?? 0) >= 8 ||
		(m.exploreNoEdit ?? 0) >= 15 ||
		m.streak >= 3 ||
		m.repeat2fail2 ||
		m.queued ||
		m.interrupted ||
		m.compacted ||
		m.unhappy ||
		m.denied >= 1,
);

// Run text size: characters stored per run in the committed generation (SubQ reads ~4 chars per token).
const SizeSchema = z.object({
	q: z.array(z.coerce.number()),
	runs: z.coerce.number(),
});
const [size] = await query(executor, SizeSchema, {
	clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
	query: `SELECT quantiles(0.5, 0.75, 0.9, 0.99)(chars) AS q, count() AS runs FROM (
		SELECT sum(text_chars) AS chars FROM rudel.transcript_records FINAL
		WHERE organization_id = {workspaceId:String} AND turn_idx >= 1
			AND kind NOT IN ('receipt', 'meta', 'oversized')
			AND (user_id, session_id, revision, parser_version) IN (
				SELECT user_id, session_id, revision, parser_version FROM rudel.run_index
				WHERE organization_id = {workspaceId:String} AND row_kind = 'run'
					AND started_at >= now() - INTERVAL {days:UInt32} DAY
			)
		GROUP BY user_id, session_id, agent_id, turn_idx
	)`,
	query_params: { workspaceId, days },
});

const models = new Map<string, number>();
for (const m of metrics) models.set(m.model, (models.get(m.model) ?? 0) + 1);

console.log(
	JSON.stringify(
		{
			workspace: workspaceId,
			days,
			runs: n,
			weeksAtRunCap: capped,
			models: Object.fromEntries(
				[...models].sort((a, b) => b[1] - a[1]).slice(0, 8),
			),
			runsWithNoToolActivity: share(count((m) => m.noActivity)),
			runsWithAMoment: { current: share(anyCurrent), looser: share(anyLooser) },
			byKindCurrent: Object.fromEntries(
				Object.entries(current).map(([k, v]) => [k, share(v)]),
			),
			byKindLooser: Object.fromEntries(
				Object.entries(looser).map(([k, v]) => [k, share(v)]),
			),
			distributions: {
				readsAndSearchesBeforeFirstEdit: quantiles(
					metrics.flatMap((m) => (m.explore === null ? [] : [m.explore])),
				),
				runsWithoutAnEdit: metrics.filter((m) => m.explore === null).length,
				longestFailingStreak: quantiles(metrics.map((m) => m.streak)),
				mostRepeatedShellCommand: quantiles(metrics.map((m) => m.maxRepeat)),
				toolResultsPerRun: quantiles(metrics.map((m) => m.results)),
				recordsPerRun: quantiles(metrics.map((m) => m.records)),
				minutesPerRun: quantiles(metrics.map((m) => Math.round(m.minutes))),
			},
			runTextChars: size
				? {
						runs: size.runs,
						p50: size.q[0],
						p75: size.q[1],
						p90: size.q[2],
						p99: size.q[3],
					}
				: null,
		},
		null,
		2,
	),
);
await executor.close();
process.exit(0);
