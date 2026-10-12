import { getLogger } from "@logtape/logtape";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import {
	createSearchAccess,
	postgresSubscriptions,
	type SearchAccess,
} from "./access.js";
import {
	readEmbeddingQuotaLimits,
	type TranscriptEmbedder,
	transcriptEmbedder,
} from "./config.js";
import { createPostgresEmbeddingQuota, type EmbeddingQuota } from "./quota.js";
import {
	indexSessionTextBestEffort,
	type SessionIndexInput,
} from "./session-index.service.js";

const logger = getLogger(["rudel", "api", "transcript-search"]);

/** What indexing an upload needs; Postgres-backed unless given. */
export interface UploadIndexDeps {
	readonly access: SearchAccess;
	readonly embedder: TranscriptEmbedder | null;
	readonly quota: EmbeddingQuota;
}

let postgresDeps: Promise<UploadIndexDeps> | null = null;

/**
 * Indexes an uploaded session for search after its transcript records are
 * written (and again on a duplicate upload, which goes on where an earlier
 * pass stopped). Only workspaces with a paid plan or listed as internal
 * (`access.ts`); history is not indexed here. Best effort: never fails the
 * upload.
 */
export async function indexUploadedSessionBestEffort(
	executor: ClickHouseExecutor,
	input: SessionIndexInput,
	deps?: UploadIndexDeps,
): Promise<void> {
	try {
		const resolved = deps ?? (await defaultDeps());
		if (!resolved || !(await resolved.access.indexes(input.organizationId)))
			return;
		await indexSessionTextBestEffort(input, {
			executor,
			embedder: resolved.embedder,
			quota: resolved.quota,
		});
	} catch (error) {
		logger.warn("Transcript search indexing was not started: {error}", {
			error: error instanceof Error ? error.message.slice(0, 512) : "failed",
		});
	}
}

/** Postgres holds the subscriptions and the quota: without it nothing is indexed. */
async function defaultDeps(): Promise<UploadIndexDeps | null> {
	if (!process.env.PG_CONNECTION_STRING) return null;
	postgresDeps ??= (async () => {
		// Loaded only here, so modules that import this one open no Postgres pool.
		const { sqlClient } = await import("../../db.js");
		return {
			access: createSearchAccess(postgresSubscriptions(sqlClient)),
			embedder: transcriptEmbedder(),
			quota: createPostgresEmbeddingQuota(
				sqlClient,
				readEmbeddingQuotaLimits(),
			),
		};
	})();
	return postgresDeps;
}
