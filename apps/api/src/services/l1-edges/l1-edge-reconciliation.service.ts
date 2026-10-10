import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import { ClickHouseWriteFencedError } from "../../lib/clickhouse-write-fence.js";
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
	failL1EdgeScope,
	holdsL1EdgeLease,
	recordL1EdgeDependencies,
} from "./l1-edge-queue.service.js";
import {
	buildSessionEdges,
	type SessionEdgeSources,
} from "./l1-edge-session.service.js";
import {
	L1_EDGE_RESOLUTIONS_TABLE,
	L1_EDGES_BY_TARGET_TABLE,
	L1_EDGES_TABLE,
} from "./l1-edge-tables.js";

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
	now?: () => Date;
}

/**
 * Claims due edge scopes and rebuilds them until the budget runs out or the
 * queue is empty; returns how many scopes were built.
 */
export async function runL1EdgePass(env: L1EdgePassEnv): Promise<number> {
	const started = Date.now();
	let built = 0;
	while (Date.now() - started < env.budgetMs) {
		const claims = await claimL1EdgeScopes(env.sql, {
			limit: CLAIM_BATCH,
			leaseMs: LEASE_MS,
		});
		if (claims.length === 0) break;
		for (const claim of claims) if (await processClaim(claim, env)) built += 1;
	}
	return built;
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
		await completeL1EdgeScope(env.sql, claim, {
			resolverVersion: L1_EDGE_RESOLVER_VERSION,
			input: build.input,
			coverage: build.written ? build.coverage : undefined,
			edgeCount: build.edgeCount,
			unresolvedCount: build.unresolvedCount,
			frozenReason: build.frozenReason,
		});
		return build.written;
	} catch (error) {
		if (error instanceof ClickHouseWriteFencedError) {
			if (claim.scopeKind === "session")
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

/** Removes a fenced session's edges from every edge table. */
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
