import { randomUUID } from "node:crypto";
import type {
	MomentLayer,
	MomentPattern,
	MomentPatterns,
} from "@rudel/api-routes";
import { z } from "zod";
import { getSafeClickHouseTable } from "../../clickhouse.js";
import { committedBuildSql } from "../analysis/run-index-reader.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "../analysis/sql.js";
import { RUN_INDEX_TABLE } from "../l1-edges/l1-edge-tables.js";
import type { MomentsCaller, MomentsEnv } from "./moments.service.js";
import {
	readObservationsInRange,
	type StoredObservation,
} from "./observation-store.js";

/**
 * Patterns: observations that say the same thing, grouped in process (no
 * model, nothing leaves Opaline). Within each fix layer, observations join
 * the nearest group whose term profile (TF-IDF over the lesson and what
 * happened) is close enough, else start one. A pattern is named by its
 * central observation. A fix recorded against a pattern keeps the pattern's
 * term profile, so observations before and after it that match the profile
 * give the before and after rate.
 */

/** Cosine similarity an observation needs to join a group. */
export const JOIN_SIMILARITY = 0.3;
/** Cosine similarity a later pattern needs to count as the fix's pattern. */
export const FIX_SIMILARITY = 0.45;
/** Weeks before a fix the "before" rate is measured over. */
const BEFORE_WEEKS = 4;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const EXAMPLES = 3;
/** Weeks a pattern's weekly series covers at most. */
const MAX_WEEKS = 104;

type Profile = Map<string, number>;

export class PatternNotFoundError extends Error {}

export async function momentPatterns(
	env: MomentsEnv,
	caller: MomentsCaller,
	range: { startDate: string; endDate: string },
): Promise<MomentPatterns> {
	const from = new Date(`${range.startDate}T00:00:00Z`);
	const to = new Date(
		new Date(`${range.endDate}T00:00:00Z`).getTime() + DAY_MS,
	);
	const observations = await readObservationsInRange(
		env.sql,
		caller.workspaceId,
		caller.member,
		{ from, to },
		caller.viewerId,
	);
	const groups = groupObservations(observations);
	const [costs, fixes] = await Promise.all([
		runCosts(env, caller, observations),
		readFixes(env.sql, caller.workspaceId),
	]);
	const now = env.now();
	const patterns: MomentPattern[] = [];
	for (const group of groups) {
		const fix = fixes
			.filter(
				(candidate) =>
					candidate.layer === group.layer &&
					cosine(candidate.centroid, group.centroid) >= FIX_SIMILARITY,
			)
			.at(-1);
		patterns.push({
			id: group.central.id,
			layer: group.layer,
			label: group.central.lesson,
			summary: group.central.whatHappened,
			observations: group.members.length,
			runs: new Set(group.members.map(runKey)).size,
			members: new Set(group.members.map((member) => member.userId)).size,
			costUsd: [...new Set(group.members.map(runKey))].reduce(
				(total, key) => total + (costs.get(key) ?? 0),
				0,
			),
			weekly: weeklyCounts(group.members, range),
			examples: [...group.members]
				.sort((a, b) => b.runStartedAt.localeCompare(a.runStartedAt))
				.slice(0, EXAMPLES)
				.map((member) => ({
					observationId: member.id,
					userId: member.userId,
					sessionId: member.sessionId,
					agentId: member.agentId,
					turn: member.turn,
					startedAt: member.runStartedAt,
					whatHappened: member.whatHappened,
				})),
			fix: fix ? await fixRates(env, caller, fix, now) : null,
		});
	}
	patterns.sort(
		(a, b) => b.observations - a.observations || b.costUsd - a.costUsd,
	);
	return { observed: observations.length, patterns };
}

/** Records a fix against a pattern of the range, keeping its term profile. */
export async function recordMomentFix(
	env: MomentsEnv,
	caller: MomentsCaller,
	input: {
		patternId: string;
		note: string;
		startDate: string;
		endDate: string;
	},
): Promise<{ id: string }> {
	const from = new Date(`${input.startDate}T00:00:00Z`);
	const to = new Date(
		new Date(`${input.endDate}T00:00:00Z`).getTime() + DAY_MS,
	);
	const groups = groupObservations(
		await readObservationsInRange(
			env.sql,
			caller.workspaceId,
			caller.member,
			{ from, to },
			caller.viewerId,
		),
	);
	const group = groups.find(
		(candidate) => candidate.central.id === input.patternId,
	);
	if (!group) throw new PatternNotFoundError("Pattern not found.");
	const id = `mf_${randomUUID()}`;
	await env.sql`
		INSERT INTO moment_fix (id, organization_id, layer, note, pattern_observation_id, centroid, created_by)
		VALUES (${id}, ${caller.workspaceId}, ${group.layer}, ${input.note}, ${group.central.id},
			${JSON.stringify(Object.fromEntries(group.centroid))}::jsonb, ${caller.viewerId})
	`;
	return { id };
}

