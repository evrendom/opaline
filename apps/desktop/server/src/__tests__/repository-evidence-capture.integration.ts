import { expect, setDefaultTimeout, test } from "bun:test";
import { createORPCClient, isDefinedError, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import {
	CliApiKeyCreateResponseSchema,
	type contract,
	RepositoryEvidenceInitInputSchema,
} from "@rudel/api-routes";
import { z } from "zod";
import { getClickhouse } from "../clickhouse.js";
import { sqlClient } from "../db.js";
import { startApiTestServer } from "./helpers/api-test-server.js";

setDefaultTimeout(60_000);

test.each([
	["1", 3_600],
	["99999999", 604_800],
	[undefined, 86_400],
])("disabled init and commit return typed errors (%s) while transcript ingest succeeds", async (pauseSeconds, expected) => {
	const server = await startApiTestServer({
		REPOSITORY_EVIDENCE_CAPTURE_ENABLED: "false",
		REPOSITORY_EVIDENCE_CAPTURE_PAUSE_SECONDS: pauseSeconds,
		R2_ACCOUNT_ID: undefined,
		R2_ACCESS_KEY_ID: undefined,
		R2_SECRET_ACCESS_KEY: undefined,
	});
	let userId: string | undefined;
	try {
		const signup = await fetch(`${server.baseUrl}/api/auth/sign-up/email`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Capture switch",
				email: `${crypto.randomUUID()}@example.test`,
				password: crypto.randomUUID(),
			}),
		});
		expect(signup.status).toBe(200);
		const account = z
			.object({ token: z.string(), user: z.object({ id: z.string() }) })
			.parse(await signup.json());
		userId = account.user.id;
		const keyResponse = await fetch(
			`${server.baseUrl}/api/auth/api-key/create`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${account.token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ name: "capture-switch", expiresIn: null }),
			},
		);
		expect(keyResponse.status).toBe(200);
		const apiKey = CliApiKeyCreateResponseSchema.parse(
			await keyResponse.json(),
		).key;
		const client: ContractRouterClient<typeof contract> = createORPCClient(
			new RPCLink({
				url: `${server.baseUrl}/rpc`,
				headers: { "x-api-key": apiKey },
			}),
		);
		const sessionId = crypto.randomUUID();
		const objectId = `sha256:${"a".repeat(64)}`;
		const now = new Date().toISOString();
		const input = RepositoryEvidenceInitInputSchema.parse({
			capture: {
				contextId: crypto.randomUUID(),
				parentContextId: null,
				baseGitCommit: null,
				headGitCommit: null,
				timing: {
					captureStartedAt: now,
					captureCompletedAt: now,
					firstActionAt: null,
					firstActionBasis: "unavailable",
					firstActionRelationship: "unknown",
					lifecycle: "end",
				},
				transcriptWatermark: {
					byteOffset: 0,
					eventOrdinal: 0,
					lastEventAt: null,
				},
			},
			coverage: [{ area: "git-state", status: "unavailable", reason: "test" }],
			manifestObjectId: objectId,
			objects: [
				{
					objectId,
					sha256: "a".repeat(64),
					byteLength: 1,
					contentEncoding: "identity",
					filterVersion: 1,
					kind: "context-manifest",
					mediaType: "application/json",
				},
			],
			operationId: crypto.randomUUID(),
			organizationId: userId,
			protocol: "repository_evidence_v1",
			repository: {
				local: {
					installationId: crypto.randomUUID(),
					repositoryId: `local-repository:${"b".repeat(64)}`,
					worktreeId: `local-worktree:${"c".repeat(64)}`,
				},
				provider: null,
			},
			session: {
				agentId: null,
				parentAgentId: null,
				runId: sessionId,
				segmentId: sessionId,
				sessionId,
				source: "claude_code",
			},
		});
		for (const operation of [
			() => client.repositoryEvidence.init(input),
			() =>
				client.repositoryEvidence.commit({
					objects: [],
					organizationId: account.user.id,
					uploadReceiptId: crypto.randomUUID(),
				}),
		]) {
			const error = await operation().then(
				() => undefined,
				(failure: unknown) => failure,
			);
			expect(error).toBeInstanceOf(ORPCError);
			expect(isDefinedError(error)).toBe(true);
			expect(error).toMatchObject({
				code: "EVIDENCE_CAPTURE_DISABLED",
				status: 403,
				data: { pauseSeconds: expected },
			});
		}
		const result = await client.ingestSession({
			organizationId: userId,
			sessionId,
			projectPath: "/capture-switch",
			source: "claude_code",
			content: JSON.stringify({
				type: "user",
				timestamp: now,
				message: { role: "user", content: "transcript still accepted" },
			}),
		});
		expect(result.success).toBe(true);
		expect(result.sessionId).toBe(sessionId);
	} finally {
		await server.stop();
		if (userId) {
			await getClickhouse().execute({
				query:
					"DELETE FROM rudel.claude_sessions WHERE user_id = {userId:String}",
				query_params: { userId },
			});
			await sqlClient`DELETE FROM organization WHERE id = ${userId}`;
			await sqlClient`DELETE FROM "user" WHERE id = ${userId}`;
		}
	}
});
