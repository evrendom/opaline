import type {
	AnalysisChange,
	AnalysisCost,
	AnalysisHost,
	AnalysisScope,
} from "@rudel/api-routes";
import type postgres from "postgres";
import { z } from "zod";
import {
	AnalysisFullError,
	AnalysisSavedError,
	SanitizedError,
} from "./errors.js";
import {
	DRAFT_RETENTION_MS,
	MAX_QUERIES_PER_ANALYSIS,
	MAX_SESSIONS_PER_ANALYSIS,
	MAX_STEPS_PER_ANALYSIS,
	RESULT_RETENTION_MS,
	SHARED_RESULT_RETENTION_MS,
} from "./limits.js";
import type {
	AnalysisPatch,
	AnalysisStore,
	EmbeddingMatch,
	QuerySession,
	QuerySummary,
	StoredAnalysis,
	StoredQuery,
	StoredSessionLink,
	StoredStep,
} from "./types.js";

export const MAX_EMBEDDING_MATCHES = 256;
const DELETE_BATCH = 50;
const OWNER_BATCH = 100;
const VECTOR_FETCH_BATCH = 1_000;
const MAX_CACHED_VECTORS = 16_384;

type Sql = postgres.Sql;
// postgres-js types TransactionSql as Omit<Sql, ...>, which drops the tagged-template call signature.
type Transaction = postgres.Sql;
type Fragment = postgres.PendingQuery<postgres.Row[]>;

interface AnalysisRow {
	id: string;
	workspace_id: string;
	author_id: string;
	host: AnalysisHost;
	question: string;
	status: StoredAnalysis["status"];
	draft: boolean;
	shared: boolean;
	pinned: boolean;
	created_at: string;
	cutoff: string;
	scope: AnalysisScope;
	final_answer: string | null;
	topics: string[];
	updates: string | null;
	changes: AnalysisChange[];
	notes: string[];
	cost: AnalysisCost | null;
	query_count: number;
	step_count: number;
	visibility_revision: number;
}

interface StepRow {
	id: string;
	analysis_id: string;
	parent_id: string | null;
	ordinal: number;
	question: string;
	reply: string | null;
	finding: string | null;
	created_at: string;
}

interface QueryRow {
	id: string;
	analysis_id: string;
	step_id: string;
	workspace_id: string;
	author_id: string;
	tool: StoredQuery["tool"];
	args_json: string;
	output_chars: number;
	has_output: boolean;
	owner_ids: string[];
	created_at: string;
	removed: boolean;
	counts: boolean;
	redaction_args_json: string | null;
	redaction_label: string | null;
}

interface SessionLinkRow {
	analysis_id: string;
	source: StoredSessionLink["source"];
	session_id: string;
	owner_id: string;
	uploaded_at: string;
}

interface CandidateRow {
	id: string;
	analysis_id: string;
	step_id: string | null;
	kind: EmbeddingMatch["kind"];
	text: string;
}

const ArgsSchema = z.record(z.string(), z.unknown());

const PATCH_COLUMNS = {
	host: { column: "host", json: false },
	question: { column: "question", json: false },
	status: { column: "status", json: false },
	pinned: { column: "pinned", json: false },
	scope: { column: "scope", json: true },
	finalAnswer: { column: "final_answer", json: false },
	topics: { column: "topics", json: true },
	updates: { column: "updates", json: false },
	changes: { column: "changes", json: true },
	notes: { column: "notes", json: true },
	cost: { column: "cost", json: true },
} as const satisfies Record<
	keyof AnalysisPatch,
	{ column: string; json: boolean }
>;

