import { expect, test } from "bun:test";
import { traceLine } from "../../services/analysis/find-text.js";
import {
	getAnalysisTree,
	type RecordedCall,
	recordQuery,
	saveAnalysis,
} from "../../services/analysis-log/analysis-log.service.js";
import { createLocalEmbedder } from "../../services/analysis-log/embedder.js";
import { MAX_QUERY_ARGS_BYTES } from "../../services/analysis-log/limits.js";
import { createMemoryAnalysisStore } from "../../services/analysis-log/memory-store.js";
import type {
	AnalysisLog,
	AnalysisViewer,
} from "../../services/analysis-log/types.js";
import { measureStatement } from "./measure-statement.js";
import { patternStatement } from "./pattern-statement.js";
import { recordedSqlArgs } from "./recorded-args.js";

const today = new Date("2026-11-07T10:00:00Z");
const author = { workspaceId: "w", userId: "u", host: "plugin" as const };
const viewer: AnalysisViewer = {
	workspaceId: "w",
	userId: "u",
	isAdmin: true,
	restrictResults: false,
	onlyMember: null,
};
const window = { from: "2026-10-06", to: "2026-11-03", repository: "athena" };

function createLog(): AnalysisLog {
	return {
		store: createMemoryAnalysisStore(),
		embedder: createLocalEmbedder(),
		now: () => today,
	};
}

function sqlCall(args: Record<string, unknown>): RecordedCall {
	const { analysis, ...rest } = args;
	return {
		tool: "sql",
		args: rest,
		trace: typeof analysis === "string" ? { analysis } : {},
		output: { table: "(no rows)" },
		outputChars: 20,
		sessions: [],
		owners: [],
		quotes: false,
	};
}

test("a patterns call is logged by its own arguments and window, not by the statement it generates", async () => {
	const input = {
		kind: "retry_loop" as const,
		limit: 8,
		minCount: 2,
		...window,
	};
	const statement = patternStatement({ action: "list", ...input }, today);
	const generated = { query: statement.query, title: statement.title };
	expect(Buffer.byteLength(JSON.stringify(generated))).toBeGreaterThan(
		MAX_QUERY_ARGS_BYTES,
	);
	const log = createLog();
	await expect(recordQuery(log, author, sqlCall(generated))).rejects.toThrow(
		"The call's arguments are",
	);

	const args = recordedSqlArgs(statement, {
		tool: "patterns",
		action: "list",
		input,
	});
	expect(args).toEqual({
		title: statement.title,
		call: { tool: "patterns", action: "list", ...input },
	});
	const trace = await recordQuery(log, author, sqlCall(args));
	expect((await log.store.getQueries(trace.analysis))[0]?.args).toEqual(args);
});

test("only a call that names no analysis starts a draft, and its trace says so with the id to pass", async () => {
	const log = createLog();
	const statement = patternStatement(
		{ action: "drill", id: "fc_3703777cb6", limit: 50, ...window },
		today,
	);
	const call = { tool: "patterns" as const, action: "drill" };
	const first = await recordQuery(
		log,
		author,
		sqlCall(recordedSqlArgs(statement, { ...call, input: window })),
	);
	const second = await recordQuery(
		log,
		author,
		sqlCall(
			recordedSqlArgs(
				{ ...statement, analysis: first.analysis },
				{ ...call, input: { ...window, analysis: first.analysis } },
			),
		),
	);
	expect(first.started).toBe(true);
	expect(second).toEqual({
		analysis: first.analysis,
		step: second.step,
		query: second.query,
	});
	expect(traceLine(first).split("\n")).toEqual([
		`trace analysis=${first.analysis} step=${first.step} query=${first.query}`,
		`new draft ${first.analysis}: this call named no analysis. Pass analysis=${first.analysis} to later calls to add to it; leaving it out starts another draft.`,
	]);
	expect(traceLine(second)).toBe(
		`trace analysis=${first.analysis} step=${second.step} query=${second.query}`,
	);
});

test("a draft built from patterns and measures calls is saved with the union of their windows", async () => {
	const log = createLog();
	const list = patternStatement(
		{ action: "list", minCount: 2, limit: 20, ...window },
		today,
	);
	const first = await recordQuery(
		log,
		author,
		sqlCall(
			recordedSqlArgs(list, {
				tool: "patterns",
				action: "list",
				input: window,
			}),
		),
	);
	const unbounded = { repository: "athena" };
	const measure = measureStatement(
		{ name: "time_lost_by_cause", limit: 50, ...unbounded },
		today,
	);
	await recordQuery(
		log,
		author,
		sqlCall({
			...recordedSqlArgs(measure, {
				tool: "measures",
				action: "run",
				input: { name: "time_lost_by_cause", ...unbounded },
			}),
			analysis: first.analysis,
		}),
	);
	await saveAnalysis(log, viewer, {
		analysis: first.analysis,
		question: "Where our agents lost time",
		finalAnswer: "Waiting on CI.",
		findings: [],
		topics: [],
		changes: [],
	});
	expect((await getAnalysisTree(log, viewer, first.analysis)).scope).toEqual({
		from: "2026-10-06",
		to: "2026-11-07",
		filters: { repository: "athena" },
	});
});
