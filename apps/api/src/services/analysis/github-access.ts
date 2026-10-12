import { sqlClient } from "../../db.js";
import {
	isGitHubEvidenceUiEnabled,
	readGitHubEvidenceUiForceOrgIds,
} from "../../lib/env.js";
import {
	readGitHubOutcomesReadiness,
	resolveGitHubOutcomesVisibility,
} from "../github-outcomes-readiness.service.js";
import type {
	CaptureRow,
	EvidencePage,
	GitHubAccess,
	GitHubSource,
	SessionOwners,
	SnapshotRow,
} from "./git-links.js";

/** GitHub visibility, bindings and session evidence as the dashboard and the CLI captures record them. */
export const postgresGitHubSource: GitHubSource = {
	access: loadGitHubAccess,
	evidence: loadSessionEvidence,
};

/** The workspace's GitHub visibility, active bindings and each repository's collection coverage. */
async function loadGitHubAccess(organizationId: string): Promise<GitHubAccess> {
	const forced = readGitHubEvidenceUiForceOrgIds().includes(organizationId);
	const uiEnabled = isGitHubEvidenceUiEnabled() || forced;
	const readiness = uiEnabled
		? await readGitHubOutcomesReadiness(sqlClient, organizationId)
		: null;
	const visibility = resolveGitHubOutcomesVisibility({
		uiEnabled,
		forced,
		readiness,
	});
	if (visibility === "hidden")
		return { visibility, bindings: [], repositories: new Map() };
	return {
		...(await loadBindingsAndCoverage(organizationId, readiness)),
		visibility,
	};
}

/**
 * The repositories whose GitHub facts the workspace's SQL views may read:
 * its active bindings while GitHub outcomes are visible to it (as find
 * links them), otherwise none.
 */
export async function visibleGitHubRepositories(
	organizationId: string,
): Promise<string[]> {
	// Hidden access holds no bindings.
	const access = await loadGitHubAccess(organizationId);
	return access.bindings.map((binding) => binding.repositoryId);
}

/**
 * The workspace's active bindings and collection coverage whatever the
 * dashboard shows: L1 edges are facts, so they do not depend on the GitHub
 * UI rollout; reads still decide visibility.
 */
export async function loadGitHubAccessForEdges(
	organizationId: string,
): Promise<GitHubAccess> {
	return {
		...(await loadBindingsAndCoverage(
			organizationId,
			await readGitHubOutcomesReadiness(sqlClient, organizationId),
		)),
		visibility: "visible",
	};
}

async function loadBindingsAndCoverage(
	organizationId: string,
	readiness: Awaited<ReturnType<typeof readGitHubOutcomesReadiness>>,
): Promise<Omit<GitHubAccess, "visibility">> {
	const rows = await sqlClient.unsafe<
		Array<{ repository_id: string; full_name: string }>
	>(
		"SELECT binding.repository_id, binding.full_name FROM github_repository_binding binding INNER JOIN github_app_installation installation ON installation.installation_id = binding.installation_id WHERE binding.organization_id = $1 AND binding.status = 'active' AND installation.status = 'active'",
		[organizationId],
	);
	return {
		bindings: rows.map((row) => ({
			repositoryId: row.repository_id,
			fullName: row.full_name,
		})),
		repositories: new Map(
			(readiness?.details.repositories ?? []).map((repository) => [
				repository.repositoryId,
				{
					included: repository.included,
					prFrom: repository.prFrom,
					ciFrom: repository.ciFrom,
					coveredThrough: repository.coveredThrough,
					reason: repository.reason,
				},
			]),
		),
	};
}

/**
 * The PRs GitHub listed for each session's captured commit and the CLI's
 * per-capture base and head commits, for the owners' sessions only: per owner
 * and kind, the first `page.limit` rows after `page.after` in the merged find
 * order (millisecond time descending, then session, stream and origin call
 * compared by code point, as the cursor compares them), only the rows
 * `page.calls` names when it is set. Times are returned as ISO text of the
 * same millisecond value they are paged by.
 */
