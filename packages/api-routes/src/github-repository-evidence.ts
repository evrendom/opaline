import { z } from "zod";

export const GitHubRepositoryBindingSchema = z.object({
	defaultBranch: z.string().min(1).max(255),
	isPrivate: z.boolean(),
	name: z.string().min(1).max(100),
	nodeId: z.string().min(1).max(200),
	owner: z.string().min(1).max(100),
	repositoryId: z.string().regex(/^[1-9][0-9]*$/u),
	// Optional so clients built before per-repository sync state keep parsing.
	sync: z
		.discriminatedUnion("state", [
			z.object({ state: z.literal("ready") }),
			z.object({
				state: z.literal("syncing"),
				// Share of the repository's history windows already read (0–1).
				progress: z.number().min(0).max(1).optional(),
			}),
			z.object({
				state: z.literal("unavailable"),
				reason: z.enum(["no-access", "not-found"]),
			}),
		])
		.optional(),
});

export const GitHubRepositoryConnectionStatusSchema = z.object({
	accountLogin: z.string().nullable(),
	accountType: z.enum(["Organization", "User"]).nullable().optional(),
	suspended: z.boolean().optional(),
	canManage: z.boolean(),
	configurationError: z.string().nullable(),
	configured: z.boolean(),
	connected: z.boolean(),
	installationId: z
		.string()
		.regex(/^[1-9][0-9]*$/u)
		.nullable(),
	manageUrl: z.string().url().nullable(),
	repositories: z.array(GitHubRepositoryBindingSchema).max(10_000),
	repositorySelection: z.enum(["all", "selected"]).nullable(),
	dashboard: z.enum(["notConnected", "syncing", "visible"]).optional(),
});

/**
 * Workspace GitHub evidence status. The user-facing GitHub experience is
 * dark-launched: while the deployment keeps it hidden, the server reveals no
 * connection details and clients render no GitHub surface at all.
 */
export const GitHubRepositoryEvidenceStatusSchema = z.discriminatedUnion(
	"visibility",
	[
		z.object({ visibility: z.literal("hidden") }),
		z.object({
			visibility: z.literal("visible"),
			dashboard: z
				.enum(["notConnected", "syncing", "visible"])
				.default("notConnected"),
			connection: GitHubRepositoryConnectionStatusSchema,
		}),
	],
);

export const GitHubCreateInstallationOutputSchema = z.object({
	url: z.string().url(),
});

export const GitHubConnectionReturnToSchema = z.enum([
	"settings",
	"onboarding",
]);
export type GitHubConnectionReturnTo = z.infer<
	typeof GitHubConnectionReturnToSchema
>;

export const GitHubCreateInstallationInputSchema = z
	.object({ returnTo: GitHubConnectionReturnToSchema.optional() })
	.optional();

export const GitHubDisconnectInputSchema = z.object({
	// The workspace the user confirmed; it must still be the active one.
	organizationId: z.string().min(1).max(200),
});

export const GitHubDisconnectOutputSchema = z.object({
	disconnected: z.boolean(),
});

export const GitHubSyncCommitInputSchema = z.object({
	commitSha: z.string().regex(/^[a-f0-9]{40}$/u),
	contextId: z.string().uuid().nullable().default(null),
	repositoryId: z.string().regex(/^[1-9][0-9]*$/u),
	refresh: z.boolean().default(false),
	sessionId: z.string().trim().min(1).max(200).nullable().default(null),
});

export const GitHubSyncCommitOutputSchema = z.object({
	collectionId: z.string().uuid(),
	commitSha: z.string().regex(/^[a-f0-9]{40}$/u),
	logCount: z.number().int().nonnegative(),
	metadataObjectId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
	status: z.enum(["complete", "partial"]),
});

export type GitHubRepositoryConnectionStatus = z.infer<
	typeof GitHubRepositoryConnectionStatusSchema
>;
export type GitHubRepositoryEvidenceStatus = z.infer<
	typeof GitHubRepositoryEvidenceStatusSchema
>;
export type GitHubSyncCommitInput = z.infer<typeof GitHubSyncCommitInputSchema>;
export type GitHubSyncCommitOutput = z.infer<
	typeof GitHubSyncCommitOutputSchema
>;
