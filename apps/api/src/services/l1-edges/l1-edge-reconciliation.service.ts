import { getLogger } from "@logtape/logtape";
import { CALL_FACTS_TABLE } from "@rudel/ch-schema/call-facts";
import { RUN_SETUP_TABLE } from "@rudel/ch-schema/received-setup";
import type postgres from "postgres";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import { ClickHouseWriteFencedError } from "../../lib/clickhouse-write-fence.js";
import { RUN_INDEX_VERSION } from "../analysis/run-index-sql.js";
import {
	assertNoClickHousePurgeTombstone,
	hasClickHousePurgeTombstone,
} from "../clickhouse-purge-tombstone.service.js";
import { L1_EDGE_RESOLVER_VERSION } from "./l1-edge-derivation.js";
import { L1_EDGE_SESSION_DEBOUNCE_MS } from "./l1-edge-enqueue.js";
import { buildRepositoryEdges } from "./l1-edge-github.service.js";
import {
	type ClaimedL1EdgeScope,
	claimL1EdgeScopes,
	completeL1EdgeScope,
	dropL1EdgeScope,
	enqueueL1EdgeDependents,
	enqueueL1EdgeScope,
	failL1EdgeScope,
	heldL1EdgeLeases,
	holdsL1EdgeLease,
	recordL1EdgeDependencies,
} from "./l1-edge-queue.service.js";
import {
	buildSessionEdges,
	type SessionEdgeBuild,
	type SessionEdgeSources,
} from "./l1-edge-session.service.js";
import {
	L1_EDGE_RESOLUTIONS_TABLE,
	L1_EDGES_BY_TARGET_TABLE,
	L1_EDGES_TABLE,
	RUN_INDEX_TABLE,
	RUN_REQUESTS_TABLE,
} from "./l1-edge-tables.js";
import { buildRunIndex, type RunIndexBuild } from "./run-index.service.js";
import {
	buildRunIndexBatch,
	type RunIndexBatchLimits,
} from "./run-index-batch.service.js";

const logger = getLogger(["rudel", "api", "l1-edges"]);

/** A scope's lease; longer than one build, renewed by completing it. */
const LEASE_MS = 3 * 60_000;
/** Dependent sessions re-queued per repository change; the rest follow on later changes or the census. */
const DEPENDENTS_PER_PASS = 1_000;
const CLAIM_BATCH = 4;

export class L1EdgeLeaseLostError extends Error {
	constructor() {
		super("The edge scope lease was lost before writing");
		this.name = "L1EdgeLeaseLostError";
	}
}

export interface L1EdgePassEnv {
	sql: postgres.Sql;
	sources: SessionEdgeSources;
	/** Stop claiming once this much time has passed. */
	budgetMs: number;
	/** Only this workspace's scopes (tests building their own fixtures). */
	organizationId?: string;
	concurrency?: number;
	/**
	 * Runs after a session's run index build committed new runs (run
	 * questions queue their answers). Best effort: a failure is logged and
	 * never fails or retries the build.
	 */
	afterRunIndexBuilt?: (session: {
		organizationId: string;
		userId: string;
		source: string;
		sessionId: string;
	}) => Promise<unknown>;
	runIndexBatch?: {
		claimLimit: number;
		limits?: RunIndexBatchLimits;
		afterBuilt?: (
			sessions: readonly {
				organizationId: string;
				userId: string;
				source: string;
				sessionId: string;
			}[],
		) => Promise<unknown>;
	};
	now?: () => Date;
}

/**
 * Claims due edge scopes and rebuilds them until the budget runs out or the
 * queue is empty; returns how many scopes were built.
 */
export async function runL1EdgePass(env: L1EdgePassEnv): Promise<number> {
	const started = Date.now();
	let built = 0;
	const concurrency = Math.max(1, env.concurrency ?? 1);
	const batch = env.runIndexBatch;
	while (Date.now() - started < env.budgetMs) {
		const [claims, runIndex] = await Promise.all([
			claimL1EdgeScopes(env.sql, {
				limit: Math.max(CLAIM_BATCH, concurrency),
				leaseMs: LEASE_MS,
				organizationId: env.organizationId,
				kinds: batch ? ["session", "repository"] : undefined,
			}),
			batch
				? claimL1EdgeScopes(env.sql, {
						limit: batch.claimLimit,
						leaseMs: LEASE_MS,
						organizationId: env.organizationId,
						kinds: ["run_index"],
					})
				: [],
		]);
		if (claims.length === 0 && runIndex.length === 0) break;
		const [others, batched] = await Promise.all([
			processClaims(
				runIndex.length === 1 ? [...claims, ...runIndex] : claims,
				env,
				concurrency,
			),
			runIndex.length > 1 ? processRunIndexBatch(runIndex, env) : 0,
		]);
		built += others + batched;
	}
	return built;
}

