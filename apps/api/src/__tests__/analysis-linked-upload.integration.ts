import "./helpers/local-integration-guard.js";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { createRouterClient, ORPCError } from "@orpc/server";
import type { IngestSessionInput } from "@rudel/api-routes";
import { getClickhouse, getSafeClickHouseTable } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { router } from "../router.js";
import { getAnalysisTree } from "../services/analysis-log/analysis-log.service.js";
import {
	ANALYSIS_UPLOAD_LOG_OFF,
	ANALYSIS_UPLOAD_NOT_FOUND,
} from "../services/analysis-log/analysis-uploads.js";
import {
	purgeAnalysisLogs,
	setAnalysisLogForTests,
} from "../services/analysis-log/config.js";
import { createLocalEmbedder } from "../services/analysis-log/embedder.js";
import { createMemoryAnalysisStore } from "../services/analysis-log/memory-store.js";
import type {
	AnalysisLog,
	StoredAnalysis,
} from "../services/analysis-log/types.js";

const runId = crypto.randomUUID();
const authorId = `linked-author-${runId}`;
const memberId = `linked-member-${runId}`;
const strangerId = `linked-stranger-${runId}`;
const workspaceId = `linked-workspace-${runId}`;
const strangerWorkspaceId = `linked-stranger-workspace-${runId}`;
const log: AnalysisLog = {
	store: createMemoryAnalysisStore(),
	embedder: createLocalEmbedder(),
	now: () => new Date(),
};
const own = analysisOf(`a_own_${runId.slice(0, 8)}`, authorId, false);
const sharedByMember = analysisOf(
	`a_shared_${runId.slice(0, 8)}`,
	memberId,
	true,
);
const privateOfMember = analysisOf(
	`a_private_${runId.slice(0, 8)}`,
	memberId,
	false,
);
const environment = {
	ANALYSIS_LOG_STORE: "memory",
	ANALYSIS_LOG_WORKSPACES: workspaceId,
	SKILL_EXTRACTION_ENABLED: "false",
	TRANSCRIPT_RECORDS_EXTRACTION_ENABLED: "false",
	USAGE_EVENT_EXTRACTION_ENABLED: "false",
};
const previousEnvironment = new Map(
	Object.keys(environment).map((name) => [name, process.env[name]]),
);

beforeAll(async () => {
	for (const [name, value] of Object.entries(environment))
		process.env[name] = value;
	setAnalysisLogForTests(log);
	for (const id of [authorId, memberId, strangerId])
		await sqlClient`
			INSERT INTO "user" (id, name, email)
			VALUES (${id}, 'Linked upload test', ${`${id}@example.com`})
		`;
	// Each account's personal workspace is its default upload target.
	for (const id of [
		authorId,
		memberId,
		strangerId,
		workspaceId,
		strangerWorkspaceId,
	])
		await sqlClient`
			INSERT INTO organization (id, name, slug)
			VALUES (${id}, 'Linked upload test', ${id})
		`;
	for (const [organizationId, userId] of [
		[authorId, authorId],
		[memberId, memberId],
		[strangerId, strangerId],
		[workspaceId, authorId],
		[workspaceId, memberId],
		[strangerWorkspaceId, strangerId],
	] as const)
		await sqlClient`
			INSERT INTO member (id, organization_id, user_id, role)
			VALUES (${crypto.randomUUID()}, ${organizationId}, ${userId}, 'owner')
		`;
	for (const analysis of [own, sharedByMember, privateOfMember])
		await log.store.createAnalysis(analysis);
});

afterAll(async () => {
	setAnalysisLogForTests(undefined);
	for (const [name, value] of previousEnvironment) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	for (const organizationId of [workspaceId, authorId, memberId, strangerId])
		await getClickhouse().execute({
			query: `DELETE FROM ${getSafeClickHouseTable("rudel.claude_sessions")} WHERE organization_id = {organizationId:String} SETTINGS lightweight_deletes_sync = 3`,
			query_params: { organizationId },
		});
	for (const id of [
		workspaceId,
		strangerWorkspaceId,
		authorId,
		memberId,
		strangerId,
	])
		await sqlClient`DELETE FROM organization WHERE id = ${id}`;
	for (const id of [authorId, memberId, strangerId])
		await sqlClient`DELETE FROM "user" WHERE id = ${id}`;
});