async function loadSessionEvidence(
	organizationId: string,
	owners: readonly SessionOwners[],
	page: EvidencePage,
): Promise<{ snapshots: SnapshotRow[]; captures: CaptureRow[] }> {
	const after = page.after;
	const cursor = [
		after?.at ?? null,
		after?.sessionId ?? "",
		after?.agentId ?? "",
		after?.call ?? null,
		page.limit,
		page.calls ? [...page.calls] : null,
	];
	// $4 time (ISO text), $5 session, $6 stream, $7 origin call (null: every
	// evidence row of that time, session and stream is already behind a
	// transcript cursor), $8 the limit, $9 the kept call ids (null: all).
	// Every parameter is cast, so none is inferred.
	const keyset = (at: string, agent: string, call: string) =>
		`($4::timestamptz IS NULL OR ${at} < $4::timestamptz OR (${at} = $4::timestamptz AND (session_id COLLATE "C" > $5::text OR (session_id = $5::text AND (${agent} COLLATE "C" > $6::text OR (${agent} = $6::text AND $7::text IS NOT NULL AND ${call} COLLATE "C" > $7::text))))))`;
	const snapshots: SnapshotRow[] = [];
	const captures: CaptureRow[] = [];
	for (const { userId, sessionIds } of owners) {
		if (sessionIds.length === 0) continue;
		const [snapshotRows, captureRows] = await Promise.all([
			sqlClient.unsafe<
				Array<{
					origin_id: string;
					session_id: string;
					repository_id: string;
					pull_number: number;
					commit_sha: string;
					observed_text: string;
					coverage_complete: boolean;
					ci_coverage_complete: boolean;
				}>
			>(
				`SELECT * FROM (SELECT snapshot.collection_id || ':' || snapshot.provider_pull_request_id AS origin_id, snapshot.session_id, snapshot.repository_id, snapshot.pull_number, collection.commit_sha, date_trunc('milliseconds', snapshot.observed_at) AS observed_at, to_char(date_trunc('milliseconds', snapshot.observed_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_text, snapshot.coverage_complete, snapshot.ci_coverage_complete FROM github_pull_request_snapshot snapshot INNER JOIN github_evidence_collection collection ON collection.id = snapshot.collection_id WHERE snapshot.organization_id = $1 AND snapshot.session_user_id = $2 AND snapshot.session_id = ANY($3::text[])) evidence WHERE ($9::text[] IS NULL OR ('snapshot:' || origin_id) = ANY($9::text[])) AND ${keyset("observed_at", "''", "('snapshot:' || origin_id)")} ORDER BY observed_at DESC, session_id COLLATE "C", ('snapshot:' || origin_id) COLLATE "C" LIMIT $8::int`,
				[organizationId, userId, [...sessionIds], ...cursor],
			),
			sqlClient.unsafe<
				Array<{
					context_id: string;
					session_id: string;
					agent_id: string | null;
					provider: string | null;
					provider_repository_id: string | null;
					provider_owner: string | null;
					provider_name: string | null;
					lifecycle: string;
					base_git_commit: string | null;
					head_git_commit: string | null;
					captured_text: string;
				}>
			>(
				`SELECT * FROM (SELECT context_id, session_id, coalesce(agent_id, '') AS agent_id, provider, provider_repository_id, provider_owner, provider_name, lifecycle, base_git_commit, head_git_commit, date_trunc('milliseconds', captured_at) AS captured_at, to_char(date_trunc('milliseconds', captured_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS captured_text FROM repository_evidence_capture WHERE organization_id = $1 AND user_id = $2 AND session_id = ANY($3::text[])) evidence WHERE ($9::text[] IS NULL OR ('capture:' || context_id) = ANY($9::text[])) AND ${keyset("captured_at", "agent_id", "('capture:' || context_id)")} ORDER BY captured_at DESC, session_id COLLATE "C", agent_id COLLATE "C", ('capture:' || context_id) COLLATE "C" LIMIT $8::int`,
				[organizationId, userId, [...sessionIds], ...cursor],
			),
		]);
		for (const row of snapshotRows)
			snapshots.push({
				originId: row.origin_id,
				sessionId: row.session_id,
				repositoryId: row.repository_id,
				pullNumber: row.pull_number,
				commitSha: row.commit_sha,
				observedAt: row.observed_text,
				coverageComplete: row.coverage_complete,
				ciCoverageComplete: row.ci_coverage_complete,
			});
		for (const row of captureRows)
			captures.push({
				originId: row.context_id,
				sessionId: row.session_id,
				agentId: row.agent_id ?? "",
				repositoryId:
					row.provider === "github"
						? (row.provider_repository_id ?? null)
						: null,
				remote:
					row.provider_owner && row.provider_name
						? `${row.provider_owner}/${row.provider_name}`
						: "",
				lifecycle: row.lifecycle,
				baseCommit: row.base_git_commit ?? "",
				headCommit: row.head_git_commit ?? "",
				capturedAt: row.captured_text,
			});
	}
	return { snapshots, captures };
}
