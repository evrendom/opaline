import type {
	AnalysisChange,
	AnalysisCost,
	AnalysisHost,
	AnalysisScope,
} from "@rudel/api-routes";

/**
 * The analysis log: an analysis (one asked question), its steps (one per
 * find/read call, labelled from its arguments, or a question to the asker), the queries with their
 * exact results, and the final answer. Records are plain documents with ids
 * generated here, so the store can be Convex (ADR 0001) or memory in tests.
 *
 * find/read calls build a private draft (`draft`); saving publishes it once
 * (`status` finished) and nothing about it changes afterwards. A revision is
 * a new analysis whose `updates` names the one it revises.
 */
export interface StoredAnalysis {
	id: string;
	workspaceId: string;
	authorId: string;
	host: AnalysisHost;
	question: string;
	status: "finished" | "unfinished";
	/**
	 * An unsaved analysis built by find/read: hidden from every reader but its
	 * author's own find/read/save calls, and deleted after `DRAFT_RETENTION_MS`.
	 * Analyses recorded before drafts existed are false.
	 */
	draft: boolean;
	shared: boolean;
	pinned: boolean;
	createdAt: string;
	/** Time of the latest query: the newest data this analysis saw. */
	cutoff: string;
	scope: AnalysisScope;
	finalAnswer: string | null;
	topics: string[];
	updates: string | null;
	/** How each finding changed against `updates`, given when saving a revision. */
	changes: AnalysisChange[];
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
	tool: "find" | "read" | "sql";
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

/**
 * A chat uploaded for an analysis (`analysisId` on ingest): the conversation
 * in which it ran. One link per analysis, source and session.
 */
export interface StoredSessionLink {
	analysisId: string;
	sessionId: string;
	source: "claude_code" | "codex";
	/** The member who uploaded the chat; it is their session. */
	ownerId: string;
	/** The latest upload of the session for this analysis. */
	uploadedAt: string;
}

/** What an author may change on an analysis; identity, `cutoff`, the counts and `draft` are kept by the store. */
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
		| "draft"
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
 * with `AnalysisFullError`, and in a saved (finished) analysis with
 * `AnalysisSavedError`, checked in the same atomic write. Updates of a
 * missing record do nothing. Lists return [] for an unknown analysis.
 * Deletion first marks analyses deleting: they are hidden at once, and
 * creating steps, queries or saves in them fails. Drafts are returned only by
 * `getAnalysis`, for the service's author checks.
 */
export interface AnalysisStore {
	createAnalysis(analysis: StoredAnalysis): Promise<void>;
	getAnalysis(id: string): Promise<StoredAnalysis | null>;
	updateAnalysis(id: string, patch: AnalysisPatch): Promise<void>;
	/** Newest first, without drafts: the viewer's own analyses plus shared ones of the workspace. */
	recentAnalyses(
		workspaceId: string,
		viewerId: string,
		limit: number,
	): Promise<StoredAnalysis[]>;
	/**
	 * Saved analyses of the workspace whose `updates` is `id`, at most
	 * `limit`, without drafts. Visibility is filtered by the caller.
	 */
	analysesUpdating(
		workspaceId: string,
		id: string,
		limit: number,
	): Promise<StoredAnalysis[]>;

	/**
	 * Publishes the analysis in one atomic write: it is no longer a draft.
	 * Every finding's step must belong to the analysis, the clarifications must
	 * fit `MAX_STEPS_PER_ANALYSIS` (else `AnalysisFullError`), and a saved
	 * (finished) analysis is refused with `AnalysisSavedError`: saving is
	 * append-only. A refused save writes nothing.
	 */
	saveAnalysis(id: string, save: AnalysisSave): Promise<void>;
	/**
	 * Deletes drafts created more than `DRAFT_RETENTION_MS` ago, with their
	 * children, by the store's own clock. Saved analyses are never touched.
	 */
	expireDrafts(): Promise<void>;

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

	/**
	 * Adds the link, or moves an existing link's `uploadedAt` to this upload.
	 * Fails for a missing or deleting analysis, and with `AnalysisFullError`
	 * once the analysis holds `MAX_SESSIONS_PER_ANALYSIS` links, checked in the
	 * same atomic write. Deleting an analysis deletes its links.
	 */
	linkSession(link: StoredSessionLink): Promise<void>;
	/** Oldest upload first, then by source and session id. */
	getSessionLinks(analysisId: string): Promise<StoredSessionLink[]>;
	/**
	 * Account deletion: the owner's links in every analysis, of any author or
	 * workspace. Repeating a call is safe and continues where the last stopped.
	 */
	deleteSessionLinksByOwner(ownerId: string): Promise<void>;

	addEmbedding(workspaceId: string, embedding: StoredEmbedding): Promise<void>;
	/**
	 * Nearest texts within the workspace among vectors of `model`, best first,
	 * leaving out drafts. Visibility is otherwise filtered by the caller.
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
	 * whose sessions it read (only a workspace limited to own sessions can);
	 * otherwise anyone who can see the analysis reads it.
	 */
	restrictResults: boolean;
}
