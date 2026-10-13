import "./helpers/local-integration-guard.js";
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { type ClickHouseStatement, getClickhouse } from "../clickhouse.js";
import type { AgentQueryLimiter } from "../services/analysis/agent-query-slots.js";
import { RUN_INDEX_VERSION } from "../services/analysis/run-index-sql.js";
import { runSql, type SqlCaller } from "../services/analysis/sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "../services/analysis/sql-results.js";
import {
	enqueueClickHousePurge,
	runClickHousePurgeWorkerPass,
} from "../services/clickhouse-purge.service.js";
import { readAnswers } from "../services/run-questions/answers.js";
import {
	addRunQuestion,
	editRunQuestion,
	turnOnRunQuestion,
} from "../services/run-questions/catalogue.js";
import {
	backfillRunQuestions,
	previewRunQuestionsBackfill,
	type RunQuestionsBackfillOptions,
} from "../services/run-questions/history-backfill.service.js";
import { importRunQuestions } from "../services/run-questions/import-questions.js";
import {
	precomputedQuestionIds,
	precomputeSessionAnswers,
} from "../services/run-questions/precompute.js";
import {
	type AskedQuestion,
	type RunQuestionProvider,
	RunQuestionProviderFatal,
} from "../services/run-questions/provider.js";
import {
	answerQueuedQuestions,
	estimateQuestions,
	readRunQuestionTest,
	recordRunQuestionVerdicts,
	runQuestions,
	testRunQuestion,
} from "../services/run-questions/run-questions.service.js";
import { deleteUserPostgresData } from "../services/user-deletion.service.js";

/** Every agent query gets a slot at once. */
const unlimitedSlots: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};

/**
 * Run questions against real ClickHouse and Postgres, with a provider that
 * answers from the run note it receives: questions from the catalogue are
 * answered over the runs an agent's SQL selects, stored per question wording
 * and run, read back with sql, reused, and deleted with the account.
 */

setDefaultTimeout(60_000);
// Its own client: another suite in this process closes the shared one.
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", {
	max: 2,
	prepare: false,
});
// Like the API's client, which drizzle wraps: timestamps come back as strings
// and sql.json() no longer serializes.
drizzle(sqlClient);
const clickhouse = getClickhouse();

