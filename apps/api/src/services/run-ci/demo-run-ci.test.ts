import { describe, expect, test } from "bun:test";
import {
	runCiStartKey,
	SessionRunCiSchema,
	SessionSummaryLinksSchema,
} from "@rudel/api-routes";
import type {
	ClickHouseExecutor,
	ClickHouseStatement,
} from "../../clickhouse.js";
import { sessionSummaryLinks } from "../session-summary-links.service.js";
import {
	runCiDemoFromEnvironment,
	runCiDemoOf,
	runCiDemoSource,
	withDemoPullRequests,
} from "./demo-run-ci.js";
import { DEMO_RUN_CI } from "./demo-run-ci-sessions.js";
import { DEMO_RUN_CI_CAPTURED_STARTS } from "./demo-run-ci-starts.fixture.js";
import { type SessionRunCiEnv, sessionRunCi } from "./session-run-ci.js";

const DEMO_ORG = "1zKtWzbRInKT6uNOqgXdcEGinGo2rXuW";
const OTHER_ORG = "w";
const SCOPE = { workspaceId: DEMO_ORG, member: null };
const SLOTS_SESSION = "371ba02e-5a6e-4c0c-9aff-45ecf70972ae";
const ms = (iso: string) => Date.parse(iso);

const refuse = (what: string) => () => {
	throw new Error(`the demo read ${what}`);
};

const throwingEnv = (): SessionRunCiEnv => ({
	executor: {
		close: refuse("ClickHouse"),
		execute: refuse("ClickHouse"),
		insert: refuse("ClickHouse"),
		query: refuse("ClickHouse"),
	} satisfies ClickHouseExecutor,
	enabled: refuse("Postgres"),
	repositories: refuse("Postgres"),
});

function recordingEnv(
	answer: (statement: ClickHouseStatement) => Record<string, unknown>[],
	options: { enabled?: boolean } = {},
) {
	const statements: ClickHouseStatement[] = [];
	const asked: string[] = [];
	const env: SessionRunCiEnv = {
		executor: {
			async close() {},
			async execute() {},
			async insert() {},
			async query<T>(statement: ClickHouseStatement) {
				statements.push(statement);
				return answer(statement) as T[];
			},
		},
		enabled: async (workspaceId) => {
			asked.push(`enabled ${workspaceId}`);
			return options.enabled ?? true;
		},
		repositories: async (workspaceId) => {
			asked.push(`repositories ${workspaceId}`);
			return [{ repositoryId: "1345271521", fullName: "opalinehq/athena" }];
		},
	};
	return { env, statements, asked };
}

const LINK = {
	agent_id: "",
	turn_idx: 4,
	started_ms: String(ms("2026-10-14T08:46:10.340Z")),
	ended_ms: String(ms("2026-10-14T09:04:21.423Z")),
	ci_run_id: "1345271521/actions_run/38537619754/1",
	repository_id: "1345271521",
	github_run_id: "38537619754",
	attempt: 1,
	workflow_name: "CI",
	event: "pull_request",
	head_branch: "feat/run-questions-dashboard",
	head_sha: "e96c449b62614c106da5d56fbbd905fe5aa3c601",
	conclusion: "failure",
	created_ms: String(ms("2026-10-14T08:47:24.000Z")),
	exact_relations: [],
	window_relations: ["pr_named"],
	pr_nodes: ["1345271521/301"],
};
const JOB = {
	repository_id: "1345271521",
	run_id: "38537619754",
	attempt: 1,
	job_id: "115764252835",
	name: "verify",
	status: "completed",
	conclusion: "failure",
	created_ms: String(ms("2026-10-14T08:47:25.000Z")),
	started_ms: String(ms("2026-10-14T08:47:33.000Z")),
	completed_ms: String(ms("2026-10-14T08:48:30.000Z")),
	runner_name: "blacksmith-8vcpu-ubuntu-2404-znlb6ppslqt4wtii",
};
const SETUP = {
	setup_file: "repo:AGENTS.md",
	kind: "instructions",
	scope: "repo",
	owner: "",
	path: "AGENTS.md",
	versions: "1",
	runs: "8",
	subagents: 0,
	chars: "512",
	first_ms: String(ms("2026-08-20T07:58:57.776Z")),
};
const PULL = {
	node_id: "1345271521/301",
	relations: ["pr_named"],
	repository_id: "1345271521",
	number: "301",
	title: "Run question tags on the dashboard",
	state: "closed",
	draft: 0,
	merged_ms: String(ms("2026-10-14T12:00:00.000Z")),
	head_ref: "feat/run-questions-dashboard",
	author_login: "evrendom",
};

