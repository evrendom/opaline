import { oc } from "@orpc/contract";
import { z } from "zod";
import { RunCiRunSchema } from "./run-ci.js";
import { RepositoryInputSchema } from "./schemas/repositories.js";

export const REPOSITORY_PULL_REQUEST_LIMIT = 200;
export const REPOSITORY_PULL_REQUEST_CI_LIMIT = 20;

export const RepositoryPullRequestSchema = z.object({
	repository: z.string(),
	node: z.string(),
	number: z.number().int().positive(),
	title: z.string().nullable(),
	state: z.string().nullable(),
	draft: z.boolean().nullable(),
	createdAt: z.string().nullable(),
	mergedAt: z.string().nullable(),
	closedAt: z.string().nullable(),
	headRef: z.string().nullable(),
	authorLogin: z.string().nullable(),
	sessions: z.array(z.string()),
	ci: z.array(RunCiRunSchema).max(REPOSITORY_PULL_REQUEST_CI_LIMIT),
});

export const RepositoryPullRequestsSchema = z.object({
	enabled: z.boolean(),
	pullRequests: z
		.array(RepositoryPullRequestSchema)
		.max(REPOSITORY_PULL_REQUEST_LIMIT),
});

export const repositoryPullRequestsContract = {
	pullRequests: oc
		.input(RepositoryInputSchema)
		.output(RepositoryPullRequestsSchema),
};

export type RepositoryPullRequest = z.infer<typeof RepositoryPullRequestSchema>;
export type RepositoryPullRequests = z.infer<
	typeof RepositoryPullRequestsSchema
>;
