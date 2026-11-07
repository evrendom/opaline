import {
	afterAll,
	beforeAll,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRouterClient } from "@orpc/server";
import {
	LIVE_SESSION_PROTOCOL,
	type LiveSessionAppendInput,
	type LiveSessionSource,
} from "@rudel/api-routes";
import { liveSessionSqlClient, sqlClient } from "../db.js";
import { handleLiveSessionsMaintenanceRequest } from "../handlers/live-sessions-maintenance.js";
import { router } from "../router.js";
import {
	appendLiveSession,
	readLiveSessionState,
} from "../services/live-session/live-session-append.service.js";
import {
	cleanupLiveSessions,
	purgeLiveSessionObjectsOfOrganization,
} from "../services/live-session/live-session-cleanup.service.js";
import {
	createLiveSessionGate,
	LiveSessionStorageError,
} from "../services/live-session/live-session-gate.js";
import { deleteOrganizationPostgresData } from "../services/organization-deletion.service.js";
import { deleteUserPostgresData } from "../services/user-deletion.service.js";
import { FakeEvidenceR2 } from "./helpers/fake-evidence-r2.js";
import { startFakeR2S3Endpoint } from "./helpers/fake-r2-s3-endpoint.js";

setDefaultTimeout(60_000);

const RUN_ID = crypto.randomUUID().slice(0, 8);
const ORGANIZATION_ID = `live-org-${RUN_ID}`;
const OWNER_ID = `live-owner-${RUN_ID}`;
const MEMBER_ID = `live-member-${RUN_ID}`;
const OUTSIDER_ID = `live-outsider-${RUN_ID}`;
const LIMITED_ID = `live-limited-${RUN_ID}`;
const LIMITED_ORGANIZATION_ID = `live-limited-org-${RUN_ID}`;
const CRON_SECRET = `live-sessions-cron-${RUN_ID}`;
const SECRET = `sk-ant-api03-${"CANARY".padEnd(93, "A")}AA`;

const fakeR2 = new FakeEvidenceR2();
const fakeR2Endpoint = startFakeR2S3Endpoint(fakeR2);
const TEST_ENVIRONMENT: Record<string, string | undefined> = {
	CRON_SECRET,
	LIVE_SESSIONS_ENABLED: undefined,
	LIVE_SESSIONS_WORKSPACES: undefined,
	R2_ACCESS_KEY_ID: "test-access-key",
	R2_ACCOUNT_ID: "test-account",
	R2_ENDPOINT: fakeR2Endpoint.url.origin,
	R2_SECRET_ACCESS_KEY: "test-secret-key",
	RATE_LIMIT_LIVE_SESSION_REQUESTS_MAX: undefined,
	SESSION_INGEST_QUIESCED: undefined,
};
const previousEnvironment = new Map(
	Object.keys(TEST_ENVIRONMENT).map((name) => [name, process.env[name]]),
);

beforeAll(async () => {
	setEnvironment(TEST_ENVIRONMENT);
	for (const userId of [OWNER_ID, MEMBER_ID, OUTSIDER_ID, LIMITED_ID]) {
		await insertUser(userId);
	}
	await insertOrganization(ORGANIZATION_ID, [
		[OWNER_ID, "owner"],
		[MEMBER_ID, "member"],
	]);
	await insertOrganization(LIMITED_ORGANIZATION_ID, [[LIMITED_ID, "owner"]]);
});

afterAll(async () => {
	setEnvironment(Object.fromEntries(previousEnvironment));
	await sqlClient`
		DELETE FROM organization
		WHERE id IN (${ORGANIZATION_ID}, ${LIMITED_ORGANIZATION_ID})
	`;
	await sqlClient`
		DELETE FROM "user"
		WHERE id IN (${OWNER_ID}, ${MEMBER_ID}, ${OUTSIDER_ID}, ${LIMITED_ID})
	`;
	await fakeR2Endpoint.stop(true);
});

