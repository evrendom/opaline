import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import { ClickHouseWriteFencedError } from "../../lib/clickhouse-write-fence.js";
import {
	assertNoClickHousePurgeTombstone,
	hasClickHousePurgeTombstone,
} from "../clickhouse-purge-tombstone.service.js";
import { L1_EDGE_RESOLVER_VERSION } from "./l1-edge-derivation.js";
import {
	type ClaimedL1EdgeScope,
	claimL1EdgeScopes,
	completeL1EdgeScope,
	dropL1EdgeScope,
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
		if (claim.scopeKind !== "session")
			throw new Error(`Unsupported edge scope kind: ${claim.scopeKind}`);
		if (await hasClickHousePurgeTombstone(target, { database: env.sql }))
			throw new ClickHouseWriteFencedError();
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
			beforeWrite: async () => {
				await assertNoClickHousePurgeTombstone(target, { database: env.sql });
				if (!(await holdsL1EdgeLease(env.sql, claim)))
					throw new L1EdgeLeaseLostError();
			},
		});
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