export function createPostgresAnalysisStore(
	connect: () => Promise<Sql>,
): AnalysisStore {
	const vectors = new Map<string, Float32Array>();
	const run = async <T>(
		operation: string,
		work: (sql: Sql) => Promise<T>,
	): Promise<T> => {
		try {
			return await work(await connect());
		} catch (error) {
			throw sanitized(operation, error);
		}
	};
	const transaction = <T>(
		operation: string,
		work: (tx: Transaction) => Promise<T>,
	): Promise<T> =>
		run(
			operation,
			(sql) =>
				sql.begin((tx) => work(tx as unknown as Transaction)) as Promise<T>,
		);

	return {
		async createAnalysis(analysis) {
			await run("createAnalysis", async (sql) => {
				await sql`
					INSERT INTO analysis_log_analysis (
						id, workspace_id, author_id, host, question, status, draft, shared,
						pinned, created_at, cutoff, scope, final_answer, topics, updates,
						changes, notes, cost, query_count, step_count, visibility_revision
					) VALUES (
						${analysis.id}, ${analysis.workspaceId}, ${analysis.authorId},
						${analysis.host}, ${analysis.question}, ${analysis.status},
						${analysis.draft}, ${analysis.shared}, ${analysis.pinned},
						${analysis.createdAt}, ${analysis.cutoff}, ${jsonb(sql, analysis.scope)},
						${analysis.finalAnswer}, ${jsonb(sql, analysis.topics)},
						${analysis.updates}, ${jsonb(sql, analysis.changes)},
						${jsonb(sql, analysis.notes)}, ${jsonb(sql, analysis.cost)},
						${analysis.queryCount}, ${analysis.stepCount},
						${analysis.visibilityRevision}
					)
				`;
			});
		},
		async getAnalysis(id) {
			return run("getAnalysis", async (sql) => {
				const [row] = await sql<AnalysisRow[]>`
					SELECT * FROM analysis_log_analysis WHERE id = ${id}
				`;
				return row ? analysisOf(row) : null;
			});
		},
		async updateAnalysis(id, patch) {
			await run("updateAnalysis", async (sql) => {
				const values = patchValues(sql, patch);
				if (Object.keys(values).length === 0) return;
				await sql`
					UPDATE analysis_log_analysis SET ${sql(values)} WHERE id = ${id}
				`;
			});
		},
		async setShared(id, shared) {
			return run("setShared", async (sql) => {
				const [row] = await sql<{ visibility_revision: number }[]>`
					UPDATE analysis_log_analysis
					SET shared = ${shared}, visibility_revision = visibility_revision + 1
					WHERE id = ${id}
					RETURNING visibility_revision
				`;
				return row ? row.visibility_revision : null;
			});
		},
		async saveAnalysis(id, { findings, clarifications, patch }) {
			await transaction("saveAnalysis", async (tx) => {
				const analysis = await lockAnalysis(tx, id);
				if (analysis.status === "finished") throw new AnalysisSavedError();
				if (
					analysis.step_count + clarifications.length >
					MAX_STEPS_PER_ANALYSIS
				)
					throw new AnalysisFullError("steps");
				const owners = await stepAnalyses(tx, [
					...findings.map((finding) => finding.stepId),
					...clarifications.map((step) => step.id),
					...clarifications.flatMap((step) =>
						step.parentId === null ? [] : [step.parentId],
					),
				]);
				for (const { stepId } of findings)
					if (owners.get(stepId) !== id)
						throw new SanitizedError(`Step ${stepId} is not in this analysis`);
				if (
					new Set(clarifications.map((step) => step.id)).size <
					clarifications.length
				)
					throw new SanitizedError("Clarification step ids repeat");
				for (const step of clarifications)
					if (
						step.analysisId !== id ||
						owners.has(step.id) ||
						(step.parentId !== null && owners.get(step.parentId) !== id)
					)
						throw new SanitizedError(
							`Step ${step.id} cannot be added to this analysis`,
						);

				for (const { stepId, finding } of findings)
					await tx`
						UPDATE analysis_log_step SET finding = ${finding} WHERE id = ${stepId}
					`;
				for (const step of clarifications) await insertStep(tx, step);
				await tx`
					UPDATE analysis_log_analysis
					SET ${tx({
						...patchValues(tx, patch),
						draft: false,
						step_count: analysis.step_count + clarifications.length,
					})}
					WHERE id = ${id}
				`;
			});
		},
		async expireDrafts() {
			await run("expireDrafts", (sql) => deleteExpiredDrafts(sql, new Date()));
		},
		async recentAnalyses(workspaceId, viewerId, limit) {
			if (limit < 1) return [];
			return run("recentAnalyses", async (sql) => {
				const rows = await sql<AnalysisRow[]>`
					SELECT * FROM analysis_log_analysis
					WHERE workspace_id = ${workspaceId}
						AND NOT draft
						AND (author_id = ${viewerId} OR shared)
					ORDER BY cutoff COLLATE "C" DESC, seq DESC
					LIMIT ${limit}
				`;
				return rows.map(analysisOf);
			});
		},
		async analysesUpdating(workspaceId, id, limit) {
			if (limit < 1) return [];
			return run("analysesUpdating", async (sql) => {
				const rows = await sql<AnalysisRow[]>`
					SELECT * FROM analysis_log_analysis
					WHERE workspace_id = ${workspaceId} AND updates = ${id} AND NOT draft
					ORDER BY seq
					LIMIT ${limit}
				`;
				return rows.map(analysisOf);
			});
		},

		async createStep(step) {
			await transaction("createStep", async (tx) => {
				const analysis = await lockAnalysis(tx, step.analysisId);
				if (analysis.status === "finished") throw new AnalysisSavedError();
				if (analysis.step_count >= MAX_STEPS_PER_ANALYSIS)
					throw new AnalysisFullError("steps");
				if (step.parentId !== null) {
					const owners = await stepAnalyses(tx, [step.parentId]);
					if (owners.get(step.parentId) !== step.analysisId)
						throw new SanitizedError(
							`Parent step ${step.parentId} is not in this analysis`,
						);
				}
				await insertStep(tx, step);
				await tx`
					UPDATE analysis_log_analysis SET step_count = step_count + 1
					WHERE id = ${step.analysisId}
				`;
			});
		},
		async getSteps(analysisId) {
			return run("getSteps", async (sql) => {
				const rows = await sql<StepRow[]>`
					SELECT * FROM analysis_log_step WHERE analysis_id = ${analysisId}
					ORDER BY ordinal, seq
				`;
				return rows.map(stepOf);
			});
		},

		async createQuery({ sessions, owners: read, output, ...query }) {
			await transaction("createQuery", async (tx) => {
				const analysis = await lockAnalysis(tx, query.analysisId);
				if (analysis.status === "finished") throw new AnalysisSavedError();
				if (analysis.query_count >= MAX_QUERIES_PER_ANALYSIS)
					throw new AnalysisFullError("queries");
				if (
					query.workspaceId !== analysis.workspace_id ||
					query.authorId !== analysis.author_id
				)
					throw new SanitizedError(
						"A query belongs to its analysis's workspace and author",
					);
				const steps = await stepAnalyses(tx, [query.stepId]);
				if (steps.get(query.stepId) !== analysis.id)
					throw new SanitizedError(
						`Step ${query.stepId} is not in this analysis`,
					);
				const distinct = [
					...new Map(
						sessions.map((session) => [session.sessionId, session]),
					).values(),
				];
				const owners = [
					...new Set([...read, ...distinct.map((session) => session.ownerId)]),
				].sort();
				await tx`
					INSERT INTO analysis_log_query (
						id, analysis_id, step_id, workspace_id, author_id, tool, args_json,
						output_chars, has_output, owner_ids, created_at, removed, counts,
						redaction_args_json, redaction_label
					) VALUES (
						${query.id}, ${query.analysisId}, ${query.stepId}, ${query.workspaceId},
						${query.authorId}, ${query.tool}, ${JSON.stringify(query.args)},
						${query.outputChars}, ${output !== null}, ${owners}::text[],
						${query.createdAt}, ${query.removed}, ${query.counts},
						${query.redaction ? JSON.stringify(query.redaction.args) : null},
						${query.redaction?.label ?? null}
					)
				`;
				if (output !== null)
					await tx`
						INSERT INTO analysis_log_query_output (query_id, json)
						VALUES (${query.id}, ${JSON.stringify(output)})
					`;
				if (distinct.length)
					await tx`
						INSERT INTO analysis_log_query_session ${tx(
							distinct.map((session) => ({
								query_id: query.id,
								session_id: session.sessionId,
								owner_id: session.ownerId,
								revision: session.revision,
								parser_version: session.parserVersion,
							})),
						)}
					`;
				await tx`
					UPDATE analysis_log_analysis
					SET cutoff = ${analysis.cutoff < query.createdAt ? query.createdAt : analysis.cutoff},
						query_count = query_count + 1
					WHERE id = ${analysis.id}
				`;
			});
		},
		async getQuery(id) {
			return run("getQuery", async (sql) => {
				const [row] = await sql<(QueryRow & { output_json: string | null })[]>`
					SELECT q.*, o.json AS output_json
					FROM analysis_log_query q
					LEFT JOIN analysis_log_query_output o ON o.query_id = q.id
					WHERE q.id = ${id}
				`;
				if (!row) return null;
				const sessions = await sql<
					{
						session_id: string;
						owner_id: string;
						revision: string;
						parser_version: number;
					}[]
				>`
					SELECT session_id, owner_id, revision, parser_version
					FROM analysis_log_query_session WHERE query_id = ${id}
				`;
				return {
					...queryFieldsOf(row),
					output:
						row.has_output && row.output_json !== null
							? JSON.parse(row.output_json)
							: null,
					sessions: sessions
						.map(
							(session): QuerySession => ({
								sessionId: session.session_id,
								ownerId: session.owner_id,
								revision: session.revision,
								parserVersion: session.parser_version,
							}),
						)
						.sort((left, right) => compare(left.sessionId, right.sessionId)),
					owners: row.owner_ids,
				};
			});
		},
		async getQueries(analysisId) {
			return run("getQueries", async (sql) => {
				const rows = await sql<QueryRow[]>`
					SELECT * FROM analysis_log_query WHERE analysis_id = ${analysisId}
					ORDER BY created_at COLLATE "C", seq
				`;
				return rows.map(
					(row): QuerySummary => ({
						...queryFieldsOf(row),
						hasOutput: row.has_output,
						ownerCount: row.owner_ids.length,
						onlyOwnerId:
							row.owner_ids.length === 1 ? (row.owner_ids[0] ?? null) : null,
					}),
				);
			});
		},

		async deleteAnalysesByAuthor(authorId) {
			await run("deleteAnalysesByAuthor", (sql) =>
				deleteAnalyses(sql, () => sql`author_id = ${authorId}`),
			);
		},
		async deleteAnalysesByWorkspace(workspaceId) {
			await run("deleteAnalysesByWorkspace", (sql) =>
				deleteAnalyses(sql, () => sql`workspace_id = ${workspaceId}`),
			);
		},
		async removeOwnerEvidence(ownerId) {
			await run("removeOwnerEvidence", async (sql) => {
				let more = true;
				while (more)
					more = await sql.begin((tx) =>
						removeOwnerBatch(tx as unknown as Transaction, ownerId),
					);
			});
		},

		async linkSession(link) {
			await transaction("linkSession", async (tx) => {
				await lockAnalysis(tx, link.analysisId);
				const moved = await tx`
					UPDATE analysis_log_session_link SET uploaded_at = ${link.uploadedAt}
					WHERE analysis_id = ${link.analysisId}
						AND source = ${link.source}
						AND session_id = ${link.sessionId}
				`;
				if (moved.count > 0) return;
				const [linked] = await tx<{ count: number }[]>`
					SELECT count(*)::int AS count FROM analysis_log_session_link
					WHERE analysis_id = ${link.analysisId}
				`;
				if ((linked?.count ?? 0) >= MAX_SESSIONS_PER_ANALYSIS)
					throw new AnalysisFullError("sessions");
				await tx`
					INSERT INTO analysis_log_session_link
						(analysis_id, source, session_id, owner_id, uploaded_at)
					VALUES (
						${link.analysisId}, ${link.source}, ${link.sessionId},
						${link.ownerId}, ${link.uploadedAt}
					)
				`;
			});
		},
		async getSessionLinks(analysisId) {
			return run("getSessionLinks", async (sql) => {
				const rows = await sql<SessionLinkRow[]>`
					SELECT analysis_id, source, session_id, owner_id, uploaded_at
					FROM analysis_log_session_link WHERE analysis_id = ${analysisId}
				`;
				return rows
					.map(
						(row): StoredSessionLink => ({
							analysisId: row.analysis_id,
							sessionId: row.session_id,
							source: row.source,
							ownerId: row.owner_id,
							uploadedAt: row.uploaded_at,
						}),
					)
					.sort(
						(left, right) =>
							compare(left.uploadedAt, right.uploadedAt) ||
							compare(left.source, right.source) ||
							compare(left.sessionId, right.sessionId),
					);
			});
		},
		async deleteSessionLinksByOwner(ownerId) {
			await run("deleteSessionLinksByOwner", async (sql) => {
				await sql`
					DELETE FROM analysis_log_session_link WHERE owner_id = ${ownerId}
				`;
			});
		},

		async addEmbedding(workspaceId, embedding) {
			const vector = encodeVector(embedding.vector);
			await transaction("addEmbedding", async (tx) => {
				const [analysis] = await tx<{ workspace_id: string }[]>`
					SELECT workspace_id FROM analysis_log_analysis
					WHERE id = ${embedding.analysisId}
					FOR SHARE
				`;
				if (analysis?.workspace_id !== workspaceId)
					throw new SanitizedError(
						`Analysis ${embedding.analysisId} is not in this workspace`,
					);
				if (embedding.stepId !== null) {
					const steps = await stepAnalyses(tx, [embedding.stepId]);
					if (steps.get(embedding.stepId) !== embedding.analysisId)
						throw new SanitizedError(
							`Step ${embedding.stepId} is not in this analysis`,
						);
				}
				await tx`
					INSERT INTO analysis_log_embedding
						(analysis_id, workspace_id, step_id, kind, text, model, vector)
					VALUES (
						${embedding.analysisId}, ${workspaceId}, ${embedding.stepId},
						${embedding.kind}, ${embedding.text}, ${embedding.model}, ${vector}
					)
				`;
			});
		},
		async searchEmbeddings(workspaceId, model, vector, limit) {
			if (limit < 1) return [];
			return run("searchEmbeddings", async (sql) => {
				const candidates = await sql<CandidateRow[]>`
					SELECT e.id::text AS id, e.analysis_id, e.step_id, e.kind, e.text
					FROM analysis_log_embedding e
					JOIN analysis_log_analysis a ON a.id = e.analysis_id
					WHERE e.workspace_id = ${workspaceId}
						AND e.model = ${model}
						AND a.workspace_id = ${workspaceId}
						AND NOT a.draft
					ORDER BY e.id
				`;
				const missing = candidates
					.map((candidate) => candidate.id)
					.filter((id) => !vectors.has(id));
				for (
					let start = 0;
					start < missing.length;
					start += VECTOR_FETCH_BATCH
				) {
					const rows = await sql<{ id: string; vector: Uint8Array }[]>`
						SELECT id::text AS id, vector FROM analysis_log_embedding
						WHERE id = ANY(${missing.slice(start, start + VECTOR_FETCH_BATCH)}::bigint[])
					`;
					for (const row of rows) vectors.set(row.id, decodeVector(row.vector));
				}
				const ranked = rankByCosine(
					vector,
					candidates.flatMap((candidate) => {
						const stored = vectors.get(candidate.id);
						return stored
							? [
									{
										vector: stored,
										match: {
											analysisId: candidate.analysis_id,
											stepId: candidate.step_id,
											kind: candidate.kind,
											text: candidate.text,
										},
									},
								]
							: [];
					}),
					Math.min(limit, MAX_EMBEDDING_MATCHES),
				);
				if (vectors.size > MAX_CACHED_VECTORS) {
					const current = new Set(candidates.map((candidate) => candidate.id));
					for (const id of vectors.keys())
						if (!current.has(id)) vectors.delete(id);
					if (vectors.size > MAX_CACHED_VECTORS) vectors.clear();
				}
				return ranked;
			});
		},
	};
}

