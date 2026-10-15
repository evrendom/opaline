import { afterAll, afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ClickHouseExecutor } from "../clickhouse.js";
import {
	readCompassSettings,
	writeCompassSettings,
} from "../services/moments/compass-settings.js";
import { checkFrustration } from "../services/moments/frustration.js";
import type { RunEvidence } from "../services/moments/moment-rules.js";
import {
	listMoments,
	MomentNotFoundError,
	type MomentsEnv,
	ObservationLimitError,
	observeMoment,
	readRunDetail,
	voteOnObservation,
} from "../services/moments/moments.service.js";
import type { ObservationModel } from "../services/moments/observer.js";
import {
	momentPatterns,
	recordMomentFix,
} from "../services/moments/patterns.js";

// Its own connection: files earlier in the integration run end the shared one.
// Wrapped by drizzle like the API's client, which then takes no Date parameters.
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", { max: 2 });
drizzle(sqlClient);
const organizationIds: string[] = [];
const userIds: string[] = [];

afterAll(async () => {
	await sqlClient.end();
});

afterEach(async () => {
	if (organizationIds.length)
		await sqlClient`DELETE FROM organization WHERE id IN ${sqlClient(organizationIds)}`;
	if (userIds.length)
		await sqlClient`DELETE FROM "user" WHERE id IN ${sqlClient(userIds)}`;
	organizationIds.length = 0;
	userIds.length = 0;
});

async function createWorkspace(): Promise<string> {
	const id = `moments-org-${randomUUID()}`;
	organizationIds.push(id);
	await sqlClient`
		INSERT INTO organization (id, name, slug)
		VALUES (${id}, 'Moment Labs', ${`moments-${randomUUID().slice(0, 8)}`})
	`;
	return id;
}

async function createUser(): Promise<string> {
	const id = `moments-user-${randomUUID()}`;
	userIds.push(id);
	await sqlClient`
		INSERT INTO "user" (id, name, email, email_verified)
		VALUES (${id}, 'Member', ${`${id}@example.com`}, true)
	`;
	return id;
}

function failingRun(userId: string, sessionId: string): RunEvidence {
	return {
		user_id: userId,
		session_id: sessionId,
		agent_id: "",
		turn_idx: 1,
		revision: "3",
		parser_version: 5,
		started_ms: Date.UTC(2026, 9, 6, 12),
		start_record: 1,
		end_record: 40,
		prompt_head: "make the tests pass",
		model: "claude-opus-5-5",
		cost_usd: 2,
		minutes: 9,
		compactions: 0,
		aborted: null,
		interrupted_calls: 0,
		denied_calls: 0,
		has_final_message: 1,
		next_reactions: [],
		first_edit: null,
		explore_records: [],
		result_records: [10, 12, 14, 16, 18],
		failed_records: [10, 12, 14, 16],
		shell_calls: [],
		failed_call_ids: [],
		first_queued: null,
		edit_files: [],
		ci_calls: [],
		pending_call_ids: [],
		git_calls: [],
		apology_records: [],
	};
}