const RUN = `run_questions_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const memberId = `${RUN}_member`;
const colleagueId = `${RUN}_colleague`;
const caller: SqlCaller = {
	workspaceId: workspace,
	reader: { userId: memberId, role: "member", ownSessionsOnly: false },
};
const questionIds: string[] = [];
/** Provider names carry the run's tag, so a pass here never takes another run's jobs. */
const tag = RUN.slice(-8);

type Stand = RunQuestionProvider & {
	/** Every question asked, with the state it was asked about. */
	readonly asked: { question: string; state: string }[];
};

/**
 * A stand-in provider: every question about a run in one call, each answered
 * by `answerOne` (default: yes, 0.9, when the run's state mentions login,
 * else 0.1; undefined leaves it unanswered; a throw fails the call), at
 * $0.002 per question asked.
 */
function provider(
	answerOne: (
		question: AskedQuestion,
		state: string,
	) => Promise<number | undefined> | number | undefined = (_question, state) =>
		state.includes("login") ? 0.9 : 0.1,
	{ name = `test-${tag}`, usdPerQuestion = 0.002 } = {},
): Stand {
	const asked: { question: string; state: string }[] = [];
	return {
		name,
		state: "note",
		stateMaxChars: 6_000,
		asked,
		callCeilingUsd: (questions) => usdPerQuestion * questions.length,
		estimateCall: (questions, stateChars) => ({
			inputTokens:
				Math.ceil(Math.min(stateChars, 6_000) / 3) + 30 * questions.length,
			outputTokens: 0,
			costUsd: usdPerQuestion * questions.length,
		}),
		async answer(input) {
			const probabilities = new Map<string, number>();
			for (const item of input.questions) {
				asked.push({ question: item.question, state: input.state });
				const probability = await answerOne(item, input.state);
				if (probability !== undefined) probabilities.set(item.id, probability);
			}
			return {
				probabilities,
				model: `${name}-1`,
				usage: { inputTokens: 100, outputTokens: 10 },
				costUsd: usdPerQuestion * input.questions.length,
			};
		},
	};
}

function environment(
	answering: RunQuestionProvider = provider(),
	others: RunQuestionProvider[] = [],
) {
	return {
		executor: clickhouse,
		sql: sqlClient,
		provider: answering,
		providers: new Map(
			[answering, ...others].map((item) => [item.name, item] as const),
		),
		mayAnswer: (id: string) => id === workspace,
		sqlQuota: createMemorySqlQuota({ queries: 100, windowMs: 3_600_000 }),
		limiter: unlimitedSlots,
		githubRepositories: async () => [],
		estimateKey: "test-estimate-key",
	};
}

/**
 * The backfill's environment: ClickHouse reports the given load averages in
 * turn (then 0; a local server may report none), and time is a clock that
 * moves only when the backfill sleeps.
 */
function backfillEnvironment(
	answering: RunQuestionProvider,
	loads: number[] = [],
) {
	let now = Date.now();
	const env = environment(answering);
	return {
		...env,
		executor: {
			...clickhouse,
			query: async <T>(statement: ClickHouseStatement): Promise<T[]> =>
				statement.query.includes("system.asynchronous_metrics")
					? ([{ value: loads.shift() ?? 0 }] as T[])
					: clickhouse.query<T>(statement),
		},
		listWorkspaces: async () => [workspace],
		clock: {
			now: () => now,
			sleep: async (ms: number) => {
				now += ms;
			},
		},
	};
}

/** run_questions as an agent calls it: an estimate first, then the run with its token. */
async function ask(
	who: SqlCaller,
	input: { questions: string[]; runs?: string },
	env: ReturnType<typeof environment>,
) {
	const estimate = ok(await estimateQuestions(who, input, env));
	return runQuestions(who, { ...input, estimate: estimate.token ?? "" }, env);
}

const at = (daysAgo: number) =>
	new Date(Date.now() - daysAgo * 86_400_000)
		.toISOString()
		.replace("T", " ")
		.replace("Z", "");

/** Committed runs of one session: [turn, prompt], at a transcript revision, started days ago. */
async function seedSession(
	user: string,
	session: string,
	runs: [number, string][],
	{ revision = 1, daysAgo = 1 } = {},
) {
	const base = {
		organization_id: workspace,
		user_id: user,
		session_id: session,
		revision: String(revision),
		parser_version: 9,
		index_version: RUN_INDEX_VERSION,
		build_revision: "1",
		source: "claude_code",
		session_date: at(daysAgo),
		started_at: at(daysAgo),
		ended_at: at(daysAgo),
		built_at: at(0),
	};
	await clickhouse.insert({
		table: "rudel.run_index",
		asyncInsert: false,
		values: [
			...runs.map(([turn, prompt]) => ({
				...base,
				row_kind: "run",
				start_record: turn * 10,
				turn_idx: turn,
				prompt_head: prompt,
				genuine_prompts: 1,
			})),
			{ ...base, row_kind: "receipt", start_record: 4_294_967_295 },
		],
	});
}

async function question(wording: string) {
	const added = await addRunQuestion(sqlClient, `${wording} (${RUN})`);
	questionIds.push(added.id);
	return turnOnRunQuestion(sqlClient, added.id);
}

function ok<T>(
	outcome: { ok: true; result: T } | { ok: false; error: { message: string } },
): T {
	if (!outcome.ok)
		throw new Error(`Expected a result: ${outcome.error.message}`);
	return outcome.result;
}

beforeAll(async () => {
	for (const id of [memberId, colleagueId])
		await sqlClient`INSERT INTO "user" (id, name, email) VALUES (${id}, ${id}, ${`${id}@example.com`})`;
	await sqlClient`INSERT INTO organization (id, name, slug) VALUES (${workspace}, ${workspace}, ${workspace})`;
	await sqlClient`INSERT INTO member (id, organization_id, user_id, role) VALUES (${`${RUN}_m`}, ${workspace}, ${memberId}, 'owner')`;
	await seedSession(memberId, `${RUN}_s1`, [
		[1, "fix the login test"],
		[2, "rename the helper"],
	]);
	await seedSession(colleagueId, `${RUN}_s2`, [[1, "login page is broken"]]);
});

afterAll(async () => {
	await sqlClient`DELETE FROM organization WHERE id = ${workspace}`;
	await sqlClient`DELETE FROM "user" WHERE id IN ${sqlClient([memberId, colleagueId])}`;
	await sqlClient`DELETE FROM run_question WHERE id IN ${sqlClient(questionIds.length ? questionIds : [""])}`;
	await sqlClient.end();
	for (const table of ["rudel.run_index", "rudel.run_question_answers"])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {organization:String} SETTINGS lightweight_deletes_sync = 2`,
			query_params: { organization: workspace },
		});
});