export async function expirePostgresAnalysisLog(
	sql: Sql,
	now: Date = new Date(),
): Promise<{ drafts: number; results: number }> {
	try {
		const drafts = await deleteExpiredDrafts(sql, now);
		const expired = await sql`
			WITH expired AS (
				UPDATE analysis_log_query q SET has_output = false
				FROM analysis_log_analysis a
				WHERE a.id = q.analysis_id
					AND q.has_output
					AND q.created_at COLLATE "C" < ${new Date(now.getTime() - RESULT_RETENTION_MS).toISOString()}
					AND (
						NOT (a.shared OR a.pinned)
						OR q.created_at COLLATE "C" < ${new Date(now.getTime() - SHARED_RESULT_RETENTION_MS).toISOString()}
					)
				RETURNING q.id
			)
			DELETE FROM analysis_log_query_output o USING expired
			WHERE o.query_id = expired.id
		`;
		return { drafts, results: expired.count };
	} catch (error) {
		throw sanitized("expire", error);
	}
}

export function encodeVector(vector: readonly number[]): Buffer {
	let norm = 0;
	for (const value of vector) {
		if (!Number.isFinite(value))
			throw new SanitizedError("Embeddings hold finite numbers only");
		norm += value * value;
	}
	const scale = norm > 0 ? 1 / Math.sqrt(norm) : 0;
	const bytes = Buffer.alloc(vector.length * 4);
	vector.forEach((value, index) => {
		bytes.writeFloatLE(value * scale, index * 4);
	});
	return bytes;
}