/** Answers the run-evidence, span, rank, prompt and run-cost queries from fixed rows. */
function fakeExecutor(
	runs: RunEvidence[],
	prompts: { prompt: string }[] = [],
): ClickHouseExecutor {
	return {
		async close() {},
		async execute() {},
		async insert() {},
		async query<T>(statement: {
			query: string;
			query_params?: Record<string, unknown>;
		}) {
			if (statement.query.includes("AS ts_ms"))
				return runs
					.filter(
						(run) =>
							run.session_id === statement.query_params?.sessionId &&
							run.revision === statement.query_params?.revision &&
							run.turn_idx === statement.query_params?.turn,
					)
					.flatMap(() => [
						{
							record_idx: 1,
							block_idx: 0,
							ts_ms: Date.UTC(2026, 9, 6, 12),
							kind: "user_prompt",
							subtype: "",
							tool_name: "",
							failed: 0,
							exit_code: null,
							file_path: "",
							file_op: "",
							text_chars: 19,
							text: "make the tests pass",
						},
						{
							record_idx: 10,
							block_idx: 0,
							ts_ms: 0,
							kind: "tool_result",
							subtype: "",
							tool_name: "Bash",
							failed: 1,
							exit_code: 2,
							file_path: "",
							file_op: "",
							text_chars: 5_000,
							text: "error TS2345",
						},
					]) as T[];
			if (statement.query.includes("record_idx BETWEEN"))
				return [
					{
						record_idx: 10,
						kind: "tool_result",
						subtype: "",
						tool_name: "Bash",
						failed: 1,
						text: "error TS2345: Argument of type 'string' is not assignable",
					},
				] as T[];
			if (statement.query.includes("explore_records"))
				return runs.filter(
					(run) =>
						statement.query_params?.runSession === undefined ||
						run.session_id === statement.query_params.runSession,
				) as T[];
			if (statement.query.includes("SELECT cost_usd, minutes"))
				return runs.map((run) => ({
					cost_usd: run.cost_usd,
					minutes: run.minutes,
				})) as T[];
			if (statement.query.includes("argMin(text"))
				return runs.flatMap((run, index) => {
					const prompt = prompts[index];
					return prompt
						? [
								{
									user_id: run.user_id,
									session_id: run.session_id,
									agent_id: run.agent_id,
									turn_idx: run.turn_idx,
									final_message: "Done, the tests pass.",
									prompt: prompt.prompt,
								},
							]
						: [];
				}) as T[];
			return runs.map((run) => ({
				user_id: run.user_id,
				session_id: run.session_id,
				agent_id: run.agent_id,
				turn_idx: run.turn_idx,
				cost_usd: run.cost_usd,
			})) as T[];
		},
	};
}

function fakeModel(lesson: string): ObservationModel & { calls: number } {
	const model = {
		model: "test-model",
		calls: 0,
		async observe() {
			model.calls++;
			return {
				output: {
					false_positive: false,
					what_happened: "The agent kept rerunning the type check.",
					layer: "automated_check" as const,
					lesson,
					evidence: [{ record: 10, quote: "error TS2345" }],
					confidence: 0.8,
				},
				inputTokens: 100,
				outputTokens: 20,
			};
		},
	};
	return model;
}

function env(
	runs: RunEvidence[],
	model: ObservationModel | null,
	overrides: Partial<MomentsEnv> = {},
): MomentsEnv {
	return {
		executor: fakeExecutor(runs),
		sql: sqlClient,
		featureEnabled: async () => true,
		model,
		dailyLimit: 100,
		now: () => new Date(Date.UTC(2026, 9, 15)),
		...overrides,
	};
}

const RANGE = { startDate: "2026-10-01", endDate: "2026-10-14" };

test("observing a moment stores the note once, and the list carries it", async () => {
	const workspaceId = await createWorkspace();
	const member = await createUser();
	const runs = [failingRun(member, "session-a")];
	const model = fakeModel("Run tsc in a pre-commit hook for apps/api.");
	const momentsEnv = env(runs, model);
	const caller = { workspaceId, member: null, viewerId: member };
	const ref = {
		userId: member,
		sessionId: "session-a",
		agentId: "",
		turn: 1,
		...RANGE,
	};

	const first = await observeMoment(momentsEnv, caller, ref);
	const again = await observeMoment(momentsEnv, caller, ref);
	expect(again.id).toBe(first.id);
	expect(model.calls).toBe(1);
	expect(first).toMatchObject({
		layer: "automated_check",
		evidence: [{ record: 10, quote: "error TS2345" }],
	});

	const listed = await listMoments(momentsEnv, caller, {
		...RANGE,
		mine: false,
		limit: 10,
		offset: 0,
	});
	expect(listed.counts.failing_streak).toBe(1);
	expect(listed.days).toEqual([{ date: "2026-10-06", count: 1 }]);
	expect(listed.runs).toBe(1);
	expect(listed.noticeable[0]?.flags.map((flag) => flag.kind)).toEqual([
		"failing_streak",
	]);
	expect(listed.noticeable[0]?.observation?.id).toBe(first.id);

	expect(
		await voteOnObservation(momentsEnv, caller, {
			observationId: first.id,
			useful: true,
		}),
	).toEqual({ useful: 1, notUseful: 0, mine: true });
});

