import {
	AnalysisCostSchema,
	AnalysisHistoryGetOutputSchema,
	AnalysisHostSchema,
} from "@rudel/api-routes";
import { z } from "zod";
import {
	ConvexCallError,
	type ConvexFunctionType,
	createConvexHttpClient,
} from "./convex-http.js";
import { createTokenSource, type SigningKey } from "./convex-token.js";
import { AnalysisFullError, SanitizedError } from "./errors.js";
import type {
	AnalysisPatch,
	AnalysisSave,
	AnalysisStore,
	QuerySession,
	StoredAnalysis,
	StoredEmbedding,
	StoredQuery,
	StoredSessionLink,
	StoredStep,
} from "./types.js";

/** Longest wait for one Convex call. */
const REQUEST_TIMEOUT_MS = 30_000;

/** A query as Convex stores it: arguments as JSON, the result and sessions kept apart. */
interface StoredQueryFields
	extends Omit<StoredQuery, "args" | "output" | "sessions" | "owners"> {
	argsJson: string;
}

const AnalysisSchema = z.object({
	id: z.string(),
	workspaceId: z.string(),
	authorId: z.string(),
	host: AnalysisHostSchema,
	question: z.string(),
	status: z.enum(["finished", "unfinished"]),
	shared: z.boolean(),
	pinned: z.boolean(),
	createdAt: z.string(),
	cutoff: z.string(),
	scope: AnalysisHistoryGetOutputSchema.shape.scope,
	finalAnswer: z.string().nullable(),
	topics: z.array(z.string()),
	updates: z.string().nullable(),
	notes: z.array(z.string()),
	cost: AnalysisCostSchema.nullable(),
	queryCount: z.number(),
	stepCount: z.number(),
});
const StepSchema = z.object({
	id: z.string(),
	analysisId: z.string(),
	parentId: z.string().nullable(),
	ordinal: z.number(),
	question: z.string(),
	reply: z.string().nullable(),
	finding: z.string().nullable(),
	createdAt: z.string(),
});
const QueryFieldsSchema = z.object({
	id: z.string(),
	analysisId: z.string(),
	stepId: z.string(),
	workspaceId: z.string(),
	authorId: z.string(),
	tool: z.enum(["find", "read"]),
	argsJson: z.string().transform(parseArgs),
	outputChars: z.number(),
	createdAt: z.string(),
	removed: z.boolean(),
});
const QuerySchema = QueryFieldsSchema.extend({
	outputJson: z.string().nullable(),
	sessions: z.array(
		z.object({
			sessionId: z.string(),
			ownerId: z.string(),
			revision: z.string(),
			parserVersion: z.number(),
		}),
	),
	owners: z.array(z.string()),
}).transform(
	({ argsJson, outputJson, ...query }): StoredQuery => ({
		...query,
		args: argsJson,
		output: outputJson === null ? null : JSON.parse(outputJson),
	}),
);
const QuerySummarySchema = QueryFieldsSchema.extend({
	hasOutput: z.boolean(),
	ownerCount: z.number(),
	onlyOwnerId: z.string().nullable(),
}).transform(({ argsJson, ...query }) => ({ ...query, args: argsJson }));
const SessionLinksSchema = z.array(
	z.object({
		analysisId: z.string(),
		sessionId: z.string(),
		source: z.enum(["claude_code", "codex"]),
		ownerId: z.string(),
		uploadedAt: z.string(),
	}),
);
const DeletionSchema = z.object({ hasMore: z.boolean() });
/** The ConvexError data of a full analysis (convex/limits.ts). */
const AnalysisFullSchema = z.object({
	kind: z.literal("analysisFull"),
	child: z.enum(["queries", "steps", "sessions"]),
});
const MatchesSchema = z.array(
	z.object({
		analysisId: z.string(),
		stepId: z.string().nullable(),
		kind: z.enum(["question", "step", "topics"]),
		text: z.string(),
	}),
);

/** The public functions in convex/ the store calls, with their arguments. Only the API's tokens may call them. */
interface ConvexFunctionArgs {
	"analyses:create": { analysis: StoredAnalysis };
	"analyses:get": { id: string };
	"analyses:update": { id: string; patch: AnalysisPatch };
	"analyses:save": { id: string; save: AnalysisSave };
	"analyses:latestOpen": {
		workspaceId: string;
		authorId: string;
		since: string;
	};
	"analyses:recent": { workspaceId: string; viewerId: string; limit: number };
	"steps:create": { step: StoredStep };
	"steps:list": { analysisId: string };
	"queries:create": {
		query: StoredQueryFields;
		sessions: QuerySession[];
		owners: string[];
		outputJson: string | null;
	};
	"queries:get": { id: string };
	"queries:list": { analysisId: string };
	"deletion:byAuthor": { authorId: string };
	"deletion:byWorkspace": { workspaceId: string };
	"deletion:markReadingOwner": { ownerId: string };
	"deletion:sweep": Record<string, never>;
	"deletion:sessionsByOwner": { ownerId: string };
	"sessions:link": { link: StoredSessionLink };
	"sessions:list": { analysisId: string };
	"embeddings:add": { workspaceId: string; embedding: StoredEmbedding };
	"embeddings:search": {
		workspaceId: string;
		model: string;
		vector: number[];
		limit: number;
	};
}