const runCiAnswer = (statement: ClickHouseStatement) =>
	statement.query.includes("rudel.github_ci_jobs") ? [JOB] : [LINK];
const linksAnswer = (statement: ClickHouseStatement) =>
	statement.query.includes("rudel.github_pull_requests") ? [PULL] : [SETUP];

describe("the showcase workspace's scripted CI and pull requests", () => {
	test("every session's fixture is what the contracts let the API answer", () => {
		for (const [sessionId, session] of Object.entries(DEMO_RUN_CI)) {
			expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
			expect(
				SessionRunCiSchema.parse({ enabled: true, runs: session.runs }),
			).toEqual({ enabled: true, runs: [...session.runs] });
			expect(
				SessionSummaryLinksSchema.parse({
					setup: [],
					pullRequests: session.pullRequests,
				}).pullRequests,
			).toEqual([...session.pullRequests]);
			expect(session.runs.length).toBeGreaterThan(0);
		}
	});

	test("every scripted run starts where a real run of its session starts", () => {
		expect(Object.keys(DEMO_RUN_CI).sort()).toEqual(
			Object.keys(DEMO_RUN_CI_CAPTURED_STARTS).sort(),
		);
		for (const [sessionId, session] of Object.entries(DEMO_RUN_CI)) {
			const captured = DEMO_RUN_CI_CAPTURED_STARTS[sessionId];
			const turnKeys = new Set(captured?.turns.map(runCiStartKey));
			const runs = new Map(captured?.runs.map(([turn, at]) => [turn, at]));
			for (const run of session.runs) {
				expect(run.agentId).toBe("");
				expect(runs.get(run.turn)).toBe(run.startedAt);
				expect(turnKeys.has(runCiStartKey(run.startedAt))).toBe(true);
			}
		}
	});

	test("its CI reads as GitHub keeps it: ids, attempts, and jobs that start after they're made and skip before they start", () => {
		for (const session of Object.values(DEMO_RUN_CI))
			for (const run of session.runs)
				for (const ci of run.ci) {
					expect(ci.ciRunId).toMatch(
						new RegExp(`^\\d+/actions_run/${ci.githubRunId}/${ci.attempt}$`),
					);
					expect(ci.repository).toMatch(/^acme\/loomrail(-ui)?$/);
					expect(ci.headSha).toMatch(/^[0-9a-f]{40}$/);
					if (ci.link === "pr_window")
						expect(ms(ci.createdAt)).toBeGreaterThanOrEqual(ms(run.startedAt));
					for (const job of ci.jobs) {
						const [created, started, completed] = [
							job.createdAt,
							job.startedAt,
							job.completedAt,
						].map((at) => ms(at ?? ""));
						expect(job.status).toBe("completed");
						expect(started).toBeGreaterThanOrEqual(created ?? 0);
						if (job.conclusion === "skipped") {
							expect(completed).toBeLessThan(started ?? 0);
							expect(job.runnerName).toBe("");
						} else {
							expect(completed).toBeGreaterThan(started ?? 0);
							expect(job.runnerName).toMatch(/^GitHub Actions \d+$/);
						}
					}
				}
	});

	test("the showcase workspace gets the script without reading ClickHouse or Postgres", async () => {
		const env = { ...throwingEnv(), demo: runCiDemoSource(DEMO_ORG) };
		const answer = await sessionRunCi(env, SCOPE, SLOTS_SESSION);
		expect(answer).toEqual({
			enabled: true,
			runs: [...(DEMO_RUN_CI[SLOTS_SESSION]?.runs ?? [])],
		});
		expect(await sessionRunCi(env, SCOPE, "another-session")).toEqual({
			enabled: true,
			runs: [],
		});
		answer.runs[0]?.ci.pop();
		expect(
			(await sessionRunCi(env, SCOPE, SLOTS_SESSION)).runs[0]?.ci,
		).toHaveLength(DEMO_RUN_CI[SLOTS_SESSION]?.runs[0]?.ci.length ?? -1);
	});

	test("the showcase workspace's summary keeps its real setup files and adds the scripted pull requests", async () => {
		const { env, asked } = recordingEnv(linksAnswer, { enabled: false });
		const answer = await sessionSummaryLinks(
			{ ...env, demo: runCiDemoSource(DEMO_ORG) },
			SCOPE,
			SLOTS_SESSION,
		);
		expect(SessionSummaryLinksSchema.parse(answer)).toEqual(answer);
		expect(answer.setup.map((file) => file.path)).toEqual(["AGENTS.md"]);
		expect(answer.pullRequests).toEqual([
			...(DEMO_RUN_CI[SLOTS_SESSION]?.pullRequests ?? []),
		]);
		expect(asked).toEqual([`enabled ${DEMO_ORG}`]);
	});

	test("a real pull request the script also names gives way to the script, and the rest stay sorted", () => {
		const scripted = DEMO_RUN_CI[SLOTS_SESSION]?.pullRequests ?? [];
		const real = [
			{ ...(scripted[0] as (typeof scripted)[number]), title: null },
			{ ...(scripted[0] as (typeof scripted)[number]), number: 9 },
		];
		expect(
			withDemoPullRequests(real, scripted).map((pull) => [
				pull.number,
				pull.title,
			]),
		).toEqual([
			[9, "Fix booking slots shifting by an hour"],
			[412, "Fix booking slots shifting by an hour"],
		]);
	});
});

