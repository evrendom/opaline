import { afterEach, describe, expect, test } from "bun:test";
import assert from "node:assert";
import { ORPCError } from "@orpc/server";
import {
	analysisAlreadySaved,
	getAnalysisTree,
	getStoredQuery,
	purgeAnalysisLog,
	type RecordedCall,
	recordQuery,
	saveAnalysis,
	searchAnalyses,
	shareAnalysis,
} from "./analysis-log.service.js";
import { createLocalEmbedder } from "./embedder.js";
import { AnalysisFullError, AnalysisSavedError } from "./errors.js";
import { DRAFT_RETENTION_MS } from "./limits.js";
import type {
	AnalysisLog,
	AnalysisStore,
	AnalysisViewer,
	StoredAnalysis,
	StoredQuery,
	StoredStep,
} from "./types.js";

const MODEL = "text-embedding-3-small";

/** Behavior every `AnalysisStore` shares; run against memory and Convex. */
export function analysisStoreContract(
	name: string,
	createStore: () => AnalysisStore,
) {
	describe(`${name} analysis store contract`, () => {
		const fixtures: ReturnType<typeof fixture>[] = [];
		const setup = () => {
			const context = fixture(createStore());
			fixtures.push(context);
			return context;
		};
		afterEach(async () => {
			for (const context of fixtures.splice(0)) {
				await context.store.deleteAnalysesByWorkspace(context.workspaceId);
				await context.store.deleteAnalysesByWorkspace(context.otherWorkspaceId);
			}
		});

		test("creates, gets and updates records, preserving JSON, and ignores updates of missing records", async () => {
			const { store, analysis, step, query } = setup();
			expect(await store.getAnalysis(analysis.id)).toBeNull();
			expect(await store.getQuery(query.id)).toBeNull();
			await store.updateAnalysis(analysis.id, { question: "Missing" });
			await store.createAnalysis(analysis);
			await store.createStep(step);
			const output = {
				"field.with.dots": [
					null,
					false,
					42,
					{ text: 'ü\n"', large: "x".repeat(90_000) },
				],
			};
			await store.createQuery({ ...query, output });
			expect(await store.getAnalysis(analysis.id)).toEqual({
				...analysis,
				queryCount: 1,
				stepCount: 1,
			});
			expect(await store.getSteps(analysis.id)).toEqual([step]);
			expect(await store.getQuery(query.id)).toEqual({ ...query, output });

			await store.updateAnalysis(analysis.id, {
				status: "finished",
				pinned: true,
				notes: ["note"],
				finalAnswer: "Answer",
			});
			expect(await store.getAnalysis(analysis.id)).toEqual({
				...analysis,
				status: "finished",
				pinned: true,
				notes: ["note"],
				finalAnswer: "Answer",
				queryCount: 1,
				stepCount: 1,
			});
		});

		test("a save writes findings, clarifications and the analysis together, and refuses repeated or foreign steps", async () => {
			const { store, analysis, step } = setup();
			await store.createAnalysis(analysis);
			await store.createStep(step);
			const clarification = {
				...step,
				id: `${step.id}_clarification`,
				ordinal: 0.5,
				question: "Two or four weeks?",
				reply: "Four",
			};
			for (const clarifications of [
				[clarification, clarification],
				[{ ...clarification, parentId: "s_foreign" }],
			])
				await expect(
					store.saveAnalysis(analysis.id, {
						findings: [{ stepId: step.id, finding: "Refused" }],
						clarifications,
						patch: { finalAnswer: "Refused" },
					}),
				).rejects.toThrow();
			expect(await store.getSteps(analysis.id)).toEqual([step]);
			await store.saveAnalysis(analysis.id, {
				findings: [{ stepId: step.id, finding: "Found it" }],
				clarifications: [clarification],
				patch: { status: "finished", finalAnswer: "Answer", topics: ["t"] },
			});
			expect(await store.getSteps(analysis.id)).toEqual([
				clarification,
				{ ...step, finding: "Found it" },
			]);
			expect(await store.getAnalysis(analysis.id)).toEqual({
				...analysis,
				status: "finished",
				finalAnswer: "Answer",
				topics: ["t"],
				stepCount: 2,
			});
		});

		test("a refused save writes nothing", async () => {
			const { store, analysis, step } = setup();
			await store.createAnalysis(analysis);
			await store.createStep(step);
			for (let index = 1; index < 199; index++)
				await store.createStep({ ...step, id: `${step.id}_${index}` });
			const clarification = (suffix: string) => ({
				...step,
				id: `${step.id}_${suffix}`,
				question: "More?",
				reply: "Yes",
			});
			const save = (clarifications: StoredStep[], stepId = step.id) =>
				store.saveAnalysis(analysis.id, {
					findings: [{ stepId, finding: "written by a refused save" }],
					clarifications,
					patch: { status: "finished", finalAnswer: "Refused" },
				});

			await expect(
				save([clarification("a"), clarification("b")]),
			).rejects.toBeInstanceOf(AnalysisFullError);
			await expect(save([], "s_foreign")).rejects.toThrow();
			await expect(save([clarification("a"), step])).rejects.toThrow();

			expect(await store.getAnalysis(analysis.id)).toMatchObject({
				status: "unfinished",
				finalAnswer: null,
				stepCount: 199,
			});
			const steps = await store.getSteps(analysis.id);
			expect(steps).toHaveLength(199);
			expect(steps.some((value) => value.finding !== null)).toBe(false);
		});

		test("creating an existing id fails and keeps the stored record", async () => {
			const { store, analysis, step, query } = setup();
			await store.createAnalysis(analysis);
			await store.createStep(step);
			await store.createQuery(query);
			await expect(
				store.createAnalysis({ ...analysis, question: "Other" }),
			).rejects.toThrow();
			await expect(
				store.createStep({ ...step, question: "Other" }),
			).rejects.toThrow();
			await expect(
				store.createQuery({ ...query, output: null }),
			).rejects.toThrow();
			expect(await store.getAnalysis(analysis.id)).toEqual({
				...analysis,
				queryCount: 1,
				stepCount: 1,
			});
			expect(await store.getSteps(analysis.id)).toEqual([step]);
			expect(await store.getQuery(query.id)).toEqual(query);
		});

		test("a query counts toward its analysis and advances its cutoff, never back", async () => {
			const { store, analysis, step, query } = setup();
			await store.createAnalysis(analysis);
			await store.createStep(step);
			const later = "2026-10-03T12:00:00.000Z";
			await store.createQuery({ ...query, createdAt: later });
			expect((await store.getAnalysis(analysis.id))?.cutoff).toBe(later);
			await store.createQuery({
				...query,
				id: `${query.id}_earlier`,
				createdAt: "2026-10-03T11:00:00.000Z",
			});
			expect(await store.getAnalysis(analysis.id)).toMatchObject({
				cutoff: later,
				queryCount: 2,
			});
		});

		test("an analysis refuses its 201st query and step atomically, even when two arrive together", async () => {
			const { store, analysis, step, query } = setup();
			await store.createAnalysis(analysis);
			await store.createStep(step);
			for (let index = 1; index < 199; index++)
				await store.createStep({ ...step, id: `${step.id}_${index}` });
			for (let index = 0; index < 199; index++)
				await store.createQuery({ ...query, id: `${query.id}_${index}` });

			const steps = await Promise.allSettled([
				store.createStep({ ...step, id: `${step.id}_a` }),
				store.createStep({ ...step, id: `${step.id}_b` }),
			]);
			const queries = await Promise.allSettled([
				store.createQuery({ ...query, id: `${query.id}_a` }),
				store.createQuery({ ...query, id: `${query.id}_b` }),
			]);
			for (const results of [steps, queries]) {
				expect(
					results.filter((result) => result.status === "fulfilled"),
				).toHaveLength(1);
				const refused = results.find((result) => result.status === "rejected");
				expect(refused?.status === "rejected" && refused.reason).toBeInstanceOf(
					AnalysisFullError,
				);
			}
			expect(await store.getAnalysis(analysis.id)).toMatchObject({
				queryCount: 200,
				stepCount: 200,
			});
			expect(await store.getSteps(analysis.id)).toHaveLength(200);
			expect(await store.getQueries(analysis.id)).toHaveLength(200);
		});

		test("a query's sessions are kept once each, in session order, and summarized in listings", async () => {
			const { store, analysis, step, query, ownerId, otherOwnerId } = setup();
			await store.createAnalysis(analysis);
			await store.createStep(step);
			const [first, second] = query.sessions;
			assert(first && second);
			await store.createQuery({ ...query, sessions: [second, first, first] });
			const third = { ...sessionOf(otherOwnerId), sessionId: "session_three" };
			const mixed = {
				...query,
				id: `${query.id}_mixed`,
				sessions: [third, first],
			};
			await store.createQuery(mixed);
			await store.createQuery({
				...query,
				id: `${query.id}_none`,
				sessions: [],
			});

			expect((await store.getQuery(query.id))?.sessions).toEqual([
				first,
				second,
			]);
			expect((await store.getQuery(mixed.id))?.sessions).toEqual([
				first,
				third,
			]);
			expect(
				(await store.getQueries(analysis.id)).map((value) => [
					value.id,
					value.ownerCount,
					value.onlyOwnerId,
				]),
			).toEqual([
				[query.id, 1, ownerId],
				[mixed.id, 2, null],
				[`${query.id}_none`, 1, ownerId],
			]);
		});

		test("a query's owners are every member it read, named in its result or not, and summarized in listings", async () => {
			const { store, analysis, step, query, ownerId, otherOwnerId } = setup();
			await store.createAnalysis(analysis);
			await store.createStep(step);
			// The result keeps only `ownerId`'s sessions, but the query also read `otherOwnerId`'s.
			const examples = { ...query, owners: [ownerId, otherOwnerId] };
			const grouped = {
				...query,
				id: `${query.id}_grouped`,
				sessions: [],
				owners: [otherOwnerId],
			};
			const empty = {
				...query,
				id: `${query.id}_empty`,
				sessions: [],
				owners: [],
			};
			await store.createQuery(examples);
			await store.createQuery(grouped);
			await store.createQuery(empty);

			expect((await store.getQuery(examples.id))?.owners).toEqual(
				[ownerId, otherOwnerId].sort(),
			);
			expect((await store.getQuery(grouped.id))?.owners).toEqual([
				otherOwnerId,
			]);
			expect(
				(await store.getQueries(analysis.id)).map((value) => [
					value.id,
					value.ownerCount,
					value.onlyOwnerId,
				]),
			).toEqual([
				[examples.id, 2, null],
				[grouped.id, 1, otherOwnerId],
				[empty.id, 0, null],
			]);
		});

		test("recent analyses includes only the viewer's own and shared workspace analyses, newest first", async () => {
			const { store, analysis, otherWorkspaceId, otherAuthorId } = setup();
			const own = { ...analysis, cutoff: "2026-10-03T10:00:00.000Z" };
			const ownShared = {
				...analysis,
				id: `${analysis.id}_own_shared`,
				shared: true,
				cutoff: "2026-10-03T09:00:00.000Z",
			};
			const shared = {
				...analysis,
				id: `${analysis.id}_shared`,
				authorId: otherAuthorId,
				shared: true,
				cutoff: "2026-10-03T11:00:00.000Z",
			};
			await store.createAnalysis(own);
			await store.createAnalysis(ownShared);
			await store.createAnalysis(shared);
			await store.createAnalysis({
				...shared,
				id: `${analysis.id}_private`,
				shared: false,
				cutoff: "2026-10-03T12:00:00.000Z",
			});
			await store.createAnalysis({
				...shared,
				id: `${analysis.id}_other`,
				workspaceId: otherWorkspaceId,
				cutoff: "2026-10-03T13:00:00.000Z",
			});
			expect(
				await store.recentAnalyses(analysis.workspaceId, analysis.authorId, 10),
			).toEqual([shared, own, ownShared]);
			expect(
				await store.recentAnalyses(analysis.workspaceId, analysis.authorId, 1),
			).toEqual([shared]);
			expect(
				await store.recentAnalyses(analysis.workspaceId, analysis.authorId, 0),
			).toEqual([]);
		});

		test("steps use ordinal order; queries are listed in creation order without results", async () => {
			const { store, analysis, step, query, ownerId } = setup();
			await store.createAnalysis(analysis);
			await store.createStep(step);
			const earlier = { ...step, id: `${step.id}_earlier`, ordinal: 0.5 };
			await store.createStep(earlier);
			const later = { ...query, createdAt: "2026-10-03T11:00:00.000Z" };
			const first = {
				...query,
				id: `${query.id}_earlier`,
				output: null,
				createdAt: "2026-10-03T10:00:00.000Z",
			};
			await store.createQuery(later);
			await store.createQuery(first);
			expect(
				(await store.getSteps(analysis.id)).map((value) => value.id),
			).toEqual([earlier.id, step.id]);
			expect(await store.getQueries(analysis.id)).toEqual([
				summary(first, false, ownerId),
				summary(later, true, ownerId),
			]);
			expect(await store.getSteps("a_missing")).toEqual([]);
			expect(await store.getQueries("a_missing")).toEqual([]);
		});

		test("deleting what quoted an owner's runs removes those analyses in any workspace, keeps the rest and repeats", async () => {
			const {
				store,
				analysis,
				step,
				query,
				otherWorkspaceId,
				otherAuthorId,
				ownerId,
				otherOwnerId,
			} = setup();
			const third = { ...sessionOf(otherOwnerId), sessionId: "session_three" };
			const inWorkspace = async (
				id: string,
				workspaceId: string,
				authorId: string,
				sessions: StoredQuery["sessions"],
			) => {
				await store.createAnalysis({ ...analysis, id, workspaceId, authorId });
				await store.createStep({ ...step, id: `${id}_step`, analysisId: id });
				await store.createQuery({
					...query,
					id: `${id}_query`,
					analysisId: id,
					stepId: `${id}_step`,
					workspaceId,
					authorId,
					sessions,
					owners: [...new Set(sessions.map((session) => session.ownerId))],
				});
				await store.addEmbedding(workspaceId, {
					analysisId: id,
					stepId: null,
					kind: "question",
					text: analysis.question,
					model: MODEL,
					vector: vector(1, 0),
				});
			};
			const read = `${analysis.id}_read`;
			const otherRead = `${analysis.id}_other_read`;
			const unrelated = `${analysis.id}_unrelated`;
			await inWorkspace(read, analysis.workspaceId, analysis.authorId, [
				sessionOf(ownerId),
			]);
			await inWorkspace(otherRead, otherWorkspaceId, otherAuthorId, [
				third,
				sessionOf(ownerId),
			]);
			await inWorkspace(unrelated, analysis.workspaceId, otherAuthorId, [
				third,
			]);

			await store.removeOwnerEvidence(ownerId);
			await store.removeOwnerEvidence(ownerId);
			for (const id of [read, otherRead]) {
				expect(await store.getAnalysis(id)).toBeNull();
				expect(await store.getSteps(id)).toEqual([]);
				expect(await store.getQueries(id)).toEqual([]);
				expect(await store.getQuery(`${id}_query`)).toBeNull();
			}
			expect(
				await store.searchEmbeddings(otherWorkspaceId, MODEL, vector(1, 0), 10),
			).toEqual([]);
			expect((await store.getAnalysis(unrelated))?.queryCount).toBe(1);
			expect((await store.getQuery(`${unrelated}_query`))?.sessions).toEqual([
				third,
			]);
			expect(
				(
					await store.searchEmbeddings(
						analysis.workspaceId,
						MODEL,
						vector(1, 0),
						10,
					)
				).map((match) => match.analysisId),
			).toEqual([unrelated]);
			await store.removeOwnerEvidence(`${ownerId}_missing`);
		});

		test("a deleted analysis is hidden and refuses further writes", async () => {
			const { store, analysis, step, query, ownerId } = setup();
			await store.createAnalysis(analysis);
			await store.createStep(step);
			await store.createQuery(query);
			await store.removeOwnerEvidence(ownerId);

			expect(await store.getAnalysis(analysis.id)).toBeNull();
			expect(
				await store.recentAnalyses(analysis.workspaceId, analysis.authorId, 10),
			).toEqual([]);
			await expect(
				store.createStep({ ...step, id: `${step.id}_late` }),
			).rejects.toThrow();
			await expect(
				store.createQuery({ ...query, id: `${query.id}_late` }),
			).rejects.toThrow();
			await expect(
				store.saveAnalysis(analysis.id, {
					findings: [],
					clarifications: [],
					patch: { finalAnswer: "Late" },
				}),
			).rejects.toThrow();
			await store.updateAnalysis(analysis.id, { finalAnswer: "Late" });
			expect(await store.getAnalysis(analysis.id)).toBeNull();
		});

		test("near-limit results and many links are deleted completely in bounded batches", async () => {
			const { store, analysis, step, query, ownerId } = setup();
			// Forty results of ~250 KB (three-byte characters) are ~10 MB: more
			// than half a Convex transaction, so deletion takes several calls.
			const output = { text: "错".repeat(83_000) };
			const fill = async (analysisId: string, stepId: string) => {
				await store.createAnalysis({ ...analysis, id: analysisId });
				await store.createStep({ ...step, id: stepId, analysisId });
				for (let index = 0; index < 40; index++)
					await store.createQuery({
						...query,
						id: `${analysisId}_q${index}`,
						analysisId,
						stepId,
						output,
						sessions: Array.from({ length: index ? 1 : 300 }, (_, session) => ({
							...sessionOf(ownerId),
							sessionId: `${analysisId}_s${index}_${session}`,
						})),
					});
			};
			await fill(analysis.id, step.id);
			await store.removeOwnerEvidence(ownerId);
			expect(await store.getAnalysis(analysis.id)).toBeNull();
			expect(await store.getQueries(analysis.id)).toEqual([]);
			expect(await store.getQuery(`${analysis.id}_q39`)).toBeNull();

			const fresh = `${analysis.id}_fresh`;
			await fill(fresh, `${step.id}_fresh`);
			await store.deleteAnalysesByAuthor(analysis.authorId);
			expect(await store.getAnalysis(fresh)).toBeNull();
			expect(await store.getQueries(fresh)).toEqual([]);
			expect(await store.getQuery(`${fresh}_q39`)).toBeNull();
		});

		test("an account purge deletes analyses that read its sessions, and its follow-up those recorded meanwhile", async () => {
			const { store, workspaceId, ownerId, otherAuthorId } = setup();
			const log = {
				store,
				embedder: createLocalEmbedder(),
				now: () => new Date("2026-10-03T10:00:00.000Z"),
			};
			const author = {
				workspaceId,
				userId: otherAuthorId,
				host: "plugin" as const,
			};
			const record = (_label: string) =>
				recordQuery(log, author, {
					tool: "read",
					args: {},
					trace: {},
					output: { ok: true },
					outputChars: 11,
					sessions: [sessionOf(ownerId)],
					owners: [ownerId],
				});
			const account = { targetType: "account" as const, targetId: ownerId };
			const first = await record("Before the purge");

			await purgeAnalysisLog(store, account, AbortSignal.timeout(60_000));
			expect(await store.getAnalysis(first.analysis)).toBeNull();
			// A capture that was in flight lands after the first pass.
			const late = await record("During the purge");
			await purgeAnalysisLog(store, account, AbortSignal.timeout(60_000));
			expect(await store.getAnalysis(late.analysis)).toBeNull();
		});

		describe("deleting a member", () => {
			const purgeOwner = async (store: AnalysisStore, ownerId: string) => {
				const account = { targetType: "account" as const, targetId: ownerId };
				await purgeAnalysisLog(store, account, AbortSignal.timeout(60_000));
				await purgeAnalysisLog(store, account, AbortSignal.timeout(60_000));
			};
			const context = () => {
				const fixed = setup();
				const log = {
					store: fixed.store,
					embedder: createLocalEmbedder(),
					now: () => new Date("2026-10-03T10:00:00.000Z"),
				};
				const author = authorOf(fixed.workspaceId, fixed.otherAuthorId);
				const viewer = viewerOf(fixed.workspaceId, fixed.otherAuthorId);
				const record = (call: Omit<RecordedCall, "trace" | "outputChars">) =>
					recordQuery(log, author, { ...call, trace: {}, outputChars: 100 });
				const save = (
					analysis: string,
					findings: { step: string; finding: string }[] = [],
				) =>
					saveAnalysis(log, viewer, {
						analysis,
						question: "Where did the team lose time?",
						finalAnswer: "In long test runs.",
						findings,
						topics: [],
						changes: [],
					});
				return { ...fixed, log, viewer, record, save };
			};
			const run = (sessionId: string, turn: number) => ({
				sessionId,
				agentId: "",
				turn,
			});

			test("deletes every analysis whose results returned text from their sessions, by any tool, and keeps one that only counted them, with that result removed", async () => {
				const { store, log, viewer, record, save, ownerId, otherOwnerId } =
					context();
				const theirs = sessionOf(ownerId);
				const quoting = [
					await record({
						tool: "read",
						args: { refs: [run(theirs.sessionId, 1)] },
						output: {
							reads: [{ ref: run(theirs.sessionId, 1), header: "a prompt" }],
						},
						sessions: [theirs],
						owners: [ownerId],
					}),
					// find quotes too: a reaction's excerpt, a run's prompt head.
					await record({
						tool: "find",
						args: { source: "user" },
						output: {
							source: "user",
							header: { notes: [] },
							events: [
								{
									type: "negative",
									eventRef: { ...run(theirs.sessionId, 2), record: 4 },
									quote: "no, revert the private fix",
								},
							],
							groups: [],
						},
						sessions: [theirs],
						owners: [ownerId, otherOwnerId],
					}),
					await record({
						tool: "find",
						args: { source: "runs" },
						output: {
							source: "runs",
							header: { notes: [] },
							rows: [
								{
									ref: run(theirs.sessionId, 3),
									model: "a-model",
									promptHead: "ship the private fix",
									minutes: 3,
								},
							],
						},
						sessions: [theirs],
						owners: [ownerId, otherOwnerId],
					}),
					// The sql gateway found transcript text in the rows it showed.
					await record({
						tool: "sql",
						args: { query: "SELECT prompt_head FROM runs", title: "Prompts" },
						output: { table: "prompt_head\nship the private fix" },
						quotes: true,
						sessions: [],
						owners: [ownerId, otherOwnerId],
					}),
				];
				const counting = [
					await record({
						tool: "find",
						args: { source: "weekly", groupBy: "member" },
						output: {
							source: "weekly",
							header: { notes: ["Totals are whole weeks."] },
							snapshot: { id: "snap", refreshedAt: "2026-10-02" },
							totals: [{ week: null, member: ownerId, agent: null, runs: 12 }],
						},
						sessions: [],
						owners: [ownerId, otherOwnerId],
					}),
					await record({
						tool: "sql",
						args: {
							query: "SELECT user_id, count() FROM runs GROUP BY user_id",
							title: "Runs per member",
						},
						output: { table: "user_id | count()" },
						quotes: false,
						sessions: [],
						owners: [ownerId, otherOwnerId],
					}),
				];
				for (const trace of [...quoting, ...counting])
					await save(trace.analysis);

				await purgeOwner(store, ownerId);

				for (const trace of quoting) {
					expect(await store.getAnalysis(trace.analysis)).toBeNull();
					expect(await store.getQuery(trace.query)).toBeNull();
				}
				for (const trace of counting) {
					const kept = await getAnalysisTree(log, viewer, trace.analysis);
					expect(kept.steps.flatMap((step) => step.queries)).toMatchObject([
						{ id: trace.query, unavailable: "removed" },
					]);
					expect(await store.getQuery(trace.query)).toMatchObject({
						output: null,
						removed: true,
						owners: [otherOwnerId],
					});
				}
				expect(
					await getStoredQuery(
						log,
						viewer,
						counting[1]?.query ?? "",
						currentGenerations,
					),
				).toMatchObject({
					unavailable: "removed",
					call: {
						tool: "sql",
						args: {
							query: "SELECT user_id, count() FROM runs GROUP BY user_id",
							title: "Runs per member",
						},
						output: null,
					},
				});
			});

			test("a counted result whose arguments carry text that may come from their sessions loses those arguments with the result", async () => {
				const { store, log, viewer, record, save, ownerId, otherOwnerId } =
					context();
				const counted = await record({
					tool: "sql",
					args: {
						query:
							"SELECT count() FROM runs WHERE prompt_head = 'ship the private fix'",
						title: "Runs of one prompt",
					},
					output: { table: "count()\n3" },
					quotes: false,
					sessions: [],
					owners: [ownerId, otherOwnerId],
				});
				const filtered = await record({
					tool: "find",
					args: {
						source: "calls",
						groupBy: "commandFingerprint",
						commandPrefix: "deploy private-host",
					},
					output: {
						source: "calls",
						header: { notes: [] },
						groups: [],
					},
					sessions: [],
					owners: [ownerId, otherOwnerId],
				});
				await save(counted.analysis);
				await save(filtered.analysis);

				await purgeOwner(store, ownerId);

				expect(await store.getQuery(counted.query)).toMatchObject({
					args: { title: "Runs of one prompt" },
					output: null,
					removed: true,
				});
				expect((await store.getQuery(counted.query))?.args).not.toHaveProperty(
					"query",
				);
				const tree = await getAnalysisTree(log, viewer, filtered.analysis);
				expect(tree.steps).toMatchObject([
					{
						question: "find source=calls groupBy=commandFingerprint",
						queries: [
							{
								args: { source: "calls", groupBy: "commandFingerprint" },
								unavailable: "removed",
							},
						],
					},
				]);
				expect(JSON.stringify(tree)).not.toContain("private-host");
			});

			test("deletes an analysis whose finding cites one of their runs, even where its result only counted", async () => {
				const { store, record, save, ownerId, otherOwnerId } = context();
				const theirs = sessionOf(ownerId);
				const cited = await record({
					tool: "sql",
					args: {
						query:
							"SELECT session_id, agent_id, turn_idx, active_minutes FROM runs",
						title: "Longest runs",
					},
					output: { runs: [run(theirs.sessionId, 5)] },
					quotes: false,
					sessions: [theirs],
					owners: [ownerId, otherOwnerId],
				});
				await save(cited.analysis, [
					{ step: cited.step, finding: "The longest runs waited on CI." },
				]);

				await purgeOwner(store, ownerId);

				expect(await store.getAnalysis(cited.analysis)).toBeNull();
			});
		});

		test("author deletion cascades past a batch, crosses workspaces, preserves other authors and is idempotent", async () => {
			const {
				store,
				analysis,
				step,
				query,
				otherWorkspaceId,
				otherAuthorId,
				ownerId,
			} = setup();
			await store.createAnalysis(analysis);
			for (let index = 0; index < 40; index++) {
				const childStep = {
					...step,
					id: `${step.id}_${index}`,
					ordinal: index,
				};
				await store.createStep(childStep);
				await store.createQuery({
					...query,
					id: `${query.id}_${index}`,
					stepId: childStep.id,
				});
				await store.addEmbedding(analysis.workspaceId, {
					analysisId: analysis.id,
					stepId: childStep.id,
					kind: "step",
					text: childStep.question,
					model: MODEL,
					vector: vector(1, 0),
				});
			}
			const other = {
				...analysis,
				id: `${analysis.id}_other`,
				workspaceId: otherWorkspaceId,
			};
			const keeper = {
				...analysis,
				id: `${analysis.id}_keep`,
				authorId: otherAuthorId,
			};
			await store.createAnalysis(other);
			await store.createAnalysis(keeper);
			await store.deleteAnalysesByAuthor(analysis.authorId);
			await store.deleteAnalysesByAuthor(analysis.authorId);
			expect(await store.getAnalysis(analysis.id)).toBeNull();
			expect(await store.getAnalysis(other.id)).toBeNull();
			expect(await store.getAnalysis(keeper.id)).toEqual(keeper);
			expect(await store.getSteps(analysis.id)).toEqual([]);
			expect(await store.getQueries(analysis.id)).toEqual([]);
			expect(await store.getQuery(`${query.id}_39`)).toBeNull();
			expect(
				await store.searchEmbeddings(
					analysis.workspaceId,
					MODEL,
					vector(1, 0),
					10,
				),
			).toEqual([]);
		});

		test("workspace deletion cascades, preserves other workspaces and is idempotent", async () => {
			const {
				store,
				analysis,
				step,
				query,
				otherWorkspaceId,
				otherAuthorId,
				ownerId,
			} = setup();
			await store.createAnalysis(analysis);
			await store.createStep(step);
			await store.createQuery(query);
			await store.addEmbedding(analysis.workspaceId, {
				analysisId: analysis.id,
				stepId: null,
				kind: "question",
				text: analysis.question,
				model: MODEL,
				vector: vector(1, 0),
			});
			await store.createAnalysis({
				...analysis,
				id: `${analysis.id}_author`,
				authorId: otherAuthorId,
			});
			const keeper = {
				...analysis,
				id: `${analysis.id}_keep`,
				workspaceId: otherWorkspaceId,
			};
			await store.createAnalysis(keeper);
			await store.deleteAnalysesByWorkspace(analysis.workspaceId);
			await store.deleteAnalysesByWorkspace(analysis.workspaceId);
			expect(await store.getAnalysis(analysis.id)).toBeNull();
			expect(await store.getAnalysis(`${analysis.id}_author`)).toBeNull();
			expect(await store.getAnalysis(keeper.id)).toEqual(keeper);
			expect(await store.getSteps(analysis.id)).toEqual([]);
			expect(await store.getQueries(analysis.id)).toEqual([]);
			expect(await store.getQuery(query.id)).toBeNull();
			expect(
				await store.searchEmbeddings(
					analysis.workspaceId,
					MODEL,
					vector(1, 0),
					10,
				),
			).toEqual([]);
		});

		test("chat links are kept once per analysis, source and session, oldest upload first, and a repeat moves its upload time", async () => {
			const { store, analysis, ownerId, otherOwnerId } = setup();
			await store.createAnalysis(analysis);
			const chat = (
				sessionId: string,
				source: "claude_code" | "codex",
				uploadedAt: string,
				owner = ownerId,
			) => ({
				analysisId: analysis.id,
				sessionId,
				source,
				ownerId: owner,
				uploadedAt,
			});
			await store.linkSession(
				chat("thread-b", "codex", "2026-10-03T10:02:00Z"),
			);
			await store.linkSession(
				chat("thread-a", "codex", "2026-10-03T10:01:00Z"),
			);
			await store.linkSession(
				chat("thread-a", "claude_code", "2026-10-03T10:01:00Z", otherOwnerId),
			);
			expect(await store.getSessionLinks(analysis.id)).toEqual([
				chat("thread-a", "claude_code", "2026-10-03T10:01:00Z", otherOwnerId),
				chat("thread-a", "codex", "2026-10-03T10:01:00Z"),
				chat("thread-b", "codex", "2026-10-03T10:02:00Z"),
			]);
			await store.linkSession(
				chat("thread-a", "codex", "2026-10-03T10:05:00Z"),
			);
			expect(await store.getSessionLinks(analysis.id)).toEqual([
				chat("thread-a", "claude_code", "2026-10-03T10:01:00Z", otherOwnerId),
				chat("thread-b", "codex", "2026-10-03T10:02:00Z"),
				chat("thread-a", "codex", "2026-10-03T10:05:00Z"),
			]);
			expect(await store.getSessionLinks("a_missing")).toEqual([]);
			await expect(
				store.linkSession({
					...chat("thread-c", "codex", analysis.cutoff),
					analysisId: "a_missing",
				}),
			).rejects.toThrow();
		});

		test("an analysis refuses its 201st chat link but still refreshes linked ones", async () => {
			const { store, analysis, ownerId } = setup();
			await store.createAnalysis(analysis);
			const chat = (index: number) => ({
				analysisId: analysis.id,
				sessionId: `thread-${index.toString().padStart(3, "0")}`,
				source: "codex" as const,
				ownerId,
				uploadedAt: analysis.cutoff,
			});
			for (let index = 0; index < 200; index++)
				await store.linkSession(chat(index));
			const refused = await store.linkSession(chat(200)).then(
				() => null,
				(error: unknown) => error,
			);
			expect(refused).toBeInstanceOf(AnalysisFullError);
			assert(refused instanceof AnalysisFullError);
			expect(refused.child).toBe("sessions");
			await store.linkSession({
				...chat(0),
				uploadedAt: "2026-10-04T00:00:00Z",
			});
			const links = await store.getSessionLinks(analysis.id);
			expect(links).toHaveLength(200);
			expect(links.at(-1)).toEqual({
				...chat(0),
				uploadedAt: "2026-10-04T00:00:00Z",
			});
		});

		test("purges delete chat links with their analysis; an account purge also removes its chats from others' analyses", async () => {
			const {
				store,
				analysis,
				workspaceId,
				otherAuthorId,
				ownerId,
				otherOwnerId,
			} = setup();
			const kept = {
				...analysis,
				id: `${analysis.id}_kept`,
				authorId: otherAuthorId,
			};
			await store.createAnalysis(analysis);
			await store.createAnalysis(kept);
			const chat = (analysisId: string, owner: string) => ({
				analysisId,
				sessionId: `thread-${owner}`,
				source: "codex" as const,
				ownerId: owner,
				uploadedAt: analysis.cutoff,
			});
			await store.linkSession(chat(analysis.id, ownerId));
			await store.linkSession(chat(kept.id, ownerId));
			await store.linkSession(chat(kept.id, otherOwnerId));

			await purgeAnalysisLog(
				store,
				{ targetType: "account", targetId: ownerId },
				AbortSignal.timeout(60_000),
			);
			await purgeAnalysisLog(
				store,
				{ targetType: "account", targetId: ownerId },
				AbortSignal.timeout(60_000),
			);
			expect(await store.getAnalysis(kept.id)).toEqual(kept);
			expect(await store.getSessionLinks(kept.id)).toEqual([
				chat(kept.id, otherOwnerId),
			]);
			// The account's own chat in an analysis it did not write is gone too.
			expect(await store.getSessionLinks(analysis.id)).toEqual([]);

			await purgeAnalysisLog(
				store,
				{ targetType: "organization", targetId: workspaceId },
				AbortSignal.timeout(60_000),
			);
			expect(await store.getAnalysis(kept.id)).toBeNull();
			expect(await store.getSessionLinks(kept.id)).toEqual([]);
		});

		test("a draft is invisible to search, get, query and sharing, for its author and other members", async () => {
			const { store, workspaceId, otherAuthorId, ownerId, analysis } = setup();
			const log = logOf(store);
			const author = authorOf(workspaceId, analysis.authorId);
			const draft = await recordQuery(log, author, recorded({}, [ownerId]));
			const stored = await store.getAnalysis(draft.analysis);
			expect(stored).toMatchObject({ draft: true, status: "unfinished" });

			for (const viewer of [
				viewerOf(workspaceId, analysis.authorId),
				viewerOf(workspaceId, otherAuthorId, true),
			]) {
				expect(
					(
						await searchAnalyses(log, viewer, {
							text: "Why do drafts stay private?",
							limit: 10,
							includeEval: true,
						})
					).analyses,
				).toEqual([]);
				await expectCode(
					getAnalysisTree(log, viewer, draft.analysis),
					"NOT_FOUND",
				);
				await expectCode(
					getStoredQuery(log, viewer, draft.query, currentGenerations),
					"NOT_FOUND",
				);
			}
			expect(
				await store.recentAnalyses(workspaceId, analysis.authorId, 10),
			).toEqual([]);
			expect(
				await store.searchEmbeddings(
					workspaceId,
					log.embedder.model,
					(await log.embedder.embed(["Why do drafts stay private?"]))[0] ?? [],
					10,
				),
			).toEqual([]);
			await expectCode(
				shareAnalysis(
					log,
					viewerOf(workspaceId, analysis.authorId),
					draft.analysis,
					true,
				),
				"BAD_REQUEST",
			);
			// Another member cannot add to it or save it: to them it does not exist.
			await expectCode(
				recordQuery(
					log,
					authorOf(workspaceId, otherAuthorId),
					recorded({ analysis: draft.analysis }),
				),
				"NOT_FOUND",
			);
			await expectCode(
				saveAnalysis(log, viewerOf(workspaceId, otherAuthorId, true), {
					...emptySave(draft.analysis),
				}),
				"NOT_FOUND",
			);
			expect(await store.getAnalysis(draft.analysis)).toEqual(stored);
		});

		test("saving publishes a draft with its question, answer, findings and topics", async () => {
			const { store, workspaceId, analysis, ownerId } = setup();
			const log = logOf(store);
			const viewer = viewerOf(workspaceId, analysis.authorId);
			const draft = await recordQuery(
				log,
				authorOf(workspaceId, analysis.authorId),
				recorded({}, [ownerId]),
			);
			await saveAnalysis(log, viewer, {
				analysis: draft.analysis,
				question: "Which runs failed?",
				finalAnswer: "Three runs failed.",
				findings: [{ step: draft.step, finding: "three" }],
				topics: ["failures"],
				changes: [],
			});

			expect(await store.getAnalysis(draft.analysis)).toMatchObject({
				draft: false,
				status: "finished",
				question: "Which runs failed?",
				finalAnswer: "Three runs failed.",
				topics: ["failures"],
			});
			const tree = await getAnalysisTree(log, viewer, draft.analysis);
			expect(tree.steps.map((step) => [step.question, step.finding])).toEqual([
				["find source=runs", "three"],
			]);
			const query = await getStoredQuery(
				log,
				viewer,
				draft.query,
				currentGenerations,
			);
			expect(query.call.output as unknown).toEqual({ ok: true });
			expect(
				(
					await searchAnalyses(log, viewer, {
						limit: 10,
						includeEval: false,
					})
				).analyses.map((listed) => listed.id),
			).toEqual([draft.analysis]);
		});

		test("a second save is refused and changes nothing; a saved analysis takes no more calls", async () => {
			const { store, workspaceId, analysis, ownerId } = setup();
			const log = logOf(store);
			const viewer = viewerOf(workspaceId, analysis.authorId);
			const author = authorOf(workspaceId, analysis.authorId);
			const draft = await recordQuery(log, author, recorded({}, [ownerId]));
			await saveAnalysis(log, viewer, {
				...emptySave(draft.analysis),
				finalAnswer: "First answer",
				findings: [{ step: draft.step, finding: "first" }],
			});
			const before = await snapshot(store, draft.analysis, draft.query);

			const refused = await saveAnalysis(log, viewer, {
				...emptySave(draft.analysis),
				finalAnswer: "Second answer",
				findings: [{ step: draft.step, finding: "second" }],
				topics: ["changed"],
			}).catch((error: unknown) => error);
			expect(refused).toBeInstanceOf(ORPCError);
			expect((refused as ORPCError<string, unknown>).message).toBe(
				`This analysis is already saved. To revise it, save a new analysis that passes updates=${draft.analysis}.`,
			);
			expect((refused as ORPCError<string, unknown>).message).toBe(
				analysisAlreadySaved(draft.analysis),
			);
			await expectCode(
				recordQuery(log, author, recorded({ analysis: draft.analysis })),
				"BAD_REQUEST",
			);
			// The store refuses on its own, atomically, whatever the caller checked.
			await expect(
				store.saveAnalysis(draft.analysis, {
					findings: [],
					clarifications: [],
					patch: { finalAnswer: "Overwritten" },
				}),
			).rejects.toBeInstanceOf(AnalysisSavedError);
			await expect(
				store.createStep({
					id: `${draft.step}_late`,
					analysisId: draft.analysis,
					parentId: null,
					ordinal: 9,
					question: "Late",
					reply: null,
					finding: null,
					createdAt: analysis.createdAt,
				}),
			).rejects.toBeInstanceOf(AnalysisSavedError);
			expect(await snapshot(store, draft.analysis, draft.query)).toEqual(
				before,
			);
			// Sharing stays reversible.
			await shareAnalysis(log, viewer, draft.analysis, true);
			await shareAnalysis(log, viewer, draft.analysis, false);
			expect((await store.getAnalysis(draft.analysis))?.shared).toBe(false);
		});

		test("a revision is a new draft saved with updates and its changes; both link ways and the earlier answer stays as it was", async () => {
			const { store, workspaceId, otherAuthorId, analysis, ownerId } = setup();
			const log = logOf(store);
			const viewer = viewerOf(workspaceId, analysis.authorId);
			const author = authorOf(workspaceId, analysis.authorId);
			// A: the prior, saved and shared.
			const a = await recordQuery(log, author, recorded({}, [ownerId]));
			await saveAnalysis(log, viewer, {
				...emptySave(a.analysis),
				finalAnswer: "Stale patches.",
				findings: [{ step: a.step, finding: "stale patches" }],
			});
			await shareAnalysis(log, viewer, a.analysis, true);
			const priorBefore = await snapshot(store, a.analysis, a.query);

			// B: a new draft, saved with updates=A.
			const b = await recordQuery(log, author, recorded({}, [ownerId]));
			expect(await store.getAnalysis(b.analysis)).toMatchObject({
				draft: true,
				updates: null,
				question: "(unsaved answer)",
			});
			await recordQuery(
				log,
				author,
				recorded({ analysis: b.analysis }, [ownerId]),
			);
			await expectCode(
				saveAnalysis(log, viewer, {
					...emptySave(b.analysis),
					updates: a.analysis,
					findings: [{ step: b.step, finding: "fewer stale patches" }],
				}),
				"BAD_REQUEST",
			);
			expect((await store.getAnalysis(b.analysis))?.draft).toBe(true);
			await saveAnalysis(log, viewer, {
				...emptySave(b.analysis),
				question: "Why do agents fail?",
				updates: a.analysis,
				finalAnswer: "Still stale patches, fewer of them.",
				findings: [{ step: b.step, finding: "fewer stale patches" }],
				changes: [
					{
						step: b.query,
						change: "weakened",
						evidence: "4 since the cutoff, was 11",
					},
				],
			});

			const posterior = await getAnalysisTree(log, viewer, b.analysis);
			expect(posterior.updates).toBe(a.analysis);
			expect(posterior.question).toBe("Why do agents fail?");
			expect(posterior.changes).toEqual([
				{
					step: b.step,
					finding: "fewer stale patches",
					change: "weakened",
					evidence: "4 since the cutoff, was 11",
				},
			]);
			expect(posterior.updatedBy).toEqual([]);
			const prior = await getAnalysisTree(log, viewer, a.analysis);
			expect(prior.updatedBy).toEqual([b.analysis]);
			expect(prior.finalAnswer).toBe("Stale patches.");
			expect(await snapshot(store, a.analysis, a.query)).toEqual(priorBefore);
			const evidence = await getStoredQuery(
				log,
				viewer,
				a.query,
				currentGenerations,
			);
			expect(evidence.call.output as unknown).toEqual({ ok: true });
			// A member sees the shared prior, but not the author's private revision.
			const member = viewerOf(workspaceId, otherAuthorId);
			expect(
				(await getAnalysisTree(log, member, a.analysis)).updatedBy,
			).toEqual([]);

			// A dropped change may name the earlier answer's step by its query id.
			const c = await recordQuery(log, author, recorded({}));
			await saveAnalysis(log, viewer, {
				...emptySave(c.analysis),
				updates: a.analysis,
				findings: [{ step: c.step, finding: "two stale patches" }],
				changes: [
					{ step: c.step, change: "confirmed", evidence: "2 this week" },
					{ step: a.query, change: "dropped", evidence: "none left" },
				],
			});
			const third = await getAnalysisTree(log, viewer, c.analysis);
			expect(third.updates).toBe(a.analysis);
			expect(third.changes).toEqual([
				{
					step: c.step,
					finding: "two stale patches",
					change: "confirmed",
					evidence: "2 this week",
				},
				{
					step: a.step,
					finding: "stale patches",
					change: "dropped",
					evidence: "none left",
				},
			]);
			expect(
				(await getAnalysisTree(log, viewer, a.analysis)).updatedBy,
			).toEqual([b.analysis, c.analysis]);
		});

		test("drafts expire after 7 days; saved analyses and newer drafts stay", async () => {
			const { store, analysis, step, query } = setup();
			const now = Date.now();
			const at = (days: number) =>
				new Date(now - days * 86_400_000).toISOString();
			const add = async (suffix: string, fields: Partial<StoredAnalysis>) => {
				const id = `${analysis.id}_${suffix}`;
				await store.createAnalysis({ ...analysis, id, ...fields });
				await store.createStep({ ...step, id: `${id}_step`, analysisId: id });
				await store.createQuery({
					...query,
					id: `${id}_query`,
					analysisId: id,
					stepId: `${id}_step`,
				});
				return id;
			};
			const expired = await add("expired", {
				draft: true,
				createdAt: at(8),
				cutoff: at(8),
			});
			const fresh = await add("fresh", {
				draft: true,
				createdAt: at(6),
				cutoff: at(6),
			});
			const saved = await add("saved", { createdAt: at(30), cutoff: at(30) });
			expect(DRAFT_RETENTION_MS).toBe(7 * 86_400_000);

			await store.expireDrafts();
			await store.expireDrafts();
			expect(await store.getAnalysis(expired)).toBeNull();
			expect(await store.getSteps(expired)).toEqual([]);
			expect(await store.getQuery(`${expired}_query`)).toBeNull();
			expect((await store.getAnalysis(fresh))?.queryCount).toBe(1);
			expect((await store.getAnalysis(saved))?.queryCount).toBe(1);
		});

		test("account and workspace purges delete drafts", async () => {
			const { store, workspaceId, otherWorkspaceId, otherAuthorId, ownerId } =
				setup();
			const log = logOf(store);
			const own = await recordQuery(
				log,
				authorOf(workspaceId, ownerId),
				recorded({}),
			);
			const reading = await recordQuery(
				log,
				authorOf(otherWorkspaceId, otherAuthorId),
				{ ...recorded({}, [ownerId]), tool: "read" },
			);
			const other = await recordQuery(
				log,
				authorOf(workspaceId, otherAuthorId),
				recorded({}),
			);
			await purgeAnalysisLog(
				store,
				{ targetType: "account", targetId: ownerId },
				AbortSignal.timeout(60_000),
			);
			expect(await store.getAnalysis(own.analysis)).toBeNull();
			expect(await store.getAnalysis(reading.analysis)).toBeNull();
			expect(await store.getQuery(reading.query)).toBeNull();
			expect((await store.getAnalysis(other.analysis))?.draft).toBe(true);

			await purgeAnalysisLog(
				store,
				{ targetType: "organization", targetId: workspaceId },
				AbortSignal.timeout(60_000),
			);
			expect(await store.getAnalysis(other.analysis)).toBeNull();
			expect(await store.getQuery(other.query)).toBeNull();
		});

		test("embedding search is workspace- and model-scoped, best first and limited, without vectors", async () => {
			const { store, analysis, step, otherWorkspaceId } = setup();
			await store.createAnalysis(analysis);
			await store.createStep(step);
			const other = {
				...analysis,
				id: `${analysis.id}_other`,
				workspaceId: otherWorkspaceId,
			};
			await store.createAnalysis(other);
			const question = {
				analysisId: analysis.id,
				stepId: null,
				kind: "question" as const,
				text: "Question",
			};
			const subquestion = {
				analysisId: analysis.id,
				stepId: step.id,
				kind: "step" as const,
				text: "Step",
			};
			const topics = {
				analysisId: analysis.id,
				stepId: null,
				kind: "topics" as const,
				text: "Topics",
			};
			await store.addEmbedding(analysis.workspaceId, {
				...topics,
				model: MODEL,
				vector: vector(-1, 0),
			});
			await store.addEmbedding(analysis.workspaceId, {
				...subquestion,
				model: MODEL,
				vector: vector(1, 1),
			});
			await store.addEmbedding(analysis.workspaceId, {
				...question,
				model: MODEL,
				vector: vector(1, 0),
			});
			await store.addEmbedding(analysis.workspaceId, {
				...question,
				text: "Another model's vector",
				model: "local-word-vectors-1",
				vector: vector(1, 0),
			});
			await store.addEmbedding(otherWorkspaceId, {
				...question,
				analysisId: other.id,
				model: MODEL,
				vector: vector(1, 0),
			});
			expect(
				await store.searchEmbeddings(
					analysis.workspaceId,
					MODEL,
					vector(1, 0),
					3,
				),
			).toEqual([question, subquestion, topics]);
			expect(
				await store.searchEmbeddings(
					analysis.workspaceId,
					MODEL,
					vector(1, 0),
					1,
				),
			).toEqual([question]);
			expect(
				await store.searchEmbeddings(
					analysis.workspaceId,
					MODEL,
					vector(1, 0),
					0,
				),
			).toEqual([]);
		});
	});
}

