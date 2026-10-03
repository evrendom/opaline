import {
	AnalysisCostSchema,
	AnalysisHistoryGetOutputSchema,
	AnalysisHostSchema,
} from "@rudel/api-routes";
import { ConvexHttpClient } from "convex/browser";
import {
	type DefaultFunctionArgs,
	type FunctionArgs,
	type FunctionReference,
	getFunctionName,
	makeFunctionReference,
	type OptionalRestArgs,
} from "convex/server";
import { ConvexError } from "convex/values";
import { z } from "zod";
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
const DeletionSchema = z.object({ hasMore: z.boolean() });
/** The ConvexError data of a full analysis (convex/limits.ts). */
const AnalysisFullSchema = z.object({
	kind: z.literal("analysisFull"),
	child: z.enum(["queries", "steps"]),
});
const MatchesSchema = z.array(
	z.object({
		analysisId: z.string(),
		stepId: z.string().nullable(),
		kind: z.enum(["question", "step", "topics"]),
		text: z.string(),
	}),
);

/** The public functions in convex/, by module. Only the API's tokens may call them. */
const convex = {
	analyses: {
		create: mutationReference<{ analysis: StoredAnalysis }>("analyses:create"),
		get: queryReference<{ id: string }>("analyses:get"),
		update: mutationReference<{ id: string; patch: AnalysisPatch }>(
			"analyses:update",
		),
		save: mutationReference<{ id: string; save: AnalysisSave }>(
			"analyses:save",
		),
		latestOpen: queryReference<{
			workspaceId: string;
			authorId: string;
			since: string;
		}>("analyses:latestOpen"),
		recent: queryReference<{
			workspaceId: string;
			viewerId: string;
			limit: number;
		}>("analyses:recent"),
	},
	steps: {
		create: mutationReference<{ step: StoredStep }>("steps:create"),
		list: queryReference<{ analysisId: string }>("steps:list"),
	},
	queries: {
		create: mutationReference<{
			query: StoredQueryFields;
			sessions: QuerySession[];
			owners: string[];
			outputJson: string | null;
		}>("queries:create"),
		get: queryReference<{ id: string }>("queries:get"),
		list: queryReference<{ analysisId: string }>("queries:list"),
	},

	deletion: {
		byAuthor: mutationReference<{ authorId: string }>("deletion:byAuthor"),
		byWorkspace: mutationReference<{ workspaceId: string }>(
			"deletion:byWorkspace",
		),
		markReadingOwner: mutationReference<{ ownerId: string }>(
			"deletion:markReadingOwner",
		),
		sweep: mutationReference<Record<string, never>>("deletion:sweep"),
	},
	embeddings: {
		add: mutationReference<{ workspaceId: string; embedding: StoredEmbedding }>(
			"embeddings:add",
		),
		search: makeFunctionReference<
			"action",
			{ workspaceId: string; model: string; vector: number[]; limit: number },
			unknown
		>("embeddings:search"),
	},
};