test("a run's detail lists its own records, with its flags and observation, and only to members who may read it", async () => {
	const workspaceId = await createWorkspace();
	const member = await createUser();
	const other = await createUser();
	const momentsEnv = env(
		[failingRun(member, "session-detail")],
		fakeModel("Run tsc before handing back."),
	);
	const caller = { workspaceId, member: null, viewerId: member };
	const ref = {
		userId: member,
		sessionId: "session-detail",
		agentId: "",
		turn: 1,
		...RANGE,
	};
	const observation = await observeMoment(momentsEnv, caller, ref);

	const detail = await readRunDetail(momentsEnv, caller, ref);
	expect(detail.run.flags.map((flag) => flag.kind)).toEqual(["failing_streak"]);
	expect(detail.run.observation?.id).toBe(observation.id);
	expect(detail.observable).toBe(true);
	expect(detail.truncated).toBe(false);
	expect(detail.records).toEqual([
		{
			record: 1,
			block: 0,
			at: "2026-10-06T12:00:00.000Z",
			kind: "user_prompt",
			subtype: "",
			tool: "",
			failed: false,
			exitCode: null,
			filePath: "",
			fileOp: "",
			text: "make the tests pass",
			textChars: 19,
		},
		{
			record: 10,
			block: 0,
			at: null,
			kind: "tool_result",
			subtype: "",
			tool: "Bash",
			failed: true,
			exitCode: 2,
			filePath: "",
			fileOp: "",
			text: "error TS2345",
			textChars: 5_000,
		},
	]);

	await expect(
		readRunDetail(
			momentsEnv,
			{ workspaceId, member: other, viewerId: other },
			ref,
		),
	).rejects.toThrow(MomentNotFoundError);
});

test("a workspace past its daily limit observes nothing new", async () => {
	const workspaceId = await createWorkspace();
	const member = await createUser();
	const model = fakeModel("Run tsc in a pre-commit hook.");
	const caller = { workspaceId, member: null, viewerId: member };
	await expect(
		observeMoment(
			env([failingRun(member, "session-b")], model, { dailyLimit: 0 }),
			caller,
			{
				userId: member,
				sessionId: "session-b",
				agentId: "",
				turn: 1,
				...RANGE,
			},
		),
	).rejects.toBeInstanceOf(ObservationLimitError);
	expect(model.calls).toBe(0);
});

test("a recorded fix stays with its pattern and deleting the workspace removes everything", async () => {
	const workspaceId = await createWorkspace();
	const member = await createUser();
	const runs = [
		failingRun(member, "session-c"),
		failingRun(member, "session-d"),
	];
	const caller = { workspaceId, member: null, viewerId: member };
	for (const sessionId of ["session-c", "session-d"])
		await observeMoment(
			env(runs, fakeModel("Run tsc in a pre-commit hook for apps/api.")),
			caller,
			{ userId: member, sessionId, agentId: "", turn: 1, ...RANGE },
		);

	const before = await momentPatterns(env(runs, null), caller, RANGE);
	expect(before.patterns).toHaveLength(1);
	const pattern = before.patterns[0];
	expect(pattern).toMatchObject({ observations: 2, runs: 2, costUsd: 4 });
	await recordMomentFix(env(runs, null), caller, {
		patternId: pattern?.id ?? "",
		note: "Added a tsc pre-commit hook",
		...RANGE,
	});
	const after = await momentPatterns(env(runs, null), caller, RANGE);
	expect(after.patterns[0]?.fix).toMatchObject({
		note: "Added a tsc pre-commit hook",
		afterPerWeek: null,
	});

	await sqlClient`DELETE FROM organization WHERE id = ${workspaceId}`;
	const [left] = await sqlClient<{ observations: number; fixes: number }[]>`
		SELECT
			(SELECT count(*)::int FROM moment_observation WHERE organization_id = ${workspaceId}) AS observations,
			(SELECT count(*)::int FROM moment_fix WHERE organization_id = ${workspaceId}) AS fixes
	`;
	expect(left).toEqual({ observations: 0, fixes: 0 });
});