export function decodeVector(bytes: Uint8Array): Float32Array {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const vector = new Float32Array(Math.floor(bytes.byteLength / 4));
	for (let index = 0; index < vector.length; index++)
		vector[index] = view.getFloat32(index * 4, true);
	return vector;
}

export function rankByCosine<TMatch>(
	query: readonly number[],
	candidates: readonly { vector: Float32Array; match: TMatch }[],
	limit: number,
): TMatch[] {
	if (limit < 1) return [];
	let norm = 0;
	for (const value of query) norm += value * value;
	const scale = norm > 0 ? 1 / Math.sqrt(norm) : 0;
	return candidates
		.map(({ vector, match }) => {
			let dot = 0;
			const length = Math.min(vector.length, query.length);
			for (let index = 0; index < length; index++)
				dot += (vector[index] ?? 0) * (query[index] ?? 0);
			return { match, score: dot * scale };
		})
		.sort((left, right) => right.score - left.score)
		.slice(0, limit)
		.map(({ match }) => match);
}

async function lockAnalysis(
	tx: Transaction,
	id: string,
): Promise<
	Pick<
		AnalysisRow,
		| "id"
		| "workspace_id"
		| "author_id"
		| "status"
		| "cutoff"
		| "query_count"
		| "step_count"
	>
