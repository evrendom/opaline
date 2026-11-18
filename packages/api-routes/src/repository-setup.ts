import { oc } from "@orpc/contract";
import { z } from "zod";
import { RepositoryScopedInputSchema } from "./schemas/repositories.js";
import {
	SessionSetupFileSchema,
	SessionSetupTextVersionSchema,
} from "./session-summary-links.js";

export const REPOSITORY_SETUP_FILE_LIMIT = 500;
export const REPOSITORY_SETUP_TEXT_VERSION_LIMIT = 24;
export const REPOSITORY_SETUP_SESSION_LIMIT = 500;
export const REPOSITORY_MCP_TOOL_LIMIT = 1000;

export const RepositorySetupFileSchema = SessionSetupFileSchema.extend({
	sessions: z.number().int().nonnegative(),
	lastAt: z.string(),
});

export const REPOSITORY_LISTED_SKILL_LIMIT = 500;

export const RepositoryListedSkillSchema = z.object({
	name: z.string(),
	description: z.string(),
	sessions: z.number().int().nonnegative(),
	lastAt: z.string(),
});

export const RepositorySetupSchema = z.object({
	files: z.array(RepositorySetupFileSchema).max(REPOSITORY_SETUP_FILE_LIMIT),
	listedSkills: z
		.array(RepositoryListedSkillSchema)
		.max(REPOSITORY_LISTED_SKILL_LIMIT)
		.optional(),
});

export const RepositorySetupTextInputSchema =
	RepositoryScopedInputSchema.extend({
		setupFile: z.string().min(1).max(2000),
	}).strict();

export const RepositorySetupTextVersionSchema =
	SessionSetupTextVersionSchema.extend({
		sessions: z.number().int().nonnegative(),
		lastAt: z.string(),
	});

export const RepositorySetupTextSchema = z.object({
	versions: z
		.array(RepositorySetupTextVersionSchema)
		.max(REPOSITORY_SETUP_TEXT_VERSION_LIMIT),
});

export const RepositorySetupSessionSchema = z.object({
	sessionId: z.string(),
	version: z.string(),
	runs: z.number().int().nonnegative(),
	firstAt: z.string(),
	lastAt: z.string(),
});

export const RepositorySetupSessionsSchema = z.object({
	sessions: z
		.array(RepositorySetupSessionSchema)
		.max(REPOSITORY_SETUP_SESSION_LIMIT),
	truncated: z.boolean(),
});

export const RepositoryMcpToolSchema = z.object({
	server: z.string(),
	tool: z.string(),
	calls: z.number().int().nonnegative(),
	sessions: z.number().int().nonnegative(),
});

export const RepositoryMcpToolsSchema = z.object({
	tools: z.array(RepositoryMcpToolSchema).max(REPOSITORY_MCP_TOOL_LIMIT),
});

export const repositorySetupContract = {
	setup: oc.input(RepositoryScopedInputSchema).output(RepositorySetupSchema),
	setupText: oc
		.input(RepositorySetupTextInputSchema)
		.output(RepositorySetupTextSchema),
	setupSessions: oc
		.input(RepositorySetupTextInputSchema)
		.output(RepositorySetupSessionsSchema),
	mcpTools: oc
		.input(RepositoryScopedInputSchema)
		.output(RepositoryMcpToolsSchema),
};

export type RepositorySetupFile = z.infer<typeof RepositorySetupFileSchema>;
export type RepositorySetup = z.infer<typeof RepositorySetupSchema>;
export type RepositoryListedSkill = z.infer<typeof RepositoryListedSkillSchema>;
export type RepositorySetupTextVersion = z.infer<
	typeof RepositorySetupTextVersionSchema
>;
export type RepositorySetupText = z.infer<typeof RepositorySetupTextSchema>;
export type RepositorySetupSession = z.infer<
	typeof RepositorySetupSessionSchema
>;
export type RepositorySetupSessions = z.infer<
	typeof RepositorySetupSessionsSchema
>;
export type RepositoryMcpTool = z.infer<typeof RepositoryMcpToolSchema>;
export type RepositoryMcpTools = z.infer<typeof RepositoryMcpToolsSchema>;
