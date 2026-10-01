import type postgres from "postgres";
import { z } from "zod";

const repositoryReadinessSchema = z.object({
	repositoryId: z.string(),
	fullName: z.string(),
	included: z.boolean(),
	prFrom: z.string().nullable(),
	ciFrom: z.string().nullable(),
	externalComplete: z.boolean(),
	noActions: z.boolean(),
	reason: z.string().nullable(),
	lastSyncedAt: z.string().nullable(),
});
export const gitHubReadinessSchema = z.object({
	status: z.enum(["not_ready", "ready"]),
	firstReadyAt: z.coerce.date().nullable(),
	details: z.object({
		activeInstallation: z.boolean(),
		repositories: z.array(repositoryReadinessSchema),
	}),
});
export type GitHubReadiness = z.infer<typeof gitHubReadinessSchema>;
export type GitHubRepositoryReadiness = z.infer<
	typeof repositoryReadinessSchema
>;

export async function readGitHubOutcomesReadiness(
	database: postgres.Sql,
	organizationId: string,
): Promise<GitHubReadiness | null> {
	const [row] = await database.unsafe(
		`SELECT status, first_ready_at AS "firstReadyAt", details FROM organization_feature_readiness WHERE organization_id = $1 AND feature = 'pr_totals'`,
		[organizationId],
	);
	return row ? gitHubReadinessSchema.parse(row) : null;
}

export function resolveGitHubOutcomesVisibility(input: {
	uiEnabled: boolean;
	forced: boolean;
	readiness: GitHubReadiness | null;
}): "hidden" | "visible" | "preview" {
	if (!input.uiEnabled || !input.readiness?.details.activeInstallation)
		return "hidden";
	if (input.readiness.firstReadyAt) return "visible";
	return input.forced ? "preview" : "hidden";
}

export async function refreshPrTotalsReadiness(
	database: postgres.Sql | postgres.TransactionSql,
	organizationId: string,
	now = new Date(),
): Promise<void> {
	await database.unsafe(
		`
	 WITH datasets AS (
	  SELECT s.repository_id, s.dataset,
	   range_agg(tstzrange(s.window_start, s.window_end + interval '1 second', '[)')) FILTER (WHERE s.status = 'complete') AS covered,
	   min(s.window_start) AS first_start, max(s.window_end) + interval '1 second' AS last_end,
	   max(s.window_end) FILTER (WHERE s.status = 'complete') AS last_complete_end,
	   min(s.retention_boundary) AS ci_from,
	   bool_or(s.status = 'pending') AS pending,
	   bool_or(s.status = 'unavailable' AND s.error IN ('github-403', 'github-404')) AS inaccessible,
	   min(s.error) FILTER (WHERE s.status = 'unavailable' AND s.error IN ('github-403', 'github-404')) AS reason,
	   bool_or(s.status = 'unavailable' AND s.error IS DISTINCT FROM 'provider-retention') AS unavailable,
	   max(s.completed_at) AS synced
	  FROM github_repository_sweep s WHERE s.organization_id = $1 GROUP BY 1,2
	 ), repos AS (
	  SELECT b.repository_id, b.full_name, p.first_start AS pr_from, a.ci_from,
	   coalesce(NOT e.pending AND NOT e.unavailable, false) AS external_complete,
	   coalesce(a.ci_from IS NULL AND a.covered @> tstzrange(p.first_start, a.last_end, '[)'), false) AS no_actions,
	   coalesce(p.covered @> tstzrange(p.first_start, p.last_end, '[)')
	    AND a.covered @> tstzrange(greatest(p.first_start, a.ci_from), a.last_end, '[)')
	    AND NOT coalesce(t.pending OR t.unavailable, false)
	    AND NOT coalesce(e.pending OR e.unavailable, false)
	    AND e.first_start IS NOT NULL
	    AND p.last_complete_end >= $2::timestamptz - interval '24 hours'
	    AND a.last_complete_end >= $2::timestamptz - interval '24 hours'
	    AND NOT coalesce(p.inaccessible OR a.inaccessible OR t.inaccessible OR e.inaccessible, false), false) AS included,
	   coalesce(p.reason, a.reason, t.reason, e.reason) AS reason,
	   least(p.synced, a.synced) AS synced
	  FROM github_repository_binding b
	  JOIN github_app_installation i ON i.installation_id = b.installation_id AND i.organization_id = b.organization_id AND i.status = 'active'
	  LEFT JOIN datasets p ON p.repository_id = b.repository_id AND p.dataset = 'pulls'
	  LEFT JOIN datasets a ON a.repository_id = b.repository_id AND a.dataset = 'actions'
	  LEFT JOIN datasets t ON t.repository_id = b.repository_id AND t.dataset = 'attempts'
	  LEFT JOIN datasets e ON e.repository_id = b.repository_id AND e.dataset = 'external'
	  WHERE b.organization_id = $1 AND b.status = 'active'
	 ), state AS (
	  SELECT EXISTS(SELECT 1 FROM github_app_installation WHERE organization_id = $1 AND status = 'active') AS active,
	   coalesce(bool_and(included), false) AS ready,
	   coalesce(jsonb_agg(jsonb_build_object('repositoryId', repository_id, 'fullName', full_name,
	    'included', included, 'prFrom', pr_from, 'ciFrom', ci_from, 'externalComplete', external_complete,
	    'noActions', no_actions, 'reason', reason, 'lastSyncedAt', synced) ORDER BY repository_id), '[]'::jsonb) AS repositories
	  FROM repos
	 )
	 INSERT INTO organization_feature_readiness (organization_id, feature, status, first_ready_at, computed_at, details)
	 SELECT $1, 'pr_totals', CASE WHEN active AND ready THEN 'ready' ELSE 'not_ready' END,
	  CASE WHEN active AND ready THEN $2::timestamptz END, $2,
	  jsonb_build_object('activeInstallation', active, 'repositories', repositories) FROM state
	 ON CONFLICT (organization_id, feature) DO UPDATE SET status = EXCLUDED.status,
	  first_ready_at = CASE WHEN NOT (EXCLUDED.details->>'activeInstallation')::boolean OR jsonb_array_length(EXCLUDED.details->'repositories') = 0 THEN NULL
	   ELSE coalesce(organization_feature_readiness.first_ready_at, EXCLUDED.first_ready_at) END,
	  computed_at = EXCLUDED.computed_at, details = EXCLUDED.details`,
		[organizationId, now.toISOString()],
	);
}