describe("every other workspace", () => {
	test("reads its CI as before, with the showcase source set for another workspace", async () => {
		const plain = recordingEnv(runCiAnswer);
		const withDemo = recordingEnv(runCiAnswer);
		const scope = { workspaceId: OTHER_ORG, member: "m" };
		const before = await sessionRunCi(plain.env, scope, SLOTS_SESSION);
		const after = await sessionRunCi(
			{ ...withDemo.env, demo: runCiDemoSource(DEMO_ORG) },
			scope,
			SLOTS_SESSION,
		);
		expect(after).toEqual(before);
		expect(before.runs[0]?.ci[0]?.githubRunId).toBe("38537619754");
		expect(withDemo.statements).toEqual(plain.statements);
		expect(withDemo.asked).toEqual(plain.asked);
	});

	test("reads its summary links as before", async () => {
		const plain = recordingEnv(linksAnswer);
		const withDemo = recordingEnv(linksAnswer);
		const scope = { workspaceId: OTHER_ORG, member: null };
		const before = await sessionSummaryLinks(plain.env, scope, SLOTS_SESSION);
		const after = await sessionSummaryLinks(
			{ ...withDemo.env, demo: runCiDemoSource(DEMO_ORG) },
			scope,
			SLOTS_SESSION,
		);
		expect(after).toEqual(before);
		expect(before.pullRequests.map((pull) => pull.number)).toEqual([301]);
		expect(withDemo.statements).toEqual(plain.statements);
		expect(withDemo.asked).toEqual(plain.asked);
	});

	test("the handler's gate sees the showcase only for its own workspace", () => {
		const env = { demo: runCiDemoSource(DEMO_ORG) };
		expect(runCiDemoOf(env, DEMO_ORG)?.workspaceId).toBe(DEMO_ORG);
		expect(runCiDemoOf(env, OTHER_ORG)).toBeUndefined();
		expect(runCiDemoOf({}, DEMO_ORG)).toBeUndefined();
	});
});

describe("with DEMO_ORGANIZATION_ID unset", () => {
	test("no showcase source is built", () => {
		expect(runCiDemoFromEnvironment({})).toBeUndefined();
		expect(
			runCiDemoFromEnvironment({ DEMO_ORGANIZATION_ID: "  " }),
		).toBeUndefined();
		expect(
			runCiDemoFromEnvironment({ DEMO_ORGANIZATION_ID: DEMO_ORG })?.workspaceId,
		).toBe(DEMO_ORG);
	});

	test("the showcase workspace itself reads its CI and links like any other", async () => {
		const { env, statements } = recordingEnv(runCiAnswer, { enabled: false });
		expect(await sessionRunCi(env, SCOPE, SLOTS_SESSION)).toEqual({
			enabled: false,
			runs: [],
		});
		expect(statements).toHaveLength(0);
		const links = recordingEnv(linksAnswer, { enabled: false });
		expect(
			(await sessionSummaryLinks(links.env, SCOPE, SLOTS_SESSION)).pullRequests,
		).toEqual([]);
	});
});