describe("live session appends", () => {
	test("follow the protocol per stream and store each chunk's filtered lines once", async () => {
		const owner = cliClient(OWNER_ID);
		const sessionId = newSessionId();
		const [first, second, third] = [
			transcriptLine(0),
			JSON.stringify({ type: "user", token: SECRET }),
			transcriptLine(2),
		];
		const subagentLine = transcriptLine(100);
		const request = appendInput(sessionId, [
			{
				agentId: null,
				lines: [first, second],
				previousLineSha256: null,
				startLine: 0,
			},
			{
				agentId: "b-agent",
				lines: [subagentLine],
				previousLineSha256: null,
				startLine: 0,
			},
		]);

		expect(await owner.liveSession.append(request)).toEqual({
			streams: [
				{
					agentId: null,
					committedLines: 2,
					lastLineSha256: sha256(second),
					status: "appended",
				},
				{
					agentId: "b-agent",
					committedLines: 1,
					lastLineSha256: sha256(subagentLine),
					status: "appended",
				},
			],
		});
		const mainKey = chunkKey(sessionId, "main", 0, 0);
		const stored = readObject(mainKey);
		expect(stored.endsWith("\n")).toBe(true);
		expect(stored).not.toContain(SECRET);
		expect(stored.split("\n")).toEqual([
			first,
			expect.stringContaining("[REDACTED:"),
			"",
		]);

		// The response was lost: the same chunk again changes nothing.
		const puts = fakeR2.putKeys.length;
		expect(await owner.liveSession.append(request)).toEqual({
			streams: [
				{
					agentId: null,
					committedLines: 2,
					lastLineSha256: sha256(second),
					status: "already-committed",
				},
				{
					agentId: "b-agent",
					committedLines: 1,
					lastLineSha256: sha256(subagentLine),
					status: "already-committed",
				},
			],
		});
		expect(fakeR2.putKeys.length).toBe(puts);

		const next = await owner.liveSession.append(
			appendInput(sessionId, [
				{
					agentId: null,
					lines: [third],
					previousLineSha256: sha256(second),
					startLine: 2,
				},
				{
					agentId: "a-agent",
					lines: [subagentLine],
					previousLineSha256: null,
					startLine: 0,
				},
				{
					agentId: "b-agent",
					lines: [],
					previousLineSha256: sha256(subagentLine),
					startLine: 1,
				},
			]),
		);
		expect(next.streams.map((stream) => stream.status)).toEqual([
			"appended",
			"appended",
			"already-committed",
		]);
		expect(readObject(chunkKey(sessionId, "main", 0, 2))).toBe(`${third}\n`);

		// A gap, and a previous line that does not match, are both out of sync.
		const outOfSync = await owner.liveSession.append(
			appendInput(sessionId, [
				{
					agentId: null,
					lines: [transcriptLine(9)],
					previousLineSha256: sha256(third),
					startLine: 9,
				},
				{
					agentId: "a-agent",
					lines: [transcriptLine(1)],
					previousLineSha256: sha256(first),
					startLine: 1,
				},
			]),
		);
		expect(outOfSync.streams).toEqual([
			{
				agentId: null,
				committedLines: 3,
				lastLineSha256: sha256(third),
				status: "out-of-sync",
			},
			{
				agentId: "a-agent",
				committedLines: 1,
				lastLineSha256: sha256(subagentLine),
				status: "out-of-sync",
			},
		]);

		expect(await owner.liveSession.state(target(sessionId))).toEqual({
			ended: false,
			streams: [
				{ agentId: null, committedLines: 3, lastLineSha256: sha256(third) },
				{
					agentId: "a-agent",
					committedLines: 1,
					lastLineSha256: sha256(subagentLine),
				},
				{
					agentId: "b-agent",
					committedLines: 1,
					lastLineSha256: sha256(subagentLine),
				},
			],
		});

		// A reset starts the stream over in a new generation.
		const restart = transcriptLine(50);
		expect(
			await owner.liveSession.append(
				appendInput(sessionId, [
					{
						agentId: null,
						lines: [restart],
						previousLineSha256: null,
						reset: true,
						startLine: 0,
					},
				]),
			),
		).toEqual({
			streams: [
				{
					agentId: null,
					committedLines: 1,
					lastLineSha256: sha256(restart),
					status: "appended",
				},
			],
		});
		expect(readObject(chunkKey(sessionId, "main", 1, 0))).toBe(`${restart}\n`);
		expect(readObject(mainKey)).toContain(first);

		// `ended` ends the session; new lines resume it.
		await owner.liveSession.append(appendInput(sessionId, [], { ended: true }));
		expect((await owner.liveSession.state(target(sessionId))).ended).toBe(true);
		await owner.liveSession.append(
			appendInput(sessionId, [
				{
					agentId: null,
					lines: [transcriptLine(51)],
					previousLineSha256: sha256(restart),
					startLine: 1,
				},
			]),
		);
		expect((await owner.liveSession.state(target(sessionId))).ended).toBe(
			false,
		);
	});

	test("refuse requests that name a stream twice, carry a newline or too many lines, or NUL in stored text", async () => {
		const owner = cliClient(OWNER_ID);
		const sessionId = newSessionId();
		for (const streams of [
			[
				{
					agentId: "x",
					lines: [transcriptLine(0)],
					previousLineSha256: null,
					startLine: 0,
				},
				{ agentId: "x", lines: [], previousLineSha256: null, startLine: 0 },
			],
			[
				{
					agentId: null,
					lines: [`${transcriptLine(0)}\n`],
					previousLineSha256: null,
					startLine: 0,
				},
			],
			Array.from({ length: 3 }, (_, index) => ({
				agentId: `stream-${index}`,
				lines: Array.from({ length: 7_000 }, () => ""),
				previousLineSha256: null,
				startLine: 0,
			})),
		]) {
			await expect(
				owner.liveSession.append(appendInput(sessionId, streams)),
			).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
		}
		await expect(
			owner.liveSession.append(
				appendInput(
					sessionId,
					[
						{
							agentId: null,
							lines: [transcriptLine(0)],
							previousLineSha256: null,
							startLine: 0,
						},
					],
					{ gitBranch: "main\u0000" },
				),
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
		await expect(
			owner.liveSession.state({
				...target(sessionId),
				organizationId: "org\u0000",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
		expect(await countRows("live_session", sessionId)).toBe(0);
	});

	test("commit concurrent copies of the same chunk once", async () => {
		const owner = cliClient(OWNER_ID);
		const sessionId = newSessionId();
		const request = appendInput(sessionId, [
			{
				agentId: null,
				lines: [transcriptLine(0), transcriptLine(1)],
				previousLineSha256: null,
				startLine: 0,
			},
		]);
		const results = await Promise.all([
			owner.liveSession.append(request),
			owner.liveSession.append(request),
			owner.liveSession.append(request),
		]);
		expect(results.map((result) => result.streams[0]?.status).sort()).toEqual([
			"already-committed",
			"already-committed",
			"appended",
		]);
		expect(await countRows("live_session_chunk", sessionId)).toBe(1);
	});

	test("do not answer an unknown session's empty or unaligned lines by creating it", async () => {
		const owner = cliClient(OWNER_ID);
		const sessionId = newSessionId();
		expect(
			await owner.liveSession.append(
				appendInput(
					sessionId,
					[
						{
							agentId: null,
							lines: [transcriptLine(3)],
							previousLineSha256: sha256("x"),
							startLine: 3,
						},
						{
							agentId: "sub",
							lines: [],
							previousLineSha256: null,
							startLine: 0,
						},
					],
					{ ended: true },
				),
			),
		).toEqual({
			streams: [
				{
					agentId: null,
					committedLines: 0,
					lastLineSha256: null,
					status: "out-of-sync",
				},
				{
					agentId: "sub",
					committedLines: 0,
					lastLineSha256: null,
					status: "already-committed",
				},
			],
		});
		expect(await owner.liveSession.state(target(sessionId))).toEqual({
			ended: false,
			streams: [],
		});
		expect(await countRows("live_session", sessionId)).toBe(0);
	});

	test("belong to the member who streams or uploaded the session, inside their workspaces", async () => {
		const owner = cliClient(OWNER_ID);
		const member = cliClient(MEMBER_ID);
		const streamed = newSessionId();
		await owner.liveSession.append(
			appendInput(streamed, [
				{
					agentId: null,
					lines: [transcriptLine(0)],
					previousLineSha256: null,
					startLine: 0,
				},
			]),
		);
		const conflict = { code: "SESSION_OWNERSHIP_CONFLICT", status: 409 };
		await expect(
			member.liveSession.state(target(streamed)),
		).rejects.toMatchObject(conflict);
		await expect(
			member.liveSession.append(
				appendInput(streamed, [
					{
						agentId: null,
						lines: [transcriptLine(1)],
						previousLineSha256: sha256(transcriptLine(0)),
						startLine: 1,
					},
				]),
			),
		).rejects.toMatchObject(conflict);

		const uploaded = newSessionId();
		await sqlClient`
			INSERT INTO session_ownership (organization_id, session_id, user_id)
			VALUES (${ORGANIZATION_ID}, ${uploaded}, ${OWNER_ID})
		`;
		const firstLine = appendInput(uploaded, [
			{
				agentId: null,
				lines: [transcriptLine(0)],
				previousLineSha256: null,
				startLine: 0,
			},
		]);
		await expect(member.liveSession.append(firstLine)).rejects.toMatchObject(
			conflict,
		);
		expect(await countRows("live_session", uploaded)).toBe(0);
		expect((await owner.liveSession.append(firstLine)).streams[0]?.status).toBe(
			"appended",
		);

		await expect(
			cliClient(OUTSIDER_ID).liveSession.append(firstLine),
		).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
	});
});

describe("live session appends under failure", () => {
	test("a write aborted for the client that lands late never replaces a committed chunk", async () => {
		const sessionId = newSessionId();
		const lines = Array.from({ length: 5 }, (_, index) =>
			transcriptLine(index),
		);
		let landLate: (() => Promise<void>) | undefined;
		const env = {
			database: liveSessionSqlClient,
			gate: createLiveSessionGate({ maxActive: 2, maxWaitMs: 1_000 }),
			now: () => new Date(),
			r2: {
				deleteObjects: (keys: readonly string[]) => fakeR2.deleteObjects(keys),
				putObject: async (
					input: Parameters<FakeEvidenceR2["putObject"]>[0],
				) => {
					if (!landLate) {
						landLate = () => fakeR2.putObject(input);
						throw new Error("Request aborted");
					}
					await fakeR2.putObject(input);
				},
			},
		};
		const owner = { ...target(sessionId), userId: OWNER_ID };
		await expect(
			appendLiveSession(
				owner,
				appendInput(sessionId, [
					{
						agentId: null,
						lines: lines.slice(0, 2),
						previousLineSha256: null,
						startLine: 0,
					},
				]),
				env,
			),
		).rejects.toBeInstanceOf(LiveSessionStorageError);
		// The client retries with the lines that arrived meanwhile.
		expect(
			await appendLiveSession(
				owner,
				appendInput(sessionId, [
					{ agentId: null, lines, previousLineSha256: null, startLine: 0 },
				]),
				env,
			),
		).toMatchObject({ streams: [{ committedLines: 5, status: "appended" }] });
		assert(landLate);
		await landLate();
		const tail = await webClient(MEMBER_ID).analytics.sessions.liveTail({
			sessionId,
		});
		expect(tail.streams[0]?.lines).toEqual(lines);
	});

	test("state answers at once while appends wait on a slow R2", async () => {
		let release: () => void = () => {};
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const env = {
			database: liveSessionSqlClient,
			gate: createLiveSessionGate({ maxActive: 4, maxWaitMs: 30_000 }),
			now: () => new Date(),
			r2: {
				deleteObjects: (keys: readonly string[]) => fakeR2.deleteObjects(keys),
				putObject: async (
					input: Parameters<FakeEvidenceR2["putObject"]>[0],
				) => {
					await blocked;
					await fakeR2.putObject(input);
				},
			},
		};
		const sessions = Array.from({ length: 12 }, () => newSessionId());
		const appends = sessions.map((sessionId) =>
			appendLiveSession(
				{ ...target(sessionId), userId: OWNER_ID },
				appendInput(sessionId, [
					{
						agentId: null,
						lines: [transcriptLine(0)],
						previousLineSha256: null,
						startLine: 0,
					},
				]),
				env,
			),
		);
		try {
			await Bun.sleep(100);
			const started = performance.now();
			expect(
				await readLiveSessionState(
					{ ...target(newSessionId()), userId: OWNER_ID },
					{ database: liveSessionSqlClient },
				),
			).toEqual({ ended: false, streams: [] });
			expect(performance.now() - started).toBeLessThan(1_000);
		} finally {
			release();
		}
		for (const result of await Promise.all(appends)) {
			expect(result.streams[0]?.status).toBe("appended");
		}
	});

	test("ending an ended session again leaves its activity time alone", async () => {
		const owner = cliClient(OWNER_ID);
		const sessionId = newSessionId();
		await owner.liveSession.append(
			appendInput(sessionId, [
				{
					agentId: null,
					lines: [transcriptLine(0)],
					previousLineSha256: null,
					startLine: 0,
				},
			]),
		);
		await owner.liveSession.append(appendInput(sessionId, [], { ended: true }));
		const activity = async () => {
			const [row] = await sqlClient<Array<{ at: string }>>`
				SELECT last_activity_at::text AS at FROM live_session
				WHERE organization_id = ${ORGANIZATION_ID} AND session_id = ${sessionId}
			`;
			return row?.at;
		};
		const ended = await activity();
		await Bun.sleep(20);
		await owner.liveSession.append(appendInput(sessionId, [], { ended: true }));
		expect(await activity()).toBe(ended);
		expect((await owner.liveSession.state(target(sessionId))).ended).toBe(true);
	});
});

describe("Codex live sessions", () => {
	test("stream apart from a Claude Code session with the same id, sub-agent threads included", async () => {
		const owner = cliClient(OWNER_ID);
		const threadId = newSessionId();
		const childThreadId = crypto.randomUUID();
		const claudeLine = transcriptLine(0);
		await owner.liveSession.append(
			appendInput(threadId, [
				{
					agentId: null,
					lines: [claudeLine],
					previousLineSha256: null,
					startLine: 0,
				},
			]),
		);
		const sessionMeta = JSON.stringify({
			timestamp: "2026-10-13T11:00:00.000Z",
			type: "session_meta",
			payload: { id: threadId, cwd: "/work/repo", originator: "codex_cli_rs" },
		});
		const main = [sessionMeta, codexLine(1, "user"), codexLine(2, "assistant")];
		const child = [codexLine(3, "user"), codexLine(4, "assistant")];
		expect(
			await owner.liveSession.append({
				...appendInput(threadId, [
					{
						agentId: null,
						lines: main,
						previousLineSha256: null,
						startLine: 0,
					},
					{
						agentId: childThreadId,
						lines: child,
						previousLineSha256: null,
						startLine: 0,
					},
				]),
				source: "codex",
			}),
		).toEqual({
			streams: [
				{
					agentId: null,
					committedLines: 3,
					lastLineSha256: sha256(main[2] ?? ""),
					status: "appended",
				},
				{
					agentId: childThreadId,
					committedLines: 2,
					lastLineSha256: sha256(child[1] ?? ""),
					status: "appended",
				},
			],
		});
		expect(readObject(chunkKey(threadId, "main", 0, 0, "codex"))).toBe(
			`${main.join("\n")}\n`,
		);
		expect(readObject(chunkKey(threadId, "main", 0, 0))).toBe(
			`${claudeLine}\n`,
		);
		expect((await owner.liveSession.state(target(threadId))).streams).toEqual([
			{ agentId: null, committedLines: 1, lastLineSha256: sha256(claudeLine) },
		]);
		expect(
			(await owner.liveSession.state(target(threadId, "codex"))).streams,
		).toEqual([
			{
				agentId: null,
				committedLines: 3,
				lastLineSha256: sha256(main[2] ?? ""),
			},
			{
				agentId: childThreadId,
				committedLines: 2,
				lastLineSha256: sha256(child[1] ?? ""),
			},
		]);

		const member = webClient(MEMBER_ID);
		expect(
			(await member.analytics.sessions.liveList()).sessions
				.filter((session) => session.sessionId === threadId)
				.map((session) => session.source)
				.sort(),
		).toEqual(["claude_code", "codex"]);
		const codexTail = await member.analytics.sessions.liveTail({
			sessionId: threadId,
			source: "codex",
		});
		expect(codexTail.session?.source).toBe("codex");
		expect(
			codexTail.streams.map((stream) => [stream.agentId, stream.lines]),
		).toEqual([
			[null, main],
			[childThreadId, child],
		]);
		expect(
			(
				await member.analytics.sessions.liveTail({
					sessionId: threadId,
					source: "claude_code",
				})
			).streams[0]?.lines,
		).toEqual([claudeLine]);

		await expect(
			cliClient(MEMBER_ID).liveSession.state(target(threadId, "codex")),
		).rejects.toMatchObject({ code: "SESSION_OWNERSHIP_CONFLICT" });
	});
});

describe("live session switches", () => {
	test("the kill switch, workspace list, ingest quiescence and missing R2 pause live updates", async () => {
		const owner = cliClient(OWNER_ID);
		const sessionId = newSessionId();
		const request = appendInput(sessionId, [
			{
				agentId: null,
				lines: [transcriptLine(0)],
				previousLineSha256: null,
				startLine: 0,
			},
		]);
		const disabled = (scope: "global" | "workspace") => ({
			code: "LIVE_SESSIONS_DISABLED",
			data: { pauseSeconds: 3_600, scope },
			status: 403,
		});

		expect((await owner.cli.authStatus()).capabilities?.liveSessions).toBe(
			true,
		);
		await withEnvironment({ LIVE_SESSIONS_ENABLED: "false" }, async () => {
			expect((await owner.cli.authStatus()).capabilities).toEqual({
				analysisLinkedUploads: true,
				dataExport: true,
				repositoryEvidenceImages: true,
				transcriptSlimming: true,
			});
			await expect(owner.liveSession.append(request)).rejects.toMatchObject(
				disabled("global"),
			);
			await expect(
				owner.liveSession.state(target(sessionId)),
			).rejects.toMatchObject(disabled("global"));
		});
		await withEnvironment(
			{ LIVE_SESSIONS_WORKSPACES: `other-${RUN_ID}` },
			async () => {
				await expect(owner.liveSession.append(request)).rejects.toMatchObject(
					disabled("workspace"),
				);
			},
		);
		await withEnvironment({ SESSION_INGEST_QUIESCED: "true" }, async () => {
			await expect(
				owner.liveSession.state(target(sessionId)),
			).rejects.toMatchObject(disabled("global"));
		});
		await withEnvironment({ R2_ACCOUNT_ID: undefined }, async () => {
			await expect(owner.liveSession.append(request)).rejects.toMatchObject(
				disabled("global"),
			);
		});
		expect(await countRows("live_session", sessionId)).toBe(0);

		await withEnvironment(
			{ LIVE_SESSIONS_WORKSPACES: `other-${RUN_ID},${ORGANIZATION_ID}` },
			async () => {
				expect(
					(await owner.liveSession.append(request)).streams[0]?.status,
				).toBe("appended");
			},
		);

		// A workspace that is not listed reads no live sessions either: the
		// list, the session's state and its detail are as without them.
		const member = webClient(MEMBER_ID);
		expect(
			(await member.analytics.sessions.detailInitial({ sessionId })).overview
				.session.sessionId,
		).toBe(sessionId);
		for (const environment of [
			{ LIVE_SESSIONS_WORKSPACES: `other-${RUN_ID}` },
			{ LIVE_SESSIONS_ENABLED: "false" },
		]) {
			await withEnvironment(environment, async () => {
				expect(
					(await member.analytics.sessions.liveList()).sessions.some(
						(session) => session.sessionId === sessionId,
					),
				).toBe(false);
				expect(await member.analytics.sessions.liveTail({ sessionId })).toEqual(
					{ session: null, streams: [], uploaded: false },
				);
				await expect(
					member.analytics.sessions.detailInitial({ sessionId }),
				).rejects.toMatchObject({ code: "NOT_FOUND" });
			});
		}
	});

	test("live updates are charged to their own budget, never the ingest budget", async () => {
		const limited = cliClient(LIMITED_ID);
		const sessionId = newSessionId();
		const lines = [transcriptLine(0), "é"];
		await withEnvironment(
			{ RATE_LIMIT_LIVE_SESSION_REQUESTS_MAX: "2" },
			async () => {
				const own = { organizationId: LIMITED_ORGANIZATION_ID };
				await limited.liveSession.append({
					...appendInput(sessionId, [
						{ agentId: null, lines, previousLineSha256: null, startLine: 0 },
					]),
					...own,
				});
				await limited.liveSession.state({ ...target(sessionId), ...own });
				await expect(
					limited.liveSession.state({ ...target(sessionId), ...own }),
				).rejects.toMatchObject({
					code: "TOO_MANY_REQUESTS",
					status: 429,
				});
			},
		);
		const counters = await sqlClient<
			Array<{ byteCount: string; limiterKey: string; requestCount: string }>
		>`
			SELECT limiter_key AS "limiterKey", request_count::text AS "requestCount", byte_count::text AS "byteCount"
			FROM ingest_rate_limit_counter
			WHERE user_id = ${LIMITED_ID}
		`;
		expect([...counters]).toEqual([
			{
				byteCount: String(
					Buffer.byteLength(lines.join("")) + lines.length * 256,
				),
				limiterKey: `live_session_user:${LIMITED_ID}`,
				requestCount: "2",
			},
		]);
	});
});

describe("live session reads", () => {
	test("list and tail sessions for readers of the session's detail", async () => {
		const owner = cliClient(OWNER_ID);
		const sessionId = newSessionId();
		const main = Array.from({ length: 450 }, (_, index) =>
			transcriptLine(index),
		);
		const subagent = Array.from({ length: 120 }, (_, index) =>
			transcriptLine(1_000 + index),
		);
		await owner.liveSession.append(
			appendInput(
				sessionId,
				[
					{
						agentId: null,
						lines: main.slice(0, 200),
						previousLineSha256: null,
						startLine: 0,
					},
					{
						agentId: "sub",
						lines: subagent,
						previousLineSha256: null,
						startLine: 0,
					},
				],
				{
					gitBranch: "feature/live",
					gitRemote: "git@github.com:example/repo.git",
				},
			),
		);
		await owner.liveSession.append(
			appendInput(sessionId, [
				{
					agentId: null,
					lines: main.slice(200),
					previousLineSha256: sha256(main[199] ?? ""),
					startLine: 200,
				},
			]),
		);
		const member = webClient(MEMBER_ID);

		const listed = (await member.analytics.sessions.liveList()).sessions.find(
			(session) => session.sessionId === sessionId,
		);
		expect(listed).toMatchObject({
			endedAt: null,
			gitBranch: "feature/live",
			gitRemote: "git@github.com:example/repo.git",
			projectPath: "/work/repo",
			source: "claude_code",
			userId: OWNER_ID,
		});

		const tail = await member.analytics.sessions.liveTail({ sessionId });
		expect(tail.session?.sessionId).toBe(sessionId);
		expect(tail.streams).toEqual([
			{
				agentId: null,
				generation: 0,
				firstLine: 50,
				nextLine: 450,
				lines: main.slice(50),
				truncatedBefore: true,
			},
			{
				agentId: "sub",
				generation: 0,
				firstLine: 20,
				nextLine: 120,
				lines: subagent.slice(20),
				truncatedBefore: true,
			},
		]);

		const more = [transcriptLine(450), transcriptLine(451)];
		await owner.liveSession.append(
			appendInput(sessionId, [
				{
					agentId: null,
					lines: more,
					previousLineSha256: sha256(main[449] ?? ""),
					startLine: 450,
				},
			]),
		);
		const cursor = [
			{ agentId: null, generation: 0, nextLine: 450 },
			{ agentId: "sub", generation: 3, nextLine: 5 },
		];
		expect(
			(await member.analytics.sessions.liveTail({ sessionId, cursor })).streams,
		).toEqual([
			{
				agentId: null,
				generation: 0,
				firstLine: 450,
				nextLine: 452,
				lines: more,
				truncatedBefore: false,
			},
			{
				agentId: "sub",
				generation: 0,
				firstLine: 20,
				nextLine: 120,
				lines: subagent.slice(20),
				truncatedBefore: true,
			},
		]);
		expect(
			await member.analytics.sessions.liveTail({ sessionId: newSessionId() }),
		).toEqual({ session: null, streams: [], uploaded: false });

		await sqlClient`UPDATE organization SET own_sessions_only = true WHERE id = ${ORGANIZATION_ID}`;
		try {
			expect(
				(await member.analytics.sessions.liveList()).sessions.some(
					(session) => session.userId === OWNER_ID,
				),
			).toBe(false);
			await expect(
				member.analytics.sessions.liveTail({ sessionId }),
			).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			expect(
				(await webClient(OWNER_ID).analytics.sessions.liveTail({ sessionId }))
					.session?.userId,
			).toBe(OWNER_ID);
		} finally {
			await sqlClient`UPDATE organization SET own_sessions_only = false WHERE id = ${ORGANIZATION_ID}`;
		}

		expect(
			(await member.analytics.sessions.liveTail({ sessionId })).uploaded,
		).toBe(false);
		await sqlClient`
			INSERT INTO session_ownership (organization_id, session_id, user_id, last_ingested_at)
			VALUES (${ORGANIZATION_ID}, ${sessionId}, ${OWNER_ID}, NOW())
		`;
		expect(
			(await member.analytics.sessions.liveTail({ sessionId })).uploaded,
		).toBe(true);

		await sqlClient`
			UPDATE live_session SET last_activity_at = NOW() - INTERVAL '25 hours'
			WHERE organization_id = ${ORGANIZATION_ID} AND session_id = ${sessionId}
		`;
		expect(
			(await member.analytics.sessions.liveList()).sessions.some(
				(session) => session.sessionId === sessionId,
			),
		).toBe(false);
	});

	test("a tail returns at most 3 MiB: a tail its newest lines, a cursor its oldest", async () => {
		const owner = cliClient(OWNER_ID);
		const sessionId = newSessionId();
		const lines = Array.from({ length: 4 }, (_, index) =>
			JSON.stringify({
				type: "assistant",
				text: `${index} ${"live words ".repeat(90_900)}`,
			}),
		);
		for (const [index, line] of lines.entries()) {
			await owner.liveSession.append(
				appendInput(sessionId, [
					{
						agentId: null,
						lines: [line],
						previousLineSha256:
							index === 0 ? null : sha256(lines[index - 1] ?? ""),
						startLine: index,
					},
				]),
			);
		}
		const member = webClient(MEMBER_ID);

		const [tail] = (await member.analytics.sessions.liveTail({ sessionId }))
			.streams;
		expect(tail).toEqual({
			agentId: null,
			generation: 0,
			firstLine: 1,
			nextLine: 4,
			lines: lines.slice(1),
			truncatedBefore: true,
		});
		const [continued] = (
			await member.analytics.sessions.liveTail({
				sessionId,
				cursor: [{ agentId: null, generation: 0, nextLine: 0 }],
			})
		).streams;
		expect(continued).toEqual({
			agentId: null,
			generation: 0,
			firstLine: 0,
			nextLine: 3,
			lines: lines.slice(0, 3),
			truncatedBefore: false,
		});
	});
});

describe("live session read bounds", () => {
	test("without a source, the reader's own session comes before another member's with the same id", async () => {
		const sessionId = newSessionId();
		await cliClient(MEMBER_ID).liveSession.append({
			...appendInput(sessionId, [
				{
					agentId: null,
					lines: [codexLine(0, "user")],
					previousLineSha256: null,
					startLine: 0,
				},
			]),
			source: "codex",
		});
		await cliClient(OWNER_ID).liveSession.append(
			appendInput(sessionId, [
				{
					agentId: null,
					lines: [transcriptLine(0)],
					previousLineSha256: null,
					startLine: 0,
				},
			]),
		);
		await sqlClient`UPDATE organization SET own_sessions_only = true WHERE id = ${ORGANIZATION_ID}`;
		try {
			const tail = await webClient(MEMBER_ID).analytics.sessions.liveTail({
				sessionId,
			});
			expect(tail.session).toMatchObject({
				source: "codex",
				userId: MEMBER_ID,
			});
		} finally {
			await sqlClient`UPDATE organization SET own_sessions_only = false WHERE id = ${ORGANIZATION_ID}`;
		}
	});

	test("a large main transcript leaves subagents their share of a response", async () => {
		const owner = cliClient(OWNER_ID);
		const sessionId = newSessionId();
		const lines = Array.from({ length: 4 }, (_, index) =>
			JSON.stringify({
				type: "assistant",
				text: `${index} ${"live words ".repeat(90_900)}`,
			}),
		);
		for (const [index, line] of lines.entries()) {
			await owner.liveSession.append(
				appendInput(sessionId, [
					{
						agentId: null,
						lines: [line],
						previousLineSha256:
							index === 0 ? null : sha256(lines[index - 1] ?? ""),
						startLine: index,
					},
					...(index === 0
						? [
								{
									agentId: "sub",
									lines: [transcriptLine(9)],
									previousLineSha256: null,
									startLine: 0,
								},
							]
						: []),
				]),
			);
		}
		const [main, subagent] = (
			await webClient(MEMBER_ID).analytics.sessions.liveTail({ sessionId })
		).streams;
		expect(main).toMatchObject({ firstLine: 2, nextLine: 4 });
		expect(subagent?.lines).toEqual([transcriptLine(9)]);
	});

	test("a tail reads about its response size from R2, however long the stream or old the cursor", async () => {
		const owner = cliClient(OWNER_ID);
		const member = webClient(MEMBER_ID);
		const sessionId = newSessionId();
		const lines = Array.from({ length: 40 }, (_, index) =>
			JSON.stringify({
				type: "assistant",
				text: `${index} ${"live ".repeat(40_000)}`,
			}),
		);
		for (const [index, line] of lines.entries()) {
			await owner.liveSession.append(
				appendInput(sessionId, [
					{
						agentId: null,
						lines: [line],
						previousLineSha256:
							index === 0 ? null : sha256(lines[index - 1] ?? ""),
						startLine: index,
					},
				]),
			);
		}
		// 40 chunks of 200 KB: 8 MB stored, 3 MiB read and returned per response.
		const readsBefore = fakeR2.readKeys.length;
		const [tail] = (await member.analytics.sessions.liveTail({ sessionId }))
			.streams;
		expect(tail).toMatchObject({
			firstLine: 25,
			nextLine: 40,
			truncatedBefore: true,
		});
		expect(fakeR2.readKeys.length - readsBefore).toBe(15);
		const readsBeforeCursor = fakeR2.readKeys.length;
		const [continued] = (
			await member.analytics.sessions.liveTail({
				sessionId,
				cursor: [{ agentId: null, generation: 0, nextLine: 0 }],
			})
		).streams;
		expect(continued).toMatchObject({
			firstLine: 0,
			nextLine: 15,
			truncatedBefore: false,
		});
		expect(fakeR2.readKeys.length - readsBeforeCursor).toBe(15);
	});

	test("a cursor more than a tail behind gets the tail, and one stream reads at most 64 objects", async () => {
		const owner = cliClient(OWNER_ID);
		const member = webClient(MEMBER_ID);
		const sessionId = newSessionId();
		const lines = Array.from({ length: 600 }, (_, index) =>
			transcriptLine(index),
		);
		for (let start = 0; start < 600; start += 200) {
			await owner.liveSession.append(
				appendInput(sessionId, [
					{
						agentId: null,
						lines: lines.slice(start, start + 200),
						previousLineSha256:
							start === 0 ? null : sha256(lines[start - 1] ?? ""),
						startLine: start,
					},
				]),
			);
		}
		const readsBefore = fakeR2.readKeys.length;
		const [behind] = (
			await member.analytics.sessions.liveTail({
				sessionId,
				cursor: [{ agentId: null, generation: 0, nextLine: 0 }],
			})
		).streams;
		expect(behind).toEqual({
			agentId: null,
			generation: 0,
			firstLine: 200,
			nextLine: 600,
			lines: lines.slice(200),
			truncatedBefore: true,
		});
		// Lines 200-599 are in the second and third chunk only.
		expect(fakeR2.readKeys.length - readsBefore).toBe(2);

		const small = newSessionId();
		for (let index = 0; index < 70; index += 1) {
			await owner.liveSession.append(
				appendInput(small, [
					{
						agentId: null,
						lines: [lines[index] ?? ""],
						previousLineSha256:
							index === 0 ? null : sha256(lines[index - 1] ?? ""),
						startLine: index,
					},
				]),
			);
		}
		const readsBeforeSmall = fakeR2.readKeys.length;
		const [newest] = (
			await member.analytics.sessions.liveTail({ sessionId: small })
		).streams;
		expect(newest).toMatchObject({
			firstLine: 6,
			nextLine: 70,
			truncatedBefore: true,
		});
		expect(fakeR2.readKeys.length - readsBeforeSmall).toBe(64);
	});
});

describe("live session cleanup", () => {
	test("the hourly cron deletes quiet sessions and superseded generations, objects first", async () => {
		const owner = cliClient(OWNER_ID);
		const quiet = newSessionId();
		const reset = newSessionId();
		for (const sessionId of [quiet, reset]) {
			await owner.liveSession.append(
				appendInput(sessionId, [
					{
						agentId: null,
						lines: [transcriptLine(0)],
						previousLineSha256: null,
						startLine: 0,
					},
					{
						agentId: "sub",
						lines: [transcriptLine(1)],
						previousLineSha256: null,
						startLine: 0,
					},
				]),
			);
		}
		await owner.liveSession.append(
			appendInput(reset, [
				{
					agentId: null,
					lines: [transcriptLine(2)],
					previousLineSha256: null,
					reset: true,
					startLine: 0,
				},
			]),
		);
		await sqlClient`
			UPDATE live_session SET last_activity_at = NOW() - INTERVAL '73 hours'
			WHERE organization_id = ${ORGANIZATION_ID} AND session_id = ${quiet}
		`;
		// An append whose transaction failed left an object without a row.
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
		const orphan = chunkKey(newSessionId(), "main", 0, 0);
		const recentOrphan = chunkKey(newSessionId(), "main", 0, 0);
		const committed = chunkKey(reset, "main", 1, 0);
		for (const [key, lastModified] of [
			[orphan, twoHoursAgo],
			[recentOrphan, new Date()],
			[committed, twoHoursAgo],
		] as const) {
			fakeR2.objects.set(key, {
				bytes: fakeR2.objects.get(key)?.bytes ?? new Uint8Array([10]),
				lastModified,
				metadata: {},
			});
		}

		const unauthorized = await handleLiveSessionsMaintenanceRequest(
			new Request("http://localhost/api/cron/live-sessions"),
		);
		expect(unauthorized.status).toBe(401);
		const response = await handleLiveSessionsMaintenanceRequest(
			new Request("http://localhost/api/cron/live-sessions", {
				headers: { Authorization: `Bearer ${CRON_SECRET}` },
			}),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			liveSessions: { enabled: true, hasMore: false },
			ok: true,
		});

		expect(fakeR2.objects.has(orphan)).toBe(false);
		expect(fakeR2.objects.has(recentOrphan)).toBe(true);
		expect(fakeR2.objects.has(committed)).toBe(true);
		expect(await countRows("live_session", quiet)).toBe(0);
		expect(await countRows("live_session_chunk", quiet)).toBe(0);
		for (const key of [
			chunkKey(quiet, "main", 0, 0),
			chunkKey(quiet, "agent-sub", 0, 0),
		]) {
			expect(fakeR2.objects.has(key)).toBe(false);
			expect(fakeR2.deletedKeys).toContain(key);
		}
		expect(fakeR2.objects.has(chunkKey(reset, "main", 0, 0))).toBe(false);
		expect(fakeR2.objects.has(chunkKey(reset, "main", 1, 0))).toBe(true);
		expect(fakeR2.objects.has(chunkKey(reset, "agent-sub", 0, 0))).toBe(true);
		expect(await countRows("live_session_chunk", reset)).toBe(2);
		expect(
			(
				await webClient(OWNER_ID).analytics.sessions.liveTail({
					sessionId: reset,
				})
			).streams,
		).toEqual([
			{
				agentId: null,
				generation: 1,
				firstLine: 0,
				nextLine: 1,
				lines: [transcriptLine(2)],
				truncatedBefore: false,
			},
			{
				agentId: "sub",
				generation: 0,
				firstLine: 0,
				nextLine: 1,
				lines: [transcriptLine(1)],
				truncatedBefore: false,
			},
		]);
	});

	test("a session whose objects cannot be deleted is kept for the next run, the rest are cleaned", async () => {
		const owner = cliClient(OWNER_ID);
		const failing = newSessionId();
		const deletable = newSessionId();
		for (const sessionId of [failing, deletable]) {
			await owner.liveSession.append(
				appendInput(sessionId, [
					{
						agentId: null,
						lines: [transcriptLine(0)],
						previousLineSha256: null,
						startLine: 0,
					},
				]),
			);
			await sqlClient`
				UPDATE live_session SET last_activity_at = NOW() - INTERVAL '73 hours'
				WHERE organization_id = ${ORGANIZATION_ID} AND session_id = ${sessionId}
			`;
		}
		const failingKey = chunkKey(failing, "main", 0, 0);
		try {
			const result = await cleanupLiveSessions({
				database: sqlClient,
				deadline: { deadlineAt: Date.now() + 60_000, now: () => Date.now() },
				now: () => new Date(),
				r2: {
					deleteObjects: async (keys) => {
						if (keys.includes(failingKey)) throw new Error("R2 unavailable");
						await fakeR2.deleteObjects(keys);
					},
					listObjects: (input) => fakeR2.listObjects(input),
				},
				random: () => 0,
			});
			expect(result.failedSessions).toBe(1);
			expect(await countRows("live_session", failing)).toBe(1);
			expect(fakeR2.objects.has(failingKey)).toBe(true);
			expect(await countRows("live_session", deletable)).toBe(0);
			expect(fakeR2.objects.has(chunkKey(deletable, "main", 0, 0))).toBe(false);
		} finally {
			await sqlClient`
				DELETE FROM live_session
				WHERE organization_id = ${ORGANIZATION_ID} AND session_id = ${failing}
			`;
		}
	});

	test("workspace and account deletions purge live session objects", async () => {
		const userId = `live-purge-user-${RUN_ID}`;
		const organizationId = `live-purge-org-${RUN_ID}`;
		await insertUser(userId);
		await insertOrganization(organizationId, [[userId, "owner"]]);
		const client = cliClient(userId);
		const inWorkspace = newSessionId();
		const inSharedWorkspace = newSessionId();
		await client.liveSession.append({
			...appendInput(inWorkspace, [
				{
					agentId: null,
					lines: [transcriptLine(0)],
					previousLineSha256: null,
					startLine: 0,
				},
			]),
			organizationId,
		});
		await sqlClient`
			INSERT INTO member (id, organization_id, user_id, role)
			VALUES (${`live-purge-member-${RUN_ID}`}, ${ORGANIZATION_ID}, ${userId}, 'member')
		`;
		await client.liveSession.append(
			appendInput(inSharedWorkspace, [
				{
					agentId: null,
					lines: [transcriptLine(0)],
					previousLineSha256: null,
					startLine: 0,
				},
			]),
		);
		try {
			// An object whose append never committed has no row to snapshot.
			const uncommitted = buildKey(
				organizationId,
				newSessionId(),
				"main",
				0,
				0,
			);
			fakeR2.objects.set(uncommitted, {
				bytes: new Uint8Array([10]),
				lastModified: new Date(),
				metadata: {},
			});
			await deleteOrganizationPostgresData({ organizationId, userId });
			expect(await readPurgeObjects("organization", organizationId)).toEqual([
				buildKey(organizationId, inWorkspace, "main", 0, 0),
			]);
			expect(await countRows("live_session", inWorkspace)).toBe(0);
			// Each purge pass also deletes the workspace's objects by key prefix.
			expect(
				await purgeLiveSessionObjectsOfOrganization(organizationId, fakeR2),
			).toBe(2);
			expect(fakeR2.objects.has(uncommitted)).toBe(false);
			expect(
				fakeR2.objects.has(buildKey(organizationId, inWorkspace, "main", 0, 0)),
			).toBe(false);
			expect(
				fakeR2.objects.has(chunkKey(inSharedWorkspace, "main", 0, 0)),
			).toBe(true);

			await deleteUserPostgresData(userId, { sqlClient });
			expect(await readPurgeObjects("account", userId)).toEqual([
				chunkKey(inSharedWorkspace, "main", 0, 0),
			]);
			expect(await countRows("live_session", inSharedWorkspace)).toBe(0);
		} finally {
			await sqlClient`
				DELETE FROM clickhouse_purge_job
				WHERE (target_type = 'organization' AND target_id = ${organizationId})
					OR (target_type = 'account' AND target_id = ${userId})
			`;
			await sqlClient`DELETE FROM organization WHERE id = ${organizationId}`;
			await sqlClient`DELETE FROM "user" WHERE id = ${userId}`;
		}
	});
});

type TestClient = ReturnType<typeof createTestClient>;

describe("live session detail", () => {
	test("a running session reads like an upload: its turns from its live lines, again as they land", async () => {
		const owner = cliClient(OWNER_ID);
		const member = webClient(MEMBER_ID);
		const sessionId = newSessionId();
		const opening = [
			conversationLine(sessionId, 0, "user"),
			conversationLine(sessionId, 1, "assistant"),
		];
		await owner.liveSession.append(
			appendInput(
				sessionId,
				[
					{
						agentId: null,
						lines: opening,
						previousLineSha256: null,
						startLine: 0,
					},
				],
				{
					gitBranch: "feature/live",
					gitRemote: "git@github.com:example/repo.git",
				},
			),
		);

		const detail = await member.analytics.sessions.detailInitial({
			sessionId,
		});
		const tail = await member.analytics.sessions.liveTail({
			sessionId,
			summaryOnly: true,
		});
		expect(tail.streams).toEqual([
			{
				agentId: null,
				generation: 0,
				firstLine: 2,
				nextLine: 2,
				lines: [],
				truncatedBefore: true,
			},
		]);
		expect(detail.overview.revision).toBe(tail.session?.lastActivityAt ?? "");
		expect(detail.overview.session).toMatchObject({
			gitBranch: "feature/live",
			modelUsed: "claude-sonnet-4-5",
			projectPath: "/work/repo",
			sessionDate: tail.session?.startedAt,
			sessionId,
			source: "claude_code",
			userId: OWNER_ID,
		});
		expect(detail.overview.session.inputTokens).toBeGreaterThan(0);
		expect(detail.overview.turnPage.total).toBe(1);
		expect(detail.overview.turnPage.items[0]).toMatchObject({
			responsePreview: "answer 1",
			userPreview: "prompt 0",
		});
		expect(detail.window.revision).toBe(detail.overview.revision);
		expect(detail.window.turns[0]?.body).not.toBeNull();
		expect(
			(
				await member.analytics.sessions.detailSpine({
					revision: detail.overview.revision,
					sessionId,
				})
			).turns,
		).toHaveLength(1);

		// New lines move the session on: the detail reads again at a new
		// revision, and the one it showed is stale.
		await owner.liveSession.append(
			appendInput(sessionId, [
				{
					agentId: null,
					lines: [
						conversationLine(sessionId, 2, "user"),
						conversationLine(sessionId, 3, "assistant"),
					],
					previousLineSha256: sha256(opening[1] ?? ""),
					startLine: 2,
				},
			]),
		);
		const next = await member.analytics.sessions.detailInitial({ sessionId });
		expect(next.overview.revision).not.toBe(detail.overview.revision);
		expect(next.overview.turnPage.total).toBe(2);
		expect(next.window.turns.map((turn) => turn.body !== null)).toEqual([
			true,
			true,
		]);
		await expect(
			member.analytics.sessions.detailSpine({
				revision: detail.overview.revision,
				sessionId,
			}),
		).rejects.toMatchObject({ code: "STALE_REVISION" });

		// The session ends: its live lines still read until the upload lands.
		await owner.liveSession.append(appendInput(sessionId, [], { ended: true }));
		const ended = await member.analytics.sessions.detailInitial({ sessionId });
		expect(ended.overview.turnPage.total).toBe(2);
		expect(ended.overview.revision).not.toBe(next.overview.revision);

		await sqlClient`UPDATE organization SET own_sessions_only = true WHERE id = ${ORGANIZATION_ID}`;
		try {
			await expect(
				member.analytics.sessions.detailInitial({ sessionId }),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
			expect(
				(
					await webClient(OWNER_ID).analytics.sessions.detailInitial({
						sessionId,
					})
				).overview.session.userId,
			).toBe(OWNER_ID);
		} finally {
			await sqlClient`UPDATE organization SET own_sessions_only = false WHERE id = ${ORGANIZATION_ID}`;
		}
		await expect(
			member.analytics.sessions.detailInitial({ sessionId: newSessionId() }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	test("subagent lines read as the session's subagents", async () => {
		const owner = cliClient(OWNER_ID);
		const sessionId = newSessionId();
		await owner.liveSession.append(
			appendInput(sessionId, [
				{
					agentId: null,
					lines: [
						conversationLine(sessionId, 0, "user"),
						conversationLine(sessionId, 1, "assistant"),
					],
					previousLineSha256: null,
					startLine: 0,
				},
				{
					agentId: "helper",
					lines: [
						conversationLine(sessionId, 10, "user"),
						conversationLine(sessionId, 11, "assistant"),
					],
					previousLineSha256: null,
					startLine: 0,
				},
			]),
		);
		const detail = await webClient(MEMBER_ID).analytics.sessions.detailInitial({
			sessionId,
		});
		expect(detail.overview.subagents.map((agent) => agent.subagentId)).toEqual([
			"helper",
		]);
		expect(
			(
				await webClient(MEMBER_ID).analytics.sessions.detailSubagent({
					revision: detail.overview.revision,
					sessionId,
					subagentId: "helper",
				})
			).content,
		).toContain("prompt 10");
	});
});

function createTestClient(userId: string, organizationId: string | null) {
	return createRouterClient(router, {
		context: {
			user: {
				id: userId,
				name: "Live session test",
				email: `${userId}@example.com`,
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			session:
				organizationId === null
					? null
					: {
							id: crypto.randomUUID(),
							token: crypto.randomUUID(),
							userId,
							expiresAt: new Date(Date.now() + 60_000),
							createdAt: new Date(),
							updatedAt: new Date(),
							activeOrganizationId: organizationId,
						},
			apiKeyId: organizationId === null ? `live-key-${userId}` : null,
			authFailure: null,
			ingestOperatorAuthorized: false,
			requestId: crypto.randomUUID(),
			publicLookupSource: "test",
		},
	});
}

/** The CLI: an ingest API key, no browser session. */
function cliClient(userId: string): TestClient {
	return createTestClient(userId, null);
}

/** The web app, in the test workspace. */
function webClient(userId: string): TestClient {
	return createTestClient(userId, ORGANIZATION_ID);
}

function appendInput(
	sessionId: string,
	streams: LiveSessionAppendInput["streams"],
	extra: Partial<LiveSessionAppendInput> = {},
): LiveSessionAppendInput {
	return {
		...target(sessionId),
		projectPath: "/work/repo",
		streams,
		...extra,
	};
}

function target(sessionId: string, source: LiveSessionSource = "claude_code") {
	return {
		organizationId: ORGANIZATION_ID,
		protocol: LIVE_SESSION_PROTOCOL,
		sessionId,
		source,
	} as const;
}

/** A line of a Codex rollout: a user or assistant message of the thread. */
function codexLine(index: number, role: "assistant" | "user"): string {
	return JSON.stringify({
		timestamp: new Date(Date.UTC(2026, 9, 13, 11, 0, index % 60)).toISOString(),
		type: "response_item",
		payload: {
			type: "message",
			role,
			content: [
				{
					type: role === "user" ? "input_text" : "output_text",
					text: `codex ${role} ${index}`,
				},
			],
		},
	});
}

/** A user prompt or an assistant answer of a Claude Code transcript. */
function conversationLine(
	sessionId: string,
	index: number,
	role: "assistant" | "user",
): string {
	const timestamp = new Date(
		Date.UTC(2026, 9, 13, 10, Math.floor(index / 60), index % 60),
	).toISOString();
	return JSON.stringify(
		role === "user"
			? {
					type: "user",
					uuid: `line-${index}`,
					parentUuid: index === 0 ? null : `line-${index - 1}`,
					sessionId,
					cwd: "/work/repo",
					timestamp,
					message: { role: "user", content: `prompt ${index}` },
				}
			: {
					type: "assistant",
					uuid: `line-${index}`,
					parentUuid: `line-${index - 1}`,
					sessionId,
					cwd: "/work/repo",
					timestamp,
					message: {
						id: `msg_${index}`,
						role: "assistant",
						model: "claude-sonnet-4-5",
						content: [{ type: "text", text: `answer ${index}` }],
						usage: { input_tokens: 12, output_tokens: 7 },
					},
				},
	);
}

function transcriptLine(index: number): string {
	return JSON.stringify({
		type: "user",
		message: { role: "user", content: `prompt ${index}` },
		timestamp: new Date(Date.UTC(2026, 9, 13, 10, 0, index % 60)).toISOString(),
		uuid: `line-${index}`,
	});
}

function newSessionId(): string {
	return `live-${RUN_ID}-${crypto.randomUUID()}`;
}

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * The object key of a chunk: keys end with a hash of their bytes, so this is
 * the newest key written for the chunk, or one no chunk has (for objects a
 * test plants).
 */
function chunkKey(
	sessionId: string,
	stream: string,
	generation: number,
	startLine: number,
	source: LiveSessionSource = "claude_code",
): string {
	return buildKey(
		ORGANIZATION_ID,
		sessionId,
		stream,
		generation,
		startLine,
		source,
	);
}

function buildKey(
	organizationId: string,
	sessionId: string,
	stream: string,
	generation: number,
	startLine: number,
	source: LiveSessionSource = "claude_code",
): string {
	const prefix = `live/v1/${sha256(organizationId)}/${source}/${sha256(sessionId)}/${stream}/g${generation}/${String(startLine).padStart(10, "0")}-`;
	return (
		[...fakeR2.putKeys].reverse().find((key) => key.startsWith(prefix)) ??
		`${prefix}${"0".repeat(32)}.jsonl`
	);
}

function readObject(key: string): string {
	const object = fakeR2.objects.get(key);
	assert(object, `missing R2 object ${key}`);
	return new TextDecoder().decode(object.bytes);
}

async function countRows(
	table: "live_session" | "live_session_chunk",
	sessionId: string,
): Promise<number> {
	const [row] = await sqlClient.unsafe<Array<{ count: number }>>(
		`SELECT count(*)::int AS count FROM ${table} WHERE session_id = $1`,
		[sessionId],
	);
	return row?.count ?? 0;
}

async function readPurgeObjects(
	targetType: "account" | "organization",
	targetId: string,
): Promise<string[]> {
	const rows = await sqlClient<Array<{ objectKey: string }>>`
		SELECT purge_object.object_key AS "objectKey"
		FROM clickhouse_purge_object purge_object
		INNER JOIN clickhouse_purge_job purge_job ON purge_job.id = purge_object.purge_job_id
		WHERE purge_job.target_type = ${targetType} AND purge_job.target_id = ${targetId}
		ORDER BY purge_object.object_key
	`;
	return rows.map((row) => row.objectKey);
}

async function insertUser(userId: string): Promise<void> {
	await sqlClient`
		INSERT INTO "user" (id, name, email)
		VALUES (${userId}, 'Live session test', ${`${userId}@example.com`})
	`;
}

async function insertOrganization(
	organizationId: string,
	members: ReadonlyArray<readonly [string, "member" | "owner"]>,
): Promise<void> {
	await sqlClient`
		INSERT INTO organization (id, name, slug)
		VALUES (${organizationId}, 'Live session test', ${organizationId})
	`;
	for (const [userId, role] of members) {
		await sqlClient`
			INSERT INTO member (id, organization_id, user_id, role)
			VALUES (${`${organizationId}-${userId}`}, ${organizationId}, ${userId}, ${role})
		`;
	}
}

async function withEnvironment(
	environment: Record<string, string | undefined>,
	run: () => Promise<void>,
): Promise<void> {
	const previous = Object.fromEntries(
		Object.keys(environment).map((name) => [name, process.env[name]]),
	);
	setEnvironment(environment);
	try {
		await run();
	} finally {
		setEnvironment(previous);
	}
}

function setEnvironment(environment: Record<string, string | undefined>): void {
	for (const [name, value] of Object.entries(environment)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
}