async function processClaims(
	claims: readonly ClaimedL1EdgeScope[],
	env: L1EdgePassEnv,
	concurrency: number,
): Promise<number> {
	let built = 0;
	if (concurrency === 1) {
		for (const claim of claims) if (await processClaim(claim, env)) built += 1;
		return built;
	}
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, claims.length) }, async () => {
			while (next < claims.length) {
				const claim = claims[next++];
				if (claim && (await processClaim(claim, env))) built += 1;
			}
		}),
	);
	return built;
}

async function processRunIndexBatch(
	claims: readonly ClaimedL1EdgeScope[],
	env: L1EdgePassEnv,
): Promise<number> {
	const members = new Map<string, ClaimedL1EdgeScope[]>();
	for (const claim of claims) {
		const key = `${claim.organizationId}\u0000${claim.userId ?? ""}`;
		const list = members.get(key);
		if (list) list.push(claim);
		else members.set(key, [claim]);
	}
	let built = 0;
	for (const member of members.values())
		built += await processMemberRunIndexBatch(member, env);
	return built;
}

async function processMemberRunIndexBatch(
	claims: readonly ClaimedL1EdgeScope[],
	env: L1EdgePassEnv,
): Promise<number> {
	const [first] = claims;
	if (!first) return 0;
	const target = {
		organizationId: first.organizationId,
		userId: first.userId ?? undefined,
	};
	const bySession = new Map(
		claims.map((claim) => [claim.sessionId ?? "", claim]),
	);
	let outcomes: Awaited<ReturnType<typeof buildRunIndexBatch>>;
	try {
		if (await hasClickHousePurgeTombstone(target, { database: env.sql }))
			throw new ClickHouseWriteFencedError();
		outcomes = await buildRunIndexBatch({
			executor: env.sources.executor,
			organizationId: first.organizationId,
			userId: first.userId ?? "",
			claims: claims.map((claim) => ({
				session: {
					userId: claim.userId ?? "",
					source: claim.source ?? "",
					sessionId: claim.sessionId ?? "",
				},
				buildRevision: claim.revision,
			})),
			beforeWrite: async (sessionIds) => {
				await assertNoClickHousePurgeTombstone(target, { database: env.sql });
				const writing = sessionIds.flatMap((sessionId) => {
					const claim = bySession.get(sessionId);
					return claim ? [claim] : [];
				});
				const held = await heldL1EdgeLeases(env.sql, writing);
				return new Set(
					writing
						.filter((claim) => held.has(claim.scopeId))
						.map((claim) => claim.sessionId ?? ""),
				);
			},
			now: env.now,
			limits: env.runIndexBatch?.limits,
		});
	} catch (error) {
		if (!(error instanceof ClickHouseWriteFencedError))
			logger.warn(
				"Run index batch of {count} sessions failed, building them one at a time: {error}",
				{
					count: claims.length,
					error: error instanceof Error ? error.message : String(error),
				},
			);
		return processClaims(claims, env, 1);
	}
	let built = 0;
	const written: {
		organizationId: string;
		userId: string;
		source: string;
		sessionId: string;
	}[] = [];
	for (const claim of claims) {
		const outcome = outcomes.get(claim.sessionId ?? "");
		if (!outcome || outcome.kind === "lease_lost") continue;
		if (outcome.kind === "failed") {
			const message =
				outcome.error instanceof Error
					? outcome.error.message
					: String(outcome.error);
			logger.warn("Edge scope {scope} failed: {error}", {
				scope: `${claim.scopeKind}:${claim.scopeId}`,
				error: message,
			});
			await failL1EdgeScope(env.sql, claim, message);
			continue;
		}
		await completeRunIndexScope(env, claim, outcome.build);
		if (outcome.build.written) {
			built += 1;
			written.push({
				organizationId: claim.organizationId,
				userId: claim.userId ?? "",
				source: claim.source ?? "",
				sessionId: claim.sessionId ?? "",
			});
		}
	}
	if (written.length > 0) await afterRunIndexBatchBuilt(env, written);
	return built;
}

