import {
	type AdminWorkspaceFeatures,
	type AdminWorkspaceFeaturesRow,
	WORKSPACE_FEATURES,
	type WorkspaceFeatureKey,
} from "@rudel/api-routes";
import type postgres from "postgres";
import { listsWorkspace } from "./analysis-log/config.js";
import { agentTracesEnabled } from "./run-questions/agent-traces-rollout.js";
import { runQuestionTagsEnabled } from "./run-questions/tags-rollout.js";

/**
 * Per-workspace feature switches (`workspace_feature`, migration 0066). A
 * switch set in the admin features page overrides the feature's environment
 * list for one workspace, on or off; without one the environment list
 * decides, as before. Switches are read once a minute per workspace and
 * process, so a change reaches every instance within a minute and needs no
 * redeploy. When the switches cannot be read, the environment decides.
 */

/** What each feature's environment list says for a workspace. */
const ENVIRONMENT: Record<
	WorkspaceFeatureKey,
	(workspaceId: string) => boolean
> = {
	agent_traces: agentTracesEnabled,
	run_question_tags: runQuestionTagsEnabled,
	// New features: only their environment list (ids or `*`) or a switch; unset lists nobody.
	moments: (workspaceId) =>
		listsWorkspace("MOMENTS_WORKSPACES", workspaceId, false),
	moment_observations: (workspaceId) =>
		listsWorkspace("MOMENT_OBSERVATIONS_WORKSPACES", workspaceId, false),
	frustration_check: (workspaceId) =>
		listsWorkspace("FRUSTRATION_CHECK_WORKSPACES", workspaceId, false),
	run_ci: (workspaceId) =>
		listsWorkspace("RUN_CI_WORKSPACES", workspaceId, false),
};

/** How long a workspace's switches are kept in memory. */
export const WORKSPACE_FEATURE_CACHE_MS = 60_000;

interface Switch {
	readonly enabled: boolean;
	readonly updatedAt: string;
}
type Switches = ReadonlyMap<WorkspaceFeatureKey, Switch>;

const cache = new Map<
	string,
	{ readAt: number; switches: Promise<Switches> }
>();

/** Whether a feature is on for a workspace: its switch, else its environment list. */
export async function workspaceFeatureEnabled(
	sql: postgres.Sql,
	feature: WorkspaceFeatureKey,
	workspaceId: string,
): Promise<boolean> {
	const switches = await cachedSwitches(sql, workspaceId);
	return switches.get(feature)?.enabled ?? ENVIRONMENT[feature](workspaceId);
}

/** Workspaces with their members and every feature's state, newest first. */
export async function listWorkspaceFeatures(
	sql: postgres.Sql,
	input: { search?: string; limit: number; offset: number },
): Promise<AdminWorkspaceFeatures> {
	const search = input.search?.trim() ?? "";
	const pattern = `%${search.replace(/[\\%_]/gu, (char) => `\\${char}`)}%`;
	const rows = await sql<
		{ id: string; name: string; slug: string; members: number; total: number }[]
	>`
		SELECT o.id, o.name, o.slug,
			(SELECT count(*)::int FROM member m WHERE m.organization_id = o.id) AS members,
			count(*) OVER ()::int AS total
		FROM organization o
		WHERE ${search} = ''
			OR o.name ILIKE ${pattern} OR o.slug ILIKE ${pattern} OR o.id = ${search}
		ORDER BY o.created_at DESC, o.id
		LIMIT ${input.limit} OFFSET ${input.offset}
	`;
	const switches = await readSwitches(
		sql,
		rows.map((row) => row.id),
	);
	return {
		features: WORKSPACE_FEATURES.map(({ key, label, description, env }) => ({
			key,
			label,
			description,
			env,
		})),
		workspaces: rows.map((row) =>
			workspaceRow(row, switches.get(row.id) ?? new Map()),
		),
		total: rows[0]?.total ?? 0,
	};
}

export class WorkspaceNotFoundError extends Error {}

/**
 * Sets one switch (true or false) or removes it (null), recording who set it,
 * and answers the workspace's states as they now are. This process forgets
 * its cached switches at once; others within a minute.
 */
