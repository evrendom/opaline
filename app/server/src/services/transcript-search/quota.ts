import type postgres from "postgres";

/**
 * The per-workspace OpenAI quota for transcript search: tokens embedded
 * (session chunks at upload and search queries) in a fixed window. Over it,
 * nothing more is embedded until the window resets; uploads still store
 * their chunks, which exact-string search finds, and search says so.
 */
export interface EmbeddingQuota {
	/** Tokens a workspace may embed per window. */
	readonly tokens: number;
	readonly windowMs: number;
	usage(workspaceId: string): Promise<EmbeddingQuotaUsage>;
	/** Adds tokens OpenAI billed to the workspace's current window. */
	charge(workspaceId: string, tokens: number): Promise<void>;
}

export interface EmbeddingQuotaUsage {
	readonly used: number;
	readonly limit: number;
	readonly resetsAt: Date;
}

/**
 * 30 days and 1 billion tokens (about $20 of text-embedding-3-small): enough
 * for a paying team. Measured text is 110K to 370K tokens per session before
 * deduplication, so this covers about 2,700 to 9,000 sessions a month.
 */
export const EMBEDDING_QUOTA = {
	tokens: 1_000_000_000,
	windowMs: 30 * 24 * 3_600_000,
} as const;

export function createMemoryEmbeddingQuota(
	limits: { tokens: number; windowMs: number },
	now: () => Date = () => new Date(),
): EmbeddingQuota {
	const windows = new Map<string, { startedAt: number; used: number }>();
	const current = (workspaceId: string) => {
		const at = now().getTime();
		const window = windows.get(workspaceId);
		return window && at - window.startedAt < limits.windowMs
			? window
			: { startedAt: at, used: 0 };
	};
	return {
		...limits,
		async usage(workspaceId) {
			const window = current(workspaceId);
			return {
				used: window.used,
				limit: limits.tokens,
				resetsAt: new Date(window.startedAt + limits.windowMs),
			};
		},
		async charge(workspaceId, tokens) {
			const window = current(workspaceId);
			windows.set(workspaceId, { ...window, used: window.used + tokens });
		},
	};
}

/**
 * One fixed window per workspace in Postgres (`transcript_embedding_quota`),
 * deleted with the workspace. Charges are atomic; a check before a request
 * and its charge after can overshoot the limit by the requests in flight.
 */
export function createPostgresEmbeddingQuota(
	sql: postgres.Sql,
	limits: { tokens: number; windowMs: number } = EMBEDDING_QUOTA,
): EmbeddingQuota {
	const window = `${limits.windowMs} milliseconds`;
	return {
		...limits,
		async usage(workspaceId) {
			const [row] = await sql<{ used: string; started_at_ms: string }[]>`
				SELECT token_count::text AS used,
					(extract(epoch FROM window_started_at) * 1000)::bigint::text AS started_at_ms
				FROM transcript_embedding_quota
				WHERE organization_id = ${workspaceId}
					AND window_started_at > now() - ${window}::interval
			`;
			const startedAt = row ? Number(row.started_at_ms) : Date.now();
			return {
				used: row ? Number(row.used) : 0,
				limit: limits.tokens,
				resetsAt: new Date(startedAt + limits.windowMs),
			};
		},
		async charge(workspaceId, tokens) {
			if (tokens <= 0) return;
			await sql`
				INSERT INTO transcript_embedding_quota (organization_id, window_started_at, token_count)
				VALUES (${workspaceId}, now(), ${tokens})
				ON CONFLICT (organization_id) DO UPDATE SET
					window_started_at = CASE
						WHEN transcript_embedding_quota.window_started_at <= now() - ${window}::interval
						THEN now() ELSE transcript_embedding_quota.window_started_at END,
					token_count = CASE
						WHEN transcript_embedding_quota.window_started_at <= now() - ${window}::interval
						THEN EXCLUDED.token_count
						ELSE transcript_embedding_quota.token_count + EXCLUDED.token_count END
			`;
		},
	};
}