function completeRunIndexScope(
	env: L1EdgePassEnv,
	claim: ClaimedL1EdgeScope,
	build: RunIndexBuild,
): Promise<boolean> {
	return completeL1EdgeScope(env.sql, claim, {
		resolverVersion: RUN_INDEX_VERSION,
		input: build.input,
		edgeCount: build.runCount,
		unresolvedCount: 0,
		frozenReason: build.frozenReason,
	});
}

async function afterRunIndexBatchBuilt(
	env: L1EdgePassEnv,
	sessions: readonly {
		organizationId: string;
		userId: string;
		source: string;
		sessionId: string;
	}[],
): Promise<void> {
	const hook = env.runIndexBatch?.afterBuilt;
	if (!hook) {
		for (const session of sessions) await afterRunIndexBuilt(env, session);
		return;
	}
	try {
		await hook(sessions);
	} catch (error) {
		logger.warn("After the run index of {count} sessions: {error}", {
			count: sessions.length,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function processClaim(
	claim: ClaimedL1EdgeScope,
	env: L1EdgePassEnv,
): Promise<boolean> {
	const target = {
		organizationId: claim.organizationId,
		userId: claim.userId ?? undefined,
	};
	try {
		if (await hasClickHousePurgeTombstone(target, { database: env.sql }))
			throw new ClickHouseWriteFencedError();
		const beforeWrite = async () => {
			await assertNoClickHousePurgeTombstone(target, { database: env.sql });
			if (!(await holdsL1EdgeLease(env.sql, claim)))
				throw new L1EdgeLeaseLostError();
		};
		if (claim.scopeKind === "repository") {
			const repositoryId = claim.repositoryId ?? claim.scopeId;
			// Read before the GitHub tables: the edges written below are complete
			// at least up to this coverage, which bounds counts made from them.
			const readAt = (env.now?.() ?? new Date()).toISOString();
			const coverage = (
				await env.sources.access(claim.organizationId)
			).repositories.get(repositoryId);
			const build = await buildRepositoryEdges({
				executor: env.sources.executor,
				organizationId: claim.organizationId,
				repositoryId,
				revision: claim.revision,
				watermark: claim.watermark,
				now: env.now?.(),
				beforeWrite,
			});
			// New GitHub facts can resolve or change the links of sessions that named them.
			if (build.edgeCount > 0)
				await enqueueL1EdgeDependents(
					env.sql,
					claim.organizationId,
					[repositoryId],
					{
						limit: DEPENDENTS_PER_PASS,
						debounceMs: L1_EDGE_SESSION_DEBOUNCE_MS,
					},
				);
			await completeL1EdgeScope(env.sql, claim, {
				resolverVersion: L1_EDGE_RESOLVER_VERSION,
				coverage: {
					[repositoryId]: {
						included: coverage?.included ?? false,
						prFrom: coverage?.prFrom ?? null,
						ciFrom: coverage?.ciFrom ?? null,
						coveredThrough: coverage?.coveredThrough ?? null,
						readAt,
					},
				},
				watermark: build.watermark,
				edgeCount: build.edgeCount,
				unresolvedCount: 0,
			});
			return true;
		}
		const session = {
			userId: claim.userId ?? "",
			source: claim.source ?? "",
			sessionId: claim.sessionId ?? "",
		};
		if (claim.scopeKind === "run_index") {
			// Reads only the session's own transcript and usage: never deferred
			// for observations and never re-queued by repository changes.
			const build = await buildRunIndex({
				executor: env.sources.executor,
				organizationId: claim.organizationId,
				session,
				buildRevision: claim.revision,
				beforeWrite,
				now: env.now,
			});
			await completeRunIndexScope(env, claim, build);
			if (build.written)
				await afterRunIndexBuilt(env, {
					organizationId: claim.organizationId,
					...session,
				});
			return build.written;
		}
		const build = await buildSessionEdges({
			sources: env.sources,
			organizationId: claim.organizationId,
			session,
			revision: claim.revision,
			previouslyBuilt: claim.builtRevision !== null,
			now: env.now?.(),
			beforeWrite,
		});
		if (build.deferredReason !== undefined) {
			// Backs off and retries; extraction's requeue resets the attempts.
			await failL1EdgeScope(env.sql, claim, build.deferredReason);
			return false;
		}
		if (build.written)
			await recordL1EdgeDependencies(env.sql, claim, build.dependencies);
		await completeL1EdgeScope(env.sql, claim, sessionCompletion(build));
		if (build.written) await queueRunIndex(env.sql, claim, session);
		return build.written;
	} catch (error) {
		if (error instanceof ClickHouseWriteFencedError) {
			if (claim.scopeKind !== "repository")
				await deleteSessionEdges(env.sources.executor, claim);
			await dropL1EdgeScope(env.sql, claim);
			return false;
		}
		if (error instanceof L1EdgeLeaseLostError) return false;
		const message = error instanceof Error ? error.message : String(error);
		logger.warn("Edge scope {scope} failed: {error}", {
			scope: `${claim.scopeKind}:${claim.scopeId}`,
			error: message,
		});
		await failL1EdgeScope(env.sql, claim, message);
		return false;
	}
}

/** The run index hook, after the build committed; its failure is only logged. */
async function afterRunIndexBuilt(
	env: L1EdgePassEnv,
	session: Parameters<NonNullable<L1EdgePassEnv["afterRunIndexBuilt"]>>[0],
): Promise<void> {
	if (!env.afterRunIndexBuilt) return;
	try {
		await env.afterRunIndexBuilt(session);
	} catch (error) {
		logger.warn("After the run index of {session}: {error}", {
			session: session.sessionId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * Queues a session's run index after its edges were built: the session's
 * evidence changed, and this runs in the worker, so no upload waits on the
 * run index's queue row. Best effort; the run index census catches a lost
 * request.
 */
async function queueRunIndex(
	sql: L1EdgePassEnv["sql"],
	claim: ClaimedL1EdgeScope,
	session: { userId: string; source: string; sessionId: string },
): Promise<void> {
	try {
		await enqueueL1EdgeScope(sql, {
			kind: "run_index",
			organizationId: claim.organizationId,
			...session,
		});
	} catch (error) {
		logger.warn("Could not queue the run index of {scope}: {error}", {
			scope: claim.scopeId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * How a session build completes its scope. A freeze writes nothing, so the
 * scope keeps the build whose edges it keeps (its revision, time, rules,
 * input with the truncated flag, and coverage): rows a failed build wrote
 * after that one must never become published by the freeze.
 */
export function sessionCompletion(
	build: Pick<
		SessionEdgeBuild,
		| "written"
		| "input"
		| "coverage"
		| "edgeCount"
		| "unresolvedCount"
		| "frozenReason"
	>,
): Parameters<typeof completeL1EdgeScope>[2] {
	return build.written
		? {
				resolverVersion: L1_EDGE_RESOLVER_VERSION,
				input: build.input,
				coverage: build.coverage,
				edgeCount: build.edgeCount,
				unresolvedCount: build.unresolvedCount,
				frozenReason: build.frozenReason,
			}
		: {
				resolverVersion: L1_EDGE_RESOLVER_VERSION,
				edgeCount: build.edgeCount,
				unresolvedCount: build.unresolvedCount,
				frozenReason: build.frozenReason,
				retainBuild: true,
			};
}

/**
 * Removes a fenced session's derived rows from every edge table and the run
 * index (runs and requests), whichever of its scopes found the fence.
 */
async function deleteSessionEdges(
	executor: ClickHouseExecutor,
	claim: ClaimedL1EdgeScope,
): Promise<void> {
	const filter =
		"organization_id = {organizationId:String} AND user_id = {userId:String} AND source = {source:String} AND session_id = {sessionId:String}";
	for (const table of [
		L1_EDGES_TABLE,
		L1_EDGES_BY_TARGET_TABLE,
		L1_EDGE_RESOLUTIONS_TABLE,
		RUN_INDEX_TABLE,
		RUN_REQUESTS_TABLE,
		RUN_SETUP_TABLE,
		CALL_FACTS_TABLE,
	])
		await executor.execute({
			clickhouse_settings: { lightweight_deletes_sync: "3" },
			query: `DELETE FROM ${table} WHERE ${filter}`,
			query_params: {
				organizationId: claim.organizationId,
				userId: claim.userId ?? "",
				source: claim.source ?? "",
				sessionId: claim.sessionId ?? "",
			},
		});
}