interface Group {
	readonly layer: MomentLayer;
	readonly members: StoredObservation[];
	readonly centroid: Profile;
	readonly central: StoredObservation;
}

/** Groups observations per layer by term profile; oldest first, so groups are stable as weeks are added. */
export function groupObservations(
	observations: readonly StoredObservation[],
): Group[] {
	const ordered = [...observations].sort((a, b) =>
		a.runStartedAt.localeCompare(b.runStartedAt),
	);
	const profiles = tfidf(ordered.map(observationText));
	const groups: { layer: MomentLayer; members: number[]; sum: Profile }[] = [];
	ordered.forEach((observation, index) => {
		const profile = profiles[index] ?? new Map();
		let best: (typeof groups)[number] | null = null;
		let bestScore = JOIN_SIMILARITY;
		for (const group of groups) {
			if (group.layer !== observation.layer) continue;
			const score = cosine(profile, group.sum);
			if (score >= bestScore) {
				best = group;
				bestScore = score;
			}
		}
		if (best) {
			best.members.push(index);
			addInto(best.sum, profile);
		} else {
			groups.push({
				layer: observation.layer,
				members: [index],
				sum: new Map(profile),
			});
		}
	});
	return groups.map((group) => {
		const centroid = normalize(group.sum);
		let central = group.members[0] ?? 0;
		let bestScore = -1;
		for (const index of group.members) {
			const score = cosine(profiles[index] ?? new Map(), centroid);
			if (score > bestScore) {
				bestScore = score;
				central = index;
			}
		}
		return {
			layer: group.layer,
			members: group.members
				.map((index) => ordered[index])
				.filter((member): member is StoredObservation => member !== undefined),
			centroid,
			central: ordered[central] as StoredObservation,
		};
	});
}

const STOPWORDS = new Set(
	"the and for that this with was were are but not from into have has had its it's they them their then than when what which while who would could should about after before again agent agents run runs file files member members instead because only also just like each more most some such very did does doing done being been make made using used use one two the".split(
		" ",
	),
);

export function terms(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9_.-]+/u)
		.map((term) => term.replace(/^[._-]+|[._-]+$/gu, ""))
		.filter((term) => term.length >= 3 && !STOPWORDS.has(term));
}

function observationText(observation: StoredObservation): string {
	return `${observation.lesson} ${observation.lesson} ${observation.whatHappened}`;
}

/** Unit-length TF-IDF profiles of the texts. */
export function tfidf(texts: readonly string[]): Profile[] {
	const documents = texts.map(terms);
	const frequency = new Map<string, number>();
	for (const document of documents)
		for (const term of new Set(document))
			frequency.set(term, (frequency.get(term) ?? 0) + 1);
	return documents.map((document) => {
		const counts = new Map<string, number>();
		for (const term of document) counts.set(term, (counts.get(term) ?? 0) + 1);
		const profile: Profile = new Map();
		for (const [term, count] of counts)
			profile.set(
				term,
				count *
					Math.log(
						(1 + documents.length) / (1 + (frequency.get(term) ?? 0)) + 1,
					),
			);
		return normalize(profile);
	});
}

export function cosine(
	a: ReadonlyMap<string, number>,
	b: ReadonlyMap<string, number>,
): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (const [term, weight] of a) {
		normA += weight * weight;
		dot += weight * (b.get(term) ?? 0);
	}
	for (const weight of b.values()) normB += weight * weight;
	return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

function normalize(profile: Profile): Profile {
	let norm = 0;
	for (const weight of profile.values()) norm += weight * weight;
	norm = Math.sqrt(norm);
	const result: Profile = new Map();
	if (norm === 0) return result;
	for (const [term, weight] of profile) result.set(term, weight / norm);
	return result;
}

function addInto(target: Profile, profile: Profile): void {
	for (const [term, weight] of profile)
		target.set(term, (target.get(term) ?? 0) + weight);
}

/** Moments per ISO week (Monday, UTC), oldest first. */
export function weeklyCounts(
	members: readonly Pick<StoredObservation, "runStartedAt">[],
	range: { startDate: string; endDate: string },
): { week: string; count: number }[] {
	const counts = new Map<string, number>();
	// Every week of the range, so quiet weeks show as zero; at most two years.
	const lastMs = Date.parse(`${range.endDate}T00:00:00Z`);
	const last = mondayOf(new Date(lastMs));
	for (
		let week = mondayOf(
			new Date(
				Math.max(
					Date.parse(`${range.startDate}T00:00:00Z`),
					lastMs - MAX_WEEKS * WEEK_MS,
				),
			),
		);
		week <= last;
		week = new Date(Date.parse(`${week}T00:00:00Z`) + 7 * DAY_MS)
			.toISOString()
			.slice(0, 10)
	)
		counts.set(week, 0);
	for (const member of members) {
		const week = mondayOf(new Date(member.runStartedAt));
		counts.set(week, (counts.get(week) ?? 0) + 1);
	}
	return [...counts]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([week, count]) => ({ week, count }));
}