test("a flag turned off in the workspace's settings no longer makes a run noticeable", async () => {
	const workspaceId = await createWorkspace();
	const member = await createUser();
	const runs = [failingRun(member, "session-e")];
	const caller = { workspaceId, member: null, viewerId: member };
	const list = () =>
		listMoments(env(runs, null), caller, {
			...RANGE,
			mine: false,
			limit: 10,
			offset: 0,
		});
	expect((await list()).noticeable).toHaveLength(1);

	const settings = await readCompassSettings(sqlClient, workspaceId);
	settings.flags.failing_streak.enabled = false;
	await writeCompassSettings(sqlClient, workspaceId, settings, member);
	expect(
		(await readCompassSettings(sqlClient, workspaceId)).flags.failing_streak,
	).toEqual({ enabled: false, value: 4 });
	const listed = await list();
	expect(listed.noticeable).toHaveLength(0);
	expect(listed.runs).toBe(1);
});

test("SubQ's frustration answer is asked once per prompt and flags the run it followed", async () => {
	const workspaceId = await createWorkspace();
	const member = await createUser();
	const quiet = {
		...failingRun(member, "session-f"),
		result_records: [],
		failed_records: [],
	};
	let asked = 0;
	const provider = {
		name: "subq",
		state: "run" as const,
		stateMaxChars: 120_000,
		callCeilingUsd: () => 0.01,
		estimateCall: () => ({ inputTokens: 1, outputTokens: 1, costUsd: 0 }),
		async answer() {
			asked++;
			return {
				probabilities: new Map([["user_frustrated", 0.9]]),
				model: "snap-test",
				usage: { inputTokens: 120, outputTokens: 1 },
				costUsd: 0.000006,
			};
		},
	};
	const saved = process.env.FRUSTRATION_CHECK_WORKSPACES;
	process.env.FRUSTRATION_CHECK_WORKSPACES = workspaceId;
	try {
		const frustration = {
			executor: fakeExecutor([quiet], [{ prompt: "it STILL fails, again??" }]),
			sql: sqlClient,
			provider,
			featureEnabled: async () => true,
		};
		const first = await checkFrustration(frustration, {
			budgetMs: 10_000,
			maxPrompts: 10,
		});
		expect(first.asked).toBeGreaterThanOrEqual(1);
		const before = asked;
		await checkFrustration(frustration, { budgetMs: 10_000, maxPrompts: 10 });
		expect(asked).toBe(before);
	} finally {
		if (saved === undefined) delete process.env.FRUSTRATION_CHECK_WORKSPACES;
		else process.env.FRUSTRATION_CHECK_WORKSPACES = saved;
	}

	const caller = { workspaceId, member: null, viewerId: member };
	const listed = await listMoments(env([quiet], null), caller, {
		...RANGE,
		mine: false,
		limit: 10,
		offset: 0,
	});
	expect(listed.noticeable[0]?.flags).toEqual([
		expect.objectContaining({
			kind: "user_frustrated",
			detail: "SubQ: 90% frustrated next prompt",
		}),
	]);
	const off = await listMoments(
		env([quiet], null, {
			featureEnabled: async (feature) => feature !== "frustration_check",
		}),
		caller,
		{ ...RANGE, mine: false, limit: 10, offset: 0 },
	);
	expect(off.noticeable).toHaveLength(0);
});