describe("analysis-linked uploads", () => {
	test("authStatus advertises analysis-linked uploads, transcript slimming, evidence images, live sessions and data export", async () => {
		expect(await clientFor(authorId).cli.authStatus()).toEqual({
			id: authorId,
			email: `${authorId}@example.com`,
			name: "Linked upload test",
			capabilities: {
				analysisLinkedUploads: true,
				dataExport: true,
				liveSessions: true,
				repositoryEvidenceImages: true,
				sessionInventory: true,
				transcriptSlimming: true,
			},
		});
	});

	test("an upload naming an analysis goes to its workspace, echoes the id and is listed by get", async () => {
		const sessionId = `linked-chat-${runId}`;
		const first = await clientFor(authorId).ingestSession(
			upload(sessionId, own.id),
		);
		expect(first).toMatchObject({
			analysisId: own.id,
			sessionId,
			success: true,
		});
		expect(await uploadedIn(workspaceId, authorId, sessionId)).toBe(true);
		expect(await uploadedIn(authorId, authorId, sessionId)).toBe(false);

		const tree = await getAnalysisTree(log, viewer(authorId), own.id);
		expect(tree.chatSessions).toEqual([
			{
				sessionId,
				source: "claude_code",
				userId: authorId,
				uploadedAt: expect.any(String),
			},
		]);
		const firstUploadedAt = tree.chatSessions[0]?.uploadedAt;
		assert(firstUploadedAt);

		// The identical re-upload is a no-op for the transcript but refreshes the link.
		await Bun.sleep(5);
		const repeated = await clientFor(authorId).ingestSession(
			upload(sessionId, own.id),
		);
		expect(repeated.analysisId).toBe(own.id);
		const relisted = await getAnalysisTree(log, viewer(authorId), own.id);
		expect(relisted.chatSessions).toHaveLength(1);
		const refreshedAt = relisted.chatSessions[0]?.uploadedAt;
		assert(refreshedAt);
		expect(refreshedAt > firstUploadedAt).toBe(true);
	});

	test("an upload without analysisId keeps its default workspace and has no echo", async () => {
		const sessionId = `unlinked-chat-${runId}`;
		const result = await clientFor(authorId).ingestSession(
			upload(sessionId, undefined),
		);
		expect(result.analysisId).toBeUndefined();
		expect(await uploadedIn(authorId, authorId, sessionId)).toBe(true);
	});

	test("a member may attach a chat to a shared analysis; private, foreign and unknown analyses are not found", async () => {
		const shared = await clientFor(authorId).ingestSession(
			upload(`linked-shared-${runId}`, sharedByMember.id),
		);
		expect(shared.analysisId).toBe(sharedByMember.id);
		expect(
			(await getAnalysisTree(log, viewer(memberId), sharedByMember.id))
				.chatSessions,
		).toEqual([
			expect.objectContaining({
				sessionId: `linked-shared-${runId}`,
				userId: authorId,
			}),
		]);

		for (const [userId, analysisId] of [
			[authorId, privateOfMember.id],
			[strangerId, own.id],
			[authorId, "a_does_not_exist"],
		] as const) {
			const sessionId = `refused-${userId}-${analysisId}`;
			const refused = await clientFor(userId)
				.ingestSession(upload(sessionId, analysisId))
				.then(
					() => null,
					(error: unknown) => error,
				);
			expect(refused).toBeInstanceOf(ORPCError);
			assert(refused instanceof ORPCError);
			expect(refused.status).toBe(404);
			expect(refused.message).toBe(ANALYSIS_UPLOAD_NOT_FOUND);
			expect(await uploadedIn(workspaceId, userId, sessionId)).toBe(false);
			expect(await uploadedIn(userId, userId, sessionId)).toBe(false);
		}
		expect(
			(await getAnalysisTree(log, viewer(memberId), privateOfMember.id))
				.chatSessions,
		).toEqual([]);
	});

	test("a restricting workspace lists a linked chat only to its owner and admins", async () => {
		const restricted = analysisOf(
			`a_restricted_${runId.slice(0, 8)}`,
			memberId,
			true,
		);
		await log.store.createAnalysis(restricted);
		const authorChat = `restricted-author-chat-${runId}`;
		await clientFor(authorId).ingestSession(upload(authorChat, restricted.id));
		const memberChat = `restricted-member-chat-${runId}`;
		await clientFor(memberId).ingestSession(upload(memberChat, restricted.id));
		const listed = async (
			userId: string,
			access: { isAdmin: boolean; restrictResults: boolean },
		) =>
			(
				await getAnalysisTree(
					log,
					{ workspaceId, userId, onlyMember: null, ...access },
					restricted.id,
				)
			).chatSessions
				.map((chat) => chat.sessionId)
				.sort();

		expect(
			await listed(authorId, { isAdmin: false, restrictResults: true }),
		).toEqual([authorChat]);
		expect(
			await listed(memberId, { isAdmin: false, restrictResults: true }),
		).toEqual([memberChat]);
		expect(
			await listed(memberId, { isAdmin: true, restrictResults: true }),
		).toEqual([authorChat, memberChat].sort());
		expect(
			await listed(authorId, { isAdmin: false, restrictResults: false }),
		).toEqual([authorChat, memberChat].sort());
	});

	test("where the log is off, an upload naming an analysis is refused with 412 and nothing is stored", async () => {
		const sessionId = `log-off-${runId}`;
		const refusals: unknown[] = [];
		process.env.ANALYSIS_LOG_WORKSPACES = "";
		try {
			refusals.push(
				await clientFor(authorId)
					.ingestSession(upload(sessionId, own.id))
					.catch((error: unknown) => error),
			);
		} finally {
			process.env.ANALYSIS_LOG_WORKSPACES = workspaceId;
		}
		setAnalysisLogForTests(null);
		try {
			refusals.push(
				await clientFor(authorId)
					.ingestSession(upload(sessionId, own.id))
					.catch((error: unknown) => error),
			);
		} finally {
			setAnalysisLogForTests(log);
		}
		for (const refused of refusals) {
			expect(refused).toBeInstanceOf(ORPCError);
			assert(refused instanceof ORPCError);
			expect(refused.status).toBe(412);
			expect(refused.message).toBe(ANALYSIS_UPLOAD_LOG_OFF);
		}
		expect(await uploadedIn(workspaceId, authorId, sessionId)).toBe(false);
		expect(await uploadedIn(authorId, authorId, sessionId)).toBe(false);
	});

	test("purges delete links: an account's chats leave other members' analyses, a workspace's analyses take theirs", async () => {
		const sessionId = `purged-chat-${runId}`;
		await clientFor(authorId).ingestSession(
			upload(sessionId, sharedByMember.id),
		);
		await clientFor(memberId).ingestSession(
			upload(`member-chat-${runId}`, sharedByMember.id),
		);
		expect(
			(await log.store.getSessionLinks(sharedByMember.id)).map(
				(link) => link.ownerId,
			),
		).toContain(authorId);

		await purgeAnalysisLogs({ targetType: "account", targetId: authorId });
		expect(await log.store.getAnalysis(sharedByMember.id)).not.toBeNull();
		expect(
			(await log.store.getSessionLinks(sharedByMember.id)).map(
				(link) => link.ownerId,
			),
		).toEqual([memberId]);

		await purgeAnalysisLogs({
			targetType: "organization",
			targetId: workspaceId,
		});
		expect(await log.store.getAnalysis(sharedByMember.id)).toBeNull();
		expect(await log.store.getSessionLinks(sharedByMember.id)).toEqual([]);
	});
});