> {
	const [row] = await tx<
		Pick<
			AnalysisRow,
			| "id"
			| "workspace_id"
			| "author_id"
			| "status"
			| "cutoff"
			| "query_count"
			| "step_count"
		>[]
	>`
		SELECT id, workspace_id, author_id, status, cutoff, query_count, step_count
		FROM analysis_log_analysis WHERE id = ${id}
		FOR UPDATE
	`;
	if (!row) throw new SanitizedError(`Analysis ${id} is missing`);
	return row;
}

async function stepAnalyses(
	tx: Transaction,
	ids: string[],
): Promise<Map<string, string>> {
	if (ids.length === 0) return new Map();
	const rows = await tx<{ id: string; analysis_id: string }[]>`
		SELECT id, analysis_id FROM analysis_log_step
		WHERE id = ANY(${[...new Set(ids)]}::text[])
	`;
	return new Map(rows.map((row) => [row.id, row.analysis_id]));
}

async function insertStep(tx: Transaction, step: StoredStep): Promise<void> {
	await tx`
		INSERT INTO analysis_log_step (
			id, analysis_id, parent_id, ordinal, question, reply, finding, created_at
		) VALUES (
			${step.id}, ${step.analysisId}, ${step.parentId}, ${step.ordinal},
			${step.question}, ${step.reply}, ${step.finding}, ${step.createdAt}
		)
	`;
}

