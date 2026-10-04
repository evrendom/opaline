import { AnalysisFullError } from "./errors.js";
import {
	MAX_QUERIES_PER_ANALYSIS,
	MAX_SESSIONS_PER_ANALYSIS,
	MAX_STEPS_PER_ANALYSIS,
} from "./limits.js";
import type {
	AnalysisStore,
	EmbeddingMatch,
	QuerySession,
	StoredAnalysis,
	StoredEmbedding,
	StoredQuery,
	StoredSessionLink,
	StoredStep,
} from "./types.js";

interface SessionLink extends QuerySession {
	queryId: string;
	analysisId: string;
}

/** In-process store for tests and local development; Convex replaces it in production. */
export function createMemoryAnalysisStore(): AnalysisStore {
	const analyses = new Map<string, StoredAnalysis>();
	const steps = new Map<string, StoredStep>();
	const queries = new Map<string, Omit<StoredQuery, "sessions">>();
	// Like Convex: session links live apart from their queries, oldest first.
	let links: SessionLink[] = [];
	const embeddings: (StoredEmbedding & { workspaceId: string })[] = [];
	let chats: StoredSessionLink[] = [];
	const sameChat = (left: StoredSessionLink, right: StoredSessionLink) =>
		left.analysisId === right.analysisId &&
		left.source === right.source &&
		left.sessionId === right.sessionId;
	// Every method below runs without awaiting, so each one is a single
	// atomic step, as each Convex mutation is.
	const sessionsOf = (queryId: string) =>
		links
			.filter((link) => link.queryId === queryId)
			.map(({ sessionId, ownerId, revision, parserVersion }) => ({
				sessionId,
				ownerId,
				revision,
				parserVersion,
			}))
			// Code-unit order, as Convex sorts index strings.
			.sort((left, right) => (left.sessionId < right.sessionId ? -1 : 1));

	const removeAnalyses = (matches: (analysis: StoredAnalysis) => boolean) => {
		const ids = new Set(
			[...analyses.values()].filter(matches).map((analysis) => analysis.id),
		);
		for (const id of ids) analyses.delete(id);
		for (const [id, step] of steps)
			if (ids.has(step.analysisId)) steps.delete(id);
		for (const [id, query] of queries)
			if (ids.has(query.analysisId)) queries.delete(id);
		links = links.filter((link) => !ids.has(link.analysisId));
		chats = chats.filter((chat) => !ids.has(chat.analysisId));
		for (let index = embeddings.length - 1; index >= 0; index--)
			if (ids.has(embeddings[index]?.analysisId ?? ""))
				embeddings.splice(index, 1);
	};

	return {
		async createAnalysis(analysis) {
			insert(analyses, analysis);
		},
		async getAnalysis(id) {
			return clone(analyses.get(id));
		},
		async updateAnalysis(id, patch) {
			const analysis = analyses.get(id);
			if (analysis)
				analyses.set(id, { ...analysis, ...structuredClone(patch) });
		},
		async saveAnalysis(id, { findings, clarifications, patch }) {
			const analysis = analyses.get(id);
			if (!analysis) throw new Error(`Analysis ${id} is missing`);
			for (const { stepId } of findings)
				if (steps.get(stepId)?.analysisId !== id)
					throw new Error(`Step ${stepId} is not in this analysis`);
			if (analysis.stepCount + clarifications.length > MAX_STEPS_PER_ANALYSIS)
				throw new AnalysisFullError("steps");
			if (
				new Set(clarifications.map((step) => step.id)).size <
				clarifications.length
			)
				throw new Error("Clarification step ids repeat");
			for (const step of clarifications)
				if (
					steps.has(step.id) ||
					step.analysisId !== id ||
					(step.parentId !== null &&
						steps.get(step.parentId)?.analysisId !== id)
				)
					throw new Error(`Step ${step.id} cannot be added to this analysis`);

			for (const { stepId, finding } of findings) {
				const step = steps.get(stepId);
				if (step) steps.set(stepId, { ...step, finding });
			}
			for (const step of clarifications)
				steps.set(step.id, structuredClone(step));
			analyses.set(id, {
				...analysis,
				...structuredClone(patch),
				stepCount: analysis.stepCount + clarifications.length,
			});
		},
		async latestOpenAnalysis(workspaceId, authorId, since) {
			return clone(
				[...analyses.values()]
					.filter(
						(analysis) =>
							analysis.workspaceId === workspaceId &&
							analysis.authorId === authorId &&
							analysis.status === "unfinished" &&
							analysis.cutoff >= since,
					)
					.sort((left, right) => right.cutoff.localeCompare(left.cutoff))[0],
			);
		},
		async recentAnalyses(workspaceId, viewerId, limit) {
			return [...analyses.values()]
				.filter(
					(analysis) =>
						analysis.workspaceId === workspaceId &&
						(analysis.authorId === viewerId || analysis.shared),
				)
				.sort((left, right) => right.cutoff.localeCompare(left.cutoff))
				.slice(0, limit)
				.map((analysis) => structuredClone(analysis));
		},

		// No awaits: each check and its insert happen together, as in Convex.
		async createStep(step) {
			const analysis = analyses.get(step.analysisId);
			if (!analysis) throw new Error(`Analysis ${step.analysisId} is missing`);
			if (analysis.stepCount >= MAX_STEPS_PER_ANALYSIS)
				throw new AnalysisFullError("steps");
			insert(steps, step);
			analyses.set(analysis.id, {
				...analysis,
				stepCount: analysis.stepCount + 1,
			});
		},
		async getSteps(analysisId) {
			return [...steps.values()]
				.filter((step) => step.analysisId === analysisId)
				.sort((left, right) => left.ordinal - right.ordinal)
				.map((step) => structuredClone(step));
		},

		async createQuery({ sessions, ...query }) {
			const analysis = analyses.get(query.analysisId);
			if (!analysis) throw new Error(`Analysis ${query.analysisId} is missing`);
			if (analysis.queryCount >= MAX_QUERIES_PER_ANALYSIS)
				throw new AnalysisFullError("queries");
			const owners = [
				...new Set([
					...query.owners,
					...sessions.map((session) => session.ownerId),
				]),
			].sort();
			insert(queries, { ...query, owners });
			for (const session of new Map(
				sessions.map((session) => [session.sessionId, session]),
			).values())
				links.push({
					...session,
					queryId: query.id,
					analysisId: query.analysisId,
				});
			analyses.set(analysis.id, {
				...analysis,
				cutoff:
					analysis.cutoff < query.createdAt ? query.createdAt : analysis.cutoff,
				queryCount: analysis.queryCount + 1,
			});
		},
		async getQuery(id) {
			const query = queries.get(id);
			return query
				? { ...structuredClone(query), sessions: sessionsOf(id) }
				: null;
		},
		async getQueries(analysisId) {
			return [...queries.values()]
				.filter((query) => query.analysisId === analysisId)
				.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
				.map(({ output, owners, ...query }) => ({
					...structuredClone(query),
					hasOutput: output !== null,
					ownerCount: owners.length,
					onlyOwnerId: owners.length === 1 ? (owners[0] ?? null) : null,
				}));
		},
		async deleteAnalysesReadingOwner(ownerId) {
			const read = new Set(
				[...queries.values()]
					.filter((query) => query.owners.includes(ownerId))
					.map((query) => query.analysisId),
			);
			removeAnalyses((analysis) => read.has(analysis.id));
		},
		async deleteAnalysesByAuthor(authorId) {
			removeAnalyses((analysis) => analysis.authorId === authorId);
		},
		async deleteAnalysesByWorkspace(workspaceId) {
			removeAnalyses((analysis) => analysis.workspaceId === workspaceId);
		},

		async linkSession(link) {
			if (!analyses.has(link.analysisId))
				throw new Error(`Analysis ${link.analysisId} is missing`);
			const existing = chats.find((chat) => sameChat(chat, link));
			if (existing) {
				chats = chats.map((chat) =>
					sameChat(chat, link)
						? { ...chat, uploadedAt: link.uploadedAt }
						: chat,
				);
				return;
			}
			if (
				chats.filter((chat) => chat.analysisId === link.analysisId).length >=
				MAX_SESSIONS_PER_ANALYSIS
			)
				throw new AnalysisFullError("sessions");
			chats.push(structuredClone(link));
		},
		async getSessionLinks(analysisId) {
			return chats
				.filter((chat) => chat.analysisId === analysisId)
				.sort(
					(left, right) =>
						compare(left.uploadedAt, right.uploadedAt) ||
						compare(left.source, right.source) ||
						compare(left.sessionId, right.sessionId),
				)
				.map((chat) => structuredClone(chat));
		},
		async deleteSessionLinksByOwner(ownerId) {
			chats = chats.filter((chat) => chat.ownerId !== ownerId);
		},

		async addEmbedding(workspaceId, embedding) {
			embeddings.push({ ...structuredClone(embedding), workspaceId });
		},
		async searchEmbeddings(workspaceId, model, vector, limit) {
			return embeddings
				.filter(
					(embedding) =>
						embedding.workspaceId === workspaceId && embedding.model === model,
				)
				.map((embedding) => ({
					embedding,
					score: cosine(vector, embedding.vector),
				}))
				.sort((left, right) => right.score - left.score)
				.slice(0, limit)
				.map(
					({ embedding }): EmbeddingMatch => ({
						analysisId: embedding.analysisId,
						stepId: embedding.stepId,
						kind: embedding.kind,
						text: embedding.text,
					}),
				);
		},
	};
}

function insert<TRecord extends { id: string }>(
	records: Map<string, TRecord>,
	record: TRecord,
): void {
	if (records.has(record.id)) throw new Error(`${record.id} already exists`);
	records.set(record.id, structuredClone(record));
}

/** Code-unit order, as Convex sorts index strings. */
function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function clone<T>(value: T | undefined): T | null {
	return value === undefined ? null : structuredClone(value);
}

function cosine(left: number[], right: number[]): number {
	let dot = 0;
	let leftNorm = 0;
	let rightNorm = 0;
	for (let index = 0; index < Math.min(left.length, right.length); index++) {
		const a = left[index] ?? 0;
		const b = right[index] ?? 0;
		dot += a * b;
		leftNorm += a * a;
		rightNorm += b * b;
	}
	return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}
