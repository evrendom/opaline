import { expect, test } from "bun:test";
import {
	type RecordedCall,
	recordQuery,
	saveAnalysis,
	shareAnalysis,
} from "./analysis-log.service.js";
import { createLocalEmbedder } from "./embedder.js";
import {
	createMemoryFindingImpact,
	type FindingImpact,
	type FindingMirror,
} from "./finding-impact.js";
import {
	createMemoryVisibilitySyncs,
	runVisibilitySyncPass,
} from "./finding-visibility.js";
import { createMemoryAnalysisStore } from "./memory-store.js";
import type { AnalysisViewer } from "./types.js";

/**
 * Finding impact as saving and sharing an analysis hand it over: each
 * finding with the runs its step's call cites, and the members whose runs the
 * analysis quoted. The ClickHouse side (measures, SQL, purge) is covered by
 * analysis-sql.integration.ts.
 */

const NOW = new Date("2026-10-12T09:00:00.000Z");
const workspaceId = "w";
const authorId = "author";
const viewer: AnalysisViewer = {
	workspaceId,
	userId: authorId,
	isAdmin: false,
	restrictResults: false,
	onlyMember: null,
};
const author = { workspaceId, userId: authorId, host: "plugin" as const };
const ref = (sessionId: string, turn: number, agentId = "") => ({
	sessionId,
	agentId,
	turn,
});
const session = (sessionId: string, ownerId: string) => ({
	sessionId,
	ownerId,
	revision: "1",
	parserVersion: 9,
});

function setup() {
	return {
		log: {
			store: createMemoryAnalysisStore(),
			embedder: createLocalEmbedder(),
			now: () => NOW,
		},
	};
}

function call(
	tool: RecordedCall["tool"],
	output: unknown,
	owners: string[],
	analysis?: string,
): RecordedCall {
	return {
		tool,
		args: {},
		trace: analysis ? { analysis } : {},
		output,
		outputChars: 10,
		sessions: owners.map((owner) => session(`session_${owner}`, owner)),
		owners,
	};
}

const save = (
	log: ReturnType<typeof setup>["log"],
	analysis: string,
	findings: { step: string; finding: string }[],
	impact: FindingImpact | FindingMirror,
) =>
	saveAnalysis(
		log,
		viewer,
		{
			analysis,
			question: "Where did time go?",
			finalAnswer: "Into tests.",
			findings,
			topics: [],
			changes: [],
		},
		"syncs" in impact
			? impact
			: { impact, syncs: createMemoryVisibilitySyncs() },
	);

test("saving hands over each finding with the runs its step's call cites, once each, and the members whose deletion deletes the analysis", async () => {
	const { log } = setup();
	const impact = createMemoryFindingImpact();
	// sql rows name runs; find rows and events carry them; read opens them.
	// Numbers and ids only: its members count, unless a finding names them.
	const sql = await recordQuery(log, author, {
		...call(
			"sql",
			{ runs: [ref("s1", 1), ref("s1", 2, "sub"), ref("s1", 1)] },
			["counted", "quoted"],
		),
		quotes: false,
	});
	const find = await recordQuery(
		log,
		author,
		call(
			"find",
			{
				rows: [{ ref: ref("s2", 4), minutes: 3 }],
				events: [{ eventRef: { ...ref("s2", 5), record: 12 } }],
				// A session's totals name no single run.
				sessions: [{ sessionId: "s9", agentId: "", runs: 4 }],
			},
			["counted"],
			sql.analysis,
		),
	);
	const read = await recordQuery(
		log,
		author,
		call(
			"read",
			{ reads: [{ ref: ref("s3", 7), header: "the prompt" }] },
			["quoted"],
			sql.analysis,
		),
	);
	// A step without a finding cites nothing.
	await recordQuery(
		log,
		author,
		call("read", { reads: [{ ref: ref("s4", 1) }] }, ["other"], sql.analysis),
	);

	await save(
		log,
		sql.analysis,
		[
			{ step: sql.query, finding: "The longest runs." },
			{ step: find.step, finding: "Failures cluster in tests." },
			{ step: read.query, finding: "The agent re-ran the suite." },
		],
		impact,
	);

	expect(impact.saved).toEqual([
		{
			workspaceId,
			analysisId: sql.analysis,
			authorId,
			visibility: { shared: false, revision: 0 },
			savedAt: NOW.toISOString(),
			// Read by a quoting call, or named by a finding's result.
			quotedOwners: ["counted", "other", "quoted"],
			onlyMember: null,
			citations: [
				{
					stepId: sql.step,
					finding: "The longest runs.",
					runs: [ref("s1", 1), ref("s1", 2, "sub")],
				},
				{
					stepId: find.step,
					finding: "Failures cluster in tests.",
					runs: [ref("s2", 4), ref("s2", 5)],
				},
				{
					stepId: read.step,
					finding: "The agent re-ran the suite.",
					runs: [ref("s3", 7)],
				},
			],
		},
	]);
});

