import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * Features Opaline turns on per workspace from the admin features page. Each
 * keeps the environment list it had (`env`) as its default; a switch set in
 * the page overrides that list for one workspace, on or off, without a
 * redeploy.
 */
export const WORKSPACE_FEATURES = [
	{
		key: "agent_traces",
		label: "Agent traces",
		description:
			"The Agent traces page: every agent run with its run question answers and confidence filters.",
		env: "AGENT_TRACES_WORKSPACES",
	},
	{
		key: "run_question_tags",
		label: "Run question tags",
		description:
			"Run question answers as tags in the sessions list, the reader and Agent traces. The workspace's runs must also be answered.",
		env: "RUN_QUESTION_TAGS_WORKSPACES",
	},
	{
		key: "moments",
		label: "Compass",
		description:
			"The Compass page: agent runs made noticeable by flags (rules, no model), observations grouped into patterns, and fixes with before/after.",
		env: "MOMENTS_WORKSPACES",
	},
	{
		key: "moment_observations",
		label: "Moment observations",
		description:
			"Lets members have a model (Claude, ANTHROPIC_API_KEY) read a noticeable run's flagged records and write an observation. Sends those records to Anthropic. Needs Compass.",
		env: "MOMENT_OBSERVATIONS_WORKSPACES",
	},
	{
		key: "frustration_check",
		label: "Frustration check",
		description:
			"SubQ answers \"Is the user frustrated?\" about every member prompt that follows a run (with the agent's last message), for Compass's User frustrated flag. Sends those prompts to SubQ (SUBQ_API_KEY). Needs Compass.",
		env: "FRUSTRATION_CHECK_WORKSPACES",
	},
	{
		key: "run_ci",
		label: "CI in the waterfall",
		description:
			"The GitHub Actions runs and jobs each agent run reached, as rows of its waterfall in the reader and Compass: the ones the run named or pushed the commit of, and apart from them the PR's CI that started while it ran. Needs GitHub connected.",
		env: "RUN_CI_WORKSPACES",
	},
] as const;

export const WorkspaceFeatureKeySchema = z.enum(
	WORKSPACE_FEATURES.map((feature) => feature.key) as [
		(typeof WORKSPACE_FEATURES)[number]["key"],
		...(typeof WORKSPACE_FEATURES)[number]["key"][],
	],
);
export type WorkspaceFeatureKey = z.infer<typeof WorkspaceFeatureKeySchema>;

/** One feature for one workspace: the switch, the environment's answer, and the result. */
export const WorkspaceFeatureStateSchema = z.object({
	key: WorkspaceFeatureKeySchema,
	/** The admin switch: true or false overrides the environment; null leaves it in charge. */
	override: z.boolean().nullable(),
	/** What the environment list says for this workspace. */
	environment: z.boolean(),
	/** Whether the feature is on: the override, else the environment. */
	enabled: z.boolean(),
	/** When the switch was last set (ISO), null without one. */
	updatedAt: z.string().nullable(),
});

export const AdminWorkspaceFeaturesRowSchema = z.object({
	id: z.string(),
	name: z.string(),
	slug: z.string(),
	members: z.number().int(),
	features: z.array(WorkspaceFeatureStateSchema),
});

export const AdminWorkspaceFeaturesSchema = z.object({
	features: z.array(
		z.object({
			key: WorkspaceFeatureKeySchema,
			label: z.string(),
			description: z.string(),
			env: z.string(),
		}),
	),
	workspaces: z.array(AdminWorkspaceFeaturesRowSchema),
	total: z.number().int(),
});

export const AdminWorkspaceFeaturesInputSchema = z
	.object({
		/** Part of a workspace's name, slug or id. */
		search: z.string().trim().max(200).optional(),
		limit: z.number().int().min(1).max(100).default(50),
		offset: z.number().int().min(0).default(0),
	})
	.strict();

export const AdminSetWorkspaceFeatureInputSchema = z
	.object({
		workspaceId: z.string().min(1).max(200),
		feature: WorkspaceFeatureKeySchema,
		/** true or false sets the switch; null removes it, so the environment decides again. */
		enabled: z.boolean().nullable(),
	})
	.strict();

export const workspaceFeaturesAdminContract = {
	list: oc
		.input(AdminWorkspaceFeaturesInputSchema)
		.output(AdminWorkspaceFeaturesSchema),
	set: oc
		.input(AdminSetWorkspaceFeatureInputSchema)
		.output(AdminWorkspaceFeaturesRowSchema),
};

export type WorkspaceFeatureState = z.infer<typeof WorkspaceFeatureStateSchema>;
export type AdminWorkspaceFeaturesRow = z.infer<
	typeof AdminWorkspaceFeaturesRowSchema
>;
export type AdminWorkspaceFeatures = z.infer<
	typeof AdminWorkspaceFeaturesSchema
>;
