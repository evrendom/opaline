import { describe, expect, test } from "bun:test";
import assert from "node:assert";
import { ORPCError } from "@orpc/server";
import {
	type AnalysisHistorySaveInput,
	AnalysisHistorySaveInputSchema,
} from "@rudel/api-routes";
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
	stepLabel,
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
// The same viewers in a workspace limited to own sessions and listed in
// ANALYSIS_LOG_RESTRICTED_WORKSPACES.
const restrictedLeadViewer = { ...leadViewer, restrictResults: true };
const restrictedMemberViewer = { ...memberViewer, restrictResults: true };
const memberAccount = { targetType: "account", targetId: "member" } as const;

describe("recording queries", () => {
	test("a call without an analysis id starts a new draft; each call with one adds its own step, labelled from its arguments", async () => {
		const log = createLog();
		const first = await recordQuery(
			log,
			lead,
			call({}, "find", { source: "tool", kind: "validation" }),
		);
		const second = await recordQuery(
			log,
			lead,
			call({ analysis: first.analysis }, "find", { source: "tool" }),
		);
		const third = await recordQuery(
			log,
			lead,
			call({ analysis: first.analysis }, "read", {
				refs: [
					{ sessionId: "s1", agentId: "", turn: 1 },
					{ sessionId: "s2", agentId: "", turn: 3 },
				],
				depth: "turn",
				maxChars: 12_000,
			}),
		);
		const fresh = await recordQuery(log, lead, call({}));

		expect([second.analysis, third.analysis]).toEqual([
			first.analysis,
			first.analysis,
		]);
		expect(fresh.analysis).not.toBe(first.analysis);
		expect(new Set([first.step, second.step, third.step]).size).toBe(3);
		const steps = await log.store.getSteps(first.analysis);
		expect(steps.map((step) => [step.question, step.parentId])).toEqual([
			["find source=tool kind=validation", null],
			["find source=tool", null],
			["read runs=2 depth=turn", null],
		]);
		expect(await log.store.getAnalysis(first.analysis)).toMatchObject({
			draft: true,
			question: "(unsaved answer)",
			queryCount: 3,
			stepCount: 3,
		});
	});

	test("step labels name the tool and the arguments the call set, never free text", () => {
		expect(
			stepLabel("find", {
				source: "user",
				from: "2026-09-01",
				reaction: ["negative"],
				includeNoise: false,
				sort: "startedAt",
				cursor: "abc",
				refs: [{ sessionId: "s", agentId: "", turn: 1 }],
			}),
		).toBe("find source=user from=2026-09-01 reaction=negative runs=1");
		expect(
			stepLabel("find", { source: "runs", repository: "r".repeat(500) }),
		).toHaveLength(200);
	});

	test("nothing is embedded for search before an answer is saved", async () => {
		const embedded: string[] = [];
		const log: AnalysisLog = {
			...createLog(),
			embedder: {
				model: "test",
				async embed(texts) {
					embedded.push(...texts);
					return texts.map(() => new Array<number>(1536).fill(0.1));
				},
			},
		};
		const draft = await recordQuery(log, lead, call({}));
		await recordQuery(log, lead, call({ analysis: draft.analysis }, "read"));
		expect(embedded).toEqual([]);

		await saveAnalysis(log, leadViewer, {
			analysis: draft.analysis,
			question: "Where our agents get stuck",
			finalAnswer: "Stale patches.",
			findings: [],
			topics: ["failures"],
			changes: [],
		});
		expect(embedded).toEqual(["Where our agents get stuck", "failures"]);
	});

	test("an analysis keeps at most 200 queries and 200 steps, and queries of at most 32 KiB arguments", async () => {
		const log = createLog();
		const first = await recordQuery(log, lead, call({}));
		for (let index = 1; index < 200; index++)
			await recordQuery(log, lead, call({ analysis: first.analysis }));
		await expect(
			recordQuery(log, lead, call({ analysis: first.analysis })),
		).rejects.toThrow(
			`Analysis ${first.analysis} already has 200 queries, the most one analysis keeps; save it, or start a new analysis`,
		);

		expect((await log.store.getAnalysis(first.analysis))?.stepCount).toBe(200);

		await expect(
			recordQuery(log, lead, {
				...call({}),
				args: { source: "runs", repository: "r".repeat(32 * 1024) },
			}),
		).rejects.toThrow("an analysis keeps at most 32768 per query");
	});

	test("two calls racing for the last query or step of an analysis cannot pass 200", async () => {
		const log = createLog();
		const first = await recordQuery(log, lead, call({}));
		for (let index = 2; index < 200; index++)
			await recordQuery(log, lead, call({ analysis: first.analysis }));
		const racing = await Promise.allSettled([
			recordQuery(log, lead, call({ analysis: first.analysis })),
			recordQuery(log, lead, call({ analysis: first.analysis })),
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

	test("only the author can add to a draft; to anyone else it does not exist", async () => {
		const log = createLog();
		const first = await recordQuery(log, lead, call({}));

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
	test("save stores the question, findings and topics and derives the scope; it takes no clarifications", async () => {
		const log = createLog();
		const trace = await recordQuery(
			log,
			lead,
			call({}, "find", {
				source: "user",
				from: "2026-09-05",
				to: "2026-10-03",
				repository: "athena",
			}),
		);
		await saveAnalysis(log, leadViewer, {
			analysis: trace.analysis,
			question: "What frustrated me most",
			finalAnswer: "Design that misses your taste, ranked first by cost.",
			findings: [{ step: trace.step, finding: "32 origin runs, 10 sessions" }],
			topics: ["frustration", "cost"],
			changes: [],
		});

		const tree = await getAnalysisTree(log, leadViewer, trace.analysis);
		expect(tree.status).toBe("finished");
		expect(tree.question).toBe("What frustrated me most");
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
			[
				"find source=user from=2026-09-05 to=2026-10-03 repository=athena",
				null,
				"32 origin runs, 10 sessions",
			],
		]);
		expect(tree.topics).toEqual(["frustration", "cost"]);
		expect(
			AnalysisHistorySaveInputSchema.safeParse({
				...saveInput(trace.analysis),
				clarifications: [{ question: "2 or 4 weeks?", reply: "4" }],
			}).success,
		).toBe(false);
		expect(
			AnalysisHistorySaveInputSchema.safeParse({
				...saveInput(trace.analysis),
				question: "q".repeat(121),
			}).success,
		).toBe(false);
	});

	test("a refused save writes nothing", async () => {
		const log = createLog();
		const trace = await recordQuery(log, lead, call({}));
		for (let index = 1; index < 199; index++)
			await recordQuery(log, lead, call({ analysis: trace.analysis }));
		const before = await stored(log, trace.analysis);

		await expect(
			saveAnalysis(log, leadViewer, {
				...saveInput(trace.analysis),
				findings: [{ step: "s_foreign", finding: "written too early" }],
			}),
		).rejects.toThrow("is not part of analysis");
		await expect(
			saveAnalysis(log, leadViewer, {
				analysis: trace.analysis,
				question: "Saved question",
				finalAnswer: "x",
				findings: [{ step: trace.step, finding: "written too early" }],
				topics: [],
				changes: [],
				updates: "a_missing",
			}),
		).rejects.toThrow();
		expect(await stored(log, trace.analysis)).toEqual(before);
	});

	test("findings name a step by its step or query id; other analyses' steps are rejected", async () => {
		const log = createLog();
		const one = await recordQuery(log, lead, call({}));
		const two = await recordQuery(log, lead, call({}));
		const read = await recordQuery(
			log,
			lead,
			call({ analysis: two.analysis }, "read"),
		);
		for (const step of [one.step, one.query])
			await expect(
				saveAnalysis(log, leadViewer, {
					analysis: two.analysis,
					question: "Saved question",
					finalAnswer: "x",
					findings: [{ step, finding: "y" }],
					topics: [],
					changes: [],
				}),
			).rejects.toThrow(`is not part of analysis ${two.analysis}`);
		await expect(
			saveAnalysis(log, leadViewer, {
				...({
					analysis: two.analysis,
					finalAnswer: "x",
					findings: [],
					clarifications: [],
					topics: [],
					changes: [],
				} as unknown as AnalysisHistorySaveInput),
			}),
		).rejects.toThrow();
		await saveAnalysis(log, leadViewer, {
			analysis: two.analysis,
			question: "Saved question",
			finalAnswer: "x",
			findings: [
				{ step: two.step, finding: "three" },
				{ step: read.query, finding: "read two" },
			],
			topics: [],
			changes: [],
		});

		expect(
			(await getAnalysisTree(log, leadViewer, two.analysis)).steps.map(
				(step) => step.finding,
			),
		).toEqual(["three", "read two"]);
	});
});

describe("drafts and revisions", () => {
	test("a draft older than 7 days is gone for its author before the daily cleanup deletes it", async () => {
		const clock = { now: Date.parse("2026-10-03T10:00:00Z") };
		const log = createLog(clock);
		const draft = await recordQuery(log, lead, call({}));
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

	test("a draft created without a question gets its question when saved; a save without one is refused", async () => {
		const log = createLog();
		const draft = await recordQuery(log, lead, call({}));
		expect((await log.store.getAnalysis(draft.analysis))?.question).toBe(
			"(unsaved answer)",
		);
		const { question: _question, ...withoutQuestion } = saveInput(
			draft.analysis,
		);
		await expect(
			saveAnalysis(
				log,
				leadViewer,
				withoutQuestion as unknown as AnalysisHistorySaveInput,
			),
		).rejects.toThrow();
		expect((await log.store.getAnalysis(draft.analysis))?.draft).toBe(true);
		expect(
			AnalysisHistorySaveInputSchema.safeParse(withoutQuestion).error?.issues[0]
				?.message,
		).toBe("required: the question this answer addresses, as a short title");

		await saveAnalysis(log, leadViewer, {
			...saveInput(draft.analysis),
			question: "Where our agents get stuck",
		});
		const tree = await getAnalysisTree(log, leadViewer, draft.analysis);
		expect(tree.question).toBe("Where our agents get stuck");
		expect(
			(
				await searchAnalyses(log, leadViewer, {
					text: "Where our agents get stuck",
					limit: 5,
					includeEval: false,
				})
			).analyses[0],
		).toMatchObject({
			id: draft.analysis,
			match: { kind: "question", text: "Where our agents get stuck" },
		});
	});

	test("a revision's changes must cover every finding saved with it exactly once, or nothing is saved", async () => {
		const log = createLog();
		const prior = await recordQuery(log, lead, call({}));
		const lint = await recordQuery(
			log,
			lead,
			call({ analysis: prior.analysis }, "find", { source: "tool" }),
		);
		await saveAnalysis(log, leadViewer, {
			...saveInput(prior.analysis),
			question: "Why do agents fail?",
			finalAnswer: "Stale patches and lint loops.",
			findings: [
				{ step: prior.step, finding: "11 stale patches" },
				{ step: lint.step, finding: "5 lint loops" },
			],
		});
		const draft = await recordQuery(log, lead, call({}));
		const timeouts = await recordQuery(
			log,
			lead,
			call({ analysis: draft.analysis }, "find", { source: "tool" }),
		);
		const before = await stored(log, draft.analysis);
		const save = (changes: AnalysisHistorySaveInput["changes"]) =>
			saveAnalysis(log, leadViewer, {
				...saveInput(draft.analysis),
				question: "Why do agents fail?",
				finalAnswer: "Fewer stale patches; timeouts are new.",
				findings: [
					{ step: draft.step, finding: "4 stale patches" },
					{ step: timeouts.query, finding: "3 timeouts" },
				],
				updates: prior.analysis,
				changes,
			});
		const weakened = {
			step: draft.query,
			change: "weakened" as const,
			evidence: "4, was 11",
		};

		await expect(save([weakened])).rejects.toThrow(
			`no change for the finding of ${timeouts.step} ("find source=tool")`,
		);
		await expect(
			save([
				weakened,
				{ ...weakened, step: draft.step },
				{ step: timeouts.step, change: "new", evidence: "3 runs" },
			]),
		).rejects.toThrow(`more than one change for ${draft.step}`);
		await expect(
			save([
				weakened,
				{ step: timeouts.step, change: "new", evidence: "3 runs" },
				{ step: lint.query, change: "weakened", evidence: "none" },
			]),
		).rejects.toThrow(
			`nor a step of ${prior.analysis} (allowed only with change=dropped), for "${lint.step}"`,
		);
		expect(await stored(log, draft.analysis)).toEqual(before);

		await save([
			weakened,
			{ step: timeouts.step, change: "new", evidence: "3 runs" },
			{ step: lint.query, change: "dropped", evidence: "none since" },
		]);
		expect(
			(await getAnalysisTree(log, leadViewer, draft.analysis)).changes,
		).toEqual([
			{ ...weakened, step: draft.step, finding: "4 stale patches" },
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

	test("the revision chain: search finds a saved answer, a new draft gathers evidence from its last day, and saving it with updates links both; the earlier answer and its evidence stay as they were", async () => {
		const clock = { now: Date.parse("2026-09-01T09:00:00Z") };
		const log = createLog(clock);
		// A: the earlier answer.
		const a = await recordQuery(
			log,
			lead,
			call({}, "find", { source: "tool" }, ["lead"]),
		);
		await saveAnalysis(log, leadViewer, {
			...saveInput(a.analysis),
			question: "Why do agents fail?",
			finalAnswer: "Mostly stale patches.",
			findings: [{ step: a.step, finding: "11 stale patches" }],
			topics: ["failures"],
		});
		const priorTree = await getAnalysisTree(log, leadViewer, a.analysis);
		const priorResult = await getStoredQuery(log, leadViewer, a.query, current);

		// A month later: search finds A; B looks only after A's last day.
		clock.now = Date.parse("2026-10-01T09:00:00Z");
		const found = await searchAnalyses(log, leadViewer, {
			text: "Why do agents fail?",
			limit: 5,
			includeEval: false,
		});
		expect(found.analyses[0]?.id).toBe(a.analysis);
		const from = priorTree.cutoff.slice(0, 10);
		const b = await recordQuery(
			log,
			lead,
			call({}, "find", { source: "tool", from }, ["lead"]),
		);
		await recordQuery(
			log,
			lead,
			call({ analysis: b.analysis }, "read", {}, ["lead"]),
		);
		await saveAnalysis(log, leadViewer, {
			...saveInput(b.analysis),
			question: "Why do agents fail?",
			finalAnswer: "Still stale patches, fewer of them.",
			findings: [
				{ step: b.query, finding: "4 stale patches since 2026-09-01" },
			],
			topics: ["failures"],
			updates: a.analysis,
			changes: [
				{
					step: b.query,
					change: "weakened",
					evidence: "4 since 2026-09-01, 11 before",
				},
			],
		});

		const posterior = await getAnalysisTree(log, leadViewer, b.analysis);
		expect(posterior.updates).toBe(a.analysis);
		expect(posterior.question).toBe("Why do agents fail?");
		expect(posterior.steps[0]?.question).toBe(
			"find source=tool from=2026-09-01",
		);
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
				...saveInput(a.analysis),
				finalAnswer: "Overwritten",
			}),
		).rejects.toThrow(
			`This analysis is already saved. To revise it, save a new analysis that passes updates=${a.analysis}.`,
		);
		// A saved answer takes no more calls; a revision starts a new draft.
		await expect(
			recordQuery(log, lead, call({ analysis: a.analysis })),
		).rejects.toThrow(
			`leave out analysis to start a new draft, then save that draft with updates=${a.analysis}`,
		);
	});
});

describe("search and visibility", () => {
	test("search finds a saved answer by its question and hides others' private and eval analyses", async () => {
		const log = createLog();
		const mine = await recordQuery(log, lead, call({}));
		const private_ = await recordQuery(
			log,
			{ ...lead, userId: "member" },
			call({}),
		);
		const evaluation = await recordQuery(
			log,
			{ ...lead, host: "eval" },
			call({}),
		);
		await publish(log, mine.analysis, leadViewer, "Why is the team annoyed?");
		await publish(
			log,
			private_.analysis,
			memberViewer,
			"Private negative reactions",
		);
		await publish(log, evaluation.analysis, leadViewer, "Eval reactions");

		const found = await searchAnalyses(log, leadViewer, {
			text: "Why is the team annoyed",
			limit: 5,
			includeEval: false,
		});
		expect(found.analyses[0]?.id).toBe(mine.analysis);
		expect(found.analyses[0]?.match).toEqual({
			kind: "question",
			step: null,
			text: "Why is the team annoyed?",
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
			call({}, "read", {}, ["lead", "member", "other"]),
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
			...call({}, "find", { source: "tool" }),
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
			...call({ analysis: examples.analysis }),
			owners: ["member", "bob"],
		});
		const memberOnly = await recordQuery(
			log,
			lead,
			call({ analysis: examples.analysis }, "read", {}, ["member"]),
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
		const trace = await recordQuery(log, lead, call({}, "find", {}, ["lead"]));
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
		const theirs = await recordQuery(log, leaving, call({}));
		const team = await recordQuery(
			log,
			lead,
			call({}, "read", {}, ["lead", "member"]),
		);
		const leadOnly = await recordQuery(
			log,
			lead,
			call({}, "read", {}, ["lead"]),
		);
		await publish(log, leadOnly.analysis, leadViewer, "Lead only");

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
			question: "Saved question",
			finalAnswer: "Busiest in late September.",
			findings: [],
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
			call({}),
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
		const one = await recordQuery(log, lead, call({}));
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
	question = "Saved question",
) {
	await saveAnalysis(log, viewer, { ...saveInput(analysis), question });
}

function saveInput(analysis: string): AnalysisHistorySaveInput {
	return {
		analysis,
		question: "Saved question",
		finalAnswer: "Answer",
		findings: [],
		topics: [],
		changes: [],
	};
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