test("each share and unshare hands over the analysis's visibility with a newer revision, so the newest wins whatever order the writes land in", async () => {
	const { log } = setup();
	const impact = createMemoryFindingImpact();
	const mirror = { impact, syncs: createMemoryVisibilitySyncs() };
	const trace = await recordQuery(log, author, call("sql", { runs: [] }, []));
	await save(log, trace.analysis, [], mirror);
	await shareAnalysis(log, viewer, trace.analysis, true, mirror);
	await shareAnalysis(log, viewer, trace.analysis, false, mirror);
	expect(impact.shares).toEqual([
		{ workspaceId, analysisId: trace.analysis, shared: true, revision: 1 },
		{ workspaceId, analysisId: trace.analysis, shared: false, revision: 2 },
	]);
	expect(impact.saved[0]?.visibility).toEqual({ shared: false, revision: 0 });
	expect(mirror.syncs.pending()).toEqual([]);
});

test("a share made while saving writes the rows, before any of them exist, still reaches them", async () => {
	const { log } = setup();
	const impact = createMemoryFindingImpact();
	const syncs = createMemoryVisibilitySyncs();
	const trace = await recordQuery(
		log,
		author,
		call("sql", { runs: [ref("s1", 1)] }, []),
	);
	const racing: FindingImpact = {
		...impact,
		async record(saved) {
			// The share's own write finds no rows yet.
			await shareAnalysis(log, viewer, saved.analysisId, true, {
				impact: { ...impact, async share() {} },
				syncs,
			});
			await impact.record(saved);
		},
	};
	await save(log, trace.analysis, [{ step: trace.query, finding: "Found." }], {
		impact: racing,
		syncs,
	});
	expect(impact.saved[0]?.visibility).toEqual({ shared: false, revision: 0 });
	expect(impact.shares).toEqual([
		{ workspaceId, analysisId: trace.analysis, shared: true, revision: 1 },
	]);
	expect(syncs.pending()).toEqual([]);
});

test("an unshare whose rows could not follow stands, and the maintenance pass makes them follow the analysis as it is then", async () => {
	const { log } = setup();
	const impact = createMemoryFindingImpact();
	const syncs = createMemoryVisibilitySyncs();
	const trace = await recordQuery(log, author, call("sql", { runs: [] }, []));
	await save(log, trace.analysis, [], { impact, syncs });
	await shareAnalysis(log, viewer, trace.analysis, true, { impact, syncs });
	const down: FindingImpact = {
		...impact,
		async share() {
			throw new Error("ClickHouse is down");
		},
	};
	expect(
		await shareAnalysis(log, viewer, trace.analysis, false, {
			impact: down,
			syncs,
		}),
	).toEqual({ analysis: trace.analysis, shared: false });
	expect(syncs.pending()).toEqual([trace.analysis]);
	// A pass while ClickHouse is still down keeps the request.
	await runVisibilitySyncPass({ impact: down, syncs, logOf: () => log });
	expect(syncs.pending()).toEqual([trace.analysis]);

	await runVisibilitySyncPass({ impact, syncs, logOf: () => log });
	expect(impact.shares.at(-1)).toEqual({
		workspaceId,
		analysisId: trace.analysis,
		shared: false,
		revision: 2,
	});
	expect(syncs.pending()).toEqual([]);
});

test("an impact write that fails never fails the save", async () => {
	const { log } = setup();
	const failing: FindingImpact = {
		async record() {
			throw new Error("ClickHouse is down");
		},
		async share() {},
	};
	const trace = await recordQuery(
		log,
		author,
		call("sql", { runs: [ref("s1", 1)] }, []),
	);
	expect(
		await save(
			log,
			trace.analysis,
			[{ step: trace.query, finding: "Found." }],
			failing,
		),
	).toEqual({ analysis: trace.analysis, status: "finished" });
});

test("a saver held to their own sessions cites only results they may still read, and only their own runs", async () => {
	const { log } = setup();
	const impact = createMemoryFindingImpact();
	// Run as an admin who could read a teammate's runs, then demoted in a
	// workspace that keeps members to their own sessions.
	const teammate = await recordQuery(
		log,
		author,
		call("sql", { runs: [ref("s_teammate", 1)] }, ["teammate"]),
	);
	const own = await recordQuery(
		log,
		author,
		call("sql", { runs: [ref("s_own", 2)] }, [authorId], teammate.analysis),
	);
	await saveAnalysis(
		log,
		{ ...viewer, restrictResults: true, onlyMember: authorId },
		{
			analysis: teammate.analysis,
			question: "Where did time go?",
			finalAnswer: "Into tests.",
			findings: [
				{ step: teammate.query, finding: "A teammate's run." },
				{ step: own.query, finding: "My run." },
			],
			topics: [],
			changes: [],
		},
		{ impact, syncs: createMemoryVisibilitySyncs() },
	);
	expect(impact.saved[0]).toMatchObject({
		onlyMember: authorId,
		citations: [
			{ stepId: teammate.step, runs: [] },
			{ stepId: own.step, runs: [ref("s_own", 2)] },
		],
	});
});