function clientFor(userId: string) {
	return createRouterClient(router, {
		context: {
			user: {
				id: userId,
				name: "Linked upload test",
				email: `${userId}@example.com`,
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			session: null,
			apiKeyId: `linked-upload-key-${userId}`,
			authFailure: null,
			ingestOperatorAuthorized: false,
			requestId: crypto.randomUUID(),
			publicLookupSource: "test",
		},
	});
}

function upload(
	sessionId: string,
	analysisId: string | undefined,
): IngestSessionInput {
	const timestamp = new Date(Date.now() - 60_000).toISOString();
	return {
		source: "claude_code",
		sessionId,
		projectPath: "/test/analysis-linked-upload",
		upload_mode: "manual",
		content: [
			JSON.stringify({
				type: "user",
				sessionId,
				timestamp,
				message: { role: "user", content: "Why are agents slow?" },
			}),
			JSON.stringify({
				type: "assistant",
				sessionId,
				timestamp,
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Because of retries." }],
				},
			}),
		].join("\n"),
		...(analysisId ? { analysisId } : {}),
	};
}

async function uploadedIn(
	organizationId: string,
	userId: string,
	sessionId: string,
): Promise<boolean> {
	const rows = await sqlClient<Array<{ session_id: string }>>`
		SELECT session_id FROM session_ownership
		WHERE organization_id = ${organizationId}
			AND user_id = ${userId}
			AND session_id = ${sessionId}
			AND last_ingested_at IS NOT NULL
	`;
	return rows.length > 0;
}

function viewer(userId: string) {
	return {
		workspaceId,
		userId,
		isAdmin: false,
		restrictResults: false,
		onlyMember: null,
	};
}

function analysisOf(
	id: string,
	authorId: string,
	shared: boolean,
): StoredAnalysis {
	const now = new Date().toISOString();
	return {
		id,
		workspaceId,
		authorId,
		host: "plugin",
		question: "Why are agents slow?",
		status: "finished",
		draft: false,
		shared,
		pinned: false,
		createdAt: now,
		cutoff: now,
		scope: { from: null, to: null, filters: {} },
		finalAnswer: "Retries.",
		topics: [],
		updates: null,
		changes: [],
		notes: [],
		cost: null,
		queryCount: 0,
		stepCount: 0,
		visibilityRevision: 0,
	};
}