async function deleteAnalyses(
	sql: Sql,
	where: () => Fragment,
): Promise<number> {
	let deleted = 0;
	for (;;) {
		const batch = await sql`
			DELETE FROM analysis_log_analysis
			WHERE id IN (
				SELECT id FROM analysis_log_analysis
				WHERE ${where()}
				ORDER BY id
				LIMIT ${DELETE_BATCH}
				FOR UPDATE
			)
		`;
		deleted += batch.count;
		if (batch.count < DELETE_BATCH) return deleted;
	}
}

function deleteExpiredDrafts(sql: Sql, now: Date): Promise<number> {
	const before = new Date(now.getTime() - DRAFT_RETENTION_MS).toISOString();
	return deleteAnalyses(
		sql,
		() => sql`draft AND created_at COLLATE "C" < ${before}`,
	);
}

async function removeOwnerBatch(
	tx: Transaction,
	ownerId: string,
): Promise<boolean> {
	const reading = await tx<{ analysis_id: string }[]>`
		SELECT DISTINCT analysis_id FROM analysis_log_query
		WHERE owner_ids @> ARRAY[${ownerId}]::text[]
		LIMIT ${OWNER_BATCH}
	`;
	if (reading.length === 0) return false;
	const locked = await tx<{ id: string }[]>`
		SELECT id FROM analysis_log_analysis
		WHERE id = ANY(${reading.map((row) => row.analysis_id)}::text[])
		ORDER BY id
		FOR UPDATE
	`;
	const queries = await tx<
		(Pick<
			QueryRow,
			| "id"
			| "analysis_id"
			| "step_id"
			| "counts"
			| "args_json"
			| "redaction_args_json"
			| "redaction_label"
		> & { cites: boolean })[]
	>`
		SELECT q.id, q.analysis_id, q.step_id, q.counts, q.args_json,
			q.redaction_args_json, q.redaction_label,
			(s.finding IS NOT NULL AND EXISTS (
				SELECT 1 FROM analysis_log_query_session qs
				WHERE qs.query_id = q.id AND qs.owner_id = ${ownerId}
			)) AS cites
		FROM analysis_log_query q
		LEFT JOIN analysis_log_step s ON s.id = q.step_id
		WHERE q.analysis_id = ANY(${locked.map((row) => row.id)}::text[])
			AND q.owner_ids @> ARRAY[${ownerId}]::text[]
		ORDER BY q.seq
	`;
	const doomed = new Set(
		queries
			.filter((query) => !query.counts || query.cites)
			.map((query) => query.analysis_id),
	);
	const kept = queries.filter((query) => !doomed.has(query.analysis_id));
	if (doomed.size)
		await tx`
			DELETE FROM analysis_log_analysis WHERE id = ANY(${[...doomed]}::text[])
		`;
	for (const query of kept)
		if (
			query.redaction_args_json !== null &&
			query.redaction_label !== null &&
			query.redaction_args_json !== query.args_json
		)
			await tx`
				UPDATE analysis_log_step SET question = ${query.redaction_label}
				WHERE id = ${query.step_id}
			`;
	const keptIds = kept.map((query) => query.id);
	if (keptIds.length) {
		await tx`
			UPDATE analysis_log_query SET
				has_output = false,
				removed = true,
				owner_ids = array_remove(owner_ids, ${ownerId}),
				args_json = coalesce(redaction_args_json, args_json)
			WHERE id = ANY(${keptIds}::text[])
		`;
		await tx`
			DELETE FROM analysis_log_query_output WHERE query_id = ANY(${keptIds}::text[])
		`;
		await tx`
			DELETE FROM analysis_log_query_session
			WHERE query_id = ANY(${keptIds}::text[]) AND owner_id = ${ownerId}
		`;
	}
	return true;
}

