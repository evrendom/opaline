import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import {
	addTurns,
	type CaptureRow,
	type EvidencePage,
	evidenceSeeds,
	type GitHubAccess,
	gitHubNeeds,
	loadGitHubFacts,
	loadObservationGenerations,
	observationSeed,
	queryObservations,
	resolveRepository,
	type SessionOwners,
	type SnapshotRow,
} from "../analysis/git-links.js";
import { queryCountedGenerations, type ScopeBatch } from "../analysis/scope.js";
import { ANALYSIS_QUERY_SETTINGS, query } from "../analysis/sql.js";
import {
	type DerivedEdge,
	type DerivedResolution,
	deriveSessionEdges,
	L1_EDGE_RESOLVER_VERSION,
} from "./l1-edge-derivation.js";
import {
	idPrefixRange,
	type SessionIdentity,
	sessionScopeId,
} from "./l1-edge-ids.js";
import { L1_EDGE_RESOLUTIONS_TABLE, L1_EDGES_TABLE } from "./l1-edge-tables.js";

/** Observations read per session rebuild; the extractor stores at most 2,000 calls. */
const MAX_OBSERVATIONS = 20_000;
/** Evidence rows (captures, snapshots) read per session rebuild. */
const MAX_EVIDENCE = 10_000;
/** A session keeps re-resolving against new GitHub data this long after its last evidence. */
export const L1_EDGE_OPEN_MS = 14 * 86_400_000;

export interface SessionEdgeSources {
	executor: ClickHouseExecutor;
	access(organizationId: string): Promise<GitHubAccess>;
	evidence(
		organizationId: string,
		owners: readonly SessionOwners[],
		page: EvidencePage,
	): Promise<{ snapshots: SnapshotRow[]; captures: CaptureRow[] }>;
}

export interface SessionEdgeBuild {
	/** False when the transcript generation expired after edges were built: they are kept. */
	written: boolean;
	frozenReason: string | null;
	/**
	 * Set when the build must wait and retry, keeping the edges already built:
	 * the git observations lag the committed transcript generation.
	 */
	deferredReason?: string;
	input: Record<string, unknown>;
	coverage: Record<string, unknown>;
	edgeCount: number;
	unresolvedCount: number;
	dependencies: { repositoryKey: string; openUntil: Date }[];
}

const RunStartSchema = z.object({
	agent_id: z.string(),
	turn_idx: z.coerce.number(),
	start_record: z.coerce.number(),
});
const RemoteSchema = z.object({ repository: z.string() });
const ActiveKeySchema = z.object({
	from_kind: z.string(),
	from_id: z.string(),
	relation: z.string(),
	to_kind: z.string(),
	to_id: z.string(),
	evidence_id: z.string(),
});
const ActiveResolutionSchema = z.object({
	evidence_id: z.string(),
	target: z.string(),
});

/**
 * Rebuilds the session-side edges of one session at `revision`: reads the
 * observation generation pinned to its indexed transcript, its captures and
 * snapshots, resolves them against the workspace's GitHub facts, writes the
 * edges and resolutions, and retracts what no longer holds. `beforeWrite`
 * runs right before the write (purge fence and lease check). When the
 * transcript generation has expired, existing edges are kept.
 */