function mondayOf(date: Date): string {
	const day = (date.getUTCDay() + 6) % 7;
	return new Date(
		Date.UTC(
			date.getUTCFullYear(),
			date.getUTCMonth(),
			date.getUTCDate() - day,
		),
	)
		.toISOString()
		.slice(0, 10);
}

function runKey(
	observation: Pick<
		StoredObservation,
		"userId" | "sessionId" | "agentId" | "turn"
	>,
): string {
	return [
		observation.userId,
		observation.sessionId,
		observation.agentId,
		observation.turn,
	].join("\u0000");
}

interface Fix {
	id: string;
	layer: MomentLayer;
	note: string;
	centroid: Profile;
	createdAt: Date;
}

async function readFixes(
	sql: MomentsEnv["sql"],
	workspaceId: string,
): Promise<Fix[]> {
	const rows = await sql<
		{
			id: string;
			layer: string;
			note: string;
			centroid: unknown;
			created_at: Date | string;
		}[]
	>`
		SELECT id, layer, note, centroid, created_at FROM moment_fix
		WHERE organization_id = ${workspaceId}
		ORDER BY created_at
	`;
	return rows.map((row) => ({
		id: row.id,
		layer: row.layer as MomentLayer,
		note: row.note,
		centroid: new Map(
			Object.entries((row.centroid ?? {}) as Record<string, number>),
		),
		createdAt: new Date(row.created_at),
	}));
}

/** How often the fix's pattern happened per week in the four weeks before it, and since. */
async function fixRates(
	env: MomentsEnv,
	caller: MomentsCaller,
	fix: Fix,
	now: Date,
): Promise<NonNullable<MomentPattern["fix"]>> {
	const before = new Date(fix.createdAt.getTime() - BEFORE_WEEKS * WEEK_MS);
	const observations = await readObservationsInRange(
		env.sql,
		caller.workspaceId,
		caller.member,
		{ from: before, to: now },
		caller.viewerId,
	);
	const profiles = tfidf(observations.map(observationText));
	let countBefore = 0;
	let countAfter = 0;
	observations.forEach((observation, index) => {
		if (observation.layer !== fix.layer) return;
		if (cosine(profiles[index] ?? new Map(), fix.centroid) < JOIN_SIMILARITY)
			return;
		if (new Date(observation.runStartedAt) < fix.createdAt) countBefore++;
		else countAfter++;
	});
	const weeksAfter = (now.getTime() - fix.createdAt.getTime()) / WEEK_MS;
	return {
		id: fix.id,
		note: fix.note,
		createdAt: fix.createdAt.toISOString(),
		beforePerWeek: countBefore / BEFORE_WEEKS,
		// Under three days is too soon to say.
		afterPerWeek:
			weeksAfter >= 3 / 7 ? countAfter / Math.max(1, weeksAfter) : null,
	};
}

const RunCostSchema = z.object({
	user_id: z.string(),
	session_id: z.string(),
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	cost_usd: z.coerce.number().nullable(),
});

/** Priced cost of the observed runs, from their committed run index builds. */
async function runCosts(
	env: MomentsEnv,
	caller: MomentsCaller,
	observations: readonly StoredObservation[],
): Promise<Map<string, number>> {
	const costs = new Map<string, number>();
	if (observations.length === 0) return costs;
	const runs = getSafeClickHouseTable(RUN_INDEX_TABLE);
	const owner = `organization_id = {workspaceId:String}${
		caller.member === null ? "" : " AND user_id = {member:String}"
	}`;
	const rows = await query(env.executor, RunCostSchema, {
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		query: `SELECT user_id, session_id, agent_id, turn_idx, cost_usd
			FROM ${runs} FINAL
			WHERE ${owner} AND row_kind = 'run'
				AND session_id IN {sessions:Array(String)}
				AND ${committedBuildSql(runs, owner, ["user_id", "session_id"])}`,
		query_params: {
			workspaceId: caller.workspaceId,
			...(caller.member === null ? {} : { member: caller.member }),
			sessions: [...new Set(observations.map((o) => o.sessionId))],
		},
	});
	for (const row of rows)
		costs.set(
			runKey({
				userId: row.user_id,
				sessionId: row.session_id,
				agentId: row.agent_id,
				turn: row.turn_idx,
			}),
			row.cost_usd ?? 0,
		);
	return costs;
}
