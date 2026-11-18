import { randomUUID } from "node:crypto";
import {
	type MomentLayer,
	MomentLayerSchema,
	type MomentObservation,
} from "@rudel/api-routes";
import type postgres from "postgres";

/**
 * Observations in Postgres (`moment_observation`, migration 0067): one per
 * noticeable run, transcript revision and prompt version, deleted with the
 * session owner's account and with the workspace. Votes live beside them.
 * Rows are written with `kind` = `run`; rows of any other kind (notes about
 * single moments, before runs were observed whole) are not read.
 */
export const RUN_OBSERVATION_KIND = "run";

export interface ObservedMomentKey {
	readonly userId: string;
	readonly sessionId: string;
	readonly agentId: string;
	readonly turn: number;
	readonly revision: string;
}

export interface NewObservation extends ObservedMomentKey {
	readonly workspaceId: string;
	readonly runStartedAt: Date;
	readonly spanStart: number;
	readonly spanEnd: number;
	readonly layer: MomentLayer;
	readonly whatHappened: string;
	readonly lesson: string;
	readonly evidence: readonly { record: number; quote: string }[];
	readonly confidence: number;
	readonly falsePositive: boolean;
	readonly model: string;
	readonly promptVersion: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly createdBy: string;
}

/** A stored observation with the run it belongs to, for patterns. */
export interface StoredObservation extends MomentObservation {
	readonly runStartedAt: string;
	readonly userId: string;
	readonly sessionId: string;
	readonly agentId: string;
	readonly turn: number;
}

export function momentKey(key: Omit<ObservedMomentKey, "revision">): string {
	return [key.userId, key.sessionId, key.agentId, key.turn].join("\u0000");
}

interface ObservationRow {
	id: string;
	kind: string;
	user_id: string;
	session_id: string;
	agent_id: string;
	turn_idx: number;
	revision: string;
	run_started_at: Date | string;
	layer: string;
	what_happened: string;
	lesson: string;
	evidence: unknown;
	confidence: number;
	false_positive: boolean;
	model: string;
	created_at: Date | string;
	useful: number;
	not_useful: number;
	mine: boolean | null;
}

const SELECT_OBSERVATION = (sql: postgres.Sql, viewerId: string) => sql`
	o.id, o.kind, o.user_id, o.session_id, o.agent_id, o.turn_idx, o.revision, o.run_started_at,
	o.layer, o.what_happened, o.lesson, o.evidence, o.confidence, o.false_positive,
	o.model, o.created_at,
	(SELECT count(*)::int FROM moment_feedback f WHERE f.observation_id = o.id AND f.useful) AS useful,
	(SELECT count(*)::int FROM moment_feedback f WHERE f.observation_id = o.id AND NOT f.useful) AS not_useful,
	(SELECT f.useful FROM moment_feedback f WHERE f.observation_id = o.id AND f.user_id = ${viewerId}) AS mine
`;

/** The newest observation of each moment at its revision, keyed by `momentKey`. */
export async function readObservations(
	sql: postgres.Sql,
	workspaceId: string,
	keys: readonly ObservedMomentKey[],
	viewerId: string,
): Promise<Map<string, MomentObservation>> {
	const found = new Map<string, MomentObservation>();
	if (keys.length === 0) return found;
	const sessions = [...new Set(keys.map((key) => key.sessionId))];
	const wanted = new Map(keys.map((key) => [momentKey(key), key.revision]));
	const rows = await sql<ObservationRow[]>`
		SELECT ${SELECT_OBSERVATION(sql, viewerId)}
		FROM moment_observation o
		WHERE o.organization_id = ${workspaceId}
			AND o.kind = ${RUN_OBSERVATION_KIND}
			AND o.session_id = ANY(${sessions}::text[])
		ORDER BY o.created_at
	`;
	for (const row of rows) {
		const key = momentKey({
			userId: row.user_id,
			sessionId: row.session_id,
			agentId: row.agent_id,
			turn: row.turn_idx,
		});
		// Only the revision the moment is read at; ordered oldest first, so the newest wins.
		if (wanted.get(key) === row.revision) found.set(key, toObservation(row));
	}
	return found;
}

/** Real-friction observations of runs that started in the range, for patterns. */
export async function readObservationsInRange(
	sql: postgres.Sql,
	workspaceId: string,
	member: string | null,
	range: { from: Date; to: Date },
	viewerId: string,
): Promise<StoredObservation[]> {
	const rows = await sql<ObservationRow[]>`
		SELECT DISTINCT ON (o.user_id, o.session_id, o.agent_id, o.turn_idx)
			${SELECT_OBSERVATION(sql, viewerId)}
		FROM moment_observation o
		WHERE o.organization_id = ${workspaceId}
			AND o.kind = ${RUN_OBSERVATION_KIND}
			AND NOT o.false_positive
			AND o.run_started_at >= ${range.from.toISOString()}::timestamptz
			AND o.run_started_at < ${range.to.toISOString()}::timestamptz
			${member === null ? sql`` : sql`AND o.user_id = ${member}`}
		ORDER BY o.user_id, o.session_id, o.agent_id, o.turn_idx, o.created_at DESC
		LIMIT 5000
	`;
	return rows.map((row) => ({
		...toObservation(row),
		runStartedAt: new Date(row.run_started_at).toISOString(),
		userId: row.user_id,
		sessionId: row.session_id,
		agentId: row.agent_id,
		turn: row.turn_idx,
	}));
}