export async function buildSessionEdges(input: {
	sources: SessionEdgeSources;
	organizationId: string;
	session: SessionIdentity;
	revision: number;
	previouslyBuilt: boolean;
	beforeWrite: () => Promise<void>;
	now?: Date;
}): Promise<SessionEdgeBuild> {
	const { executor } = input.sources;
	const { organizationId, session } = input;
	const scope = { organizationId, userId: session.userId };
	const [committed] = await queryCountedGenerations(executor, scope, [
		session.sessionId,
	]);
	const [remote] = await query(executor, RemoteSchema, {
		query: `SELECT coalesce(nullIf(git_remote, ''), nullIf(package_name, ''), project_path) AS repository
			FROM ${getSafeClickHouseTable("rudel.session_analytics")} FINAL
			WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
				AND session_id = {sessionId:String} AND source = {source:String}
			LIMIT 1`,
		query_params: {
			...scope,
			sessionId: session.sessionId,
			source: session.source,
		},
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
	});
	const batch: ScopeBatch = {
		scope,
		generations: committed ? [committed] : [],
		sessions: [
			{
				session_id: session.sessionId,
				user_id: session.userId,
				source: session.source as "claude_code" | "codex",
				model: "",
				repository: remote?.repository ?? "",
				parentSessionId: null,
				rootSessionId: session.sessionId,
				depth: 0,
			},
		],
	};
	const generations = await loadObservationGenerations(executor, [batch]);
	const generation = generations.get(session.sessionId);
	if (!committed && input.previouslyBuilt)
		return {
			written: false,
			frozenReason: "transcript generation expired; edges kept",
			input: { generation: generation ?? null },
			coverage: {},
			edgeCount: 0,
			unresolvedCount: 0,
			dependencies: [],
		};

	// A new transcript generation (a re-upload or parser version) is published
	// before its observations are re-extracted, and the old generation's run
	// starts expire after the retirement grace. Building from the stale
	// observations then would turn run edges into session edges and back;
	// wait for the extraction, which requeues the session.
	if (committed && generation && !generation.current && input.previouslyBuilt)
		return {
			written: false,
			frozenReason: null,
			deferredReason:
				"git observations lag the committed transcript generation; edges kept",
			input: { generation },
			coverage: {},
			edgeCount: 0,
			unresolvedCount: 0,
			dependencies: [],
		};

	const observations = generation
		? await queryObservations(executor, batch, generations, {
				after: undefined,
				limit: MAX_OBSERVATIONS,
			})
		: [];
	const seeds = observations.map((row) => observationSeed(row, generations));
	await addTurns(executor, [batch], seeds);
	const runStarts = new Map<string, number>();
	if (generation)
		for (const row of await query(executor, RunStartSchema, {
			query: `SELECT agent_id, turn_idx, min(record_idx) AS start_record
				FROM ${getSafeClickHouseTable("rudel.transcript_records")} FINAL
				WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
					AND session_id = {sessionId:String} AND revision = toUInt64({revision:String})
					AND parser_version = {parserVersion:UInt16} AND turn_idx >= 1
				GROUP BY agent_id, turn_idx`,
			query_params: {
				...scope,
				sessionId: session.sessionId,
				revision: generation.revision,
				parserVersion: generation.transcriptParserVersion,
			},
			clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
		}))
			runStarts.set(`${row.agent_id}|${row.turn_idx}`, row.start_record);
	const evidence = await input.sources.evidence(
		organizationId,
		[{ userId: session.userId, sessionIds: [session.sessionId] }],
		{ after: undefined, limit: MAX_EVIDENCE },
	);
	const all = [
		...seeds,
		...evidenceSeeds(evidence.snapshots, evidence.captures),
	];
	const access = await input.sources.access(organizationId);
	const resolved = all.map((seed) => ({
		seed,
		...resolveRepository(seed, remote?.repository ?? "", access),
	}));
	const facts = await loadGitHubFacts(
		executor,
		organizationId,
		gitHubNeeds(resolved),
		access.bindings.map((binding) => binding.repositoryId),
	);
	const derived = deriveSessionEdges({ session, resolved, facts, runStarts });

	await input.beforeWrite();
	await writeSessionEdges(executor, {
		organizationId,
		session,
		revision: input.revision,
		edges: derived.edges,
		resolutions: derived.resolutions,
		now: input.now ?? new Date(),
	});

	const lastEvidenceMs = Math.max(0, ...all.map((seed) => seed.atMs));
	const openUntil = new Date(lastEvidenceMs + L1_EDGE_OPEN_MS);
	return {
		written: true,
		frozenReason: null,
		input: {
			transcript: committed
				? {
						revision: committed.revision,
						parserVersion: committed.parserVersion,
					}
				: null,
			generation: generation ?? null,
			observations: observations.length,
			captures: evidence.captures.length,
			snapshots: evidence.snapshots.length,
		},
		coverage: Object.fromEntries(
			derived.repositoryKeys
				.filter((repositoryKey) => !repositoryKey.startsWith("name:"))
				.map((repositoryId) => {
					const coverage = access.repositories.get(repositoryId);
					return [
						repositoryId,
						{
							included: coverage?.included ?? false,
							prFrom: coverage?.prFrom ?? null,
							ciFrom: coverage?.ciFrom ?? null,
							coveredThrough: coverage?.coveredThrough ?? null,
						},
					];
				}),
		),
		edgeCount: derived.edges.length,
		unresolvedCount: derived.resolutions.filter(
			(resolution) => resolution.status !== "linked",
		).length,
		dependencies: derived.repositoryKeys.map((repositoryKey) => ({
			repositoryKey,
			openUntil,
		})),
	};
}

