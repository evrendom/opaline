import { expect, test } from "bun:test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createConvexHttpClient } from "./convex-http.js";
import { createConvexAnalysisStore } from "./convex-store.js";
import {
	apiClaims,
	createSigningKeys,
	createTokenSource,
	parseSigningKey,
	signToken,
} from "./convex-token.js";
import { analysisStoreContract } from "./store-contract.js";

const url = process.env.CONVEX_URL?.trim();
const signingKey = parseSigningKey(process.env.ANALYSIS_LOG_SIGNING_KEY ?? "");
if (!url || !signingKey)
	throw new Error(
		"The Convex integration test needs CONVEX_URL and ANALYSIS_LOG_SIGNING_KEY for a deployment whose ANALYSIS_LOG_JWKS holds the matching public key (see convex/README.md).",
	);

const deploymentUrl: string = url;
const getAnalysis = makeFunctionReference<"query", { id: string }>(
	"analyses:get",
);

analysisStoreContract("convex", () =>
	createConvexAnalysisStore({ url, signingKey, signal: undefined }),
);

test("calls without a token are rejected", async () => {
	await expect(
		client(undefined).query(getAnalysis, { id: "a_missing" }),
	).rejects.toThrow();
});

test("tokens signed by another key are rejected", async () => {
	const { signingKey: otherKey } = await createSigningKeys();
	const store = createConvexAnalysisStore({
		url,
		signingKey: otherKey,
		signal: undefined,
	});
	await expect(store.getAnalysis("a_missing")).rejects.toThrow();
});

test("validly signed tokens with the wrong issuer, audience or expiry are rejected", async () => {
	const now = Math.floor(Date.now() / 1000);
	for (const claims of [
		{ ...apiClaims(now), iss: "https://example.com/analysis-log" },
		{ ...apiClaims(now), aud: "another-audience" },
		{ ...apiClaims(now - 7_200), exp: now - 3_600 },
	]) {
		const token = await signToken(signingKey, claims);
		await expect(
			client(token).query(getAnalysis, { id: "a_missing" }),
		).rejects.toThrow();
	}
});