function logOf(store: AnalysisStore): AnalysisLog {
	return { store, embedder: createLocalEmbedder(), now: () => new Date() };
}

function authorOf(workspaceId: string, userId: string) {
	return { workspaceId, userId, host: "plugin" as const };
}

function viewerOf(
	workspaceId: string,
	userId: string,
	isAdmin = false,
): AnalysisViewer {
	return {
		workspaceId,
		userId,
		isAdmin,
		restrictResults: false,
		onlyMember: null,
	};
}

function recorded(
	trace: RecordedCall["trace"],
	owners: string[] = [],
): RecordedCall {
	return {
		tool: "find",
		args: { source: "runs" },
		trace,
		output: { ok: true },
		outputChars: 11,
		sessions: owners.map((ownerId) => ({
			sessionId: `session_${ownerId}`,
			ownerId,
			revision: "1",
			parserVersion: 4,
		})),
		owners,
	};
}

function emptySave(analysis: string) {
	return {
		analysis,
		question: "Saved question",
		finalAnswer: "Answer",
		findings: [],
		clarifications: [],
		topics: [],
		changes: [],
	};
}

/** Everything an analysis holds, as stored. */
async function snapshot(store: AnalysisStore, analysis: string, query: string) {
	return {
		analysis: await store.getAnalysis(analysis),
		steps: await store.getSteps(analysis),
		queries: await store.getQueries(analysis),
		query: await store.getQuery(query),
	};
}