/**
 * Writes a session's current edges and resolutions at `revision`, and an
 * inactive row at the same revision for every previously active key the
 * build no longer produced.
 */
export async function writeSessionEdges(
	executor: ClickHouseExecutor,
	input: {
		organizationId: string;
		session: SessionIdentity;
		revision: number;
		edges: readonly DerivedEdge[];
		resolutions: readonly DerivedResolution[];
		now: Date;
	},
): Promise<void> {
	const { organizationId, session } = input;
	const range = idPrefixRange(sessionScopeId(session));
	const writtenAt = input.now.toISOString().replace("T", " ").replace("Z", "");
	const owner = {
		organization_id: organizationId,
		user_id: session.userId,
		source: session.source,
		session_id: session.sessionId,
	};
	const common = {
		resolver_version: L1_EDGE_RESOLVER_VERSION,
		revision: String(input.revision),
		written_at: writtenAt,
	};
	const active = await query(executor, ActiveKeySchema, {
		query: `SELECT from_kind, from_id, relation, to_kind, to_id, evidence_id
			FROM ${getSafeClickHouseTable(L1_EDGES_TABLE)} FINAL
			WHERE organization_id = {organizationId:String} AND from_kind IN ('run', 'session')
				AND from_id >= {from:String} AND from_id < {to:String} AND is_active = 1`,
		query_params: { organizationId, from: range.from, to: range.to },
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
	});
	const edgeKey = (edge: z.infer<typeof ActiveKeySchema>) =>
		[
			edge.from_kind,
			edge.from_id,
			edge.relation,
			edge.to_kind,
			edge.to_id,
			edge.evidence_id,
		].join("|");
	const current = new Set(input.edges.map(edgeKey));
	const edgeRows = [
		...input.edges.map((edge) => ({
			...owner,
			...edge,
			...common,
			is_active: 1,
		})),
		...active
			.filter((edge) => !current.has(edgeKey(edge)))
			.map((edge) => ({ ...owner, ...edge, ...common, is_active: 0 })),
	];
	const activeResolutions = await query(executor, ActiveResolutionSchema, {
		query: `SELECT evidence_id, target FROM ${getSafeClickHouseTable(L1_EDGE_RESOLUTIONS_TABLE)} FINAL
			WHERE organization_id = {organizationId:String} AND user_id = {userId:String}
				AND source = {source:String} AND session_id = {sessionId:String} AND is_active = 1`,
		query_params: {
			organizationId,
			userId: session.userId,
			source: session.source,
			sessionId: session.sessionId,
		},
		clickhouse_settings: ANALYSIS_QUERY_SETTINGS,
	});
	const resolutionKey = (row: { evidence_id: string; target: string }) =>
		`${row.evidence_id}|${row.target}`;
	const currentResolutions = new Set(input.resolutions.map(resolutionKey));
	const resolutionRows = [
		...input.resolutions.map((resolution) => ({
			...owner,
			...resolution,
			...common,
			is_active: 1,
		})),
		...activeResolutions
			.filter((row) => !currentResolutions.has(resolutionKey(row)))
			.map((row) => ({ ...owner, ...row, ...common, is_active: 0 })),
	];
	const token = `l1-edges:${organizationId}:${sessionScopeId(session)}:${input.revision}`;
	if (edgeRows.length > 0)
		await executor.insert({
			table: L1_EDGES_TABLE,
			values: edgeRows,
			asyncInsert: false,
			deduplicationToken: `${token}:edges`,
		});
	if (resolutionRows.length > 0)
		await executor.insert({
			table: L1_EDGE_RESOLUTIONS_TABLE,
			values: resolutionRows,
			asyncInsert: false,
			deduplicationToken: `${token}:resolutions`,
		});
}
