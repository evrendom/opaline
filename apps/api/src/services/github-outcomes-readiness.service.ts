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
	/**
	 * End (exclusive) of the history every dataset holds without a gap: the
	 * earliest end of the completed windows. Readiness computed before this
	 * field existed reads as null (unknown).
	 */
	coveredThrough: z.string().nullable().default(null),
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

// A daily pass is enqueued 24 h after the previous one and can take hours to finish.
const READY_HISTORY_MAX_AGE_HOURS = 48;

/**
 * A repository is included while its completed history is contiguous from its
 * first window to its last complete window end and that end is recent. Windows
 * of a newer pass that is still running do not exclude it: coverage is measured
 * only over complete windows and only up to the last complete end, so a pending
 * window matters only where no complete window covers its range (a gap).
 */
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
	   min(s.window_start) AS first_start,
	   max(s.window_end) FILTER (WHERE s.status = 'complete') + interval '1 second' AS complete_end,
	   coalesce(max(s.window_end) FILTER (WHERE s.status = 'complete') >= $2::timestamptz - make_interval(hours => $3::int), false) AS recent,
	   min(s.retention_boundary) AS ci_from,
	   bool_or(s.status = 'unavailable' AND s.error IN ('github-403', 'github-404')) AS inaccessible,
	   min(s.error) FILTER (WHERE s.status = 'unavailable' AND s.error IN ('github-403', 'github-404')) AS reason,
	   bool_or(s.status = 'unavailable' AND s.error IS DISTINCT FROM 'provider-retention') AS unavailable,
	   max(s.completed_at) AS synced
	  FROM github_repository_sweep s WHERE s.organization_id = $1 GROUP BY 1,2
	 ), repos AS (
	  SELECT b.repository_id, b.full_name, p.first_start AS pr_from, a.ci_from,
	   coalesce(e.covered @> tstzrange(e.first_start, e.complete_end, '[)') AND e.recent AND NOT e.unavailable, false) AS external_complete,
	   coalesce(a.ci_from IS NULL AND a.covered @> tstzrange(p.first_start, a.complete_end, '[)'), false) AS no_actions,
	   coalesce(p.covered @> tstzrange(p.first_start, p.complete_end, '[)') AND p.recent
	    AND a.covered @> tstzrange(greatest(p.first_start, a.ci_from), a.complete_end, '[)') AND a.recent
	    AND (t.dataset IS NULL OR t.covered @> tstzrange(t.first_start, t.complete_end, '[)') AND t.recent)
	    AND e.covered @> tstzrange(e.first_start, e.complete_end, '[)') AND e.recent
	    AND NOT coalesce(p.unavailable OR a.unavailable OR t.unavailable OR e.unavailable, false)
	    AND NOT coalesce(p.inaccessible OR a.inaccessible OR t.inaccessible OR e.inaccessible, false), false) AS included,
	   coalesce(p.reason, a.reason, t.reason, e.reason) AS reason,
	   least(p.synced, a.synced) AS synced,
	   -- LEAST skips NULLs, so a dataset without completed windows leaves it unknown.
	   CASE WHEN p.complete_end IS NULL OR a.complete_end IS NULL OR t.complete_end IS NULL OR e.complete_end IS NULL THEN NULL
	    ELSE least(p.complete_end, a.complete_end, t.complete_end, e.complete_end) END AS covered_through
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
	    'noActions', no_actions, 'reason', reason, 'lastSyncedAt', synced, 'coveredThrough', covered_through) ORDER BY repository_id), '[]'::jsonb) AS repositories
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
		[organizationId, now.toISOString(), READY_HISTORY_MAX_AGE_HOURS],
	);
}
