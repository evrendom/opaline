import { afterAll, beforeAll, expect } from "bun:test";
import assert from "node:assert/strict";
import { getAdapter } from "@rudel/agent-adapters";
import {
	type CostDashboardInput,
	CostDashboardSchema,
} from "@rudel/api-routes";
import { ingestRudelUsageEvents } from "@rudel/ch-schema/generated";
import { extractUsageEvents } from "@rudel/usage-events";
import { z } from "zod";
import { getClickhouse } from "../../clickhouse.js";
import { sqlClient } from "../../db.js";
import { persistSessionLanguageSignalsWithExecutor } from "../../services/session-language-signal-persistence.service.js";
import { buildUsageEventRows } from "../../services/usage-event-ingest.service.js";
import { type ApiTestServer, startApiTestServer } from "./api-test-server.js";
import {
	seedGitHubPull,
	seedGitHubRepository,
	seedGitHubRun,
} from "./github-outcomes-fixture.js";

export const day = new Date().toISOString().slice(0, 10);
export const start = Date.parse(`${day}T00:00:00Z`);

export function transcript(
	duration: number,
	feedback?: string,
	skills = false,
	begin = start,
	model = "claude-sonnet-4-5",
) {
	const lines: unknown[] = [
		{
			type: "user",
			uuid: "u1",
			sessionId: "runs",
			timestamp: new Date(begin).toISOString(),
			message: { role: "user", content: "Implement the task" },
		},
	];
	if (skills)
		lines.push({
			type: "assistant",
			uuid: "skill",
			sessionId: "runs",
			timestamp: new Date(begin + 1000).toISOString(),
			message: {
				role: "assistant",
				model,
				content: [
					{
						type: "tool_use",
						id: "skill1",
						name: "Skill",
						input: { skill: "design" },
					},
				],
			},
		});
	lines.push({
		type: "assistant",
		uuid: "a1",
		sessionId: "runs",
		timestamp: new Date(begin + duration * 1000).toISOString(),
		message: {
			role: "assistant",
			id: "m1",
			model,
			usage: { input_tokens: 10, output_tokens: 5 },
			content: [{ type: "text", text: "Done" }],
		},
	});
	if (feedback !== undefined)
		lines.push({
			type: "user",
			uuid: "u2",
			sessionId: "runs",
			timestamp: new Date(begin + duration * 1000 + 1000).toISOString(),
			message: { role: "user", content: feedback },
		});
	return lines.map((line) => JSON.stringify(line)).join("\n");
}

export function unknownDurationTranscript(
	duration: number,
	feedback: string,
	skills = false,
	begin = start,
) {
	return transcript(duration, feedback, skills, begin).replace(
		`"timestamp":"${new Date(begin + duration * 1000).toISOString()}"`,
		`"timestamp":"${new Date(begin - 1000).toISOString()}"`,
	);
}

/**
 * Registers one test file's API servers (usage-event cutover off and all) and
 * the members named in `members`, at indexes 0, 1, ... Every file gets its own
 * servers, members and run id: Bun loads this module once for all the files of
 * a run, so nothing here may be shared between them.
 */