function patchValues(
	sql: Sql,
	patch: AnalysisPatch,
): Record<string, string | number | boolean | null | postgres.Parameter> {
	const values: Record<
		string,
		string | number | boolean | null | postgres.Parameter
	> = {};
	for (const [key, { column, json }] of Object.entries(PATCH_COLUMNS)) {
		const value = patch[key as keyof AnalysisPatch];
		if (value === undefined) continue;
		values[column] = json
			? jsonb(sql, value)
			: (value as string | boolean | null);
	}
	return values;
}

function analysisOf(row: AnalysisRow): StoredAnalysis {
	return {
		id: row.id,
		workspaceId: row.workspace_id,
		authorId: row.author_id,
		host: row.host,
		question: row.question,
		status: row.status,
		draft: row.draft,
		shared: row.shared,
		pinned: row.pinned,
		createdAt: row.created_at,
		cutoff: row.cutoff,
		scope: row.scope,
		finalAnswer: row.final_answer,
		topics: row.topics,
		updates: row.updates,
		changes: row.changes,
		notes: row.notes,
		cost: row.cost,
		queryCount: row.query_count,
		stepCount: row.step_count,
		visibilityRevision: row.visibility_revision,
	};
}

function stepOf(row: StepRow): StoredStep {
	return {
		id: row.id,
		analysisId: row.analysis_id,
		parentId: row.parent_id,
		ordinal: row.ordinal,
		question: row.question,
		reply: row.reply,
		finding: row.finding,
		createdAt: row.created_at,
	};
}

