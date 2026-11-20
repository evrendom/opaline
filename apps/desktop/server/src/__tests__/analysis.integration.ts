import "./helpers/local-integration-guard.js";
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import assert from "node:assert/strict";
import { createRouterClient } from "@orpc/server";
import {
	AnalysisFindInputSchema,
	AnalysisFindOutputSchema,
	AnalysisHistoryGetOutputSchema,
	AnalysisHistoryQueryOutputSchema,
	AnalysisHistorySearchOutputSchema,
	AnalysisReadOutputSchema,
} from "@rudel/api-routes";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
	TRANSCRIPT_RECORDS_PARSER_VERSION,
	type TranscriptSource,
} from "@rudel/api-routes/transcript-records";
import { extractUsageEvents } from "@rudel/usage-events";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	type ClickHouseStatement,
	getClickhouse,
} from "../clickhouse.js";
import { sqlClient } from "../db.js";
import {
	ANALYSIS_HISTORY_OFF,
	createAnalysisRouter,
} from "../handlers/analysis/index.js";
import { renderRead } from "../mcp/analysis-renderers.js";
import { MCP_TOOLS } from "../mcp/mcp-tools.js";
import { router } from "../router.js";
import { withAnalysisDeadline } from "../services/analysis/deadline.js";
import {
	findAnalysis,
	findAnalysisWithOwners,
} from "../services/analysis/find.service.js";
import type { GitHubSource } from "../services/analysis/git-links.js";
import { readAnalysis } from "../services/analysis/read.service.js";
import { RETRO_TOOLS_OFF } from "../services/analysis/retro-tools.js";
import { toolGroupSql } from "../services/analysis/tool-groups.js";
import { setAnalysisLogForTests } from "../services/analysis-log/config.js";
import {
	baseRow,
	type GitObservationRecord,
	parseGitObservations,
} from "../services/git-observation-parser.js";
import { enqueueL1EdgeScope } from "../services/l1-edges/l1-edge-queue.service.js";
import { runL1EdgePass } from "../services/l1-edges/l1-edge-reconciliation.service.js";
import { buildNativeSessionLineageRow } from "../services/session-lineage-persistence.service.js";
import {
	buildTranscriptRecordRow,
	buildTranscriptRecordsReceiptRow,
	hashTranscriptContent,
} from "../services/transcript-records-ingest.service.js";
import { buildUsageEventRows } from "../services/usage-event-ingest.service.js";
import {
	type ApiTestServer,
	startApiTestServer,
} from "./helpers/api-test-server.js";
import { NEAR_DUPLICATES } from "./helpers/command-identity-cases.js";
import {
	claudeDuplicateFixture,
	codexInFileUsageFixture,
} from "./helpers/usage-provenance-fixtures.js";

setDefaultTimeout(120_000);
const runId = crypto.randomUUID();
const baseMs = Date.now() - 3_600_000;
const day = new Date(baseMs).toISOString().slice(0, 10);
const clickhouse = getClickhouse();
/** A workspace the tests never sign in to; its lineage must stay invisible. */
const otherOrganizationId = `analysis_other_org_${runId}`;
let server: ApiTestServer | undefined;
let userId: string | undefined;
let bearerToken = "";
const createdUsers: string[] = [];

beforeAll(async () => {
	const environment = {
		USAGE_EVENT_ANALYTICS_CUTOVER_MODE: "legacy",
		CLICKHOUSE_PURGE_WORKER_ENABLED: "false",
		ANALYSIS_LOG_STORE: "memory",
	};
	server = await startApiTestServer(environment);
	const account = await signup("admin");
	userId = account.user.id;
	bearerToken = account.token;
	// The analysis log runs only for listed workspaces; the admin's is known now.
	await server.stop();
	server = await startApiTestServer({
		...environment,
		ANALYSIS_LOG_WORKSPACES: userId,
	});
});