export async function setWorkspaceFeature(
	sql: postgres.Sql,
	input: {
		workspaceId: string;
		feature: WorkspaceFeatureKey;
		enabled: boolean | null;
		userId: string;
	},
): Promise<AdminWorkspaceFeaturesRow> {
	const [workspace] = await sql<
		{ id: string; name: string; slug: string; members: number }[]
	>`
		SELECT o.id, o.name, o.slug,
			(SELECT count(*)::int FROM member m WHERE m.organization_id = o.id) AS members
		FROM organization o WHERE o.id = ${input.workspaceId}
	`;
	if (!workspace) throw new WorkspaceNotFoundError("Workspace not found.");
	if (input.enabled === null) {
		await sql`
			DELETE FROM workspace_feature
			WHERE organization_id = ${input.workspaceId} AND feature = ${input.feature}
		`;
	} else {
		await sql`
			INSERT INTO workspace_feature (organization_id, feature, enabled, updated_by, updated_at)
			VALUES (${input.workspaceId}, ${input.feature}, ${input.enabled}, ${input.userId}, now())
			ON CONFLICT (organization_id, feature) DO UPDATE
			SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()
		`;
	}
	cache.delete(input.workspaceId);
	const switches = await readSwitches(sql, [input.workspaceId]);
	return workspaceRow(workspace, switches.get(input.workspaceId) ?? new Map());
}

/** Forgets every cached switch (tests). */
export function clearWorkspaceFeatureCache(): void {
	cache.clear();
}

function cachedSwitches(
	sql: postgres.Sql,
	workspaceId: string,
	now = Date.now(),
): Promise<Switches> {
	const cached = cache.get(workspaceId);
	if (cached && now - cached.readAt < WORKSPACE_FEATURE_CACHE_MS)
		return cached.switches;
	const switches = readSwitches(sql, [workspaceId]).then(
		(byWorkspace) => byWorkspace.get(workspaceId) ?? new Map(),
		(error: unknown) => {
			// Not cached: the next request reads again.
			cache.delete(workspaceId);
			console.error("workspace features: switches could not be read", error);
			return new Map() as Switches;
		},
	);
	cache.set(workspaceId, { readAt: now, switches });
	return switches;
}

async function readSwitches(
	sql: postgres.Sql,
	workspaceIds: readonly string[],
): Promise<Map<string, Map<WorkspaceFeatureKey, Switch>>> {
	const byWorkspace = new Map<string, Map<WorkspaceFeatureKey, Switch>>();
	if (workspaceIds.length === 0) return byWorkspace;
	const rows = await sql<
		{
			organization_id: string;
			feature: string;
			enabled: boolean;
			updated_at: Date | string;
		}[]
	>`
		SELECT organization_id, feature, enabled, updated_at
		FROM workspace_feature
		WHERE organization_id = ANY(${[...workspaceIds]}::text[])
	`;
	for (const row of rows) {
		// A switch for a feature this build no longer knows is ignored.
		if (!(row.feature in ENVIRONMENT)) continue;
		const switches =
			byWorkspace.get(row.organization_id) ??
			new Map<WorkspaceFeatureKey, Switch>();
		byWorkspace.set(row.organization_id, switches);
		switches.set(row.feature as WorkspaceFeatureKey, {
			enabled: row.enabled,
			updatedAt: new Date(row.updated_at).toISOString(),
		});
	}
	return byWorkspace;
}

function workspaceRow(
	workspace: { id: string; name: string; slug: string; members: number },
	switches: Switches,
): AdminWorkspaceFeaturesRow {
	return {
		id: workspace.id,
		name: workspace.name,
		slug: workspace.slug,
		members: workspace.members,
		features: WORKSPACE_FEATURES.map(({ key }) => {
			const set = switches.get(key);
			const environment = ENVIRONMENT[key](workspace.id);
			return {
				key,
				override: set?.enabled ?? null,
				environment,
				enabled: set?.enabled ?? environment,
				updatedAt: set?.updatedAt ?? null,
			};
		}),
	};
}
