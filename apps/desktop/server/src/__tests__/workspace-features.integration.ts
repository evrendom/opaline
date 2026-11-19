import { afterAll, afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
	clearWorkspaceFeatureCache,
	listWorkspaceFeatures,
	setWorkspaceFeature,
	WorkspaceNotFoundError,
	workspaceFeatureEnabled,
} from "../services/workspace-features.js";

// Its own connection: files earlier in the integration run end the shared one.
const sqlClient = postgres(process.env.PG_CONNECTION_STRING ?? "", { max: 2 });
const organizationIds: string[] = [];
const userIds: string[] = [];
const savedList = process.env.AGENT_TRACES_WORKSPACES;

afterAll(async () => {
	await sqlClient.end();
});

afterEach(async () => {
	if (savedList === undefined) delete process.env.AGENT_TRACES_WORKSPACES;
	else process.env.AGENT_TRACES_WORKSPACES = savedList;
	clearWorkspaceFeatureCache();
	if (organizationIds.length)
		await sqlClient`DELETE FROM organization WHERE id IN ${sqlClient(organizationIds)}`;
	if (userIds.length)
		await sqlClient`DELETE FROM "user" WHERE id IN ${sqlClient(userIds)}`;
	organizationIds.length = 0;
	userIds.length = 0;
});

async function createWorkspace(): Promise<string> {
	const id = `features-org-${randomUUID()}`;
	organizationIds.push(id);
	await sqlClient`
		INSERT INTO organization (id, name, slug)
		VALUES (${id}, 'Feature Labs', ${`features-${randomUUID().slice(0, 8)}`})
	`;
	return id;
}

async function createAdmin(): Promise<string> {
	const id = `features-admin-${randomUUID()}`;
	userIds.push(id);
	await sqlClient`
		INSERT INTO "user" (id, name, email, email_verified)
		VALUES (${id}, 'Admin', ${`${id}@example.com`}, true)
	`;
	return id;
}

test("a switch overrides the environment list both ways, and removing it hands the decision back", async () => {
	const listed = await createWorkspace();
	const unlisted = await createWorkspace();
	const admin = await createAdmin();
	process.env.AGENT_TRACES_WORKSPACES = listed;

	expect(await workspaceFeatureEnabled(sqlClient, "agent_traces", listed)).toBe(
		true,
	);
	expect(
		await workspaceFeatureEnabled(sqlClient, "agent_traces", unlisted),
	).toBe(false);

	const on = await setWorkspaceFeature(sqlClient, {
		workspaceId: unlisted,
		feature: "agent_traces",
		enabled: true,
		userId: admin,
	});
	expect(on.features.find((f) => f.key === "agent_traces")).toMatchObject({
		override: true,
		environment: false,
		enabled: true,
	});
	await setWorkspaceFeature(sqlClient, {
		workspaceId: listed,
		feature: "agent_traces",
		enabled: false,
		userId: admin,
	});
	expect(
		await workspaceFeatureEnabled(sqlClient, "agent_traces", unlisted),
	).toBe(true);
	expect(await workspaceFeatureEnabled(sqlClient, "agent_traces", listed)).toBe(
		false,
	);
	const [stored] = await sqlClient<{ updated_by: string }[]>`
		SELECT updated_by FROM workspace_feature
		WHERE organization_id = ${listed} AND feature = 'agent_traces'
	`;
	expect(stored?.updated_by).toBe(admin);

	const cleared = await setWorkspaceFeature(sqlClient, {
		workspaceId: listed,
		feature: "agent_traces",
		enabled: null,
		userId: admin,
	});
	expect(cleared.features.find((f) => f.key === "agent_traces")).toMatchObject({
		override: null,
		enabled: true,
		updatedAt: null,
	});
	expect(await workspaceFeatureEnabled(sqlClient, "agent_traces", listed)).toBe(
		true,
	);
});

test("the list finds a workspace by slug and shows its states; a switch goes with its workspace", async () => {
	const workspace = await createWorkspace();
	const admin = await createAdmin();
	delete process.env.AGENT_TRACES_WORKSPACES;
	await setWorkspaceFeature(sqlClient, {
		workspaceId: workspace,
		feature: "agent_traces",
		enabled: true,
		userId: admin,
	});
	const [{ slug } = { slug: "" }] = await sqlClient<{ slug: string }[]>`
		SELECT slug FROM organization WHERE id = ${workspace}
	`;

	const listing = await listWorkspaceFeatures(sqlClient, {
		search: slug,
		limit: 10,
		offset: 0,
	});
	expect(listing.total).toBe(1);
	expect(listing.workspaces[0]?.features).toContainEqual(
		expect.objectContaining({ key: "agent_traces", enabled: true }),
	);

	await sqlClient`DELETE FROM organization WHERE id = ${workspace}`;
	expect(
		await sqlClient`SELECT 1 FROM workspace_feature WHERE organization_id = ${workspace}`,
	).toHaveLength(0);
	await expect(
		setWorkspaceFeature(sqlClient, {
			workspaceId: workspace,
			feature: "agent_traces",
			enabled: true,
			userId: admin,
		}),
	).rejects.toThrow(WorkspaceNotFoundError);
});