function queryFieldsOf(
	row: QueryRow,
): Omit<StoredQuery, "output" | "sessions" | "owners"> {
	return {
		id: row.id,
		analysisId: row.analysis_id,
		stepId: row.step_id,
		workspaceId: row.workspace_id,
		authorId: row.author_id,
		tool: row.tool,
		args: ArgsSchema.parse(JSON.parse(row.args_json)),
		outputChars: row.output_chars,
		createdAt: row.created_at,
		removed: row.removed,
		counts: row.counts,
		redaction:
			row.redaction_args_json !== null && row.redaction_label !== null
				? {
						args: ArgsSchema.parse(JSON.parse(row.redaction_args_json)),
						label: row.redaction_label,
					}
				: null,
	};
}

function jsonb(sql: Sql, value: unknown): postgres.Parameter | null {
	return value === null ? null : sql.json(value as postgres.JSONValue);
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sanitized(operation: string, error: unknown): SanitizedError {
	if (error instanceof SanitizedError) return error;
	const code =
		error instanceof Error &&
		"code" in error &&
		typeof (error as { code: unknown }).code === "string"
			? (error as { code: string }).code
			: error instanceof Error
				? error.name
				: typeof error;
	return new SanitizedError(
		`Postgres analysis log ${operation} failed (${code})`,
	);
}
