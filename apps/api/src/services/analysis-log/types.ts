import type {
	AnalysisCost,
	AnalysisHost,
	AnalysisScope,
} from "@rudel/api-routes";

/**
 * The analysis log: an analysis (one asked question), its steps (written-out
 * sub-questions, answered by queries or by the asker), the queries with their
 * exact results, and the final answer. Records are plain documents with ids
 * generated here, so the store can be Convex (ADR 0001) or memory in tests.
 */
export interface StoredAnalysis {
	id: string;
	workspaceId: string;
	authorId: string;
	host: AnalysisHost;
	question: string;
	status: "finished" | "unfinished";
	shared: boolean;
	pinned: boolean;
	createdAt: string;
	/** Time of the latest query: the newest data this analysis saw. */
	cutoff: string;
	scope: AnalysisScope;
	finalAnswer: string | null;
	topics: string[];
	updates: string | null;
	notes: string[];
	cost: AnalysisCost | null;
	/** Queries and steps recorded so far; kept by the store. */
	queryCount: number;
	stepCount: number;
}

export interface StoredStep {
	id: string;
	analysisId: string;
	parentId: string | null;
	/** Display order; clarifications saved later can be placed between steps. */
	ordinal: number;
	question: string;
	reply: string | null;
	finding: string | null;
	createdAt: string;
}

/** A session a query read, as it was at query time. */
export interface QuerySession {
	sessionId: string;
	ownerId: string;
	revision: string;
	parserVersion: number;
}

export interface StoredQuery {
	id: string;
	analysisId: string;
	stepId: string;
	workspaceId: string;
	authorId: string;
	tool: "find" | "read";
	args: Record<string, unknown>;
	/** The exact typed result; null once expired or removed. */
	output: unknown;
	outputChars: number;
	/**
	 * One entry per session, in `sessionId` order. Stores keep them apart from
	 * the query, so listing an analysis never reads them.
	 */
	sessions: QuerySession[];
	/**
	 * Every member whose sessions the query read, whether or not its result
	 * shows them (grouped finds name none), in order. Stores add the owners of
	 * `sessions`. Account deletion finds the query's analysis through them, and
	 * only their sole owner (or an admin) may read the result.
	 */
	owners: string[];
	createdAt: string;
	removed: boolean;
}

/** A query as listed with its analysis: no result, sessions or owners. */
export interface QuerySummary
	extends Omit<StoredQuery, "output" | "sessions" | "owners"> {
	/** False once the result expired or was removed. */
	hasOutput: boolean;
	/** How many members' sessions the query read (`owners`). */
	ownerCount: number;
	/** The only member in `owners`; null for none or several. */
	onlyOwnerId: string | null;
}

/** What an author may change on an analysis; identity, `cutoff` and the counts are kept by the store. */
export type AnalysisPatch = Partial<
	Omit<
		StoredAnalysis,
		| "id"
		| "workspaceId"
		| "authorId"
		| "createdAt"
		| "cutoff"
		| "queryCount"
		| "stepCount"
	>
>;

/** What saving an analysis writes, all at once. */
export interface AnalysisSave {
	findings: { stepId: string; finding: string }[];
	/** Steps the asker answered, inserted as given. */
	clarifications: StoredStep[];
	patch: AnalysisPatch;
}

/** One searchable text of an analysis: its question, a step's sub-question, or its topics. */
export interface StoredEmbedding {
	analysisId: string;
	stepId: string | null;
	kind: "question" | "step" | "topics";
	text: string;
	vector: number[];
	/** The embedding model; vectors of different models are never compared. */
	model: string;
}

export interface EmbeddingMatch {
	analysisId: string;
	stepId: string | null;
	kind: StoredEmbedding["kind"];
	text: string;
}

/**
 * Creating an existing id fails. Creating a step or query in an analysis that
 * already holds `MAX_STEPS_PER_ANALYSIS` or `MAX_QUERIES_PER_ANALYSIS` fails
 * with `AnalysisFullError`, checked in the same atomic write. Updates of a
 * missing record do nothing. Lists return [] for an unknown analysis.
 * Deletion first marks analyses deleting: they are hidden at once, and
 * creating steps, queries or saves in them fails.
 */
export interface AnalysisStore {
	createAnalysis(analysis: StoredAnalysis): Promise<void>;
	getAnalysis(id: string): Promise<StoredAnalysis | null>;
	updateAnalysis(id: string, patch: AnalysisPatch): Promise<void>;
	/** The author's most recently active unfinished analysis since `since`. */
	latestOpenAnalysis(
		workspaceId: string,
		authorId: string,
		since: string,
	): Promise<StoredAnalysis | null>;
	/** Newest first: the viewer's own analyses plus shared ones of the workspace. */
	recentAnalyses(
		workspaceId: string,
		viewerId: string,
		limit: number,
	): Promise<StoredAnalysis[]>;

	/**
	 * One atomic write: every finding's step must belong to the analysis and
	 * the clarifications must fit `MAX_STEPS_PER_ANALYSIS` (else
	 * `AnalysisFullError`); a refused save writes nothing.
	 */
	saveAnalysis(id: string, save: AnalysisSave): Promise<void>;

	/** Also advances the analysis's `stepCount`. */
	createStep(step: StoredStep): Promise<void>;
	/** In display order (`ordinal`). */
	getSteps(analysisId: string): Promise<StoredStep[]>;

	/** Also advances the analysis's `cutoff` and `queryCount`. */
	createQuery(query: StoredQuery): Promise<void>;
	getQuery(id: string): Promise<StoredQuery | null>;
	/** In creation order, without results. */
	getQueries(analysisId: string): Promise<QuerySummary[]>;
	/**
	 * Delete analyses (with their steps, queries, results and embeddings).
	 * Repeating a call is safe and continues where the last stopped.
	 */
	deleteAnalysesByAuthor(authorId: string): Promise<void>;
	deleteAnalysesByWorkspace(workspaceId: string): Promise<void>;
	/** Every analysis, of any author or workspace, that read one of the owner's sessions. */
	deleteAnalysesReadingOwner(ownerId: string): Promise<void>;

	addEmbedding(workspaceId: string, embedding: StoredEmbedding): Promise<void>;
	/**
	 * Nearest texts within the workspace among vectors of `model`, best first.
	 * Visibility is filtered by the caller.
	 */
	searchEmbeddings(
		workspaceId: string,
		model: string,
		vector: number[],
		limit: number,
	): Promise<EmbeddingMatch[]>;
}

export interface Embedder {
	/** Identifies the vector space, stored with every vector. */
	model: string;
	embed(texts: string[]): Promise<number[][]>;
}

export interface AnalysisLog {
	store: AnalysisStore;
	embedder: Embedder;
	now(): Date;
}

/** Who is asking, with the permissions the rest of the API uses. */
export interface AnalysisViewer {
	workspaceId: string;
	userId: string;
	isAdmin: boolean;
	/**
	 * The workspace restricts a stored result to admins and the one member
	 * whose sessions it read; otherwise anyone who can see the analysis reads it.
	 */
	restrictResults: boolean;
}