afterAll(async () => {
	setAnalysisLogForTests(undefined);
	await server?.stop();
	for (const table of [
		"rudel.transcript_records",
		"rudel.usage_events",
		"rudel.session_analytics",
		"rudel.session_lineage",
	]) {
		for (const organizationId of [
			userId ?? `analysis_unused_${runId}`,
			otherOrganizationId,
		])
			await clickhouse.execute({
				query: `DELETE FROM ${table} WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
				query_params: { organizationId },
			});
	}
	for (const id of createdUsers) {
		await sqlClient`DELETE FROM organization WHERE id = ${id}`;
		await sqlClient`DELETE FROM "user" WHERE id = ${id}`;
	}
});

test("real API: pinned Claude/Codex runs, line prices, failure refs, reaction origins and bounded exchange", async () => {
	const claudeId = `analysis_claude_${runId}`;
	const codexId = `analysis_codex_${runId}`;
	await seedSession(
		claudeId,
		"claude_code",
		claudeTranscript(),
		"claude-sonnet-4-5",
	);
	await seedSession(codexId, "codex", codexTranscript(), "gpt-5");
	const scope = { from: day, to: day };
	const runs = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", { source: "runs", ...scope }),
	);
	assert(runs.source === "runs" && "rows" in runs);
	expect(runs.header).toMatchObject({
		sessionsInScope: 2,
		indexedSessions: 2,
		runsInScope: 4,
		unpricedRuns: 2,
		classifierVersion: 1,
	});
	const first = runs.rows.find(
		(row) => row.ref.sessionId === claudeId && row.ref.turn === 1,
	);
	assert(first);
	assert(first.costUsd !== null);
	for (const groupBy of ["week", "model", "repository", "agent"]) {
		const grouped = AnalysisFindOutputSchema.parse(
			await rpc("analysis/find", {
				source: "runs",
				...scope,
				groupBy,
				limit: 1,
			}),
		);
		assert(grouped.source === "runs" && "groups" in grouped);
		expect(grouped.groups).toHaveLength(1);
		expect(grouped.header.runsInScope).toBe(4);
	}
	expect(first.costUsd).toBeCloseTo(0.0045, 4);
	expect(first).toMatchObject({
		edits: 1,
		toolCalls: 3,
		failedCalls: 1,
		readCalls: 1,
		notFound: 1,
		nextReaction: "swear",
	});
	expect(
		runs.rows.find((row) => row.ref.sessionId === codexId && row.ref.turn === 1)
			?.costUsd,
	).toBeCloseTo(0.0023, 4);
	expect(runs.rows.some((row) => row.promptHead.includes("uncommitted"))).toBe(
		false,
	);
	const tools = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", { source: "tool", ...scope }),
	);
	assert(tools.source === "tool");
	expect(
		tools.groups.find((group) => group.toolGroup === "read"),
	).toMatchObject({ count: 2, sessions: 2 });
	expect(
		tools.groups
			.flatMap((group) => group.examples)
			.some(
				(example) =>
					example.ref.sessionId === claudeId &&
					example.ref.turn === 1 &&
					example.record === 7,
			),
	).toBe(true);
	const reactions = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", { source: "user", ...scope }),
	);
	assert(reactions.source === "user");
	expect(
		reactions.events.find(
			(event) =>
				event.type === "swear" && event.eventRef.sessionId === claudeId,
		)?.originRef,
	).toEqual(first.ref);
	expect(
		reactions.events.find(
			(event) =>
				event.type === "apology" && event.eventRef.sessionId === claudeId,
		),
	).toMatchObject({ originRef: first.ref, originCostUsd: first.costUsd });
	const exchange = AnalysisReadOutputSchema.parse(
		await rpc("analysis/read", { refs: [first.ref] }),
	);
	expect(exchange.reads[0]?.sections.map((section) => section.name)).toEqual([
		"prompt",
		"files edited",
		"checks after last edit",
		"failed calls",
		"final",
		"next prompt reaction",
	]);
	expect(
		exchange.reads[0]?.sections.find(
			(section) => section.name === "checks after last edit",
		)?.text,
	).toContain("pass\ttest\tbun test");
	expect(
		exchange.reads[0]?.sections.find(
			(section) => section.name === "files edited",
		)?.text,
	).toContain("src/a.ts");
	expect(
		exchange.reads[0]?.sections.find((section) => section.name === "final")
			?.text,
	).toBe("Finished the change.");
	const selected = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", { source: "runs", ...scope, refs: [first.ref] }),
	);
	expect(selected.header.runsInScope).toBe(1);
	expect(selected.header.pricedCostUsd).toBe(first.costUsd);
	const bounded = AnalysisReadOutputSchema.parse(
		await rpc("analysis/read", {
			refs: [first.ref, { sessionId: codexId, agentId: "", turn: 1 }],
			maxChars: 200,
		}),
	);
	expect(bounded.truncated).toBe(true);
	expect(
		bounded.reads.reduce(
			(total, read) =>
				total +
				Array.from(read.header).length +
				read.sections.reduce(
					(sum, section) => sum + Array.from(section.text).length,
					0,
				),
			0,
		),
	).toBeLessThanOrEqual(200);
	expect(renderRead(bounded)).toEndWith(
		"… [2 more runs omitted to fit the response size limit]",
	);
	const record = AnalysisReadOutputSchema.parse(
		await rpc("analysis/read", {
			refs: [first.ref],
			depth: "record",
			record: 1,
			fromChar: 0,
			toChar: 3,
		}),
	);
	expect(record.reads[0]?.sections[0]?.text).toBe("Fix");
	const wrongRecord = await rpcResponse("analysis/read", {
		refs: [first.ref],
		depth: "record",
		record: 9,
	});
	expect(wrongRecord.status).toBe(400);
});

test("a member's agent finds and reads a teammate's runs; with the own-sessions option on, members cannot widen find scope, read refuses foreign refs before querying records, and admins span and narrow members", async () => {
	assert(userId);
	const firstMember = await signup("member-a");
	const secondMember = await signup("member-b");
	for (const member of [firstMember, secondMember]) {
		await sqlClient`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (${crypto.randomUUID()}, ${userId}, ${member.user.id}, 'member', now())`;
		await sqlClient`UPDATE session SET active_organization_id = ${userId} WHERE user_id = ${member.user.id}`;
	}
	const ownId = `member_a_${runId}`;
	const foreignId = `member_b_${runId}`;
	await seedSession(
		ownId,
		"claude_code",
		claudeTranscript(),
		"claude-sonnet-4-5",
		{ owner: firstMember.user.id },
	);
	await seedSession(
		foreignId,
		"claude_code",
		claudeTranscript(),
		"claude-sonnet-4-5",
		{ owner: secondMember.user.id },
	);
	const ownRef = { sessionId: ownId, agentId: "", turn: 1 };
	const foreignRef = { sessionId: foreignId, agentId: "", turn: 1 };
	const asMember = async (path: string, input: unknown) => {
		const response = await rpcResponse(path, input, firstMember.token);
		assert.equal(response.status, 200, await response.clone().text());
		return z.object({ json: z.unknown() }).parse(await response.json()).json;
	};
	// Every member reads every member's sessions.
	const teamFind = AnalysisFindOutputSchema.parse(
		await asMember("analysis/find", {
			source: "runs",
			from: day,
			to: day,
			refs: [ownRef, foreignRef],
		}),
	);
	assert(teamFind.source === "runs" && "rows" in teamFind);
	expect(new Set(teamFind.rows.map((row) => row.ref.sessionId))).toEqual(
		new Set([ownId, foreignId]),
	);
	const teammateRead = AnalysisReadOutputSchema.parse(
		await asMember("analysis/read", { refs: [foreignRef], depth: "turn" }),
	);
	expect(teammateRead.reads.map((read) => [read.ref, read.found])).toEqual([
		[foreignRef, true],
	]);
	await sqlClient`UPDATE organization SET own_sessions_only = true WHERE id = ${userId}`;
	try {
		await expectOwnSessionsOnly();
	} finally {
		await sqlClient`UPDATE organization SET own_sessions_only = false WHERE id = ${userId}`;
	}

	async function expectOwnSessionsOnly() {
		for (const source of ["runs", "tool", "user"]) {
			for (const selector of [
				{ sessionId: foreignId },
				{ refs: [foreignRef] },
			]) {
				const response = await rpcResponse(
					"analysis/find",
					{ source, from: day, to: day, ...selector },
					firstMember.token,
				);
				expect(response.status).toBe(200);
				const result = AnalysisFindOutputSchema.parse(
					z.object({ json: z.unknown() }).parse(await response.json()).json,
				);
				expect(result.header.sessionsInScope).toBe(0);
				expect(result.header.runsInScope).toBe(0);
			}
		}
		expect(
			(
				await rpcResponse(
					"analysis/find",
					{ source: "runs", userId: secondMember.user.id },
					firstMember.token,
				)
			).status,
		).toBe(403);
		expect(
			(
				await rpcResponse(
					"analysis/read",
					{ refs: [ownRef, foreignRef], depth: "turn" },
					firstMember.token,
				)
			).status,
		).toBe(403);
		const statements: ClickHouseStatement[] = [];
		const client = createRouterClient(
			createAnalysisRouter({ executor: observingExecutor(statements) }),
			{
				context: {
					user: {
						id: firstMember.user.id,
						name: "Analysis integration",
						email: `analysis-member-a-${runId}@example.com`,
						emailVerified: false,
						createdAt: new Date(),
						updatedAt: new Date(),
					},
					session: {
						id: crypto.randomUUID(),
						token: firstMember.token,
						userId: firstMember.user.id,
						expiresAt: new Date(Date.now() + 60_000),
						createdAt: new Date(),
						updatedAt: new Date(),
						activeOrganizationId: userId,
					},
					apiKeyId: null,
					authFailure: null,
					ingestOperatorAuthorized: false,
					requestId: crypto.randomUUID(),
					publicLookupSource: "test",
				},
			},
		);
		await expect(
			client.read({ refs: [ownRef, foreignRef], depth: "turn" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(statements).toHaveLength(0);
		const admin = AnalysisFindOutputSchema.parse(
			await rpc("analysis/find", {
				source: "runs",
				from: day,
				to: day,
				refs: [ownRef, foreignRef],
			}),
		);
		assert(admin.source === "runs" && "rows" in admin);
		expect(new Set(admin.rows.map((row) => row.ref.sessionId))).toEqual(
			new Set([ownId, foreignId]),
		);
		const narrowed = AnalysisFindOutputSchema.parse(
			await rpc("analysis/find", {
				source: "runs",
				from: day,
				to: day,
				refs: [ownRef, foreignRef],
				userId: firstMember.user.id,
			}),
		);
		assert(narrowed.source === "runs" && "rows" in narrowed);
		expect(narrowed.rows.map((row) => row.ref.sessionId)).toEqual([ownId]);
	}
});

test("aggregate find succeeds beyond the lowered record cap; text ceilings return explicit coverage", async () => {
	assert(userId);
	for (const index of [0, 1, 2])
		await seedSession(
			`cap_${index}_${runId}`,
			"claude_code",
			shortRecordsTranscript(80),
			"cap-model",
		);
	const statements: ClickHouseStatement[] = [];
	const input = AnalysisFindInputSchema.parse({
		source: "runs",
		from: day,
		to: day,
		latest: 200,
		limit: 1,
		model: "cap-model",
	});
	// 240 records but 3 runs: capping every records statement at 3 result rows
	// proves run facts come back aggregated per run, never per record.
	const result = await findAnalysis({ organizationId: userId, userId }, input, {
		executor: observingExecutor(statements, 3),
		recordRowCap: 2,
	});
	assert(result.source === "runs" && "rows" in result);
	expect(result.rows).toHaveLength(1);
	expect(result.header).toMatchObject({
		sessionsInScope: 3,
		runsInScope: 3,
		truncated: true,
	});
	expect(
		statements.every((statement) => !statement.query.includes("AS scan_text")),
	).toBe(true);
	expect(
		statements.every((statement) => statement.abortSignal !== undefined),
	).toBe(true);
	expect(
		new Set(statements.map((statement) => statement.abortSignal)).size,
	).toBe(1);
	const scan = await findAnalysis(
		{ organizationId: userId, userId },
		{ ...input, source: "user" },
		{ executor: clickhouse, recordRowCap: 2 },
	);
	expect(scan.header.truncated).toBe(true);
	expect(scan.header.notes.join(" ")).toContain(
		"text scan coverage curtailed at 2 rows",
	);
	const byteScan = await findAnalysis(
		{ organizationId: userId, userId },
		{ ...input, source: "user" },
		{ executor: clickhouse, recordByteCap: 1 },
	);
	expect(byteScan.header.truncated).toBe(true);
	expect(byteScan.header.notes.join(" ")).toContain("0 rows / 0 bytes");
});

test("unmerged duplicate records and record-budget batches leave find and read unchanged", async () => {
	assert(userId);
	const plainId = `dedupe_plain_${runId}`;
	const copiedId = `dedupe_copied_${runId}`;
	await seedSession(plainId, "claude_code", claudeTranscript(), "dedupe-model");
	await seedSession(
		copiedId,
		"claude_code",
		claudeTranscript(),
		"dedupe-model",
		{
			duplicateRecords: true,
		},
	);
	const owner = userId;
	const scope = { organizationId: owner, userId: owner };
	const find = (sessionId: string, args: Record<string, unknown>) =>
		findAnalysis(
			scope,
			AnalysisFindInputSchema.parse({ from: day, to: day, sessionId, ...args }),
		);
	for (const args of [
		{ source: "runs" },
		{ source: "tool", includeNoise: true },
		{ source: "user" },
	]) {
		const plain = await find(plainId, args);
		expect(plain.header.runsInScope).toBeGreaterThan(0);
		expect(
			JSON.stringify(await find(copiedId, args)).replaceAll(copiedId, plainId),
		).toBe(JSON.stringify(plain));
	}
	const runs = await find(plainId, { source: "runs" });
	assert(runs.source === "runs" && "rows" in runs);
	const ref = runs.rows[0]?.ref;
	assert(ref);
	for (const depth of ["exchange", "turn"] as const) {
		const read = (sessionId: string) =>
			readAnalysis(owner, new Map([[sessionId, owner]]), {
				refs: [{ ...ref, sessionId }],
				depth,
				maxChars: 12_000,
			});
		expect(
			JSON.stringify(await read(copiedId)).replaceAll(copiedId, plainId),
		).toBe(JSON.stringify(await read(plainId)));
	}
	// One run-facts statement per session when the record budget is below one session.
	const input = AnalysisFindInputSchema.parse({
		source: "runs",
		from: day,
		to: day,
		model: "dedupe-model",
	});
	const statements: ClickHouseStatement[] = [];
	const split = await findAnalysis(scope, input, {
		executor: observingExecutor(statements),
		batchRecords: 1,
	});
	expect(
		statements.filter((statement) =>
			statement.query.includes("run_facts AS ("),
		),
	).toHaveLength(2);
	expect(split).toEqual(await findAnalysis(scope, input));
});

test("many short raw records keep metadata and never exceed the emitted maxChars; uncommitted text is invisible", async () => {
	const sessionId = `short_records_${runId}`;
	await seedSession(
		sessionId,
		"claude_code",
		shortRecordsTranscript(200),
		"short-record-model",
	);
	for (const maxChars of [200, 1200, 12000]) {
		const result = AnalysisReadOutputSchema.parse(
			await rpc("analysis/read", {
				refs: [{ sessionId, agentId: "", turn: 1 }],
				depth: "turn",
				maxChars,
			}),
		);
		const text = renderRead(result);
		expect(text.length).toBeLessThanOrEqual(maxChars);
		expect(text).not.toContain("uncommitted");
		if (maxChars > 200) {
			expect(
				result.reads[0]?.sections.some(
					(section) =>
						section.record?.kind === "tool_result" && section.record.isError,
				),
			).toBe(true);
			expect(text).toContain("tool_result");
		}
	}
	const result = AnalysisReadOutputSchema.parse(
		await rpc("analysis/read", {
			refs: [{ sessionId, agentId: "", turn: 1 }],
			depth: "record",
			record: 1,
		}),
	);
	expect(result.reads[0]?.sections[0]?.text).toBe("Many records");
	const find = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", {
			source: "runs",
			sessionId,
			from: day,
			to: day,
		}),
	);
	assert(find.source === "runs" && "rows" in find);
	expect(find.rows[0]?.promptHead).toBe("Many records");
});

test("exchange uses the full last-edit boundary and preserves the failure head", async () => {
	const sessionId = `last_edit_${runId}`;
	const lines: unknown[] = [
		{
			type: "user",
			timestamp: at(0),
			message: { role: "user", content: "Edit files" },
		},
	];
	for (let index = 0; index < 201; index++)
		lines.push(
			claudeTool(`edit-${index}`, "Write", {
				file_path: `file-${index}.ts`,
				content: "new",
			}),
		);
	lines.push(
		claudeTool("check", "Bash", { command: "bun test" }),
		claudeResult("check", "Process exited with code 0\npass"),
	);
	lines.push(
		claudeTool("final-edit", "Write", {
			file_path: "last.ts",
			content: "unchecked",
		}),
	);
	lines.push(
		claudeTool("read-missing", "Read", { file_path: "missing.ts" }),
		claudeResult(
			"read-missing",
			`ENOENT: no such file or directory, open /repo/missing.ts\n${"diagnostic body\n".repeat(1000)}`,
			true,
		),
	);
	await seedSession(
		sessionId,
		"claude_code",
		lines.map((line) => JSON.stringify(line)).join("\n"),
		"claude-sonnet-4-5",
	);
	const exchange = AnalysisReadOutputSchema.parse(
		await rpc("analysis/read", {
			refs: [{ sessionId, agentId: "", turn: 1 }],
			maxChars: 40000,
		}),
	);
	expect(
		exchange.reads[0]?.sections.find(
			(section) => section.name === "checks after last edit",
		)?.text,
	).toBe("");
	expect(
		exchange.reads[0]?.sections.find(
			(section) => section.name === "failed calls",
		)?.text,
	).toContain("ENOENT: no such file or directory, open /repo/missing.ts");
	expect(exchange.truncated).toBe(true);
});

test("a still-running check is not a pass; minutes end at the last non-meta record and activeMinutes caps idle gaps", async () => {
	const sessionId = `running_check_${runId}`;
	const lines = [
		{
			type: "user",
			timestamp: at(0),
			message: { role: "user", content: "Start the dev server and test" },
		},
		{
			...claudeTool("edit", "Write", { file_path: "a.ts", content: "x" }),
			timestamp: at(1),
		},
		{ ...claudeResult("edit", "File created"), timestamp: at(2) },
		{
			...claudeTool("watch", "Bash", {
				command: "bun test --watch",
				run_in_background: true,
			}),
			timestamp: at(3),
		},
		{
			...claudeResult(
				"watch",
				"Command running in background with ID: bd486wkvr. Output is being written to: /tmp/claude/bd486wkvr.output",
			),
			timestamp: at(4),
		},
		{
			...claudeTool("once", "Bash", { command: "bun test" }),
			timestamp: at(5),
		},
		{ ...claudeResult("once", "12 pass\n0 fail"), timestamp: at(6) },
		{
			type: "assistant",
			// 20 minutes idle (an approval wait) before the final message.
			timestamp: at(6 + 20 * 60),
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Both started." }],
			},
		},
		// Written when the session was resumed hours later; not part of the run.
		{ type: "ai-title", timestamp: at(3 * 3600), aiTitle: "Dev server" },
	];
	await seedSession(
		sessionId,
		"claude_code",
		lines.map((line) => JSON.stringify(line)).join("\n"),
		"claude-sonnet-4-5",
	);
	const ref = { sessionId, agentId: "", turn: 1 };
	const runs = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", {
			source: "runs",
			from: day,
			to: day,
			refs: [ref],
		}),
	);
	assert(runs.source === "runs" && "rows" in runs);
	const [run] = runs.rows;
	assert(run);
	expect(run.minutes).toBeCloseTo((6 + 20 * 60) / 60, 3);
	expect(run.activeMinutes).toBeCloseTo((6 + 5 * 60) / 60, 3);
	expect(runs.header.activeMinutes).toBeCloseTo(run.activeMinutes ?? 0, 6);
	const exchange = AnalysisReadOutputSchema.parse(
		await rpc("analysis/read", { refs: [ref], maxChars: 4000 }),
	);
	const checks = exchange.reads[0]?.sections.find(
		(section) => section.name === "checks after last edit",
	)?.text;
	expect(checks?.split("\n")).toEqual([
		"running\ttest\tbun test --watch",
		"pass\ttest\tbun test",
	]);
	expect(exchange.reads[0]?.header).toContain("activeMinutes=");
});

test("a /compact run hours after the answer doesn't stretch the run before it", async () => {
	const sessionId = `compact_after_${runId}`;
	const later = 3 * 3600;
	const lines = [
		{
			type: "user",
			timestamp: at(0),
			message: { role: "user", content: "Fix the build" },
		},
		{
			...claudeTool("check", "Bash", { command: "bun test" }),
			timestamp: at(30),
		},
		{ ...claudeResult("check", "12 pass\n0 fail"), timestamp: at(40) },
		{
			type: "assistant",
			timestamp: at(60),
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Fixed." }],
			},
		},
		// The next morning: the member compacts before the next prompt. The
		// command and what it injects are filed under the run before.
		{
			type: "user",
			timestamp: at(later),
			message: {
				role: "user",
				content:
					"<command-name>/compact</command-name>\n<command-message>compact</command-message>",
			},
		},
		{
			type: "system",
			subtype: "compact_boundary",
			timestamp: at(later + 90),
			content: "Conversation compacted",
			compactMetadata: { trigger: "manual", preTokens: 150_000 },
		},
		{
			type: "user",
			timestamp: at(later + 90),
			isCompactSummary: true,
			message: { role: "user", content: "Summary of the work so far." },
		},
		{
			type: "user",
			timestamp: at(later + 91),
			message: {
				role: "user",
				content: "<local-command-stdout>Compacted</local-command-stdout>",
			},
		},
		{
			type: "user",
			timestamp: at(later + 92),
			message: { role: "user", content: "Now the docs" },
		},
		{
			type: "assistant",
			timestamp: at(later + 120),
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Docs updated." }],
			},
		},
	];
	await seedSession(
		sessionId,
		"claude_code",
		lines.map((line) => JSON.stringify(line)).join("\n"),
		"claude-sonnet-4-5",
	);
	const runs = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", {
			source: "runs",
			from: day,
			to: day,
			refs: [
				{ sessionId, agentId: "", turn: 1 },
				{ sessionId, agentId: "", turn: 2 },
			],
		}),
	);
	assert(runs.source === "runs" && "rows" in runs);
	const runOf = (turn: number) =>
		runs.rows.find(
			(row) => row.ref.sessionId === sessionId && row.ref.turn === turn,
		);
	const [first, second] = [runOf(1), runOf(2)];
	assert(first && second);
	// Its answer, a minute in: not the compaction three hours later.
	expect(first.minutes).toBeCloseTo(1, 3);
	expect(first.activeMinutes).toBeCloseTo(1, 3);
	expect(second.minutes).toBeCloseTo(28 / 60, 3);
});

test("costs: unpriced usage stays unpriced, mixed-model runs split cost per model, and model= filters on run usage", async () => {
	const mixedId = `cost_mixed_${runId}`;
	const unpricedId = `cost_unpriced_${runId}`;
	const lines = [
		{
			type: "user",
			timestamp: at(0),
			message: { role: "user", content: "Plan, then build" },
		},
		...[1, 2, 3].map((index) => ({
			type: "assistant",
			timestamp: at(index),
			message: {
				role: "assistant",
				content: [{ type: "text", text: `step ${index}` }],
			},
		})),
	];
	const transcript = lines.map((line) => JSON.stringify(line)).join("\n");
	// The session's recorded model is the last one; opus did the planning.
	await seedSession(mixedId, "claude_code", transcript, "claude-sonnet-4-5", {
		repository: `cost_repo_${runId}`,
		usage: [
			{ line: 2, model: "claude-opus-4-6" },
			{ line: 3, model: "claude-sonnet-4-5" },
			{ line: 4, model: "mystery-model-x" },
		],
	});
	await seedSession(unpricedId, "claude_code", transcript, "mystery-model-x", {
		repository: `cost_repo_${runId}`,
		usage: [{ line: 2, model: "mystery-model-x" }],
	});
	const scope = { from: day, to: day, repository: `cost_repo_${runId}` };
	const runs = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", { source: "runs", ...scope }),
	);
	assert(runs.source === "runs" && "rows" in runs);
	const mixed = runs.rows.find((row) => row.ref.sessionId === mixedId);
	const unpriced = runs.rows.find((row) => row.ref.sessionId === unpricedId);
	assert(mixed && unpriced);
	expect(unpriced.costUsd).toBeNull();
	expect(runs.header.unpricedRuns).toBe(1);
	expect(mixed.model).toBe("mystery-model-x");
	expect(mixed.models).toHaveLength(3);
	expect(mixed.models.slice(0, 2)).toEqual([
		"claude-opus-4-6",
		"claude-sonnet-4-5",
	]);
	assert(mixed.costUsd !== null);
	expect(
		runs.header.notes.some((note) => note.includes("could not be priced")),
	).toBe(true);

	const byModel = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", { source: "runs", ...scope, groupBy: "model" }),
	);
	assert(byModel.source === "runs" && "groups" in byModel);
	const group = (key: string) =>
		byModel.groups.find((entry) => entry.key === key);
	const opus = group("claude-opus-4-6")?.costUsd;
	const sonnet = group("claude-sonnet-4-5")?.costUsd;
	assert(typeof opus === "number" && typeof sonnet === "number");
	// Opus is priced higher than sonnet for the same tokens: its spend is its own.
	expect(opus).toBeGreaterThan(sonnet);
	expect(opus + sonnet).toBeCloseTo(mixed.costUsd, 4);
	expect(group("mystery-model-x")).toMatchObject({ runs: 2, costUsd: null });

	const opusOnly = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", {
			source: "runs",
			...scope,
			model: "claude-opus-4-6",
		}),
	);
	assert(opusOnly.source === "runs" && "rows" in opusOnly);
	expect(opusOnly.rows.map((row) => row.ref.sessionId)).toEqual([mixedId]);
	expect(opusOnly.rows[0]?.costUsd).toBeCloseTo(opus, 4);
	expect(opusOnly.header.pricedCostUsd).toBeCloseTo(opus, 4);
});

test("a command that failed inside a Codex code-mode script is a failure of its own", async () => {
	const sessionId = `codex_nested_${runId}`;
	const transcript = jsonl([
		codexLine(0, codexText("user", "Run the suite")),
		codexLine(1, {
			type: "custom_tool_call",
			name: "exec",
			call_id: "script",
			input: 'const r = await tools.exec_command({ cmd: "bun test src" });',
		}),
		{
			timestamp: at(2),
			type: "event_msg",
			payload: {
				type: "item_completed",
				item: {
					type: "CommandExecution",
					id: "exec-0198aaaa-1111-7000-8000-00000000000a",
					command: ["/bin/zsh", "-lc", "bun test src"],
					aggregated_output:
						"src/login.test.ts:\nerror: expect(received).toBe(expected)\n1 fail",
					exit_code: 1,
					status: "failed",
					source: "unified_exec_startup",
				},
			},
		},
		codexLine(3, {
			type: "custom_tool_call_output",
			call_id: "script",
			output: [
				{
					type: "input_text",
					text: "Script completed\nWall time 1.0 seconds\nOutput:\n",
				},
			],
		}),
		codexLine(4, codexText("assistant", "One test fails.")),
	]);
	await seedSession(sessionId, "codex", transcript, "gpt-5");
	const tools = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", {
			source: "tool",
			from: day,
			to: day,
			sessionId,
		}),
	);
	assert(tools.source === "tool");
	expect(tools.groups.map((group) => [group.toolGroup, group.count])).toEqual([
		["shell", 1],
	]);
	expect(tools.groups[0]?.topCommands).toEqual(["bun test src"]);
	expect(tools.groups[0]?.examples[0]).toMatchObject({
		ref: { sessionId, agentId: "", turn: 1 },
		record: 3,
	});
	const runs = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", {
			source: "runs",
			from: day,
			to: day,
			sessionId,
		}),
	);
	assert(runs.source === "runs" && "rows" in runs);
	expect(runs.rows[0]).toMatchObject({ failedCalls: 1, toolCalls: 1 });
});

test("find source=calls finds the same command across sessions, next to its text", async () => {
	const repository = `calls_repo_${runId}`;
	const scope = { from: day, to: day, repository };
	const prompt = {
		type: "user",
		timestamp: at(0),
		message: { role: "user", content: "Check the build" },
	};
	const [pollA, pollB] = NEAR_DUPLICATES.map(
		(record) =>
			z.object({ content: z.string() }).parse(JSON.parse(record.text)).content,
	);
	await seedSession(
		`calls_a_${runId}`,
		"claude_code",
		jsonl([
			prompt,
			claudeTool("a-test", "Bash", {
				command: "cd /Users/alice/app && bun test 2>&1 | tail -20",
			}),
			claudeResult("a-test", "Exit code 1\n1 fail", true),
			claudeTool("a-checks", "Bash", { command: "gh pr checks 133" }),
			claudeResult("a-checks", "All checks were successful"),
			claudeTool("a-script", "Write", {
				file_path: "/tmp/alice/ci-poll.sh",
				content: pollA,
			}),
			claudeResult("a-script", "File created successfully"),
		]),
		"claude-opus-4-6",
		{ repository },
	);
	await seedSession(
		`calls_b_${runId}`,
		"claude_code",
		jsonl([
			prompt,
			claudeTool("b-test", "Bash", { command: "bun test" }),
			claudeResult("b-test", "pass"),
			claudeTool("b-checks", "Bash", {
				command: "gh pr checks 140 2>&1 | head -5",
			}),
			claudeResult("b-checks", "All checks were successful"),
			claudeTool("b-script", "Write", {
				file_path: "/tmp/bob/ci-poll.sh",
				content: pollB,
			}),
			claudeResult("b-script", "File created successfully"),
		]),
		"claude-opus-4-6",
		{ repository },
	);
	await seedSession(
		`calls_c_${runId}`,
		"codex",
		jsonl([
			codexLine(0, codexText("user", "Run the tests")),
			codexLine(1, codexCall("c-test", "exec_command", { cmd: "bun test" })),
			codexLine(2, codexOutput("c-test", "Process exited with code 0\npass")),
		]),
		"gpt-5",
		{ repository },
	);
	const find = async (input: Record<string, unknown>) => {
		const output = AnalysisFindOutputSchema.parse(
			await rpc("analysis/find", { source: "calls", ...scope, ...input }),
		);
		assert(output.source === "calls");
		return output;
	};

	const byFingerprint = await find({ groupBy: "commandFingerprint" });
	assert("groups" in byFingerprint);
	const bunTest = byFingerprint.groups.find(
		(group) => group.normalized === "bun test",
	);
	expect(bunTest).toMatchObject({ calls: 3, sessions: 3, failedCalls: 1 });
	expect(new Set(bunTest?.examples.map((example) => example.command))).toEqual(
		new Set(["cd /Users/alice/app && bun test 2>&1 | tail -20", "bun test"]),
	);
	expect(
		byFingerprint.groups.find(
			(group) => group.normalized === "gh pr checks <n>",
		),
	).toMatchObject({ calls: 2, sessions: 2, failedCalls: 0 });
	expect(byFingerprint.groups.map((group) => group.calls)).toEqual([
		3, 2, 1, 1,
	]);

	const byProgram = await find({ groupBy: "commandArgv0" });
	assert("groups" in byProgram);
	expect(
		byProgram.groups.map((group) => [group.key, group.calls, group.sessions]),
	).toEqual([
		["bun", 3, 3],
		["gh", 2, 2],
	]);
	expect(byProgram.header.notes).toContain(
		"2 calls have no program: Codex code-mode scripts and written script files, which run no single program, and calls stored only in part",
	);
	const byPrefix = await find({ groupBy: "commandPrefix", limit: 1 });
	assert("groups" in byPrefix);
	expect(byPrefix.groups.map((group) => group.key)).toEqual(["bun test"]);
	const nextPrefix = await find({
		groupBy: "commandPrefix",
		limit: 1,
		cursor: byPrefix.header.cursor,
	});
	assert("groups" in nextPrefix);
	expect(nextPrefix.groups.map((group) => group.key)).toEqual(["gh pr"]);

	const written = await find({ commandFrom: "written" });
	assert("rows" in written);
	expect(written.rows.map((row) => row.filePath).sort()).toEqual([
		"/tmp/alice/ci-poll.sh",
		"/tmp/bob/ci-poll.sh",
	]);
	const [script] = written.rows;
	assert(script?.commandSimhash);
	expect(script).toMatchObject({
		commandFrom: "written",
		commandArgv0: null,
		commandPrefix: null,
		failed: false,
	});
	const near = await find({ commandSimhash: script.commandSimhash });
	assert("rows" in near);
	expect(near.rows.map((row) => row.filePath).sort()).toEqual([
		"/tmp/alice/ci-poll.sh",
		"/tmp/bob/ci-poll.sh",
	]);
	expect(new Set(near.rows.map((row) => row.commandFingerprint)).size).toBe(2);

	const fingerprint = bunTest?.key;
	assert(fingerprint);
	const runs = await find({ commandFingerprint: fingerprint, limit: 2 });
	assert("rows" in runs);
	expect(runs.rows).toHaveLength(2);
	const rest = await find({
		commandFingerprint: fingerprint,
		limit: 2,
		cursor: runs.header.cursor,
	});
	assert("rows" in rest);
	const all = [...runs.rows, ...rest.rows];
	expect(
		all
			.map((row) => [
				row.agent,
				row.commandArgv0,
				row.commandPrefix,
				row.failed,
			])
			.sort(),
	).toEqual([
		["claude_code", "bun", "bun test", false],
		["claude_code", "bun", "bun test", true],
		["codex", "bun", "bun test", false],
	]);
	expect(all.find((row) => row.failed)?.command).toBe(
		"cd /Users/alice/app && bun test 2>&1 | tail -20",
	);
});

test("one deadline aborts the active ClickHouse query and stops subsequent statements", async () => {
	const statements: ClickHouseStatement[] = [];
	const operation = settledOperation(async (executor) => {
		for (let index = 0; index < 3; index++)
			await executor.query({
				query: "SELECT sleep(0.4) LIMIT 1",
				clickhouse_settings: { max_execution_time: 1 },
			});
	});
	await expect(
		withAnalysisDeadline("integration deadline", operation.run, {
			executor: observingExecutor(statements),
			deadlineMs: 50,
		}),
	).rejects.toThrow("deadline");
	await operation.settled;
	expect(statements).toHaveLength(1);
	expect(statements[0]?.abortSignal?.aborted).toBe(true);
});

test("a failed ClickHouse sibling aborts the shared signal and no following batch runs", async () => {
	const statements: ClickHouseStatement[] = [];
	const operation = settledOperation(async (executor) => {
		await Promise.all([
			executor.query({ query: "SELECT sleep(0.4) LIMIT 1" }),
			executor.query({
				query: "SELECT definitely_missing_analysis_column LIMIT 1",
			}),
		]);
		await executor.query({ query: "SELECT 1 LIMIT 1" });
	});
	await expect(
		withAnalysisDeadline("sibling error", operation.run, {
			executor: observingExecutor(statements),
		}),
	).rejects.toThrow();
	await operation.settled;
	expect(statements).toHaveLength(2);
	expect(
		new Set(statements.map((statement) => statement.abortSignal)).size,
	).toBe(1);
	expect(statements.every((statement) => statement.abortSignal?.aborted)).toBe(
		true,
	);
});

test("SQL ceilings return explicit incomplete coverage rather than a record-overflow exception", async () => {
	assert(userId);
	const input = AnalysisFindInputSchema.parse({
		source: "runs",
		from: day,
		to: day,
		latest: 200,
		limit: 1,
	});
	const executor: ClickHouseExecutor = {
		close: () => clickhouse.close(),
		execute: (statement) => clickhouse.execute(statement),
		insert: (params) => clickhouse.insert(params),
		query: (statement) =>
			clickhouse.query({
				...statement,
				clickhouse_settings: {
					...statement.clickhouse_settings,
					max_rows_to_read: "1",
				},
			}),
	};
	const result = await findAnalysis({ organizationId: userId, userId }, input, {
		executor,
	});
	expect(result.header.truncated).toBe(true);
	expect(result.header.notes.join(" ")).toContain("SQL work ceiling reached");
});

test("run reactions are aggregated from the full genuine prompt, not just its head", async () => {
	const sessionId = `reaction_aggregate_${runId}`;
	const user = (content: string) => ({
		type: "user",
		timestamp: at(0),
		message: { role: "user", content },
	});
	const response = {
		type: "assistant",
		timestamp: at(1),
		message: { content: [{ type: "text", text: "Response" }] },
	};
	const content = [
		user("First prompt"),
		response,
		user(`${"prefix ".repeat(100)}fuck ??`),
		response,
		user("<system_instruction>fuck</system_instruction>what??"),
	]
		.map((line) => JSON.stringify(line))
		.join("\n");
	await seedSession(sessionId, "claude_code", content, "reaction-model");
	const result = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", {
			source: "runs",
			from: day,
			to: day,
			sessionId,
		}),
	);
	assert(result.source === "runs" && "rows" in result);
	expect(result.rows.find((row) => row.ref.turn === 1)?.nextReaction).toBe(
		"swear",
	);
	expect(result.rows.find((row) => row.ref.turn === 2)?.nextReaction).toBe(
		"negative",
	);
});

test("SQL usage provenance: Claude duplicate/collision costs stay unattributed; in-file Codex usage belongs only to the child", async () => {
	for (const childId of ["worker", "main"]) {
		const sessionId = `duplicate_${childId}_${runId}`;
		const fixture = claudeDuplicateFixture(childId, at(0));
		await seedSession(
			sessionId,
			"claude_code",
			fixture.content,
			"session-model",
			{ subagents: fixture.subagents, extractedUsage: true },
		);
		const result = AnalysisFindOutputSchema.parse(
			await rpc("analysis/find", {
				source: "runs",
				sessionId,
				from: day,
				to: day,
			}),
		);
		assert(result.source === "runs" && "rows" in result);
		expect(result.rows).toHaveLength(3);
		expect(
			result.rows.every(
				(row) => row.costUsd === null && row.model === "session-model",
			),
		).toBe(true);
		expect(result.header.unattributedCostUsd).toBeCloseTo(0.0045, 4);
		expect(result.header.pricedCostUsd).toBe(0);
		const read = AnalysisReadOutputSchema.parse(
			await rpc("analysis/read", { refs: result.rows.map((row) => row.ref) }),
		);
		expect(
			read.reads.every((row) => row.header.includes("costUsd=unpriced")),
		).toBe(true);
	}
	const sessionId = `in_file_child_${runId}`;
	await seedSession(
		sessionId,
		"codex",
		codexInFileUsageFixture(at(0)),
		"session-model",
		{ extractedUsage: true },
	);
	const result = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", {
			source: "runs",
			sessionId,
			from: day,
			to: day,
		}),
	);
	assert(result.source === "runs" && "rows" in result);
	expect(result.rows.find((row) => row.ref.agentId === "")?.costUsd).toBeNull();
	expect(
		result.rows.find((row) => row.ref.agentId === "/root/worker")?.costUsd,
	).toBeCloseTo(0.0023, 4);
	expect(result.header.unattributedCostUsd).toBe(0);
});

async function seedSession(
	sessionId: string,
	source: TranscriptSource,
	content: string,
	model: string,
	options: {
		owner?: string;
		subagents?: Record<string, string>;
		extractedUsage?: boolean;
		/** Inserts the committed records a second time, like a retried insert that has not merged yet. */
		duplicateRecords?: boolean;
		/** Seconds after `baseMs` the session starts (its `session_date`). */
		startOffset?: number;
		repository?: string;
		/** Usage events to store instead of the default one (line 2, the session's model). */
		usage?: readonly { line: number; model: string }[];
	} = {},
): Promise<void> {
	assert(userId);
	const identity = {
		organizationId: userId,
		userId: options.owner ?? userId,
		sessionId,
		source,
		revision: "1",
		sessionDate: at(0),
	};
	const stats = createSplitStats();
	const rows = [
		...splitSessionTranscript(
			{ content, subagents: options.subagents, sessionDate: at(0), source },
			stats,
		),
	].map((draft) => buildTranscriptRecordRow(identity, draft));
	const summary = summarizeSplit(stats);
	await clickhouse.insert({
		table: "rudel.transcript_records",
		asyncInsert: false,
		values: [
			...rows,
			buildTranscriptRecordsReceiptRow(identity, {
				...summary,
				contentSha256: hashTranscriptContent(content),
				parserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
				publishedAt: new Date().toISOString(),
				rowCount: rows.length,
			}),
			...rows.map((row) => ({
				...row,
				revision: "2",
				head: "uncommitted",
				text: "uncommitted",
			})),
		],
	});
	if (options.duplicateRecords)
		await clickhouse.insert({
			table: "rudel.transcript_records",
			asyncInsert: false,
			values: rows,
		});
	await clickhouse.insert({
		table: "rudel.session_analytics",
		asyncInsert: false,
		values: [
			{
				organization_id: userId,
				user_id: identity.userId,
				session_id: sessionId,
				source,
				session_date: timestamp(options.startOffset ?? 0),
				last_interaction_date: timestamp((options.startOffset ?? 0) + 10),
				project_path: "/test/analysis",
				git_remote: options.repository ?? "repo",
				model_used: model,
				revision: "1",
			},
		],
	});
	if (options.extractedUsage) {
		const extraction = extractUsageEvents({
			organizationId: userId,
			userId: identity.userId,
			sessionId,
			source,
			content,
			subagents: options.subagents ?? {},
		});
		assert.equal(extraction.status, "complete");
		await clickhouse.insert({
			table: "rudel.usage_events",
			asyncInsert: false,
			values: [
				...buildUsageEventRows(
					{
						organizationId: userId,
						userId: identity.userId,
						sessionId,
						source,
						generation: "1",
						extraction,
						replaceAbsentEvents: false,
						contentSha256: hashTranscriptContent(content),
						filterVersion: 1,
						ingestedAt: new Date(),
						sessionDate: new Date(baseMs),
					},
					[],
				),
			],
		});
	} else
		await clickhouse.insert({
			table: "rudel.usage_events",
			asyncInsert: false,
			values: (options.usage ?? [{ line: 2, model }]).map((usage, index) => ({
				organization_id: userId,
				user_id: identity.userId,
				session_id: sessionId,
				source,
				agent_id: "main",
				event_id: `${index}${sessionId.replaceAll("-", "")}`
					.padEnd(64, "0")
					.slice(0, 64),
				record_kind: "event",
				event_version: "1",
				occurred_at: timestamp(2),
				usage_date: day,
				has_valid_timestamp: 1,
				raw_model: usage.model,
				resolved_model: usage.model,
				model_status: "resolved",
				model_provider: source === "codex" ? "openai" : "anthropic",
				context_input_tokens: "1000",
				uncached_input_tokens: "1000",
				output_tokens: "100",
				first_observed_line: usage.line,
			})),
		});
	await sqlClient`INSERT INTO session_ownership (organization_id, user_id, session_id) VALUES (${userId}, ${identity.userId}, ${sessionId})`;
}

/** The paged items of a find result: rows, groups, events or weekly totals. */
function items(output: z.infer<typeof AnalysisFindOutputSchema>): unknown[] {
	if (output.source === "sessions") return output.sessions;
	if (output.source === "user" || output.source === "git") return output.events;
	if (output.source === "weekly") return output.totals;
	return "rows" in output ? output.rows : output.groups;
}

function shiftDay(isoDay: string, days: number): string {
	return new Date(Date.parse(isoDay) + days * 86_400_000)
		.toISOString()
		.slice(0, 10);
}

async function signup(label: string) {
	assert(server);
	const response = await fetch(`${server.baseUrl}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			email: `analysis-${label}-${runId}@example.com`,
			name: "Analysis integration",
			password: "analysis-test-password",
		}),
	});
	expect(response.ok).toBe(true);
	const account = z
		.object({ token: z.string(), user: z.object({ id: z.string() }) })
		.parse(await response.json());
	createdUsers.push(account.user.id);
	return account;
}

