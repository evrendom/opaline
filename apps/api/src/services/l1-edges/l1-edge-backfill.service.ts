import type postgres from "postgres";
import { z } from "zod";
import {
	type ClickHouseExecutor,
	getSafeClickHouseTable,
} from "../../clickhouse.js";
import { enqueueL1EdgeScope } from "./l1-edge-queue.service.js";

const SessionSchema = z.object({
	organization_id: z.string(),
	user_id: z.string(),
	source: z.string(),
	session_id: z.string(),
});

export interface L1EdgeBackfillResult {
	repositories: number;
	sessions: number;
	queued: boolean;
}

/**
 * Queues every active repository binding and every session with git
 * observations or CLI captures for an L1 edge build, at backfill priority so
 * live changes go first. Repositories come first so GitHub-side edges exist
 * when sessions resolve. Queueing is idempotent; the worker does the work.
 */
export async function backfillL1Edges(
	executor: ClickHouseExecutor,
	sql: postgres.Sql,
	options: { organizationId?: string; maxSessions: number },
	execute: boolean,
): Promise<L1EdgeBackfillResult> {
	const repositories = await sql.unsafe<
		{ organization_id: string; repository_id: string }[]
	>(
		`SELECT DISTINCT binding.organization_id, binding.repository_id
		 FROM github_repository_binding binding
		 INNER JOIN github_app_installation installation ON installation.installation_id = binding.installation_id
		 WHERE binding.status = 'active' AND installation.status = 'active'
			AND ($1::text IS NULL OR binding.organization_id = $1::text)`,
		[options.organizationId ?? null],
	);
	const observed = z.array(SessionSchema).parse(
		await executor.query<unknown>({
			query: `SELECT DISTINCT organization_id, user_id, source, session_id
				FROM ${getSafeClickHouseTable("rudel.session_git_observations")}
				WHERE kind = 'receipt' ${options.organizationId ? "AND organization_id = {organizationId:String}" : ""}
				LIMIT {limit:UInt32}`,
			query_params: {
				organizationId: options.organizationId ?? "",
				limit: options.maxSessions,
			},
		}),
	);
	const captured = await sql.unsafe<z.infer<typeof SessionSchema>[]>(
		`SELECT DISTINCT organization_id, user_id, source, session_id
		 FROM repository_evidence_capture
		 WHERE ($1::text IS NULL OR organization_id = $1::text)
		 LIMIT $2`,
		[options.organizationId ?? null, options.maxSessions],
	);
	const sessions = new Map(
		[...observed, ...captured]
			.filter((row) => row.source === "claude_code" || row.source === "codex")
			.map((row) => [
				JSON.stringify([
					row.organization_id,
					row.user_id,
					row.source,
					row.session_id,
				]),
				row,
			]),
	);
	const selected = [...sessions.values()].slice(0, options.maxSessions);
	if (execute) {
		for (const repository of repositories)
			await enqueueL1EdgeScope(
				sql,
				{
					kind: "repository",
					organizationId: repository.organization_id,
					repositoryId: repository.repository_id,
				},
				{ priority: 1 },
			);
		for (const session of selected)
			await enqueueL1EdgeScope(
				sql,
				{
					kind: "session",
					organizationId: session.organization_id,
					userId: session.user_id,
					source: session.source,
					sessionId: session.session_id,
				},
				{ priority: 1 },
			);
	}
	return {
		repositories: repositories.length,
		sessions: selected.length,
		queued: execute,
	};
}
