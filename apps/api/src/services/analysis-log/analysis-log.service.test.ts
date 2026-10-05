import { describe, expect, test } from "bun:test";
import assert from "node:assert";
import { ORPCError } from "@orpc/server";
import type { AnalysisHistorySaveInput } from "@rudel/api-routes";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import {
	getAnalysisTree,
	getStoredQuery,
	purgeAnalysisLog,
	type RecordedCall,
	recordQuery,
	saveAnalysis,
	searchAnalyses,
	shareAnalysis,
	sinceUpdatedCutoff,
} from "./analysis-log.service.js";
import { captureCall } from "./capture.js";
import { createLocalEmbedder } from "./embedder.js";
import { createMemoryAnalysisStore } from "./memory-store.js";
import type { AnalysisLog } from "./types.js";

const workspaceId = "workspace";
const lead = { workspaceId, userId: "lead", host: "plugin" as const };
const leadViewer = {
	workspaceId,
	userId: "lead",
	isAdmin: true,
	restrictResults: false,
};
const memberViewer = {
	workspaceId,
	userId: "member",
	isAdmin: false,
	restrictResults: false,
};
// The same viewers in a workspace listed in ANALYSIS_LOG_RESTRICTED_WORKSPACES.
const restrictedLeadViewer = { ...leadViewer, restrictResults: true };
const restrictedMemberViewer = { ...memberViewer, restrictResults: true };
const memberAccount = { targetType: "account", targetId: "member" } as const;