/**
 * An operation for withAnalysisDeadline, and a promise that resolves once the
 * operation itself has finished: the deadline can end the call while the
 * operation still runs, and only after it has settled can no statement follow.
 */
function settledOperation(
	operation: (executor: ClickHouseExecutor) => Promise<void>,
) {
	let finished: Promise<unknown> = Promise.resolve();
	return {
		run: (executor: ClickHouseExecutor) => {
			const running = operation(executor);
			finished = Promise.allSettled([running]);
			return running;
		},
		get settled() {
			return finished;
		},
	};
}

function observingExecutor(
	statements: ClickHouseStatement[],
	recordResultRows?: number,
): ClickHouseExecutor {
	return {
		close: () => clickhouse.close(),
		execute: (statement) => clickhouse.execute(statement),
		insert: (params) => clickhouse.insert(params),
		query: (statement) => {
			statements.push(statement);
			return clickhouse.query(
				recordResultRows && statement.query.includes("record_idx < 4294967295")
					? {
							...statement,
							clickhouse_settings: {
								...statement.clickhouse_settings,
								max_result_rows: String(recordResultRows),
							},
						}
					: statement,
			);
		},
	};
}

function shortRecordsTranscript(count: number): string {
	return [
		{
			type: "user",
			timestamp: at(0),
			message: { role: "user", content: "Many records" },
		},
		...Array.from({ length: count }, (_, index) =>
			claudeResult(`call-${index}`, "x", index % 2 === 0),
		),
	]
		.map((line) => JSON.stringify(line))
		.join("\n");
}
function claudeTool(id: string, name: string, input: unknown) {
	return {
		type: "assistant",
		timestamp: at(1),
		message: {
			role: "assistant",
			content: [{ type: "tool_use", id, name, input }],
		},
	};
}
function claudeResult(id: string, content: string, isError = false) {
	return {
		type: "user",
		timestamp: at(2),
		message: {
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: id, content, is_error: isError },
			],
		},
	};
}