export function setUpAgentRunsDashboard(members: readonly string[]) {
	const ch = getClickhouse();
	const run = crypto.randomUUID();
	const users: { id: string; token: string }[] = [];
	let revision = Date.now();
	let legacy: ApiTestServer | undefined;
	let events: ApiTestServer | undefined;

	beforeAll(async () => {
		legacy = await startApiTestServer({
			GITHUB_EVIDENCE_UI_ENABLED: "true",
			USAGE_EVENT_ANALYTICS_CUTOVER_MODE: "off",
		});
		events = await startApiTestServer({
			GITHUB_EVIDENCE_UI_ENABLED: "true",
			USAGE_EVENT_ANALYTICS_CUTOVER_MODE: "all",
		});
		await workspaces(...members);
	});
	afterAll(async () => {
		await legacy?.stop();
		await events?.stop();
		const organizations = users.map((user) => user.id);
		await Promise.all(
			[
				"claude_sessions",
				"session_analytics",
				"session_language_signals",
				"usage_events",
			].map((table) =>
				ch.execute({
					query: `ALTER TABLE rudel.${table} DELETE WHERE organization_id IN {organizations:Array(String)}`,
					query_params: { organizations },
				}),
			),
		);
		await sqlClient`DELETE FROM organization WHERE id = ANY(${organizations})`;
		await sqlClient`DELETE FROM "user" WHERE id = ANY(${organizations})`;
	});

	function servers() {
		assert(legacy && events);
		return { legacy, events };
	}

	function user(index: number) {
		const member = users[index];
		assert(member);
		return member;
	}

	/**
	 * Signs up one member per name, each in a workspace of their own, and
	 * returns their indexes. A test that reads workspace-wide totals takes its
	 * own workspace, so no other test's sessions reach them in any order.
	 */
	async function workspaces(...names: string[]): Promise<number[]> {
		const { legacy: server } = servers();
		const created = await Promise.all(
			names.map(async (name) => {
				const response = await fetch(
					`${server.baseUrl}/api/auth/sign-up/email`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							name,
							email: `${name}-${run}@example.test`,
							password: `test-${run}`,
						}),
					},
				);
				expect(response.status, server.readOutput()).toBe(200);
				const result = z
					.object({ token: z.string(), user: z.object({ id: z.string() }) })
					.parse(await response.json());
				return { id: result.user.id, token: result.token };
			}),
		);
		return created.map((member) => users.push(member) - 1);
	}

	async function workspace(name: string): Promise<number> {
		const [index] = await workspaces(name);
		assert(index !== undefined);
		return index;
	}

	async function ingest(
		sessionId: string,
		content: string,
		userIndex = 0,
		indexed = true,
		projectPath = "/test/agent-runs",
		gitRemote?: string,
	) {
		const member = user(userIndex);
		const adapter = getAdapter("claude_code");
		const timestamps = adapter.extractTimestamps(content);
		assert(timestamps);
		const ingestedAt = new Date(++revision);
		const rawRevision = (BigInt(ingestedAt.getTime()) << 16n).toString();
		const input = {
			content,
			sessionId,
			projectPath,
			gitRemote,
			source: "claude_code" as const,
		};
		await adapter.ingest(ch, input, {
			ingestedAt,
			organizationId: member.id,
			revision: rawRevision,
			timestamps,
			userId: member.id,
		});
		if (indexed)
			await persistSessionLanguageSignalsWithExecutor(
				{
					content,
					organizationId: member.id,
					rawIngestedAt: ingestedAt,
					rawRevision,
					sessionDate: timestamps.sessionDate,
					sessionId,
					source: "claude_code",
					userId: member.id,
				},
				ch,
			);
		return { ingestedAt, rawRevision };
	}

	// Requests run one at a time, as they did before the file was split.
	// Fired together, one returned a 500 on a CI runner that no local run
	// reproduced; that cause is being chased with the concurrent version
	// (#568), and a failing request prints the server's log either way.
	let queue: Promise<unknown> = Promise.resolve();
	function dashboard(
		filters: Partial<CostDashboardInput> = {},
		userIndex = 0,
		endpoint = servers().legacy,
	) {
		const next = queue.then(() => request(filters, userIndex, endpoint));
		queue = next.catch(() => undefined);
		return next;
	}

	async function request(
		filters: Partial<CostDashboardInput>,
		userIndex: number,
		endpoint: ReturnType<typeof servers>["legacy"],
	) {
		const member = user(userIndex);
		const response = await fetch(
			`${endpoint.baseUrl}/rpc/analytics/overview/costs`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${member.token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					json: {
						startDate: day,
						endDate: day,
						requestedMetric: "agentRuns",
						...filters,
					},
				}),
			},
		);
		// A 500 says only "Internal Server Error"; the server's log has the cause.
		expect(
			response.status,
			`${await response.clone().text()}\n${endpoint.readOutput()}`,
		).toBe(200);
		return z.object({ json: CostDashboardSchema }).parse(await response.json())
			.json;
	}

	/** Both cutover modes: session analytics, and request-level usage events. */
	function bothModes() {
		const { legacy, events } = servers();
		return [legacy, events];
	}

	/**
	 * One session with usage events in a bound GitHub repository, with a merged
	 * pull request and two failed CI runs on it. Returns the session's remote.
	 */
	async function seedPullRequestActivity(
		repositoryId: string,
		model = "claude-sonnet-4-5",
		userIndex = 0,
		bindingFullName = `opalinehq/headline-${repositoryId}-${userIndex}-${run}`,
		remoteFullName = bindingFullName,
	) {
		const member = user(userIndex);
		const [owner, repositoryName] = bindingFullName.split("/");
		assert(owner && repositoryName);
		const repository = `github.com/${remoteFullName}`;
		const sessionId = `pr-${repositoryId}-${userIndex}-${run}`;
		const content = transcript(60, "Great", false, start, model);
		const { ingestedAt, rawRevision } = await ingest(
			sessionId,
			content,
			userIndex,
			true,
			`/test/${repositoryName}`,
			userIndex === 0
				? `git@github.com:${remoteFullName}.git`
				: `https://github.com/${remoteFullName}.git`,
		);
		const extraction = extractUsageEvents({
			content,
			organizationId: member.id,
			userId: member.id,
			sessionId,
			source: "claude_code",
			subagents: {},
		});
		expect(extraction.status).toBe("complete");
		await ingestRudelUsageEvents(
			ch,
			[
				...buildUsageEventRows(
					{
						contentSha256: "a".repeat(64),
						extraction,
						filterVersion: 1,
						generation: rawRevision,
						ingestedAt,
						organizationId: member.id,
						sessionDate: new Date(start),
						sessionId,
						source: "claude_code",
						userId: member.id,
					},
					[],
				),
			],
			{ validate: true },
		);
		await seedGitHubRepository(member.id, repositoryId, bindingFullName);
		await seedGitHubPull(
			member.id,
			repositoryId,
			148,
			new Date(start - 3600000).toISOString(),
			new Date(start).toISOString(),
		);
		for (const id of ["lint", "test"])
			await seedGitHubRun(
				member.id,
				repositoryId,
				id,
				new Date(start - 1800000).toISOString(),
				{ conclusion: "failure", pullNumber: 148 },
			);
		return repository;
	}

	return {
		run,
		servers,
		bothModes,
		user,
		workspace,
		ingest,
		dashboard,
		seedPullRequestActivity,
	};
}