/** Whether each function is a query, mutation or action (it picks the HTTP endpoint). */
const FUNCTION_TYPES = {
	"analyses:create": "mutation",
	"analyses:get": "query",
	"analyses:update": "mutation",
	"analyses:save": "mutation",
	"analyses:latestOpen": "query",
	"analyses:recent": "query",
	"steps:create": "mutation",
	"steps:list": "query",
	"queries:create": "mutation",
	"queries:get": "query",
	"queries:list": "query",
	"deletion:byAuthor": "mutation",
	"deletion:byWorkspace": "mutation",
	"deletion:markReadingOwner": "mutation",
	"deletion:sweep": "mutation",
	"deletion:sessionsByOwner": "mutation",
	"sessions:link": "mutation",
	"sessions:list": "query",
	"embeddings:add": "mutation",
	"embeddings:search": "action",
} as const satisfies Record<keyof ConvexFunctionArgs, ConvexFunctionType>;

/**
 * The analysis log in Convex (ADR 0001). Each store call is one Convex
 * function call over Convex's HTTP API (convex-http.ts), authenticated with a
 * token signed by the API's key. Every
 * HTTP request ends after `REQUEST_TIMEOUT_MS` or when `signal` aborts, and
 * deletion loops stop with it.
 */
export function createConvexAnalysisStore({
	url,
	signingKey,
	signal,
}: {
	url: string;
	signingKey: SigningKey;
	signal: AbortSignal | undefined;
}): AnalysisStore {
	const client = createConvexHttpClient(url);
	const token = createTokenSource(signingKey);
	// Convex errors can repeat the rejected arguments, which may quote
	// transcript evidence: callers only ever see which function failed, or
	// that an analysis is full.
	const run = async <TPath extends keyof ConvexFunctionArgs>(
		path: TPath,
		args: ConvexFunctionArgs[TPath],
	): Promise<unknown> => {
		try {
			const bearer = await token();
			const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
			return await client(FUNCTION_TYPES[path], path, args, {
				token: bearer,
				signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
			});
		} catch (error) {
			if (!(error instanceof ConvexCallError))
				throw new SanitizedError(
					`Convex ${path} failed (${error instanceof Error ? error.name : typeof error})`,
				);
			const full =
				error.failure.kind === "convexError"
					? AnalysisFullSchema.safeParse(error.failure.data)
					: undefined;
			if (full?.success) throw new AnalysisFullError(full.data.child);
			throw new SanitizedError(error.message);
		}
	};
	const untilDone = async (batch: () => Promise<unknown>) => {
		let hasMore = true;
		while (hasMore) {
			signal?.throwIfAborted();
			hasMore = DeletionSchema.parse(await batch()).hasMore;
		}
	};

	return {
		async createAnalysis(analysis) {
			await run("analyses:create", { analysis });
		},
		async getAnalysis(id) {
			return AnalysisSchema.nullable().parse(await run("analyses:get", { id }));
		},
		async updateAnalysis(id, patch) {
			await run("analyses:update", { id, patch });
		},
		async saveAnalysis(id, save) {
			await run("analyses:save", { id, save });
		},
		async latestOpenAnalysis(workspaceId, authorId, since) {
			return AnalysisSchema.nullable().parse(
				await run("analyses:latestOpen", {
					workspaceId,
					authorId,
					since,
				}),
			);
		},
		async recentAnalyses(workspaceId, viewerId, limit) {
			return AnalysisSchema.array().parse(
				await run("analyses:recent", { workspaceId, viewerId, limit }),
			);
		},

		async createStep(step) {
			await run("steps:create", { step });
		},
		async getSteps(analysisId) {
			return StepSchema.array().parse(await run("steps:list", { analysisId }));
		},

		async createQuery({ args, output, sessions, owners, ...fields }) {
			await run("queries:create", {
				query: { ...fields, argsJson: JSON.stringify(args) },
				sessions,
				owners,
				outputJson: output === null ? null : JSON.stringify(output),
			});
		},
		async getQuery(id) {
			return QuerySchema.nullable().parse(await run("queries:get", { id }));
		},
		async getQueries(analysisId) {
			return QuerySummarySchema.array().parse(
				await run("queries:list", { analysisId }),
			);
		},

		async deleteAnalysesByAuthor(authorId) {
			await untilDone(() => run("deletion:byAuthor", { authorId }));
		},
		async deleteAnalysesByWorkspace(workspaceId) {
			await untilDone(() => run("deletion:byWorkspace", { workspaceId }));
		},
		async deleteAnalysesReadingOwner(ownerId) {
			// Hide them all first, then delete them in bounded batches.
			await untilDone(() => run("deletion:markReadingOwner", { ownerId }));
			await untilDone(() => run("deletion:sweep", {}));
		},

		async linkSession(link) {
			await run("sessions:link", { link });
		},
		async getSessionLinks(analysisId) {
			// Convex orders by upload time; ties go by source and session id.
			return SessionLinksSchema.parse(
				await run("sessions:list", { analysisId }),
			).sort(
				(left, right) =>
					compare(left.uploadedAt, right.uploadedAt) ||
					compare(left.source, right.source) ||
					compare(left.sessionId, right.sessionId),
			);
		},
		async deleteSessionLinksByOwner(ownerId) {
			await untilDone(() => run("deletion:sessionsByOwner", { ownerId }));
		},

		async addEmbedding(workspaceId, embedding) {
			await run("embeddings:add", { workspaceId, embedding });
		},
		async searchEmbeddings(workspaceId, model, vector, limit) {
			return MatchesSchema.parse(
				await run("embeddings:search", {
					workspaceId,
					model,
					vector,
					limit,
				}),
			);
		},
	};
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function parseArgs(argsJson: string): Record<string, unknown> {
	return z.record(z.string(), z.unknown()).parse(JSON.parse(argsJson));
}