async function rpc(path: string, input: unknown): Promise<unknown> {
	const response = await rpcResponse(path, input);
	assert.equal(
		response.status,
		200,
		`${await response.clone().text()}\n${server?.readOutput()}`,
	);
	return z.object({ json: z.unknown() }).parse(await response.json()).json;
}

async function rpcResponse(
	path: string,
	input: unknown,
	token = bearerToken,
): Promise<Response> {
	assert(server);
	return fetch(`${server.baseUrl}/rpc/${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ json: input }),
	});
}

function claudeTranscript(): string {
	const user = (content: unknown, offset: number) => ({
		type: "user",
		timestamp: at(offset),
		message: { role: "user", content },
	});
	const assistant = (content: unknown, offset: number) => ({
		type: "assistant",
		timestamp: at(offset),
		message: { role: "assistant", content },
	});
	return [
		user("Fix the file", 0),
		assistant(
			[
				{
					type: "tool_use",
					id: "edit",
					name: "Edit",
					input: {
						file_path: "src/a.ts",
						old_string: "old",
						new_string: "new",
					},
				},
			],
			1,
		),
		user([{ type: "tool_result", tool_use_id: "edit", content: "Updated" }], 2),
		assistant(
			[
				{
					type: "tool_use",
					id: "test",
					name: "Bash",
					input: { command: "bun test" },
				},
			],
			3,
		),
		user(
			[
				{
					type: "tool_result",
					tool_use_id: "test",
					content: "Process exited with code 0\nTests passed",
				},
			],
			4,
		),
		assistant(
			[
				{
					type: "tool_use",
					id: "read",
					name: "Read",
					input: { file_path: "missing.ts" },
				},
			],
			5,
		),
		user(
			[
				{
					type: "tool_result",
					tool_use_id: "read",
					is_error: true,
					content: "ENOENT: open 'missing.ts'",
				},
			],
			6,
		),
		assistant([{ type: "text", text: "Finished the change." }], 7),
		user("fuck, fix the mistake", 8),
		assistant([{ type: "text", text: "I'm sorry for the mistake." }], 9),
	]
		.map((line) => JSON.stringify(line))
		.join("\n");
}

function codexTranscript(): string {
	return [
		{
			timestamp: at(0),
			type: "response_item",
			payload: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "Read the file" }],
			},
		},
		{
			timestamp: at(1),
			type: "response_item",
			payload: {
				type: "function_call",
				name: "exec_command",
				arguments: JSON.stringify({ cmd: "cat missing.ts" }),
				call_id: "read",
			},
		},
		{
			timestamp: at(2),
			type: "response_item",
			payload: {
				type: "function_call_output",
				call_id: "read",
				output: "Process exited with code 2\nENOENT: open 'missing.ts'",
			},
		},
		{
			timestamp: at(3),
			type: "response_item",
			payload: {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "File is absent." }],
			},
		},
		{
			timestamp: at(4),
			type: "response_item",
			payload: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "fuck, use the right file" }],
			},
		},
		{
			timestamp: at(5),
			type: "response_item",
			payload: {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "I'm sorry for the mistake." }],
			},
		},
	]
		.map((line) => JSON.stringify(line))
		.join("\n");
}

function at(offset: number): string {
	return new Date(baseMs + offset * 1_000).toISOString();
}

function timestamp(offset: number): string {
	return at(offset).replace("T", " ").replace("Z", "");
}

test("tool groups normalize Claude and Codex tools, splitting shell calls by their first word", async () => {
	const cases = [
		["Bash", "bun test", "shell"],
		["exec_command", "cat file", "read"],
		["functions.exec_command", "rg term", "search"],
		["shell", "sed -n '1,5p' file", "read"],
		["local_shell", "head file", "read"],
		["write_stdin", "", "shell"],
		["Bash", "less file", "read"],
		["Bash", "tail file", "read"],
		["Bash", "grep term", "search"],
		["Bash", "find src", "search"],
		["Bash", "fd app", "search"],
		["Bash", "ls src", "search"],
		["Bash", "echo rg", "shell"],
		["Bash", "cd src && cat file", "shell"],
		["Bash", "sed -i s/a/b/ file", "shell"],
		["Read", "", "read"],
		["Grep", "", "search"],
		["Glob", "", "search"],
		["LS", "", "search"],
		["Edit", "", "edit"],
		["Write", "", "edit"],
		["MultiEdit", "", "edit"],
		["NotebookEdit", "", "edit"],
		["apply_patch", "", "edit"],
		["mcp__playwright__goto", "", "browser"],
		["mcp__chrome__navigate", "", "browser"],
		["WebFetch", "", "web"],
		["WebSearch", "", "web"],
		["web_search", "", "web"],
		["mcp__db__query", "", "mcp"],
		["Task", "", "subagent"],
		["Agent", "", "subagent"],
		["spawn_agent", "", "subagent"],
		["custom", "", "other"],
	] as const;
	const rows = await clickhouse.query<{
		tool: string;
		command: string;
		group: string;
	}>({
		query: `SELECT c.1 AS tool, c.2 AS command, ${toolGroupSql("c.1", "c.2")} AS group
			FROM (SELECT arrayJoin(arrayZip({tools:Array(String)}, {commands:Array(String)})) AS c)`,
		query_params: {
			tools: cases.map(([tool]) => tool),
			commands: cases.map(([, command]) => command),
		},
	});
	expect(rows.map((row) => [row.tool, row.command, row.group])).toEqual(
		cases.map((entry) => [...entry]),
	);
});

test("the analysis log stores each call as its own step and returns the path, the result and search hits", async () => {
	assert(userId);
	const sessionId = `analysis_log_${runId}`;
	await seedSession(sessionId, "claude_code", claudeTranscript(), "log-model");
	const found = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", {
			source: "runs",
			from: day,
			to: day,
			sessionId,
		}),
	);
	const trace = found.header.trace;
	assert(trace);
	const ref = { sessionId, agentId: "", turn: 1 };
	const read = AnalysisReadOutputSchema.parse(
		await rpc("analysis/read", {
			refs: [ref],
			analysis: trace.analysis,
		}),
	);
	expect(read.trace?.analysis).toBe(trace.analysis);
	await rpc("analysis/history/save", {
		analysis: trace.analysis,
		question: "Why did my last session go wrong?",
		finalAnswer: "The agent never checked its edit.",
		findings: [{ step: trace.step, finding: "one failing run" }],
		topics: ["failures"],
	});

	const tree = AnalysisHistoryGetOutputSchema.parse(
		await rpc("analysis/history/get", { analysis: trace.analysis }),
	);
	expect(tree.status).toBe("finished");
	expect(tree.question).toBe("Why did my last session go wrong?");
	expect(tree.host).toBe("home");
	expect(
		tree.steps.map((step) => [step.question, step.parent, step.finding]),
	).toEqual([
		[
			`find source=runs from=${day} to=${day} sessionId=${sessionId}`,
			null,
			"one failing run",
		],
		["read runs=1", null, null],
	]);
	const stored = AnalysisHistoryQueryOutputSchema.parse(
		await rpc("analysis/history/query", { query: trace.query }),
	);
	expect(stored).toMatchObject({ stale: false, unavailable: null });
	expect(
		stored.call.tool === "find" && stored.call.output?.header.runsInScope,
	).toBe(found.header.runsInScope);
	const hits = AnalysisHistorySearchOutputSchema.parse(
		await rpc("analysis/history/search", { text: "session go wrong" }),
	);
	expect(hits.analyses[0]?.id).toBe(trace.analysis);

	const member = await signup("log-member");
	// Earlier tests filled the free plan's member seats.
	await sqlClient`DELETE FROM member WHERE organization_id = ${userId} AND role = 'member'`;
	await sqlClient`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (${crypto.randomUUID()}, ${userId}, ${member.user.id}, 'member', now())`;
	await sqlClient`UPDATE session SET active_organization_id = ${userId} WHERE user_id = ${member.user.id}`;
	expect(
		(
			await rpcResponse(
				"analysis/history/get",
				{ analysis: trace.analysis },
				member.token,
			)
		).status,
	).toBe(404);
	await rpc("analysis/history/share", {
		analysis: trace.analysis,
		shared: true,
	});
	const shared = AnalysisHistoryGetOutputSchema.parse(
		z
			.object({ json: z.unknown() })
			.parse(
				await (
					await rpcResponse(
						"analysis/history/get",
						{ analysis: trace.analysis },
						member.token,
					)
				).json(),
			).json,
	);
	// The workspace does not restrict results, so the member reads the admin's.
	expect(shared.steps[0]?.queries[0]?.unavailable).toBeNull();
	const sharedQuery = AnalysisHistoryQueryOutputSchema.parse(
		z
			.object({ json: z.unknown() })
			.parse(
				await (
					await rpcResponse(
						"analysis/history/query",
						{ query: trace.query },
						member.token,
					)
				).json(),
			).json,
	);
	expect(sharedQuery.unavailable).toBeNull();
	expect(
		sharedQuery.call.tool === "find" &&
			sharedQuery.call.output?.header.runsInScope,
	).toBe(found.header.runsInScope);
});

test("where the log is off, history fails with an agent-actionable message and the saved-answer MCP tools return it as their result", async () => {
	assert(userId);
	// The server lists only the admin's workspace, so a new account's is off.
	const outsider = await signup("log-off");
	const refused = await rpcResponse(
		"analysis/history/search",
		{ text: "failing run" },
		outsider.token,
	);
	expect(refused.status).toBe(412);
	expect(await refused.text()).toContain(ANALYSIS_HISTORY_OFF);

	const searchAnswers = MCP_TOOLS.find(
		(tool) => tool.name === "search_answers",
	);
	const getAnswer = MCP_TOOLS.find((tool) => tool.name === "get_answer");
	const answers = MCP_TOOLS.find((tool) => tool.name === "answers");
	assert(searchAnswers && getAnswer && answers);
	const user = {
		id: userId,
		name: "Analysis integration",
		email: `analysis-admin-${runId}@example.com`,
		emailVerified: false,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	const session = {
		id: crypto.randomUUID(),
		token: bearerToken,
		userId,
		expiresAt: new Date(Date.now() + 60_000),
		createdAt: new Date(),
		updatedAt: new Date(),
		activeOrganizationId: userId,
	};
	const client = createRouterClient(router, {
		context: {
			user,
			session,
			apiKeyId: null,
			authFailure: null,
			ingestOperatorAuthorized: false,
			requestId: crypto.randomUUID(),
			publicLookupSource: "test",
		},
	});
	// In this process the log is off for every workspace; afterAll resets it.
	setAnalysisLogForTests(null);
	for (const [tool, args] of [
		[searchAnswers, { text: "failing run" }],
		[getAnswer, { analysis: crypto.randomUUID() }],
		[answers, { action: "search", text: "failing run" }],
	] as const) {
		expect(
			await tool.run(client, args, {
				userId,
				workspace: { id: userId, slug: "analysis-log-off", createdAt: null },
				authSession: { user, session },
			}),
		).toBe(ANALYSIS_HISTORY_OFF);
	}
});

test("a workspace without the retro tools is refused schema, sql, search, run and run questions, as procedures and MCP tools; find still answers", async () => {
	assert(userId);
	const user = {
		id: userId,
		name: "Analysis integration",
		email: `analysis-admin-${runId}@example.com`,
		emailVerified: false,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	const session = {
		id: crypto.randomUUID(),
		token: bearerToken,
		userId,
		expiresAt: new Date(Date.now() + 60_000),
		createdAt: new Date(),
		updatedAt: new Date(),
		activeOrganizationId: userId,
	};
	const client = createRouterClient(router, {
		context: {
			user,
			session,
			apiKeyId: null,
			authFailure: null,
			ingestOperatorAuthorized: false,
			requestId: crypto.randomUUID(),
			publicLookupSource: "test",
		},
	});
	const context = {
		userId,
		workspace: { id: userId, slug: "analysis-retro-off", createdAt: null },
		authSession: { user, session },
	};
	const saved = process.env.RETRO_TOOLS_WORKSPACES;
	const savedSince = process.env.RETRO_TOOLS_NEW_SINCE;
	process.env.RETRO_TOOLS_WORKSPACES = otherOrganizationId;
	process.env.RETRO_TOOLS_NEW_SINCE = "2999-01-01";
	try {
		const runs = "SELECT session_id, agent_id, turn_idx FROM runs LIMIT 1";
		for (const call of [
			() => client.analysis.schema({}),
			() => client.analysis.sql({ query: "SELECT 1 FROM runs", title: "x" }),
			() => client.analysis.search({ text: "flaky login", mode: "exact" }),
			() => client.analysis.run({ id: "s:main:1" }),
			() => client.analysis.estimateQuestions({ questions: ["rq_1"], runs }),
			() =>
				client.analysis.runQuestions({
					questions: ["rq_1"],
					runs,
					estimate: "token",
				}),
		])
			await expect(call()).rejects.toThrow(RETRO_TOOLS_OFF);
		const schemaTool = MCP_TOOLS.find((tool) => tool.name === "schema");
		assert(schemaTool);
		await expect(schemaTool.run(client, {}, context)).rejects.toThrow(
			RETRO_TOOLS_OFF,
		);
		expect(
			AnalysisFindOutputSchema.parse(
				await client.analysis.find({ source: "runs", from: day, to: day }),
			).source,
		).toBe("runs");

		process.env.RETRO_TOOLS_NEW_SINCE = "2000-01-01";
		expect(await client.analysis.schema({})).toMatchObject({
			level: "views",
		});

		process.env.RETRO_TOOLS_NEW_SINCE = "";
		await expect(client.analysis.schema({})).rejects.toThrow(RETRO_TOOLS_OFF);
		process.env.RETRO_TOOLS_WORKSPACES = `${otherOrganizationId},${userId}`;
		expect(await client.analysis.schema({})).toMatchObject({
			level: "views",
		});
	} finally {
		if (saved === undefined) delete process.env.RETRO_TOOLS_WORKSPACES;
		else process.env.RETRO_TOOLS_WORKSPACES = saved;
		if (savedSince === undefined) delete process.env.RETRO_TOOLS_NEW_SINCE;
		else process.env.RETRO_TOOLS_NEW_SINCE = savedSince;
	}
});

test("find pages: a cursor continues the same call without duplicates, the last page has none, and other arguments reject it", async () => {
	const scope = { from: day, to: day };
	for (const input of [
		{ source: "runs", ...scope },
		{ source: "runs", ...scope, sort: "costUsd" },
		{ source: "runs", ...scope, groupBy: "agent" },
		{ source: "tool", ...scope, includeNoise: true },
		{ source: "user", ...scope },
	]) {
		const whole = AnalysisFindOutputSchema.parse(
			await rpc("analysis/find", { ...input, limit: 200 }),
		);
		expect(whole.header.cursor).toBeUndefined();
		const all = items(whole);
		expect(all.length).toBeGreaterThan(1);

		const first = AnalysisFindOutputSchema.parse(
			await rpc("analysis/find", { ...input, limit: 1 }),
		);
		expect(first.header.truncated).toBe(true);
		const cursor = first.header.cursor;
		assert(cursor);
		const rest = AnalysisFindOutputSchema.parse(
			await rpc("analysis/find", {
				...input,
				limit: all.length - 1,
				cursor,
			}),
		);
		expect(rest.header.cursor).toBeUndefined();
		expect([...items(first), ...items(rest)]).toEqual(all);
		expect(rest.header.runsInScope).toBe(whole.header.runsInScope);

		const other = await rpcResponse("analysis/find", {
			...input,
			from: shiftDay(day, -1),
			cursor,
		});
		expect(other.status).toBe(400);
		expect(await other.text()).toContain(
			"cursor: returned by a find call with other arguments",
		);
	}
	const forged = await rpcResponse("analysis/find", {
		source: "runs",
		...scope,
		cursor: "not-a-cursor",
	});
	expect(forged.status).toBe(400);
	expect(await forged.text()).toContain(
		"cursor: not a cursor returned by find",
	);

	const runs = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", { source: "runs", ...scope }),
	);
	assert(runs.source === "runs" && "rows" in runs);
	const main = runs.rows.find((row) => row.ref.agentId === "");
	assert(main);
	const { agentId: _agentId, ...withoutAgent } = main.ref;
	const read = AnalysisReadOutputSchema.parse(
		await rpc("analysis/read", { refs: [withoutAgent] }),
	);
	expect(read.reads[0]).toMatchObject({ ref: main.ref, found: true });
});

test("reaction pages keep every text block of one record: two apologies in one assistant message both appear", async () => {
	const sessionId = `analysis_blocks_${runId}`;
	await seedSession(
		sessionId,
		"claude_code",
		[
			{
				type: "user",
				timestamp: at(0),
				message: { role: "user", content: "Rename the helper" },
			},
			{
				type: "assistant",
				timestamp: at(1),
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "I'm sorry, I renamed the wrong file." },
						{ type: "text", text: "Apologies, I also broke the import." },
					],
				},
			},
		]
			.map((line) => JSON.stringify(line))
			.join("\n"),
		"claude-sonnet-4-5",
	);
	const input = {
		source: "user",
		from: day,
		to: day,
		sessionId,
		reaction: ["apology"],
	};
	const whole = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", input),
	);
	assert(whole.source === "user");
	expect(whole.events).toHaveLength(2);
	expect(new Set(whole.events.map((event) => event.eventRef.record)).size).toBe(
		1,
	);

	const first = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", { ...input, limit: 1 }),
	);
	assert(first.source === "user" && first.header.cursor);
	const second = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", {
			...input,
			limit: 1,
			cursor: first.header.cursor,
		}),
	);
	assert(second.source === "user");
	expect(second.header.cursor).toBeUndefined();
	expect([...first.events, ...second.events]).toEqual(whole.events);
});

test("Codex subagent threads: find keeps a family together with parent links and single costs; read joins parent and children at the spawning call", async () => {
	assert(userId);
	const owner = userId;
	const repository = `lineage-${runId}`;
	const id = (name: string) => `analysis_family_${name}_${runId}`;
	const [parent, review, tests, grandchild] = [
		id("parent"),
		id("review"),
		id("tests"),
		id("grandchild"),
	];
	const [uncountable, inferred, standalone] = [
		id("uncountable"),
		id("inferred"),
		id("standalone"),
	];
	const member = await signup("lineage-other");
	const seed = (sessionId: string, content: string, startOffset: number) =>
		seedSession(sessionId, "codex", content, "gpt-5", {
			repository,
			startOffset,
		});
	await seed(parent, codexParentTranscript(review, tests), 100);
	await seed(review, codexReviewTranscript(parent, grandchild), 102);
	await seed(tests, codexTestsTranscript(parent), 106);
	await seed(grandchild, codexGrandchildTranscript(review), 103);
	for (const [sessionId, offset] of [
		[standalone, 89],
		[inferred, 90],
		[uncountable, 91],
	] as const)
		await seed(sessionId, codexTranscript(), offset);
	const edge = (
		childSessionId: string,
		parentSessionId: string,
		overrides: { countable?: boolean; organizationId?: string; user?: string },
	) =>
		buildNativeSessionLineageRow({
			childIngestedAt: new Date(),
			childModel: "gpt-5",
			childSessionDate: at(100),
			childSessionId,
			countable: overrides.countable ?? true,
			derivedAt: new Date(),
			evidenceAt: new Date(),
			organizationId: overrides.organizationId ?? owner,
			parentSessionDate: at(100),
			parentSessionId,
			userId: overrides.user ?? owner,
		});
	await clickhouse.insert({
		table: "rudel.session_lineage",
		asyncInsert: false,
		values: [
			edge(review, parent, {}),
			edge(tests, parent, {}),
			edge(grandchild, review, {}),
			// Not countable (the parent was never uploaded when it was derived).
			edge(uncountable, parent, { countable: false }),
			// An inferred link, not native parent metadata.
			{
				...edge(inferred, parent, {}),
				carrier: "codex_exec_prompt",
				confidence: "prompt_echo",
			},
			// Another member's and another workspace's rows naming this owner's sessions.
			edge(standalone, parent, { user: member.user.id }),
			edge(standalone, parent, { organizationId: otherOrganizationId }),
		],
	});
	const scope = { from: day, to: day, repository };
	const findRuns = async (input: Record<string, unknown>) => {
		const output = AnalysisFindOutputSchema.parse(
			await rpc("analysis/find", { source: "runs", ...scope, ...input }),
		);
		assert(output.source === "runs" && "rows" in output);
		return output;
	};
	const family = [parent, review, tests, grandchild];

	// Asking for the parent brings its threads, each run linked to its parent.
	const byParent = await findRuns({ sessionId: parent });
	expect(new Set(byParent.rows.map((row) => row.ref.sessionId))).toEqual(
		new Set(family),
	);
	expect(byParent.header.sessionsInScope).toBe(4);
	const links = new Map(
		byParent.rows.map((row) => [
			row.ref.sessionId,
			[row.parentSessionId, row.depth],
		]),
	);
	expect(Object.fromEntries(links)).toEqual({
		[parent]: [null, 0],
		[review]: [parent, 1],
		[tests]: [parent, 1],
		[grandchild]: [review, 2],
	});
	expect(byParent.header.notes.join("\n")).toContain(
		"3 of the 4 sessions are Codex subagent threads",
	);
	// Each thread is priced once: the header is the sum of its runs.
	const priced = byParent.rows.reduce(
		(sum, row) => sum + (row.costUsd ?? 0),
		0,
	);
	// One usage event per session prices one run of each thread.
	expect(
		byParent.rows
			.filter((row) => row.costUsd !== null)
			.map((row) => row.ref.sessionId)
			.sort(),
	).toEqual([...family].sort());
	expect(byParent.header.unpricedRuns).toBe(byParent.rows.length - 4);
	// Rows are rounded to 4 decimals, the header sums before rounding.
	expect(byParent.header.pricedCostUsd).toBeCloseTo(priced, 3);
	expect(
		new Set(byParent.rows.map((row) => JSON.stringify(row.ref))).size,
	).toBe(byParent.rows.length);

	// The whole repository: every session once, threads not added twice.
	const all = await findRuns({});
	expect(all.header.sessionsInScope).toBe(7);
	expect(new Set(all.rows.map((row) => JSON.stringify(row.ref))).size).toBe(
		all.rows.length,
	);
	// Seven sessions with one equal usage event each: nothing counted twice.
	expect(all.header.pricedCostUsd).toBeCloseTo(
		(byParent.header.pricedCostUsd * 7) / 4,
		3,
	);
	for (const separate of [uncountable, inferred, standalone])
		expect(
			new Set(
				all.rows
					.filter((row) => row.ref.sessionId === separate)
					.map((row) => JSON.stringify([row.parentSessionId, row.depth])),
			),
		).toEqual(new Set([JSON.stringify([null, 0])]));
	const families = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", {
			source: "runs",
			...scope,
			groupBy: "session",
		}),
	);
	assert(families.source === "runs" && "groups" in families);
	expect(
		Object.fromEntries(
			families.groups.map((group) => [group.key, group.sessions]),
		),
	).toEqual({ [parent]: 4, [uncountable]: 1, [inferred]: 1, [standalone]: 1 });
	expect(
		families.groups.find((group) => group.key === parent)?.costUsd,
	).toBeCloseTo(byParent.header.pricedCostUsd, 4);

	// latest counts families: the newest session is a thread, its family comes whole.
	expect(
		new Set(
			(await findRuns({ latest: 1 })).rows.map((row) => row.ref.sessionId),
		),
	).toEqual(new Set(family));
	expect((await findRuns({ latest: 2 })).header.sessionsInScope).toBe(5);

	// Failures and reactions inside a thread point back to its parent.
	const tools = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", { source: "tool", ...scope, sessionId: parent }),
	);
	assert(tools.source === "tool");
	expect(
		tools.groups
			.flatMap((group) => group.examples)
			.find((example) => example.ref.sessionId === tests)?.parentSessionId,
	).toBe(parent);
	const reactions = AnalysisFindOutputSchema.parse(
		await rpc("analysis/find", { source: "user", ...scope, sessionId: parent }),
	);
	assert(reactions.source === "user");
	expect(
		reactions.events.find((event) => event.eventRef.sessionId === tests)
			?.parentSessionId,
	).toBe(parent);

	// Reading the parent lists each thread at the call that reached it.
	const read = AnalysisReadOutputSchema.parse(
		await rpc("analysis/read", {
			refs: [
				{ sessionId: parent, turn: 1 },
				{ sessionId: parent, turn: 2 },
			],
		}),
	);
	const section = (index: number, name: string) =>
		read.reads[index]?.sections.find((entry) => entry.name === name)?.text;
	expect(section(0, "subagents")).toBe(
		`record 3 spawn_agent -> ${JSON.stringify({ sessionId: review, agentId: "", turn: 1 })} task: Message Type: NEW_TASK Task name: /root/review Sender: /root Payload: Review src/a.ts for bugs`,
	);
	expect(section(1, "subagents")?.split("\n")).toEqual([
		`record 7 spawn_agent -> ${JSON.stringify({ sessionId: tests, agentId: "", turn: 1 })} task: Message Type: NEW_TASK Task name: /root/tests Sender: /root Payload:`,
		`record 9 followup_task -> ${JSON.stringify({ sessionId: review, agentId: "", turn: 2 })} task: Message Type: FOLLOWUP_TASK Task name: /root/review Sender: /root Payload: Also check src/b.ts`,
	]);
	expect(section(0, "parent")).toBeUndefined();
	const turn = AnalysisReadOutputSchema.parse(
		await rpc("analysis/read", {
			refs: [{ sessionId: parent, turn: 2 }],
			depth: "turn",
		}),
	);
	const records = turn.reads[0]?.sections ?? [];
	const spawn = records.findIndex((entry) => entry.record?.index === 7);
	expect(records[spawn]?.text).toContain('"message":"[encrypted]"');
	expect(records[spawn]?.text).not.toContain("gAAAA");
	expect(records[spawn]?.record?.cut).toBe(false);
	expect(records[spawn + 1]?.name).toBe("subagent");
	expect(records[spawn + 1]?.text).toContain(`"sessionId":"${tests}"`);

	// Reading a thread starts with its parent run and its delegated task.
	const threads = AnalysisReadOutputSchema.parse(
		await rpc("analysis/read", {
			refs: [
				{ sessionId: review, turn: 1 },
				{ sessionId: grandchild, turn: 1 },
				{ sessionId: tests, turn: 1 },
				{ sessionId: uncountable, turn: 1 },
			],
		}),
	);
	const [reviewRead, grandchildRead, testsRead, uncountableRead] =
		threads.reads;
	expect(reviewRead?.sections[0]).toEqual({
		name: "parent",
		text: `spawned by ${JSON.stringify({ sessionId: parent, agentId: "", turn: 1 })} at record 3 (spawn_agent); depth 1, top session ${parent}`,
	});
	expect(
		reviewRead?.sections.find((entry) => entry.name === "task")?.text,
	).toContain("Review src/a.ts for bugs");
	expect(
		reviewRead?.sections.find((entry) => entry.name === "subagents")?.text,
	).toBe(
		`record 3 spawn_agent -> ${JSON.stringify({ sessionId: grandchild, agentId: "", turn: 1 })} task: Check the imports of src/a.ts`,
	);
	expect(grandchildRead?.sections[0]?.text).toBe(
		`spawned by ${JSON.stringify({ sessionId: review, agentId: "", turn: 1 })} at record 3 (spawn_agent); depth 2, top session ${parent}`,
	);
	expect(testsRead?.sections[0]?.text).toContain(
		`${JSON.stringify({ sessionId: parent, agentId: "", turn: 2 })} at record 7`,
	);
	expect(
		uncountableRead?.sections.some((entry) => entry.name === "parent"),
	).toBe(false);
	// Other members' and workspaces' lineage never joins this owner's sessions.
	expect(JSON.stringify(read)).not.toContain(standalone);
});

function codexMeta(sessionId: string, parent?: string, path?: string) {
	return {
		timestamp: at(0),
		type: "session_meta",
		payload: {
			id: sessionId,
			...(parent
				? {
						parent_thread_id: parent,
						thread_source: "subagent",
						agent_path: path ?? null,
						source: {
							subagent: {
								thread_spawn: {
									parent_thread_id: parent,
									agent_path: path ?? null,
								},
							},
						},
					}
				: { thread_source: "user" }),
		},
	};
}

function codexLine(offset: number, payload: Record<string, unknown>) {
	return { timestamp: at(offset), type: "response_item", payload };
}

function codexText(role: "user" | "assistant", text: string) {
	return {
		type: "message",
		role,
		content: [{ type: role === "user" ? "input_text" : "output_text", text }],
	};
}

function codexCall(callId: string, name: string, args: unknown) {
	return {
		type: "function_call",
		name,
		arguments: JSON.stringify(args),
		call_id: callId,
	};
}

function codexOutput(callId: string, output: string) {
	return { type: "function_call_output", call_id: callId, output };
}

function codexTask(
	recipient: string,
	kind: string,
	payload: string,
	encrypted = false,
) {
	return {
		type: "agent_message",
		author: "/root",
		recipient,
		content: [
			{
				type: "input_text",
				text: `Message Type: ${kind}\nTask name: ${recipient}\nSender: /root\nPayload:\n${encrypted ? "" : payload}`,
			},
			...(encrypted
				? [{ type: "encrypted_content", encrypted_content: payload }]
				: []),
		],
	};
}

const ENCRYPTED = `gAAAAABqvTvktoKr0mG1POcRDUOwiBy9eSTBRZSdTnb2AGan62XewcHE8IF2W1M-${"x".repeat(40)}`;

function jsonl(lines: readonly unknown[]): string {
	return lines.map((line) => JSON.stringify(line)).join("\n");
}

/** Spawns /root/review in turn 1, /root/tests and a follow-up to review in turn 2; messages encrypted. */
function codexParentTranscript(review: string, tests: string): string {
	return jsonl([
		codexMeta(`parent-of-${review}-${tests}`),
		codexLine(100, codexText("user", "Review and test the change")),
		codexLine(
			102,
			codexCall("s1", "spawn_agent", {
				task_name: "review",
				message: ENCRYPTED,
			}),
		),
		codexLine(102, codexOutput("s1", '{"task_name":"/root/review"}')),
		codexLine(103, codexText("assistant", "Waiting for the review.")),
		codexLine(105, codexText("user", "Now run the tests")),
		codexLine(
			106,
			codexCall("s2", "spawn_agent", {
				task_name: "tests",
				message: ENCRYPTED,
			}),
		),
		codexLine(106, codexOutput("s2", '{"task_name":"/root/tests"}')),
		codexLine(
			107,
			codexCall("f1", "followup_task", {
				target: "review",
				message: ENCRYPTED,
			}),
		),
		codexLine(107, codexOutput("f1", "")),
		codexLine(109, codexText("assistant", "Done.")),
	]);
}

/** A thread with a plain-text task that spawns the grandchild (older Codex: the result names its id). */
function codexReviewTranscript(parent: string, grandchild: string): string {
	return jsonl([
		codexMeta(`review-${parent}`, parent, "/root/review"),
		codexLine(
			102,
			codexTask("/root/review", "NEW_TASK", "Review src/a.ts for bugs"),
		),
		codexLine(
			103,
			codexCall("g1", "spawn_agent", {
				message: "Check the imports of src/a.ts",
			}),
		),
		codexLine(
			103,
			codexOutput(
				"g1",
				JSON.stringify({ agent_id: grandchild, nickname: "Poincare" }),
			),
		),
		codexLine(104, codexText("assistant", "Found one bug.")),
		codexLine(
			107,
			codexTask("/root/review", "FOLLOWUP_TASK", "Also check src/b.ts"),
		),
		codexLine(108, codexText("assistant", "src/b.ts is fine.")),
	]);
}

/** A thread whose task payload is encrypted; its test run fails and it apologizes. */
function codexTestsTranscript(parent: string): string {
	return jsonl([
		codexMeta(`tests-${parent}`, parent, "/root/tests"),
		codexLine(106, codexTask("/root/tests", "NEW_TASK", ENCRYPTED, true)),
		codexLine(107, codexCall("t1", "exec_command", { cmd: "bun test" })),
		codexLine(
			107,
			codexOutput("t1", "Process exited with code 1\nFAIL src/a.test.ts"),
		),
		codexLine(108, codexText("assistant", "I'm sorry, the tests fail.")),
	]);
}

/** Older Codex: the task arrives as a plain user message. */
function codexGrandchildTranscript(review: string): string {
	return jsonl([
		codexMeta(`grandchild-${review}`, review),
		codexLine(103, codexText("user", "Check the imports of src/a.ts")),
		codexLine(104, codexText("assistant", "Imports are fine.")),
	]);
}

test("source=git joins a session's pushes and CI checks to its PR and the CI runs on the pushed SHA, the PR and its merge commit", async () => {
	assert(userId);
	const organizationId = userId;
	const sessionId = `analysis_git_${runId}`;
	const repositoryId = `9${Date.now() % 1_000_000_000}`;
	const fullSha = `d4e5f6a${"0".repeat(32)}1`;
	const prHead = `c0ffee0${"0".repeat(32)}2`;
	const mergeSha = `e0e0e0e${"0".repeat(32)}3`;
	const coveredFrom = new Date(baseMs - 3 * 86_400_000)
		.toISOString()
		.slice(0, 10);
	// One boundary for every read, so links from edges and at query time compare exactly.
	const coveredThrough = new Date().toISOString();
	const transcript = jsonl([
		{
			type: "user",
			timestamp: at(0),
			message: { role: "user", content: "Push and watch CI" },
		},
		// The session creates the pushed commit, which dates its CI history.
		claudeTool("commit", "Bash", { command: "git commit -m 'feat: links'" }),
		claudeResult("commit", "[feat/links d4e5f6a] feat: links\n 1 file changed"),
		claudeTool("push", "Bash", { command: "git push -u origin feat/links" }),
		claudeResult(
			"push",
			"To github.com:opalinehq/athena.git\n   a1b2c3d..d4e5f6a  feat/links -> feat/links",
		),
		claudeTool("checks", "Bash", {
			command: "gh pr checks 133 --repo opalinehq/athena",
		}),
		claudeResult("checks", "Exit code 1\nbuild\tfail", true),
		claudeTool("fork", "Bash", { command: "git push fork feat/links" }),
		claudeResult(
			"fork",
			"To github.com:someone/else.git\n   a1b2c3d..d4e5f6a  feat/links -> feat/links",
		),
		claudeTool("runs", "Bash", {
			command: "gh run list --branch main -R opalinehq/athena",
		}),
		claudeResult("runs", "completed\tsuccess\tCI"),
	]);
	await seedSession(sessionId, "claude_code", transcript, "claude-opus-5-5", {
		repository: "github.com/opalinehq/athena",
	});
	const input = {
		organizationId,
		userId: organizationId,
		sessionId,
		source: "claude_code" as const,
		revision: "1",
		transcriptParserVersion: TRANSCRIPT_RECORDS_PARSER_VERSION,
	};
	const observations = parseGitObservations({
		...input,
		records: [
			...splitSessionTranscript({
				content: transcript,
				sessionDate: at(0),
				source: "claude_code",
			}),
		].map(
			(draft): GitObservationRecord => ({
				agent_id: draft.agentId,
				record_idx: draft.recordIdx,
				block_idx: draft.blockIdx,
				call_id: draft.callId,
				kind: draft.kind,
				subtype: draft.subtype,
				tool_name: draft.toolName,
				is_error: draft.isError,
				exit_code: draft.exitCode,
				ts: draft.ts,
				text: draft.text,
				text_chars: draft.textChars,
				byte_start: String(draft.byteStart),
				byte_len: draft.byteLen,
			}),
		),
	});
	expect(observations.map((row) => row.kind)).toEqual([
		"commit_created",
		"push_range",
		"ci_check",
		"push_range",
		"ci_check",
	]);
	const github = {
		workspace_id: organizationId,
		provider: "github",
		repository_id: repositoryId,
		version: "1",
		synced_at: timestamp(5),
	};
	const source: GitHubSource = {
		access: async () => ({
			visibility: "visible" as const,
			bindings: [{ repositoryId, fullName: "opalinehq/athena" }],
			repositories: new Map([
				[
					repositoryId,
					{
						included: true,
						// Collected from well before the session, so the branch
						// check's day-long window is covered too.
						prFrom: coveredFrom,
						ciFrom: coveredFrom,
						coveredThrough,
						reason: null,
					},
				],
			]),
		}),
		evidence: async () => ({ snapshots: [], captures: [] }),
	};
	const find = (
		extra: Record<string, unknown>,
		sourceOverride: GitHubSource = source,
	) =>
		findAnalysis(
			{ organizationId, userId: null },
			AnalysisFindInputSchema.parse({
				source: "git",
				sessionId,
				from: day,
				to: day,
				...extra,
			}),
			{ executor: clickhouse, github: sourceOverride },
		).then((output) => {
			const parsed = AnalysisFindOutputSchema.parse(output);
			assert(parsed.source === "git");
			return parsed;
		});
	try {
		await clickhouse.insert({
			table: "rudel.session_git_observations",
			asyncInsert: false,
			values: [
				...observations,
				{
					...baseRow(input, {
						agent_id: "",
						record_idx: 4_294_967_295,
						block_idx: 0,
						call_id: "",
						ts: at(0),
					}),
					kind: "receipt",
					label: "",
				},
			],
		});
		await clickhouse.insert({
			table: "rudel.github_pull_requests",
			asyncInsert: false,
			values: [
				{
					...github,
					number: 133,
					provider_pull_request_id: "p133",
					state: "closed",
					draft: 0,
					created_at: timestamp(1),
					updated_at: timestamp(4),
					merged_at: timestamp(4),
					head_sha: prHead,
					head_ref: "feat/links",
					base_ref: "main",
					head_repository_id: repositoryId,
					merge_commit_sha: mergeSha,
					title: "feat: links",
				},
			],
		});
		await clickhouse.insert({
			table: "rudel.github_pull_request_commits",
			asyncInsert: false,
			values: [
				{ ...github, sha: fullSha, pr_number: 133, last_seen_head_sha: prHead },
			],
		});
		const run = (
			runId: string,
			sha: string,
			conclusion: string,
			offset: number,
			event = "pull_request",
		) => ({
			...github,
			kind: "actions_run",
			run_id: runId,
			attempt: 1,
			created_at: timestamp(offset),
			workflow_name: "CI",
			event,
			head_sha: sha,
			head_branch: event === "push" ? "main" : "feat/links",
			status: "completed",
			conclusion,
		});
		await clickhouse.insert({
			table: "rudel.github_ci_runs",
			asyncInsert: false,
			values: [
				run("7001", fullSha, "failure", 3),
				run("7002", prHead, "success", 4),
				run("7003", mergeSha, "failure", 6, "push"),
				// On main a minute before the session: in the branch check's window.
				run("7004", `b0b0b0b${"0".repeat(32)}4`, "success", -60, "push"),
			],
		});
		await clickhouse.insert({
			table: "rudel.github_ci_run_pull_requests",
			asyncInsert: false,
			values: [
				{
					...github,
					pr_number: 133,
					run_created_at: timestamp(4),
					kind: "actions_run",
					run_id: "7002",
					attempt: 1,
					basis: "provider",
				},
			],
		});

		const output = await find({});
		const pushes = output.events.filter((event) => event.kind === "push_range");
		const athena = pushes.find((event) =>
			event.remote.includes("opalinehq/athena"),
		);
		expect(athena).toMatchObject({
			turn: 1,
			label: "observed",
			generation: { revision: "1", current: true },
			repository: { id: repositoryId, basis: "event" },
			github: { status: "linked" },
			sha: { value: fullSha, candidates: 1 },
			ciRunCount: 3,
			ciRunCountThrough: expect.any(String),
			ciRunCountUnknown: null,
			ciConclusions: { failure: 2, success: 1 },
			checksAfter: { count: 2 },
		});
		expect(athena?.pullRequests).toMatchObject([
			{
				number: 133,
				bases: ["branch", "commit"],
				commitInHead: true,
				mergeCommitSha: mergeSha,
			},
		]);
		expect(
			athena?.ciRuns
				.map((ciRun) => [
					ciRun.runId,
					ciRun.repositoryId === repositoryId,
					ciRun.edges.map((edge) => [edge.basis, edge.linkBasis]),
				])
				.sort(),
		).toEqual([
			["7001", true, [["pushed_sha", null]]],
			["7002", true, [["pull_request", "provider"]]],
			["7003", true, [["merge_commit", null]]],
		]);
		const checkRecord = output.events.find(
			(event) => event.kind === "ci_check" && event.prNumber === 133,
		)?.record;
		expect(athena?.checksAfter).toEqual({
			count: 2,
			unconfirmed: 0,
			sameCall: 0,
			first: { record: checkRecord ?? -1, at: expect.any(String) },
		});
		// A push to a repository without a binding is never linked to the session's repository.
		const other = pushes.find((event) => event.remote.includes("someone/else"));
		expect(other).toMatchObject({
			repository: null,
			github: { status: "unbound" },
			sha: { value: null, candidates: null },
			ciRunCount: null,
			pullRequests: [],
		});
		const check = output.events.find(
			(event) => event.kind === "ci_check" && event.prNumber === 133,
		);
		expect(check).toMatchObject({
			label: "observed",
			prNumber: 133,
			pullRequests: [{ number: 133, bases: ["named"] }],
		});
		// A check that names only a branch lists that branch's runs of the day before it.
		const branchCheck = output.events.find(
			(event) => event.kind === "ci_check" && event.branch === "main",
		);
		expect(branchCheck).toMatchObject({
			pullRequests: [],
			ciRunCount: 1,
			ciRunCountUnknown: null,
		});
		expect(
			branchCheck?.ciRuns.map((ciRun) => [
				ciRun.runId,
				ciRun.edges.map((edge) => edge.basis),
			]),
		).toEqual([["7004", ["branch"]]]);

		const first = await find({ limit: 1 });
		expect(first.events).toHaveLength(1);
		assert(first.header.cursor);
		const rest = await find({ limit: 10, cursor: first.header.cursor });
		expect(rest.events).toHaveLength(output.events.length - 1);
		expect(rest.events.map((event) => event.record)).not.toContain(
			first.events[0]?.record,
		);

		const hidden = await find(
			{},
			{
				access: async () => ({
					visibility: "hidden" as const,
					bindings: [],
					repositories: new Map(),
				}),
				evidence: async () => ({ snapshots: [], captures: [] }),
			},
		);
		expect(hidden.events).toHaveLength(output.events.length);
		expect(
			hidden.events.every(
				(event) =>
					event.github.status === "not_visible" && event.ciRunCount === null,
			),
		).toBe(true);
		expect(hidden.header.notes.join("\n")).toContain("not visible");
		expect(hidden.events.every((event) => !("edges" in event))).toBe(true);

		// The edge worker is off (no scope row for the session): the output is
		// exactly what it was before edges, with no link metadata.
		expect(output.events.every((event) => !("edges" in event))).toBe(true);

		// Built edges: the same events with the same links, read from the edges.
		await enqueueL1EdgeScope(sqlClient, {
			kind: "session",
			organizationId,
			userId: organizationId,
			source: "claude_code",
			sessionId,
		});
		await enqueueL1EdgeScope(sqlClient, {
			kind: "repository",
			organizationId,
			repositoryId,
		});
		expect(
			await runL1EdgePass({
				sql: sqlClient,
				budgetMs: 60_000,
				// Only this workspace's scopes: other suites queue theirs too.
				organizationId,
				sources: {
					executor: clickhouse,
					access: source.access,
					evidence: source.evidence,
				},
			}),
		).toBeGreaterThanOrEqual(2);
		const withoutEdges = (events: typeof output.events) =>
			events.map(({ edges: _edges, ...event }) => event);
		const fromEdges = await find({});
		expect(withoutEdges(fromEdges.events)).toEqual(withoutEdges(output.events));
		expect(
			fromEdges.events.map((event) => [
				event.edges?.linkedBy,
				event.edges?.status,
			]),
		).toEqual(output.events.map(() => ["edges", "current"]));

		// Switched off, find links at query time and says nothing about edges.
		process.env.L1_EDGES_FIND_READ = "false";
		try {
			const off = await find({});
			expect(withoutEdges(off.events)).toEqual(withoutEdges(output.events));
			expect(off.events.every((event) => !("edges" in event))).toBe(true);
		} finally {
			delete process.env.L1_EDGES_FIND_READ;
		}

		// The reverse direction: the runs that touched PR 133, whatever their date.
		const touching = AnalysisFindOutputSchema.parse(
			await findAnalysis(
				{ organizationId, userId: null },
				AnalysisFindInputSchema.parse({
					source: "git",
					pullRequest: "https://github.com/opalinehq/athena/pull/133",
				}),
				{ executor: clickhouse, github: source },
			),
		);
		assert(touching.source === "git");
		expect(
			touching.events.map((event) => [event.kind, event.record]).sort(),
		).toEqual(
			output.events
				.filter(
					(event) =>
						event.kind === "commit_created" ||
						(event.kind === "push_range" &&
							event.remote.includes("opalinehq/athena")) ||
						(event.kind === "ci_check" && event.prNumber === 133),
				)
				.map((event) => [event.kind, event.record])
				.sort(),
		);
		expect(touching.header).toMatchObject({ from: day, to: day });
		// Every touching session is indexed in the generation its edges came from.
		expect(touching.witnesses).toEqual([]);
		expect(touching.header.notes).toContain(
			"pullRequest opalinehq/athena#133: 1 sessions you can see touch it through 4 edges (commit_created 1, commit_pushed 1, pr_branch_head 1, pr_named 1)",
		);
		// A scope limited to one member (the own-sessions option on) never counts the admin's sessions.
		const member = AnalysisFindOutputSchema.parse(
			await findAnalysis(
				{ organizationId, userId: `not_the_owner_${runId}` },
				AnalysisFindInputSchema.parse({
					source: "git",
					pullRequest: "opalinehq/athena#133",
				}),
				{ executor: clickhouse, github: source },
			),
		);
		assert(member.source === "git");
		expect(member.events).toEqual([]);
		expect(member.header.sessionsInScope).toBe(0);
		expect(member.header.notes[0]).toBe(
			"pullRequest opalinehq/athena#133: no session you can see has an edge to it or its commits",
		);
		expect(member.header.notes.join("\n")).not.toMatch(/\b[1-9]\d* sessions/u);
	} finally {
		await clickhouse.execute({
			query:
				"DELETE FROM rudel.session_git_observations WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3",
			query_params: { organizationId },
		});
		for (const table of [
			"rudel.l1_edges",
			"rudel.l1_edges_by_target",
			"rudel.l1_edge_resolutions",
		])
			await clickhouse.execute({
				query: `DELETE FROM ${table} WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
				query_params: { organizationId },
			});
		await sqlClient.unsafe(
			"DELETE FROM l1_edge_scope WHERE organization_id = $1",
			[organizationId],
		);
		for (const table of [
			"rudel.github_pull_requests",
			"rudel.github_pull_request_commits",
			"rudel.github_ci_runs",
			"rudel.github_ci_run_pull_requests",
		])
			await clickhouse.execute({
				query: `DELETE FROM ${table} WHERE workspace_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
				query_params: { organizationId },
			});
	}
});

test("source=git pages a member's unindexed CLI captures from Postgres exactly and counts the member as an owner", async () => {
	assert(userId);
	const organizationId = userId;
	const member = await signup("evidence-owner");
	await sqlClient`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (${crypto.randomUUID()}, ${organizationId}, ${member.user.id}, 'member', now())`;
	const sessions = [`evidence_a_${runId}`, `evidence_b_${runId}`];
	const uploadId = `analysis_evidence_upload_${runId}`;
	// Same millisecond, different microseconds: one page boundary falls inside it.
	const sameMs = new Date(baseMs + 30_000).toISOString().replace("Z", "");
	const captures: [string, string, string | null, string][] = [
		["c1", sessions[0] ?? "", null, `${sameMs}400Z`],
		["c2", sessions[0] ?? "", null, `${sameMs}800Z`],
		["c3", sessions[0] ?? "", "agent-x", `${sameMs}100Z`],
		["c4", sessions[0] ?? "", "agent-x", `${sameMs}900Z`],
		["c5", sessions[1] ?? "", null, `${sameMs}000Z`],
		["c6", sessions[1] ?? "", "agent-y", `${sameMs}500Z`],
		["c7", sessions[0] ?? "", null, at(20)],
		["c8", sessions[1] ?? "", null, at(40)],
	];
	try {
		await clickhouse.insert({
			table: "rudel.session_analytics",
			asyncInsert: false,
			values: sessions.map((sessionId) => ({
				organization_id: organizationId,
				user_id: member.user.id,
				session_id: sessionId,
				source: "codex",
				session_date: timestamp(0),
				last_interaction_date: timestamp(10),
				project_path: "/test/evidence",
				git_remote: "repo",
				model_used: "gpt-5",
				revision: "1",
			})),
		});
		// One upload per capture, as the CLI uploads them.
		for (const [context, sessionId, agentId, capturedAt] of captures) {
			await sqlClient.unsafe(
				`INSERT INTO repository_evidence_upload (
					id, operation_id, organization_id, user_id, context_id,
					manifest_object_id, request, missing_object_ids, expires_at
				 ) VALUES ($1, $1, $2, $3, $1, 'manifest', '{}'::jsonb, '[]'::jsonb, NOW() + INTERVAL '1 hour')`,
				[`${uploadId}_${context}`, organizationId, member.user.id],
			);
			await sqlClient.unsafe(
				`INSERT INTO repository_evidence_capture (
					organization_id, context_id, user_id, upload_id, manifest_object_id,
					installation_id, local_repository_id, local_worktree_id, session_id,
					run_id, segment_id, agent_id, source, lifecycle, head_git_commit,
					captured_at, coverage
				 ) VALUES (
					$1, $2, $3, $4, 'manifest', 'installation', 'local-repository',
					'local-worktree', $5, 'run', 'segment', $6, 'codex', 'checkpoint',
					$7, $8::timestamptz, '[]'::jsonb
				 )`,
				[
					organizationId,
					`${runId}_${context}`,
					member.user.id,
					`${uploadId}_${context}`,
					sessionId,
					agentId,
					context,
					capturedAt,
				],
			);
		}
		const { postgresGitHubSource } = await import(
			"../services/analysis/github-access.js"
		);
		const source: GitHubSource = {
			access: async () => ({
				visibility: "visible" as const,
				bindings: [],
				repositories: new Map(),
			}),
			evidence: postgresGitHubSource.evidence,
		};
		const find = (extra: Record<string, unknown>) =>
			// The scope an admin's `userId` filter resolves to in the handler.
			findAnalysisWithOwners(
				{ organizationId, userId: member.user.id },
				AnalysisFindInputSchema.parse({
					source: "git",
					userId: member.user.id,
					from: day,
					to: day,
					...extra,
				}),
				{ executor: clickhouse, github: source },
			).then(({ output, owners }) => {
				const parsed = AnalysisFindOutputSchema.parse(output);
				assert(parsed.source === "git");
				return { output: parsed, owners };
			});

		const all = await find({ limit: 50 });
		// Only the member's sessions were read, though none has an indexed transcript.
		expect(all.owners).toEqual([member.user.id]);
		// Newest first, then session, stream and capture, as the cursor orders them.
		const order = all.output.events.map((event) => event.commitHash);
		expect(order).toEqual(["c8", "c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
		expect(
			all.output.events.every(
				(event) =>
					event.kind === "evidence_capture" &&
					event.github.status === "not_github",
			),
		).toBe(true);

		const paged: string[] = [];
		let cursor: string | undefined;
		for (let page = 0; page < captures.length; page++) {
			const next = await find({ limit: 2, ...(cursor ? { cursor } : {}) });
			expect(next.owners).toEqual([member.user.id]);
			paged.push(...next.output.events.map((event) => event.commitHash));
			cursor = next.output.header.cursor ?? undefined;
			if (!cursor) break;
		}
		expect(paged).toEqual(order);
	} finally {
		await sqlClient.unsafe(
			"DELETE FROM repository_evidence_capture WHERE organization_id = $1 AND upload_id LIKE $2",
			[organizationId, `${uploadId}_%`],
		);
		await sqlClient.unsafe(
			"DELETE FROM repository_evidence_upload WHERE organization_id = $1 AND id LIKE $2",
			[organizationId, `${uploadId}_%`],
		);
	}
});
