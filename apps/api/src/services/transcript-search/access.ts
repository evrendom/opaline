import type postgres from "postgres";
import { embedsWorkspace } from "./config.js";

/**
 * Which workspaces' uploads are indexed for search (embedded with OpenAI):
 * those with a paid subscription, active or past due, and the internal
 * workspaces `TRANSCRIPT_EMBEDDINGS_WORKSPACES` lists. A workspace that stops
 * paying stops being indexed for new uploads; what was indexed stays until
 * the account or workspace is deleted. Search says the feature is on paid
 * plans everywhere else.
 */

/** Subscription statuses that keep a workspace indexed. */
const PAID_STATUSES: ReadonlySet<string> = new Set(["active", "past_due"]);
/** How long a subscription lookup is trusted. */
const SUBSCRIPTION_TTL_MS = 60_000;
const CACHED_WORKSPACES = 1_000;

export const SEARCH_PAID_PLANS =
	"search is available on paid plans: this workspace's uploads are not indexed for search";

export interface SearchAccess {
	/** Whether the workspace's uploads are indexed for search. */
	indexes(workspaceId: string): Promise<boolean>;
}

export function createSearchAccess(
	billing: {
		/** The workspace's subscription status, or null without one. */
		subscriptionStatus(workspaceId: string): Promise<string | null>;
	},
	options: { now?: () => number } = {},
): SearchAccess {
	const now = options.now ?? Date.now;
	const paid = new Map<string, { at: number; paid: Promise<boolean> }>();
	return {
		async indexes(workspaceId) {
			if (embedsWorkspace(workspaceId)) return true;
			const at = now();
			const cached = paid.get(workspaceId);
			if (cached && at - cached.at < SUBSCRIPTION_TTL_MS) return cached.paid;
			const lookup = billing
				.subscriptionStatus(workspaceId)
				.then((status) => status !== null && PAID_STATUSES.has(status));
			paid.delete(workspaceId);
			paid.set(workspaceId, { at, paid: lookup });
			lookup.catch(() => {
				if (paid.get(workspaceId)?.paid === lookup) paid.delete(workspaceId);
			});
			for (const stale of paid.keys()) {
				if (paid.size <= CACHED_WORKSPACES) break;
				paid.delete(stale);
			}
			return lookup;
		},
	};
}

/** The workspace's subscription in Postgres (`billing_subscription`, one per workspace). */
export function postgresSubscriptions(sql: postgres.Sql): {
	subscriptionStatus(workspaceId: string): Promise<string | null>;
} {
	return {
		async subscriptionStatus(workspaceId) {
			const [row] = await sql<{ status: string }[]>`
				SELECT status FROM billing_subscription WHERE organization_id = ${workspaceId}
			`;
			return row?.status ?? null;
		},
	};
}