async function currentGenerations(sessions: { sessionId: string }[]) {
	return new Map(
		sessions.map((session) => [
			session.sessionId,
			{ revision: "1", parserVersion: 4 },
		]),
	);
}

async function expectCode(promise: Promise<unknown>, code: string) {
	const error = await promise.then(
		() => null,
		(reason: unknown) => reason,
	);
	expect(error).toBeInstanceOf(ORPCError);
	expect((error as ORPCError<string, unknown>).code).toBe(code);
}

function fixture(store: AnalysisStore) {
	const namespace = crypto.randomUUID();
	const workspaceId = `contract_${namespace}`;
	const otherWorkspaceId = `other_${namespace}`;
	const authorId = `author_${namespace}`;
	const otherAuthorId = `other_author_${namespace}`;
	const ownerId = `owner_${namespace}`;
	const otherOwnerId = `other_owner_${namespace}`;
	const now = "2026-10-03T10:00:00.000Z";
	const analysis: StoredAnalysis = {
		id: `a_${namespace}`,
		workspaceId,
		authorId,
		host: "plugin",
		question: "Why are agents slow?",
		status: "unfinished",
		draft: false,
		shared: false,
		pinned: false,
		createdAt: now,
		cutoff: now,
		scope: { from: null, to: null, filters: {} },
		finalAnswer: null,
		topics: [],
		updates: null,
		changes: [],
		notes: [],
		cost: null,
		queryCount: 0,
		stepCount: 0,
		visibilityRevision: 0,
	};
	const step: StoredStep = {
		id: `s_${namespace}`,
		analysisId: analysis.id,
		parentId: null,
		ordinal: 1,
		question: "Which runs were slow?",
		reply: null,
		finding: null,
		createdAt: now,
	};
	const query: StoredQuery = {
		id: `q_${namespace}`,
		analysisId: analysis.id,
		stepId: step.id,
		workspaceId,
		authorId,
		// Opened the runs it read: account deletion deletes its analysis.
		tool: "read",
		args: { text: "slow", nested: { sources: ["user"] } },
		output: { runs: [1, 2], next: null },
		outputChars: 32,
		sessions: [
			sessionOf(ownerId),
			{ ...sessionOf(ownerId), sessionId: "session_two" },
		],
		owners: [ownerId],
		createdAt: now,
		removed: false,
		counts: false,
		redaction: null,
	};
	return {
		store,
		workspaceId,
		otherWorkspaceId,
		otherAuthorId,
		ownerId,
		otherOwnerId,
		analysis,
		step,
		query,
	};
}

function sessionOf(ownerId: string) {
	return {
		sessionId: "session_one",
		ownerId,
		revision: "revision",
		parserVersion: 1,
	};
}

function summary(
	{ output, sessions, owners, ...query }: StoredQuery,
	hasOutput: boolean,
	onlyOwnerId: string | null,
) {
	return { ...query, hasOutput, ownerCount: owners.length, onlyOwnerId };
}

function vector(first: number, second: number): number[] {
	const values = new Array<number>(1536).fill(0);
	values[0] = first;
	values[1] = second;
	return values;
}