export async function insertObservation(
	sql: postgres.Sql,
	observation: NewObservation,
): Promise<string> {
	const id = `mo_${randomUUID()}`;
	const [row] = await sql<{ id: string }[]>`
		INSERT INTO moment_observation (
			id, organization_id, user_id, session_id, agent_id, turn_idx, kind, revision,
			run_started_at, span_start, span_end, layer, what_happened, lesson, evidence, confidence,
			false_positive, model, prompt_version, input_tokens, output_tokens, created_by
		) VALUES (
			${id}, ${observation.workspaceId}, ${observation.userId}, ${observation.sessionId},
			${observation.agentId}, ${observation.turn}, ${RUN_OBSERVATION_KIND}, ${observation.revision},
			${observation.runStartedAt.toISOString()}::timestamptz, ${observation.spanStart}, ${observation.spanEnd}, ${observation.layer},
			${observation.whatHappened}, ${observation.lesson},
			${JSON.stringify(observation.evidence)}::jsonb,
			${observation.confidence}, ${observation.falsePositive}, ${observation.model},
			${observation.promptVersion}, ${observation.inputTokens}, ${observation.outputTokens},
			${observation.createdBy}
		)
		ON CONFLICT (organization_id, user_id, session_id, agent_id, turn_idx, kind, revision, prompt_version)
		DO UPDATE SET id = moment_observation.id
		RETURNING id
	`;
	return row?.id ?? id;
}

/** Observations written for a workspace since the start of the UTC day. */
export async function observationsToday(
	sql: postgres.Sql,
	workspaceId: string,
	now: Date,
): Promise<number> {
	const day = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	const [row] = await sql<{ count: number }[]>`
		SELECT count(*)::int AS count FROM moment_observation
		WHERE organization_id = ${workspaceId} AND created_at >= ${day.toISOString()}::timestamptz
	`;
	return row?.count ?? 0;
}

export async function readObservationById(
	sql: postgres.Sql,
	workspaceId: string,
	id: string,
	viewerId: string,
): Promise<StoredObservation | null> {
	const [row] = await sql<ObservationRow[]>`
		SELECT ${SELECT_OBSERVATION(sql, viewerId)}
		FROM moment_observation o
		WHERE o.organization_id = ${workspaceId} AND o.id = ${id}
	`;
	return row
		? {
				...toObservation(row),
				runStartedAt: new Date(row.run_started_at).toISOString(),
				userId: row.user_id,
				sessionId: row.session_id,
				agentId: row.agent_id,
				turn: row.turn_idx,
			}
		: null;
}

/** Sets or removes a member's vote and answers the observation's votes. */
export async function setFeedback(
	sql: postgres.Sql,
	input: { observationId: string; userId: string; useful: boolean | null },
): Promise<MomentObservation["feedback"]> {
	if (input.useful === null)
		await sql`
			DELETE FROM moment_feedback
			WHERE observation_id = ${input.observationId} AND user_id = ${input.userId}
		`;
	else
		await sql`
			INSERT INTO moment_feedback (observation_id, user_id, useful)
			VALUES (${input.observationId}, ${input.userId}, ${input.useful})
			ON CONFLICT (observation_id, user_id) DO UPDATE
			SET useful = EXCLUDED.useful, created_at = now()
		`;
	const [row] = await sql<{ useful: number; not_useful: number }[]>`
		SELECT count(*) FILTER (WHERE useful)::int AS useful,
			count(*) FILTER (WHERE NOT useful)::int AS not_useful
		FROM moment_feedback WHERE observation_id = ${input.observationId}
	`;
	return {
		useful: row?.useful ?? 0,
		notUseful: row?.not_useful ?? 0,
		mine: input.useful,
	};
}

function toObservation(row: ObservationRow): MomentObservation {
	const layer = MomentLayerSchema.safeParse(row.layer);
	const evidence = Array.isArray(row.evidence)
		? (row.evidence as { record: number; quote: string }[])
		: [];
	return {
		id: row.id,
		layer: layer.success ? layer.data : "other",
		whatHappened: row.what_happened,
		lesson: row.lesson,
		evidence,
		confidence: row.confidence,
		falsePositive: row.false_positive,
		model: row.model,
		createdAt: new Date(row.created_at).toISOString(),
		feedback: {
			useful: row.useful,
			notUseful: row.not_useful,
			mine: row.mine,
		},
	};
}
