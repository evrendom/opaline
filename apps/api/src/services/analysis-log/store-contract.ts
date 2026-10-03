import { afterEach, describe, expect, test } from "bun:test";
import assert from "node:assert";
import {
	purgeAnalysisLog,
	recordQuery,
	saveAnalysis,
} from "./analysis-log.service.js";
import { createLocalEmbedder } from "./embedder.js";
import { AnalysisFullError } from "./errors.js";
import type {
	AnalysisStore,
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

		test("latest open analysis uses the activity cutoff, inclusive window, workspace and author", async () => {
			const { store, analysis, otherWorkspaceId, otherAuthorId } = setup();
			const boundary = "2026-10-03T10:00:00.000Z";
			await store.createAnalysis({ ...analysis, cutoff: boundary });
			await store.createAnalysis({
				...analysis,
				id: `${analysis.id}_old`,
				cutoff: "2026-10-03T09:59:59.999Z",
			});
			await store.createAnalysis({
				...analysis,
				id: `${analysis.id}_finished`,
				status: "finished",
				cutoff: "2026-10-03T11:00:00.000Z",
			});
			await store.createAnalysis({
				...analysis,
				id: `${analysis.id}_workspace`,
				workspaceId: otherWorkspaceId,
				cutoff: "2026-10-03T12:00:00.000Z",
			});
			await store.createAnalysis({
				...analysis,
				id: `${analysis.id}_author`,
				authorId: otherAuthorId,
				cutoff: "2026-10-03T13:00:00.000Z",
			});
			expect(
				(
					await store.latestOpenAnalysis(
						analysis.workspaceId,
						analysis.authorId,
						boundary,
					)
				)?.id,
			).toBe(analysis.id);
			expect(
				await store.latestOpenAnalysis(
					analysis.workspaceId,
					analysis.authorId,
					"2026-10-03T10:00:00.001Z",
				),
			).toBeNull();
			const newest = {
				...analysis,
				id: `${analysis.id}_new`,
				cutoff: "2026-10-03T10:01:00.000Z",
			};
			await store.createAnalysis(newest);
			expect(
				await store.latestOpenAnalysis(
					analysis.workspaceId,
					analysis.authorId,
					boundary,
				),
			).toEqual(newest);
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

		test("deleting what read an owner's sessions removes those analyses in any workspace, keeps the rest and repeats", async () => {
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

			await store.deleteAnalysesReadingOwner(ownerId);
			await store.deleteAnalysesReadingOwner(ownerId);
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
			await store.deleteAnalysesReadingOwner(`${ownerId}_missing`);
		});

		test("a deleted analysis is hidden and refuses further writes", async () => {
			const { store, analysis, step, query, ownerId } = setup();
			await store.createAnalysis(analysis);
			await store.createStep(step);
			await store.createQuery(query);
			await store.deleteAnalysesReadingOwner(ownerId);

			expect(await store.getAnalysis(analysis.id)).toBeNull();
			expect(
				await store.recentAnalyses(analysis.workspaceId, analysis.authorId, 10),
			).toEqual([]);
			expect(
				await store.latestOpenAnalysis(
					analysis.workspaceId,
					analysis.authorId,
					analysis.cutoff,
				),
			).toBeNull();
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
			await store.deleteAnalysesReadingOwner(ownerId);
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
			const record = (question: string) =>
				recordQuery(log, author, {
					tool: "read",
					args: {},
					trace: { question },
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

		test("an analysis whose results name none of an account's sessions is still deleted with that account", async () => {
			const { store, workspaceId, ownerId, otherAuthorId } = setup();
			const log = {
				store,
				embedder: createLocalEmbedder(),
				now: () => new Date("2026-10-03T10:00:00.000Z"),
			};
			const admin = {
				workspaceId,
				userId: otherAuthorId,
				host: "plugin" as const,
			};
			// A grouped find reads the member's sessions but shows only totals.
			const trace = await recordQuery(log, admin, {
				tool: "find",
				args: { source: "runs", groupBy: "week" },
				trace: { question: "How busy was the team?" },
				output: { groups: [{ key: "2026-09-28", runs: 12, sessions: 3 }] },
				outputChars: 60,
				sessions: [],
				owners: [ownerId],
			});
			await saveAnalysis(
				log,
				{
					workspaceId,
					userId: otherAuthorId,
					isAdmin: true,
					restrictResults: false,
				},
				{
					analysis: trace.analysis,
					finalAnswer: "Busiest in late September.",
					findings: [],
					clarifications: [],
					topics: [],
				},
			);

			await purgeAnalysisLog(
				store,
				{ targetType: "account", targetId: ownerId },
				AbortSignal.timeout(60_000),
			);
			expect(await store.getAnalysis(trace.analysis)).toBeNull();
			expect(await store.getQuery(trace.query)).toBeNull();
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
		shared: false,
		pinned: false,
		createdAt: now,
		cutoff: now,
		scope: { from: null, to: null, filters: {} },
		finalAnswer: null,
		topics: [],
		updates: null,
		notes: [],
		cost: null,
		queryCount: 0,
		stepCount: 0,
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
		tool: "find",
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