/**
 * The analysis log in Convex (ADR 0001). Each store call is one Convex
 * function call authenticated with a token signed by the API's key. Every
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
	const timeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const client = new ConvexHttpClient(url, {
		// Function log lines may quote stored evidence; never print them.
		logger: false,
		fetch: Object.assign(
			(
				input: Parameters<typeof fetch>[0],
				init?: Parameters<typeof fetch>[1],
			) =>
				fetch(input, {
					...init,
					signal: signal ? AbortSignal.any([signal, timeout()]) : timeout(),
				}),
			{ preconnect: fetch.preconnect },
		),
	});
	const token = createTokenSource(signingKey);
	// Convex errors can repeat the rejected arguments, which may quote
	// transcript evidence: callers only ever see which function failed, or
	// that an analysis is full.
	const call = async <TResult>(
		fn: FunctionReference<"query" | "mutation" | "action">,
		request: () => Promise<TResult>,
	): Promise<TResult> => {
		try {
			client.setAuth(await token());
			return await request();
		} catch (error) {
			const full =
				error instanceof ConvexError
					? AnalysisFullSchema.safeParse(error.data)
					: undefined;
			if (full?.success) throw new AnalysisFullError(full.data.child);
			throw new SanitizedError(
				`Convex ${getFunctionName(fn)} failed (${error instanceof Error ? error.name : typeof error})`,
			);
		}
	};
	const query = <TQuery extends FunctionReference<"query">>(
		fn: TQuery,
		...args: OptionalRestArgs<TQuery>
	) => call(fn, () => client.query(fn, ...args));
	// The client is shared by all requests: skip its one-at-a-time queue.
	const mutation = <TMutation extends FunctionReference<"mutation">>(
		fn: TMutation,
		args: FunctionArgs<TMutation>,
	) => call(fn, () => client.mutation(fn, args, { skipQueue: true }));
	const action = <TAction extends FunctionReference<"action">>(
		fn: TAction,
		...args: OptionalRestArgs<TAction>
	) => call(fn, () => client.action(fn, ...args));
	const untilDone = async (batch: () => Promise<unknown>) => {
		let hasMore = true;
		while (hasMore) {
			signal?.throwIfAborted();
			hasMore = DeletionSchema.parse(await batch()).hasMore;
		}
	};

	return {
		async createAnalysis(analysis) {
			await mutation(convex.analyses.create, { analysis });
		},
		async getAnalysis(id) {
			return AnalysisSchema.nullable().parse(
				await query(convex.analyses.get, { id }),
			);
		},
		async updateAnalysis(id, patch) {
			await mutation(convex.analyses.update, { id, patch });
		},
		async saveAnalysis(id, save) {
			await mutation(convex.analyses.save, { id, save });
		},
		async latestOpenAnalysis(workspaceId, authorId, since) {
			return AnalysisSchema.nullable().parse(
				await query(convex.analyses.latestOpen, {
					workspaceId,
					authorId,
					since,
				}),
			);
		},
		async recentAnalyses(workspaceId, viewerId, limit) {
			return AnalysisSchema.array().parse(
				await query(convex.analyses.recent, { workspaceId, viewerId, limit }),
			);
		},

		async createStep(step) {
			await mutation(convex.steps.create, { step });
		},
		async getSteps(analysisId) {
			return StepSchema.array().parse(
				await query(convex.steps.list, { analysisId }),
			);
		},

		async createQuery({ args, output, sessions, owners, ...fields }) {
			await mutation(convex.queries.create, {
				query: { ...fields, argsJson: JSON.stringify(args) },
				sessions,
				owners,
				outputJson: output === null ? null : JSON.stringify(output),
			});
		},
		async getQuery(id) {
			return QuerySchema.nullable().parse(
				await query(convex.queries.get, { id }),
			);
		},
		async getQueries(analysisId) {
			return QuerySummarySchema.array().parse(
				await query(convex.queries.list, { analysisId }),
			);
		},

		async deleteAnalysesByAuthor(authorId) {
			await untilDone(() => mutation(convex.deletion.byAuthor, { authorId }));
		},
		async deleteAnalysesByWorkspace(workspaceId) {
			await untilDone(() =>
				mutation(convex.deletion.byWorkspace, { workspaceId }),
			);
		},
		async deleteAnalysesReadingOwner(ownerId) {
			// Hide them all first, then delete them in bounded batches.
			await untilDone(() =>
				mutation(convex.deletion.markReadingOwner, { ownerId }),
			);
			await untilDone(() => mutation(convex.deletion.sweep, {}));
		},

		async addEmbedding(workspaceId, embedding) {
			await mutation(convex.embeddings.add, { workspaceId, embedding });
		},
		async searchEmbeddings(workspaceId, model, vector, limit) {
			return MatchesSchema.parse(
				await action(convex.embeddings.search, {
					workspaceId,
					model,
					vector,
					limit,
				}),
			);
		},
	};
}

function queryReference<TArgs extends DefaultFunctionArgs>(name: string) {
	return makeFunctionReference<"query", TArgs, unknown>(name);
}

function mutationReference<TArgs extends DefaultFunctionArgs>(name: string) {
	return makeFunctionReference<"mutation", TArgs, unknown>(name);
}

function parseArgs(argsJson: string): Record<string, unknown> {
	return z.record(z.string(), z.unknown()).parse(JSON.parse(argsJson));
}
