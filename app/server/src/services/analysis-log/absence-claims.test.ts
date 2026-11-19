import { describe, expect, test } from "bun:test";
import {
	type RecordedCall,
	recordQuery,
	saveAnalysis,
} from "./analysis-log.service.js";
import { createLocalEmbedder } from "./embedder.js";
import { createMemoryAnalysisStore } from "./memory-store.js";
import type { AnalysisLog, AnalysisViewer } from "./types.js";

const author = { workspaceId: "ws", userId: "lead", host: "plugin" as const };
const viewer: AnalysisViewer = {
	workspaceId: "ws",
	userId: "lead",
	isAdmin: false,
	restrictResults: false,
	onlyMember: null,
};
const MAIN_ONLY =
	"SELECT uniqExactIf(session_id, match(file_path, '(athena[^/]*)/AGENTS\\\\.md$')) AS read_n FROM calls WHERE started_at >= '2026-10-08' AND agent_id = ''";
const EVERY_STREAM =
	"SELECT uniqExactIf(session_id, match(file_path, '(^|/)AGENTS\\\\.md$')) AS read_n FROM calls WHERE started_at >= '2026-10-08'";
const EXACT =
	"SELECT count() AS hits FROM search('AGENTS.md', 'exact', 30) JOIN runs USING (run_id)";
const CLAIM = "0 of 86 sessions read the repository's AGENTS.md.";

function createLog(): AnalysisLog {
	return {
		store: createMemoryAnalysisStore(),
		embedder: createLocalEmbedder(),
		now: () => new Date("2026-11-07T17:00:00Z"),
	};
}

function sql(query: string, analysis?: string): RecordedCall {
	return {
		tool: "sql",
		args: { query, title: "t" },
		trace: analysis ? { analysis } : {},
		output: { ok: true },
		outputChars: 11,
		sessions: [],
		owners: [],
	};
}

async function save(
	log: AnalysisLog,
	analysis: string,
	step: string,
	finalAnswer: string,
	runOpened?: (since: string) => Promise<boolean>,
) {
	return saveAnalysis(
		log,
		viewer,
		{
			analysis,
			question: "Do sessions read the repository instructions",
			finalAnswer,
			findings: [{ step, finding: finalAnswer }],
			topics: [],
			changes: [],
		},
		undefined,
		runOpened,
	);
}

describe("absence claims at save", () => {
	test("a '0 of N' claim resting on a main-stream count, with no run read, is saved with a warning naming it and both checks", async () => {
		const log = createLog();
		const trace = await recordQuery(log, author, sql(MAIN_ONLY));
		const saved = await save(
			log,
			trace.analysis,
			trace.step,
			CLAIM,
			async () => false,
		);
		expect(saved.status).toBe("finished");
		expect((await log.store.getAnalysis(trace.analysis))?.status).toBe(
			"finished",
		);
		expect(saved.warnings).toEqual([
			`warning: "${CLAIM}" says something never or rarely happened, but this answer has no step that counted every stream (sql over calls, prompts, events or setup_files without agent_id = '', or search('…', 'exact')) and no run that was read (run or read). It is saved; confirm the claim that way and save an update if it changes.`,
		]);
	});

	test("the same claim confirmed on every stream, with a run opened since the draft began, saves without a warning", async () => {
		const log = createLog();
		const trace = await recordQuery(log, author, sql(MAIN_ONLY));
		await recordQuery(log, author, sql(EVERY_STREAM, trace.analysis));
		const asked: string[] = [];
		const saved = await save(
			log,
			trace.analysis,
			trace.step,
			CLAIM,
			async (since) => {
				asked.push(since);
				return true;
			},
		);
		expect(saved.warnings).toBeUndefined();
		expect(asked).toEqual([
			(await log.store.getAnalysis(trace.analysis))?.createdAt ?? "",
		]);
	});

	test("an exact search and a read step confirm a 'never'; only the missing check is named; no claim asks nothing", async () => {
		const log = createLog();
		const exact = await recordQuery(log, author, sql(EXACT));
		await recordQuery(log, author, {
			...sql("", exact.analysis),
			tool: "read",
			args: { refs: [] },
		});
		expect(
			(await save(log, exact.analysis, exact.step, "The agents never read it."))
				.warnings,
		).toBeUndefined();
		const counted = await recordQuery(log, author, sql(EVERY_STREAM));
		const unread = await save(
			log,
			counted.analysis,
			counted.step,
			"No sessions read it.",
		);
		expect(unread.warnings).toEqual([
			expect.stringContaining("this answer has no run that was read"),
		]);
		const plain = await recordQuery(log, author, sql(MAIN_ONLY));
		let looked = false;
		const quiet = await save(
			log,
			plain.analysis,
			plain.step,
			"Most sessions read it.",
			async () => {
				looked = true;
				return false;
			},
		);
		expect(quiet.warnings).toBeUndefined();
		expect(looked).toBe(false);
	});
});