describe("run questions", () => {
	test("after run_questions, sql filters runs by the answer probability", async () => {
		const asked = await question("Did the agent work on the login flow?");
		const env = environment();

		ok(await ask(caller, { questions: [asked.id] }, env));
		await answerQueuedQuestions(env);

		const result = ok(
			await runSql(
				caller,
				{
					title: "Runs about login",
					query: `SELECT r.session_id, r.turn_idx FROM runs AS r
						JOIN run_answers AS a
							ON a.session_id = r.session_id AND a.agent_id = r.agent_id AND a.turn_idx = r.turn_idx
						WHERE a.question_id = '${asked.id}' AND a.probability > 0.5
						ORDER BY r.session_id, r.turn_idx`,
				},
				{
					executor: clickhouse,
					results: createMemorySqlResultStore(),
					limiter: unlimitedSlots,
					githubRepositories: async () => [],
					quota: createMemorySqlQuota({ queries: 10, windowMs: 60_000 }),
				},
			),
		);
		expect(result.table).toBe(
			`session_id | turn_idx\n${RUN}_s1 | 1\n${RUN}_s2 | 1`,
		);
	});

	test("estimate_questions sends nothing and reports the cost of the answers not stored yet, and the reused ones", async () => {
		const asked = await question("Did the agent misread what the user wanted?");
		const answering = provider();
		const env = environment(answering);
		ok(
			await ask(
				caller,
				{
					questions: [asked.id],
					runs: `SELECT session_id, agent_id, turn_idx FROM runs WHERE session_id = '${RUN}_s1'`,
				},
				env,
			),
		);
		await answerQueuedQuestions(env);
		const sent = answering.asked.length;

		const estimate = ok(
			await estimateQuestions(caller, { questions: [asked.id] }, env),
		);

		expect(answering.asked.length).toBe(sent);
		expect(estimate).toMatchObject({
			runs: 3,
			questions: [{ id: asked.id, answered: 2, queued: 0, toAnswer: 1 }],
			toAnswer: 1,
			costUsd: 0.002,
			available: true,
		});
	});

	test("asking again about the same runs pays nothing, whether the answers are stored or still queued", async () => {
		const asked = await question("Did the agent go in circles?");
		const answering = provider();
		const env = environment(answering);
		const first = ok(await ask(caller, { questions: [asked.id] }, env));
		const whileQueued = ok(await ask(caller, { questions: [asked.id] }, env));
		await answerQueuedQuestions(env);
		const afterAnswers = ok(await ask(caller, { questions: [asked.id] }, env));
		await answerQueuedQuestions(env);

		expect([first, whileQueued, afterAnswers]).toMatchObject([
			{ queued: 3, alreadyQueued: 0, reused: 0, costUsd: 0.006 },
			{ job: null, queued: 0, alreadyQueued: 3, reused: 0, costUsd: 0 },
			{ job: null, queued: 0, alreadyQueued: 0, reused: 3, costUsd: 0 },
		]);
		expect(answering.asked).toHaveLength(3);
	});

	test("a reworded question is a new question: earlier answers keep the old wording", async () => {
		const original = await question(
			"Did the agent struggle to find the right file?",
		);
		const env = environment();
		ok(await ask(caller, { questions: [original.id] }, env));
		await answerQueuedQuestions(env);

		const reworded = await editRunQuestion(
			sqlClient,
			original.id,
			`Did the agent search several times before finding the file it needed? (${RUN})`,
		);
		questionIds.push(reworded.id);
		await turnOnRunQuestion(sqlClient, reworded.id);
		ok(await ask(caller, { questions: [reworded.id] }, env));
		await answerQueuedQuestions(env);

		const answers = ok(
			await runSql(
				caller,
				{
					title: "Answers by wording",
					query: `SELECT question, count() AS answers FROM run_answers
						WHERE question_id IN ('${original.id}', '${reworded.id}')
						GROUP BY question ORDER BY question`,
				},
				{
					executor: clickhouse,
					results: createMemorySqlResultStore(),
					limiter: unlimitedSlots,
					githubRepositories: async () => [],
					quota: createMemorySqlQuota({ queries: 10, windowMs: 60_000 }),
				},
			),
		);
		expect(answers.table).toBe(
			[
				"question | answers",
				`Did the agent search several times before finding the file it needed? (${RUN}) | 3`,
				`Did the agent struggle to find the right file? (${RUN}) | 3`,
			].join("\n"),
		);
		expect(reworded).toMatchObject({ state: "draft", replaces: original.id });
		const retired = await estimateQuestions(
			caller,
			{ questions: [original.id] },
			env,
		);
		expect(retired.ok).toBe(false);
	});

	test("a question added in the form is tested on the newest runs before it is turned on, and the operator's verdicts give its precision", async () => {
		const added = await addRunQuestion(
			sqlClient,
			`Was the user's request about logging in? (${RUN})`,
		);
		questionIds.push(added.id);
		const env = environment();
		const refusedWhileDraft = await estimateQuestions(
			caller,
			{ questions: [added.id] },
			env,
		);

		await testRunQuestion(
			memberId,
			{ id: added.id, workspaceId: workspace },
			env,
		);
		await answerQueuedQuestions(env);
		const tested = await readRunQuestionTest(memberId, added.id, env);

		expect(refusedWhileDraft.ok).toBe(false);
		expect(tested.status).toBe("done");
		expect(
			tested.runs.map((run) => `${run.promptHead}: ${run.probability}`).sort(),
		).toEqual([
			"fix the login test: 0.9",
			"login page is broken: 0.9",
			"rename the helper: 0.1",
		]);

		const judged = await recordRunQuestionVerdicts(
			memberId,
			{
				id: added.id,
				verdicts: tested.runs.map((run) => ({
					sessionId: run.sessionId,
					agentId: run.agentId,
					turn: run.turn,
					yes: run.promptHead === "login page is broken",
				})),
			},
			env,
		);
		expect(judged).toMatchObject({
			state: "draft",
			testedRuns: 3,
			testedPrecision: 0.5,
		});
		await turnOnRunQuestion(sqlClient, added.id);
		expect(
			ok(await estimateQuestions(caller, { questions: [added.id] }, env)),
		).toMatchObject({ toAnswer: 0, questions: [{ answered: 3 }] });
	});

	test("where members read only their own sessions, an operator who is a plain member sees only their own runs of a test", async () => {
		const added = await addRunQuestion(
			sqlClient,
			`Did the user ask for a test to be fixed? (${RUN})`,
		);
		questionIds.push(added.id);
		const env = environment();
		await testRunQuestion(
			memberId,
			{ id: added.id, workspaceId: workspace },
			env,
		);
		await answerQueuedQuestions(env);
		await sqlClient`INSERT INTO member (id, organization_id, user_id, role) VALUES (${`${RUN}_m2`}, ${workspace}, ${colleagueId}, 'member')`;
		await sqlClient`UPDATE organization SET own_sessions_only = true WHERE id = ${workspace}`;
		try {
			const seen = await readRunQuestionTest(colleagueId, added.id, env);

			expect(
				seen.runs.map((run) => `${run.promptHead}: ${run.probability}`),
			).toEqual(["login page is broken: 0.9"]);
		} finally {
			await sqlClient`UPDATE organization SET own_sessions_only = false WHERE id = ${workspace}`;
			await sqlClient`DELETE FROM member WHERE id = ${`${RUN}_m2`}`;
		}
	});

	test("where members read only their own sessions, a member cannot have a colleague's runs answered by naming them", async () => {
		const asked = await question(
			"Did the agent rewrite code it had just written?",
		);
		const env = environment();
		const ownOnly: SqlCaller = {
			workspaceId: workspace,
			reader: { userId: memberId, role: "member", ownSessionsOnly: true },
		};
		const naming = `SELECT '${RUN}_s2' AS session_id, '' AS agent_id, toUInt32(1) AS turn_idx FROM runs LIMIT 1`;

		const estimate = ok(
			await estimateQuestions(
				ownOnly,
				{ questions: [asked.id], runs: naming },
				env,
			),
		);
		const run = ok(
			await ask(ownOnly, { questions: [asked.id], runs: naming }, env),
		);

		expect(estimate).toMatchObject({ runs: 0, toAnswer: 0 });
		expect(run).toMatchObject({ job: null, runs: 0, queued: 0 });
	});

	test("an answer the provider leaves out keeps the answers already bought, and the job is retried later", async () => {
		const first = await question("Did the agent misread an error message?");
		const second = await question(
			"Did the agent change files it was not asked to?",
		);
		const env = environment(
			provider((item) => (item.id === first.id ? 0.4 : undefined)),
		);
		const runs = `SELECT session_id, agent_id, turn_idx FROM runs WHERE session_id = '${RUN}_s2'`;
		const queued = ok(
			await ask(caller, { questions: [first.id, second.id], runs }, env),
		);

		await answerQueuedQuestions(env);
		const estimate = ok(
			await estimateQuestions(
				caller,
				{ questions: [first.id, second.id], runs },
				env,
			),
		);
		const [job] = await sqlClient<
			{ status: string; attempt_count: number; retry_later: boolean }[]
		>`
			SELECT status, attempt_count, next_attempt_at > now() AS retry_later
			FROM run_question_job WHERE id = ${queued.job ?? ""}
		`;

		expect(estimate.questions).toMatchObject([
			{ id: first.id, answered: 1, queued: 0 },
			{ id: second.id, answered: 0, queued: 1 },
		]);
		expect(job).toEqual({
			status: "queued",
			attempt_count: 1,
			retry_later: true,
		});
	});

	test("a failed call uses the quota of the answers it asked for, not of runs never sent", async () => {
		const asked = [
			await question("Did the agent run the tests before finishing?"),
			await question("Did the agent ask the user a question?"),
		];
		const env = environment(
			provider(() => {
				throw new Error("provider unavailable");
			}),
		);
		// Two runs, so two calls of two questions each.
		const input = {
			questions: asked.map((item) => item.id),
			runs: `SELECT session_id, agent_id, turn_idx FROM runs WHERE session_id = '${RUN}_s1'`,
		};
		const remaining = async () =>
			ok(await estimateQuestions(caller, input, env)).quota.remaining;
		ok(await ask(caller, input, env));
		const before = await remaining();

		await answerQueuedQuestions(env);

		expect(before - (await remaining())).toBe(2);
	});

	test("a pass calls nothing once its time is up, keeps the answers it bought and hands the job back", async () => {
		const asked = await question("Did the agent read the docs first?");
		const budgetMs = 2_000;
		let passStarted = 0;
		let calls = 0;
		const answering = provider(async (item) => {
			// The second call returns just after the budget, before the cut.
			if (item.id === asked.id && ++calls === 2)
				await Bun.sleep(passStarted + budgetMs + 50 - Date.now());
			return 0.2;
		});
		const env = environment(answering);
		const input = { questions: [asked.id] };
		const queued = ok(await ask(caller, input, env));

		// Three runs, one call each: the third would start after the budget.
		passStarted = Date.now();
		await answerQueuedQuestions(env, { budgetMs });

		expect(
			answering.asked.filter((item) => item.question === asked.question),
		).toHaveLength(2);
		expect(ok(await estimateQuestions(caller, input, env))).toMatchObject({
			questions: [{ answered: 2, queued: 1 }],
		});
		const [job] = await sqlClient<{ status: string; attempt_count: number }[]>`
			SELECT status, attempt_count FROM run_question_job WHERE id = ${queued.job ?? ""}
		`;
		expect(job).toEqual({ status: "queued", attempt_count: 0 });
	});

	test("each run's answers are stored as they arrive, so a pass cut off later keeps the answers already bought", async () => {
		const asked = await question("Did the agent install a dependency?");
		const third = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let calls = 0;
		const env = environment(
			provider(async (item) => {
				if (item.id === asked.id && ++calls === 3) {
					third.resolve();
					await release.promise;
				}
				return 0.3;
			}),
		);
		const input = { questions: [asked.id] };
		ok(await ask(caller, input, env));

		const pass = answerQueuedQuestions(env);
		await third.promise;
		const whileAsking = ok(await estimateQuestions(caller, input, env));
		release.resolve();
		await pass;

		expect(whileAsking.questions).toMatchObject([{ answered: 2 }]);
	});

	test("a provider call still running past the pass's time is cut, and the job is retried later", async () => {
		const asked = await question("Did the agent wait on a slow command?");
		const env = environment(provider(() => new Promise(() => {})));
		const queued = ok(
			await ask(
				caller,
				{
					questions: [asked.id],
					runs: `SELECT session_id, agent_id, turn_idx FROM runs WHERE session_id = '${RUN}_s2'`,
				},
				env,
			),
		);

		await answerQueuedQuestions(env, { budgetMs: 400 });

		const [job] = await sqlClient<
			{ status: string; attempt_count: number; retry_later: boolean }[]
		>`
			SELECT status, attempt_count, next_attempt_at > now() AS retry_later
			FROM run_question_job WHERE id = ${queued.job ?? ""}
		`;
		expect(job).toEqual({
			status: "queued",
			attempt_count: 1,
			retry_later: true,
		});
	}, 10_000);

	test("a test in the form does not buy again what run_questions already queued", async () => {
		const asked = await question("Did the agent touch the login code?");
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const answering = provider(async (item, state) => {
			if (item.id === asked.id) {
				started.resolve();
				await release.promise;
			}
			return state.includes("login") ? 0.9 : 0.1;
		});
		const env = environment(answering);
		ok(await ask(caller, { questions: [asked.id] }, env));
		await testRunQuestion(
			memberId,
			{ id: asked.id, workspaceId: workspace },
			env,
		);

		// One worker holds the queued answers; another passes over the test.
		const holding = answerQueuedQuestions(env);
		await started.promise;
		await answerQueuedQuestions(env);
		const whileHeld = await readRunQuestionTest(memberId, asked.id, env);
		release.resolve();
		await holding;
		const answered = await readRunQuestionTest(memberId, asked.id, env);

		expect(whileHeld.status).toBe("queued");
		expect(
			answering.asked.filter((input) => input.question === asked.question),
		).toHaveLength(3);
		expect(answered.status).toBe("done");
		expect(answered.runs.map((run) => run.probability)).not.toContain(null);
	});

	test("an answer belongs to the transcript it was given for: once a session is uploaded again with changes, it is neither reused nor read", async () => {
		const asked = await question("Did the user ask for a login button?");
		const answering = provider();
		const env = environment(answering);
		// Older than the default 4 weeks, so other tests never select it.
		const session = `${RUN}_s3`;
		await seedSession(memberId, session, [[1, "add a login button"]], {
			daysAgo: 40,
		});
		const input = {
			questions: [asked.id],
			runs: `SELECT session_id, agent_id, turn_idx FROM runs WHERE session_id = '${session}'`,
		};
		const answersInSql = async () =>
			ok(
				await runSql(
					caller,
					{
						title: "Answers of the re-uploaded session",
						query: `SELECT count() AS answers FROM run_answers WHERE session_id = '${session}' AND question_id = '${asked.id}'`,
					},
					{
						executor: clickhouse,
						results: createMemorySqlResultStore(),
						limiter: unlimitedSlots,
						githubRepositories: async () => [],
						quota: createMemorySqlQuota({ queries: 10, windowMs: 60_000 }),
					},
				),
			).table;
		ok(await ask(caller, input, env));
		await answerQueuedQuestions(env);
		const before = await answersInSql();

		await seedSession(memberId, session, [[1, "add a logout button"]], {
			revision: 2,
			daysAgo: 40,
		});

		expect(before).toBe("answers\n1");
		expect(await answersInSql()).toBe("answers\n0");
		expect(ok(await estimateQuestions(caller, input, env))).toMatchObject({
			toAnswer: 1,
			questions: [{ answered: 0, toAnswer: 1 }],
		});
	});

	test("run_questions buys only what an estimate priced: without its token, with another caller's, once the runs or the price changed, nothing is queued", async () => {
		const asked = await question("Did the agent split its work into steps?");
		const env = environment();
		const session = `${RUN}_s4`;
		const input = {
			questions: [asked.id],
			runs: `SELECT session_id, agent_id, turn_idx FROM runs WHERE session_id LIKE '${session}%'`,
		};
		await seedSession(memberId, session, [[1, "plan the migration"]], {
			daysAgo: 40,
		});
		const token = async (who: SqlCaller, using = env) =>
			ok(await estimateQuestions(who, input, using)).token ?? "";
		const run = (estimate: string, using = env) =>
			runQuestions(caller, { ...input, estimate }, using);
		const colleague: SqlCaller = {
			workspaceId: workspace,
			reader: { userId: colleagueId, role: "member", ownSessionsOnly: false },
		};
		const pricier = environment(provider(undefined, { usdPerQuestion: 0.01 }));

		const refused = [
			await run(""),
			await run(`${(await token(caller)).slice(0, -2)}xx`),
			await run(await token(colleague)),
			await run(await token(caller), pricier),
		];
		const beforeGrowth = await token(caller);
		await seedSession(memberId, `${session}_b`, [[1, "plan the rollback"]], {
			daysAgo: 40,
		});
		refused.push(await run(beforeGrowth));

		expect(refused.map((outcome) => outcome.ok)).toEqual([
			false,
			false,
			false,
			false,
			false,
		]);
		expect(ok(await estimateQuestions(caller, input, env))).toMatchObject({
			runs: 2,
			questions: [{ queued: 0, toAnswer: 2 }],
		});
		expect(ok(await run(await token(caller)))).toMatchObject({ queued: 2 });
	});

	test("two providers answer the same question about the same runs side by side, and the form tests with the one picked", async () => {
		const asked = await question("Did the agent ask before deleting files?");
		const first = provider(() => 0.2, { name: `first-${tag}` });
		const second = provider(() => 0.7, { name: `second-${tag}` });
		const env = environment(first, [second]);

		ok(await ask(caller, { questions: [asked.id] }, env));
		await testRunQuestion(
			memberId,
			{ id: asked.id, workspaceId: workspace, provider: second.name },
			env,
		);
		await answerQueuedQuestions(env);

		const byProvider = ok(
			await runSql(
				caller,
				{
					title: "Answers by provider",
					query: `SELECT provider, model, input, count() AS answers, round(avg(probability), 2) AS p FROM run_answers
						WHERE question_id = '${asked.id}' GROUP BY provider, model, input ORDER BY provider`,
				},
				{
					executor: clickhouse,
					results: createMemorySqlResultStore(),
					limiter: unlimitedSlots,
					githubRepositories: async () => [],
					quota: createMemorySqlQuota({ queries: 10, windowMs: 60_000 }),
				},
			),
		);
		expect(byProvider.table).toBe(
			[
				"provider | model | input | answers | p",
				`first-${tag} | first-${tag}-1 | note | 3 | 0.2`,
				`second-${tag} | second-${tag}-1 | note | 3 | 0.7`,
			].join("\n"),
		);
		expect(
			(
				await readRunQuestionTest(memberId, asked.id, env, second.name)
			).runs.map((run) => run.probability),
		).toEqual([0.7, 0.7, 0.7]);
	});

	test("a provider that reads whole runs is sent the run's text, and each answer records that it read the whole run", async () => {
		const asked = await question("Did the user mention the login page?");
		const whole: Stand = {
			...provider(),
			name: `whole-${tag}`,
			state: "run",
		};
		const env = environment(whole);

		ok(
			await ask(
				caller,
				{
					questions: [asked.id],
					runs: `SELECT session_id, agent_id, turn_idx FROM runs WHERE session_id = '${RUN}_s2'`,
				},
				env,
			),
		);
		await answerQueuedQuestions(env);

		expect(whole.asked.map((item) => item.state)).toEqual([
			"prompt:\nlogin page is broken",
		]);
		const recorded = ok(
			await runSql(
				caller,
				{
					title: "Input of the answer",
					query: `SELECT input, probability FROM run_answers WHERE question_id = '${asked.id}'`,
				},
				{
					executor: clickhouse,
					results: createMemorySqlResultStore(),
					limiter: unlimitedSlots,
					githubRepositories: async () => [],
					quota: createMemorySqlQuota({ queries: 10, windowMs: 60_000 }),
				},
			),
		);
		expect(recorded.table).toBe("input | probability\nrun | 0.9");
	});

	test("a provider out of credits fails the job at once, says so, and is not asked again in the pass", async () => {
		const asked = await question("Did the agent stop to ask for review?");
		let calls = 0;
		const broke = provider(
			() => {
				calls++;
				throw new RunQuestionProviderFatal(
					"broke has no credits left (HTTP 402)",
				);
			},
			{ name: `broke-${tag}` },
		);
		const env = environment(broke);
		const queue = async (session: string) =>
			ok(
				await ask(
					caller,
					{
						questions: [asked.id],
						runs: `SELECT session_id, agent_id, turn_idx FROM runs WHERE session_id = '${session}'`,
					},
					env,
				),
			).job ?? "";
		const jobs = [await queue(`${RUN}_s1`), await queue(`${RUN}_s2`)];

		await answerQueuedQuestions(env);

		const rows = await sqlClient<
			{ id: string; status: string; last_error: string | null }[]
		>`
			SELECT id, status, last_error FROM run_question_job WHERE id IN ${sqlClient(jobs)}
			ORDER BY created_at
		`;
		expect(calls).toBe(1);
		expect(rows.map((row) => row.status)).toEqual(["failed", "queued"]);
		expect(rows[0]?.last_error).toContain("no credits");
	});

	test("a session's runs are answered for every question that is on once its run index is built; rebuilds and uploads of the same transcript queue nothing", async () => {
		const asked = await question(
			"Did the agent check its work before saying it was done?",
		);
		await seedSession(memberId, `${RUN}_pre`, [
			[1, "add the login rate limit"],
			[2, "run the tests"],
		]);
		const answering = provider(undefined, { name: `pre-${tag}` });
		const env = environment(answering);
		const on = await precomputedQuestionIds(env);
		const session = {
			organizationId: workspace,
			userId: memberId,
			sessionId: `${RUN}_pre`,
		};

		const built = await precomputeSessionAnswers(env, session);
		const whileQueued = await precomputeSessionAnswers(env, session);
		await answerQueuedQuestions(env);
		const rebuilt = await precomputeSessionAnswers(env, session);
		// Only the owner's runs of the session are the session's.
		const otherMember = await precomputeSessionAnswers(env, {
			...session,
			userId: colleagueId,
		});

		expect(on).toContain(asked.id);
		expect(built).toMatchObject({
			status: "queued",
			runs: 2,
			answers: 2 * on.length,
		});
		expect([whileQueued, rebuilt, otherMember]).toEqual([
			{ status: "current", runs: 2 },
			{ status: "current", runs: 2 },
			{ status: "current", runs: 0 },
		]);
		expect(answering.asked).toHaveLength(2 * on.length);
		const answers = await readAnswers(
			clickhouse,
			workspace,
			[asked.id],
			[
				{ sessionId: `${RUN}_pre`, agentId: "", turn: 1, revision: "1" },
				{ sessionId: `${RUN}_pre`, agentId: "", turn: 2, revision: "1" },
			],
			answering.name,
		);
		expect([...answers.values()].sort()).toEqual([0.1, 0.9]);
		const [job] = await sqlClient<{ purpose: string; requested_by: string }[]>`
			SELECT purpose, requested_by FROM run_question_job WHERE id = ${built.status === "queued" ? (built.jobs[0] ?? "") : ""}
		`;
		expect(job).toEqual({ purpose: "precompute", requested_by: memberId });
	});

	test("nothing is precomputed without a provider, for a workspace that may not have answers, or beyond the workspace's answer quota", async () => {
		await question("Did the agent leave a TODO behind?");
		const session = {
			organizationId: workspace,
			userId: memberId,
			sessionId: `${RUN}_s1`,
		};
		const answering = provider(undefined, { name: `gate-${tag}` });
		const env = environment(answering);

		const outcomes = [
			await precomputeSessionAnswers({ ...env, provider: null }, session),
			await precomputeSessionAnswers(
				{ ...env, mayAnswer: () => false },
				session,
			),
			await precomputeSessionAnswers(
				{ ...env, answerQuota: { answers: 1, windowMs: 3_600_000 } },
				session,
			),
		];

		expect(outcomes).toMatchObject([
			{ status: "off", reason: "provider" },
			{ status: "off", reason: "workspace" },
			{ status: "quota", runs: 2 },
		]);
		const [queued] = await sqlClient<{ count: string }[]>`
			SELECT count(*) AS count FROM run_question_job WHERE provider = ${answering.name}
		`;
		expect(queued?.count).toBe("0");
	});

	test("the history backfill previews the runs, answers and cost without sending anything, then answers them paced through the same jobs", async () => {
		const answering = provider(undefined, { name: `history-${tag}` });
		// ClickHouse is busy at first: the run waits for it.
		const env = backfillEnvironment(answering, [20]);
		const options: RunQuestionsBackfillOptions = {
			organizationId: workspace,
			days: 28,
			maxRuns: 100,
			after: undefined,
			runsPerMinute: 2,
			maxLoad: 12,
		};
		const on = await precomputedQuestionIds(env);

		const preview = await previewRunQuestionsBackfill(env, options);
		const sentBefore = answering.asked.length;
		const executed = await backfillRunQuestions(
			{ ...env, answer: () => answerQueuedQuestions(env) },
			options,
		);
		const after = await previewRunQuestionsBackfill(env, options);

		expect(sentBefore).toBe(0);
		expect(preview.runs).toBeGreaterThanOrEqual(5);
		expect(preview).toMatchObject({
			status: "preview",
			provider: answering.name,
			questions: on.length,
			runsToAnswer: preview.runs,
			answers: preview.runs * on.length,
			hasMore: false,
			next: null,
		});
		expect(preview.estimatedInputTokens).toBeGreaterThan(0);
		expect(preview.estimatedCostUsd).toBeCloseTo(
			0.002 * preview.runs * on.length,
			4,
		);
		expect(preview.workspaces).toMatchObject([
			{ organizationId: workspace, runs: preview.runs, fitsQuota: true },
		]);
		expect(executed).toMatchObject({
			status: "executed",
			runsQueued: preview.runs,
			answersQueued: preview.answers,
			answersBought: preview.answers,
			alreadyAnswered: 0,
			loadPausedSeconds: 30,
			stopped: null,
			next: null,
		});
		expect(after).toMatchObject({ runs: preview.runs, runsToAnswer: 0 });
	});

	test("the history backfill stops cleanly when the provider is out of credits, and says where to continue", async () => {
		// Answers the first call, then has no credits left.
		const base = provider(undefined, { name: `history-broke-${tag}` });
		let calls = 0;
		const broke: RunQuestionProvider = {
			...base,
			async answer(input) {
				calls++;
				if (calls > 1)
					throw new RunQuestionProviderFatal("out of credits (HTTP 402)");
				return base.answer(input);
			},
		};
		const env = backfillEnvironment(broke);

		const executed = await backfillRunQuestions(
			{ ...env, answer: () => answerQueuedQuestions(env) },
			{
				organizationId: workspace,
				days: 28,
				maxRuns: 100,
				after: undefined,
				runsPerMinute: 1,
				maxLoad: 1_000,
			},
		);

		expect(executed).toMatchObject({
			stopped: "provider",
			hasMore: true,
			runsQueued: 2,
		});
		expect(executed.message).toContain("HTTP 402");
		expect(calls).toBe(2);
		expect(executed.next).not.toBeNull();
		expect(executed.message).toContain(
			`Continue with --after ${executed.next}`,
		);
	});

	test("the history backfill stops at the workspace's answer quota, before queuing what does not fit", async () => {
		const answering = provider(undefined, { name: `history-quota-${tag}` });
		const env = {
			...backfillEnvironment(answering),
			answerQuota: { answers: 1, windowMs: 3_600_000 },
		};

		const executed = await backfillRunQuestions(
			{ ...env, answer: () => answerQueuedQuestions(env) },
			{
				organizationId: workspace,
				days: 28,
				maxRuns: 100,
				after: undefined,
				runsPerMinute: 60,
				maxLoad: 1_000,
			},
		);

		expect(executed).toMatchObject({
			stopped: "quota",
			hasMore: true,
			runsQueued: 0,
			answersBought: 0,
			next: null,
		});
		expect(executed.message).toContain(`workspace ${workspace}`);
		expect(answering.asked).toHaveLength(0);
	});

	test("questions from a file are added through the catalogue once: the same wording again is reported with its id, other criteria as a conflict", async () => {
		const wording = `Did the agent ask the user for a value it could have found? (${RUN})`;
		const file = [
			{ key: "missing_info", instructions: wording },
			{
				key: "asked_again",
				instructions: `In the next prompt, did the user ask again? (${RUN})`,
				criteria: {
					true: "The user repeats the request.",
					false: "A new request.",
				},
			},
		];

		const first = await importRunQuestions(sqlClient, file, { turnOn: false });
		questionIds.push(...first.flatMap((item) => (item.id ? [item.id] : [])));
		const again = await importRunQuestions(sqlClient, file, { turnOn: true });
		const otherCriteria = await importRunQuestions(
			sqlClient,
			[
				{
					key: "missing_info",
					instructions: wording,
					criteria: { true: "yes", false: "no" },
				},
			],
			{ turnOn: false },
		);

		expect(first).toMatchObject([
			{ key: "missing_info", status: "added", state: "draft" },
			{ key: "asked_again", status: "added", state: "draft" },
		]);
		expect(again).toEqual([
			{
				key: "missing_info",
				id: first[0]?.id ?? "",
				status: "exists",
				state: "on",
			},
			{
				key: "asked_again",
				id: first[1]?.id ?? "",
				status: "exists",
				state: "on",
			},
		]);
		expect(otherCriteria).toEqual([
			{
				key: "missing_info",
				id: first[0]?.id ?? "",
				status: "conflict",
				state: "on",
			},
		]);
	});

	// Last: it deletes the workspace.
	test("deleting an account removes its answers and the jobs naming its sessions; deleting the workspace removes the rest", async () => {
		const asked = await question("Did the agent ignore an instruction?");
		const env = environment();
		ok(await ask(caller, { questions: [asked.id] }, env));
		await answerQueuedQuestions(env);
		// A job still queued that names both members' sessions.
		const queuedToo = await question("Did the agent give up early?");
		ok(await ask(caller, { questions: [queuedToo.id] }, env));
		const answerOwners = async () =>
			(
				await clickhouse.query<{ user_id: string; answers: string }>({
					query: `SELECT user_id, count() AS answers FROM rudel.run_question_answers
						WHERE organization_id = {workspace:String} GROUP BY user_id ORDER BY user_id`,
					query_params: { workspace },
				})
			).map((row) => `${row.user_id}: ${row.answers}`);
		const jobsNamingColleague = async () =>
			(
				await sqlClient<{ count: string }[]>`
					SELECT count(*) AS count FROM run_question_job
					WHERE organization_id = ${workspace} AND ${colleagueId} = ANY(owner_ids)
				`
			)[0]?.count;
		expect((await answerOwners()).map((line) => line.split(":")[0])).toEqual([
			colleagueId,
			memberId,
		]);
		expect(await jobsNamingColleague()).not.toBe("0");

		await deleteUserPostgresData(colleagueId, { sqlClient });
		await purgeUntilDone({ targetType: "account", targetId: colleagueId });

		expect((await answerOwners()).map((line) => line.split(":")[0])).toEqual([
			memberId,
		]);
		expect(await jobsNamingColleague()).toBe("0");

		await sqlClient.begin(async (transaction) => {
			await enqueueClickHousePurge(
				{ targetId: workspace, targetType: "organization" },
				transaction,
			);
			await transaction.unsafe("DELETE FROM organization WHERE id = $1", [
				workspace,
			]);
		});
		await purgeUntilDone({ targetType: "organization", targetId: workspace });
		expect(await answerOwners()).toEqual([]);
		const [quota] = await sqlClient<{ count: string }[]>`
			SELECT count(*) AS count FROM run_question_quota WHERE organization_id = ${workspace}
		`;
		expect(quota?.count).toBe("0");
	});
});

/** Runs purge passes until the target's purge succeeded; other suites may have jobs queued first. */
async function purgeUntilDone(target: {
	targetType: "account" | "organization";
	targetId: string;
}) {
	for (let pass = 0; pass < 20; pass++) {
		await runClickHousePurgeWorkerPass({ resend: {}, sqlClient });
		const [job] = await sqlClient<{ status: string }[]>`
			SELECT status FROM clickhouse_purge_job
			WHERE target_type = ${target.targetType} AND target_id = ${target.targetId}
		`;
		if (job?.status === "succeeded") return;
	}
}