test("tokens with another algorithm are rejected: unsigned, or HMAC keyed with the public key", async () => {
	const payload = base64Url(
		JSON.stringify(apiClaims(Math.floor(Date.now() / 1000))),
	);
	const unsigned = `${base64Url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${payload}.`;
	const header = base64Url(
		JSON.stringify({ alg: "HS256", typ: "JWT", kid: signingKey.kid }),
	);
	const { kty, crv, x, y, kid } = signingKey;
	const hmacKey = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(JSON.stringify({ kty, crv, x, y, kid })),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		hmacKey,
		new TextEncoder().encode(`${header}.${payload}`),
	);
	const hmac = `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
	for (const token of [unsigned, hmac])
		await expect(
			client(token).query(getAnalysis, { id: "a_missing" }),
		).rejects.toThrow();
});

test("internal functions reject the API's own valid token", async () => {
	const authenticated = client(await createTokenSource(signingKey)());
	expect(
		await authenticated.query(getAnalysis, { id: "a_missing" }),
	).toBeNull();
	const expire = makeFunctionReference<"mutation", { cursor: null }>(
		"retention:expireQueryResults",
	);
	const visibleMatches = makeFunctionReference<
		"query",
		{ workspaceId: string; ids: string[] }
	>("embeddings:visibleMatches");
	await expect(
		authenticated.mutation(expire, { cursor: null }),
	).rejects.toThrow("Could not find public function");
	await expect(
		authenticated.query(visibleMatches, { workspaceId: "w", ids: [] }),
	).rejects.toThrow("Could not find public function");
});

test("the HTTP client reads exactly what ConvexHttpClient reads", async () => {
	const store = createConvexAnalysisStore({
		url,
		signingKey,
		signal: undefined,
	});
	const id = `a_${crypto.randomUUID()}`;
	const now = new Date().toISOString();
	await store.createAnalysis({
		id,
		workspaceId: `workspace_${id}`,
		authorId: `author_${id}`,
		host: "eval",
		question: "Parity — 错 ✓",
		status: "unfinished",
		draft: false,
		shared: false,
		pinned: false,
		createdAt: now,
		cutoff: now,
		scope: { from: null, to: null, filters: {} },
		finalAnswer: null,
		topics: ["parity"],
		updates: null,
		changes: [],
		notes: [],
		cost: {
			source: "reported",
			model: "gpt-5",
			inputTokens: 1_234_567,
			cachedInputTokens: 0,
			cacheWriteTokens: 0,
			outputTokens: 89,
			reasoningTokens: 0,
			costUsd: 0.1234,
		},
		queryCount: 0,
		stepCount: 0,
		visibilityRevision: 0,
	});
	const token = await createTokenSource(signingKey)();
	const viaHttp = await createConvexHttpClient(deploymentUrl)(
		"query",
		"analyses:get",
		{ id },
		{ token, signal: AbortSignal.timeout(30_000) },
	);
	expect(viaHttp).toEqual(await client(token).query(getAnalysis, { id }));
	expect(await store.getAnalysis(id)).toMatchObject({
		id,
		question: "Parity — 错 ✓",
		cost: { inputTokens: 1_234_567, costUsd: 0.1234 },
	});
	await store.deleteAnalysesByAuthor(`author_${id}`);
});

test("a failed store call names only the function, never its arguments", async () => {
	const store = createConvexAnalysisStore({
		url,
		signingKey,
		signal: undefined,
	});
	const query = {
		id: `q_${crypto.randomUUID()}`,
		analysisId: "a_missing",
		stepId: "s_missing",
		workspaceId: "w",
		authorId: "u",
		tool: "find" as const,
		args: {},
		output: { quote: "export API_KEY=sk-live-should-not-be-logged" },
		outputChars: 1,
		sessions: [],
		owners: [],
		createdAt: new Date().toISOString(),
		removed: false,
		counts: false,
		redaction: null,
	};
	await expect(store.createQuery(query)).rejects.toThrow(
		/^Convex queries:create failed \(\w+\)$/,
	);
});

test("analyses that quoted a deleted owner are hidden first, then deleted in size-bounded batches", async () => {
	const store = createConvexAnalysisStore({
		url,
		signingKey,
		signal: undefined,
	});
	const namespace = crypto.randomUUID();
	const authorId = `author_${namespace}`;
	const ownerId = `owner_${namespace}`;
	const now = new Date().toISOString();
	// ~250 KB each: 40 of them are more than half a transaction.
	const output = { text: "错".repeat(83_000) };
	const fill = async (analysisId: string, sessionOwner: string) => {
		await store.createAnalysis({
			id: analysisId,
			workspaceId: `workspace_${namespace}`,
			authorId,
			host: "eval",
			question: "Near-limit results",
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
		});
		const stepId = `${analysisId}_step`;
		await store.createStep({
			id: stepId,
			analysisId,
			parentId: null,
			ordinal: 1,
			question: "Step",
			reply: null,
			finding: null,
			createdAt: now,
		});
		for (let index = 0; index < 40; index++)
			await store.createQuery({
				id: `${analysisId}_q${index}`,
				analysisId,
				stepId,
				workspaceId: `workspace_${namespace}`,
				authorId,
				// Quoting the owner's runs: deletion takes the whole analysis.
				tool: "read",
				args: {},
				output,
				outputChars: 1,
				sessions: [
					{
						sessionId: `${analysisId}_s${index}`,
						ownerId: sessionOwner,
						revision: "1",
						parserVersion: 1,
					},
				],
				owners: [sessionOwner],
				createdAt: now,
				removed: false,
				counts: false,
				redaction: null,
			});
	};
	const authenticated = client(await createTokenSource(signingKey)());
	const removeOwnerEvidence = makeFunctionReference<
		"mutation",
		{ ownerId: string },
		{ hasMore: boolean }
	>("deletion:removeOwnerEvidence");
	const sweep = makeFunctionReference<
		"mutation",
		Record<string, never>,
		{ hasMore: boolean }
	>("deletion:sweep");
	const deleteByAuthor = makeFunctionReference<
		"mutation",
		{ authorId: string },
		{ hasMore: boolean }
	>("deletion:byAuthor");

	const analysisId = `a_${namespace}`;
	await fill(analysisId, ownerId);
	expect(
		await authenticated.mutation(removeOwnerEvidence, { ownerId }),
	).toEqual({ hasMore: false });
	// Marked analyses are hidden and refuse writes before anything is deleted.
	expect(await store.getAnalysis(analysisId)).toBeNull();
	await expect(
		store.createStep({
			id: `${analysisId}_late`,
			analysisId,
			parentId: null,
			ordinal: 2,
			question: "Late",
			reply: null,
			finding: null,
			createdAt: now,
		}),
	).rejects.toThrow();
	expect(await authenticated.mutation(sweep, {})).toEqual({ hasMore: true });
	await store.removeOwnerEvidence(ownerId);
	expect(await store.getQueries(analysisId)).toEqual([]);

	await fill(`${analysisId}_fresh`, ownerId);
	expect(await authenticated.mutation(deleteByAuthor, { authorId })).toEqual({
		hasMore: true,
	});
	await store.deleteAnalysesByAuthor(authorId);
	expect(await store.getAnalysis(`${analysisId}_fresh`)).toBeNull();
});

function client(token: string | undefined): ConvexHttpClient {
	return new ConvexHttpClient(deploymentUrl, {
		logger: false,
		...(token ? { auth: token } : {}),
	});
}

function base64Url(value: string): string {
	return Buffer.from(value).toString("base64url");
}