describe("recording queries", () => {
	test("the first call opens an analysis; later calls group into steps by id or sub-question", async () => {
		const log = createLog();
		const first = await recordQuery(
			log,
			lead,
			call({
				question: "What pissed me off?",
				step: "Which prompts were negative?",
			}),
		);
		const again = await recordQuery(
			log,
			lead,
			call({ analysis: first.analysis, step: "Which prompts were negative?" }),
		);
		const byId = await recordQuery(
			log,
			lead,
			call({ analysis: first.analysis, step: first.step }),
		);
		const child = await recordQuery(
			log,
			lead,
			call(
				{
					analysis: first.analysis,
					step: "What happened in those runs?",
					parentStep: first.step,
				},
				"read",
			),
		);

		expect([again.analysis, byId.analysis, child.analysis]).toEqual([
			first.analysis,
			first.analysis,
			first.analysis,
		]);
		expect([again.step, byId.step]).toEqual([first.step, first.step]);
		await publish(log, first.analysis);
		const tree = await getAnalysisTree(log, leadViewer, first.analysis);
		expect(tree.question).toBe("What pissed me off?");
		expect(tree.status).toBe("finished");
		expect(
			tree.steps.map((step) => [
				step.question,
				step.parent,
				step.queries.length,
			]),
		).toEqual([
			["Which prompts were negative?", null, 3],
			["What happened in those runs?", first.step, 1],
		]);
	});

	test("a call without an analysis id joins the author's analysis active in the last 30 minutes", async () => {
		const clock = { now: Date.parse("2026-10-03T10:00:00Z") };
		const log = createLog(clock);
		const first = await recordQuery(
			log,
			lead,
			call({ question: "Why do agents fail?" }),
		);
		clock.now += 20 * 60_000;
		const joined = await recordQuery(log, lead, call({}));
		clock.now += 31 * 60_000;
		const fresh = await recordQuery(log, lead, call({}));

		expect(joined.analysis).toBe(first.analysis);
		expect(fresh.analysis).not.toBe(first.analysis);
	});

	test("an analysis keeps at most 200 queries and 200 steps, and queries of at most 32 KiB arguments", async () => {
		const log = createLog();
		const first = await recordQuery(log, lead, call({ question: "Big" }));
		for (let index = 1; index < 200; index++)
			await recordQuery(log, lead, call({ analysis: first.analysis }));
		await expect(
			recordQuery(log, lead, call({ analysis: first.analysis })),
		).rejects.toThrow(
			`Analysis ${first.analysis} already has 200 queries, the most one analysis keeps; start a new analysis`,
		);

		const steps = await recordQuery(
			log,
			lead,
			call({ question: "Many steps", step: "Step 0" }),
		);
		for (let index = 1; index < 181; index++)
			await recordQuery(
				log,
				lead,
				call({ analysis: steps.analysis, step: `Step ${index}` }),
			);
		const clarify = (count: number) =>
			saveAnalysis(log, leadViewer, {
				analysis: steps.analysis,
				finalAnswer: "x",
				findings: [],
				clarifications: Array.from({ length: count }, (_, index) => ({
					question: `Clarification ${index}?`,
					reply: "Yes",
				})),
				topics: [],
				changes: [],
			});
		await expect(clarify(20)).rejects.toThrow("save fewer clarifications");
		await clarify(19);
		expect((await log.store.getAnalysis(steps.analysis))?.stepCount).toBe(200);

		await expect(
			recordQuery(log, lead, {
				...call({ question: "Long" }),
				args: { source: "runs", repository: "r".repeat(32 * 1024) },
			}),
		).rejects.toThrow("an analysis keeps at most 32768 per query");
	});

	test("two calls racing for the last query or step of an analysis cannot pass 200", async () => {
		const log = createLog();
		const first = await recordQuery(log, lead, call({ question: "Race" }));
		for (let index = 2; index < 200; index++)
			await recordQuery(
				log,
				lead,
				call({ analysis: first.analysis, step: `Step ${index}` }),
			);
		const racing = await Promise.allSettled([
			recordQuery(log, lead, call({ analysis: first.analysis, step: "A" })),
			recordQuery(log, lead, call({ analysis: first.analysis, step: "B" })),
		]);

		expect(racing.map((result) => result.status).sort()).toEqual([
			"fulfilled",
			"rejected",
		]);
		const refused = racing.find((result) => result.status === "rejected");
		expect(refused?.status === "rejected" && refused.reason).toBeInstanceOf(
			ORPCError,
		);
		const analysis = await log.store.getAnalysis(first.analysis);
		expect([analysis?.queryCount, analysis?.stepCount]).toEqual([200, 200]);
	});

	test("a call without an analysis id starts a new analysis when the open one is full", async () => {
		const log = createLog();
		const full = await recordQuery(log, lead, call({ question: "Full" }));
		for (let index = 1; index < 200; index++)
			await recordQuery(log, lead, call({}));

		const next = await recordQuery(log, lead, call({}));
		expect(next.analysis).not.toBe(full.analysis);
		expect((await log.store.getAnalysis(next.analysis))?.question).toBe(
			"(question not given)",
		);
		expect((await log.store.getAnalysis(full.analysis))?.queryCount).toBe(200);
	});

	test("two calls without an analysis id racing for its last query both succeed", async () => {
		const log = createLog();
		const full = await recordQuery(log, lead, call({ question: "Busy" }));
		for (let index = 2; index < 200; index++)
			await recordQuery(log, lead, call({}));

		const racing = await Promise.all([
			recordQuery(log, lead, call({})),
			recordQuery(log, lead, call({})),
		]);
		expect(new Set(racing.map((trace) => trace.analysis)).size).toBe(2);
		expect(racing.map((trace) => trace.analysis)).toContain(full.analysis);
		expect((await log.store.getAnalysis(full.analysis))?.queryCount).toBe(200);
	});

	test("only the author can add to a draft; to anyone else it does not exist", async () => {
		const log = createLog();
		const first = await recordQuery(log, lead, call({ question: "Mine" }));

		const refused = await recordQuery(
			log,
			{ ...lead, userId: "member" },
			call({ analysis: first.analysis }),
		).catch((error: unknown) => error);
		expect(refused).toBeInstanceOf(ORPCError);
		expect((refused as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
		expect((await log.store.getAnalysis(first.analysis))?.queryCount).toBe(1);
	});
});

describe("saving and reading back", () => {
	test("save stores findings, places clarifications before a step and derives the scope", async () => {
		const log = createLog();
		const trace = await recordQuery(
			log,
			lead,
			call(
				{
					question: "What pissed me off the most?",
					step: "Which prompts were negative?",
				},
				"find",
				{
					source: "user",
					from: "2026-09-05",
					to: "2026-10-03",
					repository: "athena",
				},
			),
		);
		await saveAnalysis(log, leadViewer, {
			analysis: trace.analysis,
			finalAnswer: "Design that misses your taste, ranked first by cost.",
			findings: [{ step: trace.step, finding: "32 origin runs, 10 sessions" }],
			clarifications: [
				{
					question: "2 or 4 weeks?",
					reply: "4 weeks, by cost",
					before: trace.step,
				},
			],
			topics: ["frustration", "cost"],
			changes: [],
		});

		const tree = await getAnalysisTree(log, leadViewer, trace.analysis);
		expect(tree.status).toBe("finished");
		expect(tree.finalAnswer).toBe(
			"Design that misses your taste, ranked first by cost.",
		);
		expect(tree.scope).toEqual({
			from: "2026-09-05",
			to: "2026-10-03",
			filters: { repository: "athena" },
		});
		expect(
			tree.steps.map((step) => [step.question, step.reply, step.finding]),
		).toEqual([
			["2 or 4 weeks?", "4 weeks, by cost", null],
			["Which prompts were negative?", null, "32 origin runs, 10 sessions"],
		]);
		expect(tree.topics).toEqual(["frustration", "cost"]);
	});

	test("a refused save writes nothing", async () => {
		const log = createLog();
		const trace = await recordQuery(
			log,
			lead,
			call({ question: "Almost full", step: "Step 0" }),
		);
		for (let index = 1; index < 199; index++)
			await recordQuery(
				log,
				lead,
				call({ analysis: trace.analysis, step: `Step ${index}` }),
			);
		const before = await stored(log, trace.analysis);

		await expect(
			saveAnalysis(log, leadViewer, {
				analysis: trace.analysis,
				finalAnswer: "x",
				findings: [{ step: trace.step, finding: "written too early" }],
				clarifications: [
					{ question: "One?", reply: "Yes" },
					{ question: "Two?", reply: "Yes" },
				],
				topics: [],
				changes: [],
			}),
		).rejects.toThrow("save fewer clarifications");
		await expect(
			saveAnalysis(log, leadViewer, {
				analysis: trace.analysis,
				finalAnswer: "x",
				findings: [{ step: trace.step, finding: "written too early" }],
				clarifications: [],
				topics: [],
				changes: [],
				updates: "a_missing",
			}),
		).rejects.toThrow();
		expect(await stored(log, trace.analysis)).toEqual(before);
	});

	test("a save that loses the last step to a concurrent call writes nothing", async () => {
		const store = createMemoryAnalysisStore();
		let competing: (() => Promise<void>) | undefined;
		const log: AnalysisLog = {
			...createLog(),
			store: {
				...store,
				async getSteps(analysisId) {
					const steps = await store.getSteps(analysisId);
					// The competing step lands after the save read its steps.
					const run = competing;
					competing = undefined;
					await run?.();
					return steps;
				},
			},
		};
		const trace = await recordQuery(
			log,
			lead,
			call({ question: "Almost full", step: "Step 0" }),
		);
		for (let index = 1; index < 199; index++)
			await recordQuery(
				log,
				lead,
				call({ analysis: trace.analysis, step: `Step ${index}` }),
			);
		const before = await stored(log, trace.analysis);
		competing = () =>
			recordQuery(
				log,
				lead,
				call({ analysis: trace.analysis, step: "Last" }),
			).then(() => undefined);

		await expect(
			saveAnalysis(log, leadViewer, {
				analysis: trace.analysis,
				finalAnswer: "x",
				findings: [{ step: trace.step, finding: "written too early" }],
				clarifications: [{ question: "One?", reply: "Yes" }],
				topics: [],
				changes: [],
			}),
		).rejects.toThrow("save fewer clarifications");
		const after = await stored(log, trace.analysis);
		expect(after.analysis?.finalAnswer).toBeNull();
		expect(after.analysis?.draft).toBe(true);
		expect(after.steps.filter((step) => step.finding !== null)).toEqual([]);
		expect(after.steps).toHaveLength(before.steps.length + 1);
	});

	test("findings name a step by id or by its sub-question; other analyses' steps are rejected", async () => {
		const log = createLog();
		const one = await recordQuery(
			log,
			lead,
			call({ question: "One", step: "Sub" }),
		);
		const two = await recordQuery(
			log,
			lead,
			call({ question: "Two", step: "Which runs failed?" }),
		);
		await expect(
			saveAnalysis(log, leadViewer, {
				analysis: two.analysis,
				finalAnswer: "x",
				findings: [{ step: one.step, finding: "y" }],
				clarifications: [],
				topics: [],
				changes: [],
			}),
		).rejects.toThrow(`is not part of analysis ${two.analysis}`);
		await saveAnalysis(log, leadViewer, {
			analysis: two.analysis,
			finalAnswer: "x",
			findings: [{ step: "Which runs failed?", finding: "three" }],
			clarifications: [],
			topics: [],
			changes: [],
		});

		expect(
			(await getAnalysisTree(log, leadViewer, two.analysis)).steps[0]?.finding,
		).toBe("three");
	});
});

describe("drafts and revisions", () => {
	test("a draft older than 7 days is gone for its author before the daily cleanup deletes it", async () => {
		const clock = { now: Date.parse("2026-10-03T10:00:00Z") };
		const log = createLog(clock);
		const draft = await recordQuery(log, lead, call({ question: "Old draft" }));
		clock.now += 7 * 86_400_000 + 1;

		await expect(
			recordQuery(log, lead, call({ analysis: draft.analysis })),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(publish(log, draft.analysis)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		const fresh = await recordQuery(log, lead, call({}));
		expect(fresh.analysis).not.toBe(draft.analysis);
	});

	test("a find that updates a saved analysis defaults from to its data cutoff day, and says so", async () => {
		const clock = { now: Date.parse("2026-09-20T15:30:00Z") };
		const log = createLog(clock);
		const prior = await recordQuery(log, lead, call({ question: "Prior" }));
		await publish(log, prior.analysis);
		const input = {
			source: "runs" as const,
			includeNoise: false,
			reaction: ["negative" as const],
			sort: "startedAt" as const,
			updates: prior.analysis,
		};

		expect(await sinceUpdatedCutoff(log, leadViewer, input)).toEqual({
			input: { ...input, from: "2026-09-20" },
			note: `from defaults to 2026-09-20, the data cutoff of analysis ${prior.analysis} that this draft updates; pass from to cover earlier days`,
		});
		expect(
			await sinceUpdatedCutoff(log, leadViewer, {
				...input,
				from: "2026-09-01",
			}),
		).toBeNull();
		expect(
			await sinceUpdatedCutoff(log, leadViewer, { ...input, to: "2026-09-10" }),
		).toBeNull();
		const draft = await recordQuery(log, lead, call({ question: "Draft" }));
		await expect(
			sinceUpdatedCutoff(log, leadViewer, {
				...input,
				updates: draft.analysis,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	test("follow-up finds in a revision keep the prior's cutoff as their default from; an explicit from wins", async () => {
		const clock = { now: Date.parse("2026-09-01T15:30:00Z") };
		const log = createLog(clock);
		const prior = await recordQuery(log, lead, call({ question: "Prior" }));
		await publish(log, prior.analysis);
		clock.now = Date.parse("2026-10-01T09:00:00Z");
		const draft = await recordQuery(
			log,
			lead,
			call({ updates: prior.analysis }),
		);
		const followUp = {
			source: "runs" as const,
			includeNoise: false,
			reaction: ["negative" as const],
			sort: "startedAt" as const,
			analysis: draft.analysis,
			step: "Since the cutoff",
		};

		expect(await sinceUpdatedCutoff(log, leadViewer, followUp)).toEqual({
			input: { ...followUp, from: "2026-09-01" },
			note: `from defaults to 2026-09-01, the data cutoff of analysis ${prior.analysis} that this draft updates; pass from to cover earlier days`,
		});
		expect(
			await sinceUpdatedCutoff(log, leadViewer, {
				...followUp,
				from: "2026-09-20",
			}),
		).toBeNull();
		// A draft that revises nothing, or another member's draft, keeps the default window.
		const plain = await recordQuery(log, lead, call({ question: "Plain" }));
		expect(
			await sinceUpdatedCutoff(log, leadViewer, {
				...followUp,
				analysis: plain.analysis,
			}),
		).toBeNull();
		expect(await sinceUpdatedCutoff(log, memberViewer, followUp)).toBeNull();
	});

	test("a revision's changes must cover every finding saved with it exactly once, or nothing is saved", async () => {
		const log = createLog();
		const prior = await recordQuery(
			log,
			lead,
			call({ question: "Why do agents fail?", step: "Stale patches" }),
		);
		const lint = await recordQuery(
			log,
			lead,
			call({ analysis: prior.analysis, step: "Lint loops" }),
		);
		await saveAnalysis(log, leadViewer, {
			analysis: prior.analysis,
			finalAnswer: "Stale patches and lint loops.",
			findings: [
				{ step: prior.step, finding: "11 stale patches" },
				{ step: lint.step, finding: "5 lint loops" },
			],
			clarifications: [],
			topics: [],
			changes: [],
		});
		const draft = await recordQuery(
			log,
			lead,
			call({ updates: prior.analysis, step: "Stale patches since" }),
		);
		const timeouts = await recordQuery(
			log,
			lead,
			call({ analysis: draft.analysis, step: "Timeouts" }),
		);
		const before = await stored(log, draft.analysis);
		const save = (changes: AnalysisHistorySaveInput["changes"]) =>
			saveAnalysis(log, leadViewer, {
				analysis: draft.analysis,
				finalAnswer: "Fewer stale patches; timeouts are new.",
				findings: [
					{ step: draft.step, finding: "4 stale patches" },
					{ step: "Timeouts", finding: "3 timeouts" },
				],
				clarifications: [],
				topics: [],
				changes,
			});
		const weakened = {
			step: draft.step,
			change: "weakened" as const,
			evidence: "4, was 11",
		};

		await expect(save([weakened])).rejects.toThrow(
			`no change for the finding of ${timeouts.step} ("Timeouts")`,
		);
		await expect(
			save([
				weakened,
				{ ...weakened, step: "Stale patches since" },
				{ step: "Timeouts", change: "new", evidence: "3 runs" },
			]),
		).rejects.toThrow(
			`more than one change for ${draft.step} ("Stale patches since")`,
		);
		await expect(
			save([
				weakened,
				{ step: "Timeouts", change: "new", evidence: "3 runs" },
				{ step: "Lint loops", change: "weakened", evidence: "none" },
			]),
		).rejects.toThrow(
			`nor a step of ${prior.analysis} (allowed only with change=dropped), for "Lint loops"`,
		);
		expect(await stored(log, draft.analysis)).toEqual(before);

		await save([
			weakened,
			{ step: "Timeouts", change: "new", evidence: "3 runs" },
			{ step: "Lint loops", change: "dropped", evidence: "none since" },
		]);
		expect(
			(await getAnalysisTree(log, leadViewer, draft.analysis)).changes,
		).toEqual([
			{ ...weakened, finding: "4 stale patches" },
			{
				step: timeouts.step,
				finding: "3 timeouts",
				change: "new",
				evidence: "3 runs",
			},
			{
				step: lint.step,
				finding: "5 lint loops",
				change: "dropped",
				evidence: "none since",
			},
		]);
	});

	test("the Bayesian cycle: a saved prior is updated by a new draft that links it, and the prior and its evidence stay as they were", async () => {
		const clock = { now: Date.parse("2026-09-01T09:00:00Z") };
		const log = createLog(clock);
		// A: the prior.
		const a = await recordQuery(
			log,
			lead,
			call(
				{ question: "Why do agents fail?", step: "Failures" },
				"find",
				{
					source: "tool",
				},
				["lead"],
			),
		);
		await saveAnalysis(log, leadViewer, {
			analysis: a.analysis,
			finalAnswer: "Mostly stale patches.",
			findings: [{ step: a.step, finding: "11 stale patches" }],
			clarifications: [],
			topics: ["failures"],
			changes: [],
		});
		const priorTree = await getAnalysisTree(log, leadViewer, a.analysis);
		const priorResult = await getStoredQuery(log, leadViewer, a.query, current);

		// A month later: search finds A, then B starts from it with find and read.
		clock.now = Date.parse("2026-10-01T09:00:00Z");
		const found = await searchAnalyses(log, leadViewer, {
			text: "Why do agents fail?",
			limit: 5,
			includeEval: false,
		});
		expect(found.analyses[0]?.id).toBe(a.analysis);
		const b = await recordQuery(
			log,
			lead,
			call(
				{ updates: a.analysis, step: "Failures since the cutoff" },
				"find",
				{
					source: "tool",
					from: "2026-09-01",
				},
				["lead"],
			),
		);
		await recordQuery(
			log,
			lead,
			call(
				{ analysis: b.analysis, step: "Read the new stale patches" },
				"read",
				{},
				["lead"],
			),
		);
		await saveAnalysis(log, leadViewer, {
			analysis: b.analysis,
			finalAnswer: "Still stale patches, fewer of them.",
			findings: [{ step: b.step, finding: "4 stale patches since 2026-09-01" }],
			clarifications: [],
			topics: ["failures"],
			changes: [
				{
					step: b.step,
					change: "weakened",
					evidence: "4 since the cutoff, 11 before",
				},
			],
		});

		const posterior = await getAnalysisTree(log, leadViewer, b.analysis);
		expect(posterior.updates).toBe(a.analysis);
		expect(posterior.question).toBe("Why do agents fail?");
		expect(posterior.changes.map((change) => change.change)).toEqual([
			"weakened",
		]);
		const after = await getAnalysisTree(log, leadViewer, a.analysis);
		expect(after).toEqual({ ...priorTree, updatedBy: [b.analysis] });
		expect(await getStoredQuery(log, leadViewer, a.query, current)).toEqual(
			priorResult,
		);
		await expect(
			saveAnalysis(log, leadViewer, {
				analysis: a.analysis,
				finalAnswer: "Overwritten",
				findings: [],
				clarifications: [],
				topics: [],
				changes: [],
			}),
		).rejects.toThrow(
			`This analysis is already saved. To revise it, save a new analysis that passes updates=${a.analysis}.`,
		);
	});
});

describe("search and visibility", () => {
	test("search finds an analysis by a step's sub-question and hides others' private and eval analyses", async () => {
		const log = createLog();
		const mine = await recordQuery(
			log,
			lead,
			call({
				question: "Why is the team annoyed?",
				step: "Which runs had negative reactions in September?",
			}),
		);
		const private_ = await recordQuery(
			log,
			{ ...lead, userId: "member" },
			call({ question: "Private negative reactions" }),
		);
		const evaluation = await recordQuery(
			log,
			{ ...lead, host: "eval" },
			call({ question: "Eval negative reactions" }),
		);
		await publish(log, mine.analysis);
		await publish(log, private_.analysis, memberViewer);
		await publish(log, evaluation.analysis);

		const found = await searchAnalyses(log, leadViewer, {
			text: "negative reactions in September",
			limit: 5,
			includeEval: false,
		});
		expect(found.analyses[0]?.id).toBe(mine.analysis);
		expect(found.analyses[0]?.match).toEqual({
			kind: "step",
			step: mine.step,
			text: "Which runs had negative reactions in September?",
		});
		expect(found.analyses.map((analysis) => analysis.question)).toEqual([
			"Why is the team annoyed?",
		]);
	});

	test("a shared analysis shows its path and results quoting others' sessions to the workspace, unless it restricts results", async () => {
		const log = createLog();
		const trace = await recordQuery(
			log,
			lead,
			call({ question: "Team frustration" }, "read", {}, [
				"lead",
				"member",
				"other",
			]),
		);
		await expect(
			getAnalysisTree(log, memberViewer, trace.analysis),
		).rejects.toThrow();
		await expect(
			getStoredQuery(log, memberViewer, trace.query, current),
		).rejects.toThrow();
		await publish(log, trace.analysis);
		await shareAnalysis(log, leadViewer, trace.analysis, true);

		const tree = await getAnalysisTree(log, memberViewer, trace.analysis);
		expect(tree.steps[0]?.queries[0]?.unavailable).toBeNull();
		const query = await getStoredQuery(log, memberViewer, trace.query, current);
		expect(query.call.output as unknown).toEqual({ ok: true });

		const restrictedTree = await getAnalysisTree(
			log,
			restrictedMemberViewer,
			trace.analysis,
		);
		expect(restrictedTree.steps[0]?.queries[0]?.unavailable).toBe("restricted");
		const restricted = await getStoredQuery(
			log,
			restrictedMemberViewer,
			trace.query,
			current,
		);
		expect(restricted.call.output).toBeNull();
		for (const admin of [leadViewer, restrictedLeadViewer]) {
			const asAdmin = await getStoredQuery(log, admin, trace.query, current);
			expect(asAdmin.call.output as unknown).toEqual({ ok: true });
		}
	});

	test("a member reads a shared result over other members' sessions in full; a restricting workspace keeps it restricted even when its examples are all the viewer's", async () => {
		const log = createLog();
		// An admin's find over the member's and Bob's sessions keeps five
		// examples, all the member's, but its top commands include Bob's.
		const output = {
			source: "tool",
			groups: [
				{
					key: "failed",
					examples: [1, 2, 3, 4, 5].map((index) => ({
						sessionId: `s_member_${index}`,
					})),
					topCommands: ["git checkout confidential-roadmap"],
				},
			],
		};
		const examples = await recordQuery(log, lead, {
			...call({ question: "Why do tools fail?" }, "find", { source: "tool" }),
			output,
			sessions: [1, 2, 3, 4, 5].map((index) => ({
				sessionId: `s_member_${index}`,
				ownerId: "member",
				revision: "1",
				parserVersion: 4,
			})),
			owners: ["member", "bob"],
		});
		const grouped = await recordQuery(log, lead, {
			...call({ analysis: examples.analysis, step: "How often?" }),
			owners: ["member", "bob"],
		});
		const memberOnly = await recordQuery(
			log,
			lead,
			call({ analysis: examples.analysis, step: "Mine only" }, "read", {}, [
				"member",
			]),
		);
		await publish(log, examples.analysis);
		await shareAnalysis(log, leadViewer, examples.analysis, true);
		const unavailable = async (viewer: typeof memberViewer) =>
			(await getAnalysisTree(log, viewer, examples.analysis)).steps.flatMap(
				(step) => step.queries.map((query) => [query.id, query.unavailable]),
			);

		expect(await unavailable(memberViewer)).toEqual([
			[examples.query, null],
			[grouped.query, null],
			[memberOnly.query, null],
		]);
		const shown = await getStoredQuery(
			log,
			memberViewer,
			examples.query,
			current,
		);
		expect(shown.unavailable).toBeNull();
		expect(shown.call.output as unknown).toEqual(output);
		const groupedShown = await getStoredQuery(
			log,
			memberViewer,
			grouped.query,
			current,
		);
		expect(groupedShown.call.output as unknown).toEqual({ ok: true });

		expect(await unavailable(restrictedMemberViewer)).toEqual([
			[examples.query, "restricted"],
			[grouped.query, "restricted"],
			[memberOnly.query, null],
		]);
		const asMember = await getStoredQuery(
			log,
			restrictedMemberViewer,
			examples.query,
			current,
		);
		expect(asMember.unavailable).toBe("restricted");
		expect(asMember.call.output).toBeNull();
		const groupedAsMember = await getStoredQuery(
			log,
			restrictedMemberViewer,
			grouped.query,
			current,
		);
		expect(groupedAsMember.call.output).toBeNull();
		for (const admin of [leadViewer, restrictedLeadViewer]) {
			const asAdmin = await getStoredQuery(log, admin, examples.query, current);
			expect(asAdmin.unavailable).toBeNull();
			expect(asAdmin.call.output as unknown).toEqual(output);
		}
		const own = await getStoredQuery(
			log,
			restrictedMemberViewer,
			memberOnly.query,
			current,
		);
		expect(own.unavailable).toBeNull();
		expect(own.call.output as unknown).toEqual({ ok: true });
	});

	test("results expire after 90 days and changed sessions are flagged stale", async () => {
		const clock = { now: Date.parse("2026-07-01T00:00:00Z") };
		const log = createLog(clock);
		const trace = await recordQuery(
			log,
			lead,
			call({ question: "Old" }, "find", {}, ["lead"]),
		);
		await publish(log, trace.analysis);
		const changed = await getStoredQuery(
			log,
			leadViewer,
			trace.query,
			async () => new Map([["s_lead", { revision: "2", parserVersion: 4 }]]),
		);
		expect(changed.stale).toBe(true);
		clock.now += 91 * 86_400_000;

		const expired = await getStoredQuery(log, leadViewer, trace.query, current);
		expect(expired.unavailable).toBe("expired");
		expect(expired.call.output).toBeNull();
	});
});

describe("deletion", () => {
	test("deleting an account removes its analyses and every analysis that read its sessions", async () => {
		const log = createLog();
		const leaving = { ...lead, userId: "member" };
		const theirs = await recordQuery(
			log,
			leaving,
			call({ question: "Their own" }),
		);
		const team = await recordQuery(
			log,
			lead,
			call({ question: "Team" }, "read", {}, ["lead", "member"]),
		);
		const leadOnly = await recordQuery(
			log,
			lead,
			call({ question: "Lead only" }, "read", {}, ["lead"]),
		);
		await publish(log, leadOnly.analysis);

		await purgeAnalysisLog(log.store, memberAccount, purgeSignal());
		await purgeAnalysisLog(log.store, memberAccount, purgeSignal());

		expect(await log.store.getAnalysis(theirs.analysis)).toBeNull();
		expect(await log.store.getAnalysis(team.analysis)).toBeNull();
		await expect(
			getAnalysisTree(log, leadViewer, team.analysis),
		).rejects.toThrow();
		expect(
			(await getAnalysisTree(log, leadViewer, leadOnly.analysis)).question,
		).toBe("Lead only");
	});

	test("a captured grouped find over a member's sessions is deleted with the member's account", async () => {
		const log = createLog();
		// Grouped results name no session, so no ClickHouse lookup happens.
		const unused: ClickHouseExecutor = {
			async close() {},
			async execute() {
				throw new Error("not used");
			},
			async insert() {
				throw new Error("not used");
			},
			async query() {
				throw new Error("not used");
			},
		};
		const trace = await captureCall(
			unused,
			log,
			lead,
			"find",
			{ source: "runs", groupBy: "week", question: "How busy was the team?" },
			{ source: "runs", groups: [{ key: "2026-09-28", runs: 12 }] },
			["member"],
		);
		assert(trace);
		await saveAnalysis(log, leadViewer, {
			analysis: trace.analysis,
			finalAnswer: "Busiest in late September.",
			findings: [],
			clarifications: [],
			topics: [],
			changes: [],
		});

		await purgeAnalysisLog(log.store, memberAccount, purgeSignal());
		expect(await log.store.getAnalysis(trace.analysis)).toBeNull();
	});

	test("a purge stops at its deadline and the next one finishes", async () => {
		const log = createLog();
		const theirs = await recordQuery(
			log,
			{ ...lead, userId: "member" },
			call({ question: "Their own" }),
		);
		await expect(
			purgeAnalysisLog(log.store, memberAccount, AbortSignal.abort()),
		).rejects.toThrow();
		expect(await log.store.getAnalysis(theirs.analysis)).not.toBeNull();

		await purgeAnalysisLog(log.store, memberAccount, purgeSignal());
		expect(await log.store.getAnalysis(theirs.analysis)).toBeNull();
	});

	test("deleting a workspace removes every analysis in it", async () => {
		const log = createLog();
		const one = await recordQuery(log, lead, call({ question: "One" }));
		await purgeAnalysisLog(
			log.store,
			{ targetType: "organization", targetId: workspaceId },
			purgeSignal(),
		);

		expect(await log.store.getAnalysis(one.analysis)).toBeNull();
		expect(
			(await searchAnalyses(log, leadViewer, { limit: 10, includeEval: true }))
				.analyses,
		).toEqual([]);
	});
});

/** Saves a draft with no findings: it becomes visible. */
async function publish(
	log: AnalysisLog,
	analysis: string,
	viewer: typeof leadViewer = leadViewer,
) {
	await saveAnalysis(log, viewer, {
		analysis,
		finalAnswer: "Answer",
		findings: [],
		clarifications: [],
		topics: [],
		changes: [],
	});
}

/** The analysis and its steps as stored, drafts included. */
async function stored(log: AnalysisLog, analysis: string) {
	return {
		analysis: await log.store.getAnalysis(analysis),
		steps: await log.store.getSteps(analysis),
	};
}

function purgeSignal(): AbortSignal {
	return AbortSignal.timeout(60_000);
}

function createLog(
	clock = { now: Date.parse("2026-10-03T10:00:00Z") },
): AnalysisLog {
	return {
		store: createMemoryAnalysisStore(),
		embedder: createLocalEmbedder(),
		now: () => new Date(clock.now),
	};
}

function call(
	trace: RecordedCall["trace"],
	tool: RecordedCall["tool"] = "find",
	args: Record<string, unknown> = { source: "runs" },
	owners: string[] = [],
): RecordedCall {
	return {
		tool,
		args,
		trace,
		output: { ok: true },
		outputChars: 11,
		sessions: owners.map((ownerId) => ({
			sessionId: `s_${ownerId}`,
			ownerId,
			revision: "1",
			parserVersion: 4,
		})),
		owners,
	};
}

async function current(sessions: { sessionId: string }[]) {
	return new Map(
		sessions.map((session) => [
			session.sessionId,
			{ revision: "1", parserVersion: 4 },
		]),
	);
}
