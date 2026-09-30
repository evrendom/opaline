import { z } from "zod";

const nullableStringSchema = z.string().nullable().optional().transform(toNull);
const nullableNumberSchema = z.number().nullable().optional().transform(toNull);

export const githubActorSchema = z
	.object({
		id: z.union([z.number(), z.string()]),
		login: z.string(),
		type: z.string().optional().default("User"),
	})
	.passthrough();

const githubGitIdentitySchema = z
	.object({
		name: nullableStringSchema,
		email: nullableStringSchema,
		date: nullableStringSchema,
	})
	.nullable()
	.optional()
	.transform(toNull);

export const githubCommitSchema = z
	.object({
		sha: z.string(),
		html_url: z.string(),
		commit: z
			.object({
				message: z.string(),
				author: githubGitIdentitySchema,
				committer: githubGitIdentitySchema,
				tree: z.object({ sha: z.string() }).passthrough(),
			})
			.passthrough(),
		author: githubActorSchema.nullable().optional().transform(toNull),
		committer: githubActorSchema.nullable().optional().transform(toNull),
		parents: z.array(z.object({ sha: z.string() }).passthrough()).default([]),
	})
	.passthrough();

const githubPullRefSchema = z
	.object({
		ref: z.string(),
		sha: z.string(),
	})
	.passthrough();

export const githubPullRequestSchema = z
	.object({
		id: z.union([z.number(), z.string()]),
		number: z.number().int(),
		node_id: z.string(),
		title: z.string(),
		body: nullableStringSchema,
		state: z.string(),
		draft: z.boolean().optional().default(false),
		user: githubActorSchema.nullable().optional().transform(toNull),
		base: githubPullRefSchema,
		head: githubPullRefSchema,
		created_at: z.string(),
		updated_at: z.string(),
		closed_at: nullableStringSchema,
		merged_at: nullableStringSchema,
		html_url: z.string(),
	})
	.passthrough();

export const githubPullRequestFileSchema = z
	.object({
		sha: z.string(),
		filename: z.string(),
		status: z.string(),
		additions: z.number().int(),
		deletions: z.number().int(),
		changes: z.number().int(),
		previous_filename: nullableStringSchema,
		patch: nullableStringSchema,
	})
	.passthrough();

export const githubReviewSchema = z
	.object({
		id: z.union([z.number(), z.string()]),
		node_id: z.string(),
		user: githubActorSchema.nullable().optional().transform(toNull),
		body: nullableStringSchema,
		state: z.string(),
		html_url: z.string(),
		submitted_at: nullableStringSchema,
		commit_id: nullableStringSchema,
	})
	.passthrough();

export const githubIssueCommentSchema = z
	.object({
		id: z.union([z.number(), z.string()]),
		user: githubActorSchema.nullable().optional().transform(toNull),
		body: nullableStringSchema,
		created_at: z.string(),
		updated_at: z.string(),
		html_url: z.string(),
	})
	.passthrough();

export const githubReviewCommentSchema = githubIssueCommentSchema.extend({
	path: nullableStringSchema,
	commit_id: nullableStringSchema,
});

export const githubCheckSuiteSchema = z
	.object({
		id: z.union([z.number(), z.string()]),
		node_id: z.string(),
		head_sha: z.string(),
		head_branch: nullableStringSchema,
		status: nullableStringSchema,
		conclusion: nullableStringSchema,
		app: z
			.object({ slug: nullableStringSchema })
			.passthrough()
			.nullable()
			.optional()
			.transform(toNull),
		created_at: nullableStringSchema,
		updated_at: nullableStringSchema,
	})
	.passthrough();

export const githubCheckRunSchema = z
	.object({
		id: z.union([z.number(), z.string()]),
		node_id: z.string(),
		name: z.string(),
		head_sha: z.string(),
		status: z.string(),
		conclusion: nullableStringSchema,
		started_at: nullableStringSchema,
		completed_at: nullableStringSchema,
		details_url: nullableStringSchema,
		app: z
			.object({ slug: nullableStringSchema })
			.passthrough()
			.nullable()
			.optional()
			.transform(toNull),
	})
	.passthrough();

export const githubCheckAnnotationSchema = z
	.object({
		annotation_level: z.string(),
		blob_href: nullableStringSchema,
		end_column: z.number().int().nullable().optional().transform(toNull),
		end_line: z.number().int().nonnegative(),
		message: z.string(),
		path: z.string(),
		raw_details: nullableStringSchema,
		start_column: z.number().int().nullable().optional().transform(toNull),
		start_line: z.number().int().nonnegative(),
		title: nullableStringSchema,
	})
	.passthrough();

export const githubCommitStatusSchema = z
	.object({
		id: z.union([z.number(), z.string()]),
		node_id: z.string(),
		state: z.string(),
		context: z.string(),
		description: nullableStringSchema,
		target_url: nullableStringSchema,
		creator: githubActorSchema.nullable().optional().transform(toNull),
		created_at: z.string(),
		updated_at: z.string(),
	})
	.passthrough();

export const githubWorkflowRunSchema = z
	.object({
		id: z.union([z.number(), z.string()]),
		node_id: z.string(),
		name: nullableStringSchema,
		display_title: z.string().optional().default(""),
		workflow_id: z.union([z.number(), z.string()]),
		run_number: z.number().int(),
		run_attempt: z.number().int().optional().default(1),
		event: z.string(),
		status: nullableStringSchema,
		conclusion: nullableStringSchema,
		head_branch: nullableStringSchema,
		head_sha: z.string(),
		created_at: z.string(),
		updated_at: z.string(),
		run_started_at: nullableStringSchema,
		html_url: z.string(),
	})
	.passthrough();

export const githubWorkflowJobStepSchema = z
	.object({
		number: z.number().int(),
		name: z.string(),
		status: z.string(),
		conclusion: nullableStringSchema,
		started_at: nullableStringSchema,
		completed_at: nullableStringSchema,
	})
	.passthrough();

export const githubWorkflowJobSchema = z
	.object({
		id: z.union([z.number(), z.string()]),
		run_id: z.union([z.number(), z.string()]),
		run_attempt: nullableNumberSchema,
		name: z.string(),
		status: z.string(),
		conclusion: nullableStringSchema,
		head_sha: z.string(),
		started_at: z.string(),
		completed_at: nullableStringSchema,
		html_url: nullableStringSchema,
		labels: z.array(z.string()).default([]),
		steps: z.array(githubWorkflowJobStepSchema).optional().default([]),
	})
	.passthrough();

export const githubArtifactSchema = z
	.object({
		id: z.union([z.number(), z.string()]),
		node_id: z.string(),
		name: z.string(),
		size_in_bytes: z.number().int().nonnegative(),
		expired: z.boolean(),
		digest: nullableStringSchema,
		created_at: z.string(),
		updated_at: z.string(),
		expires_at: nullableStringSchema,
		workflow_run: z
			.object({ id: z.union([z.number(), z.string()]) })
			.passthrough()
			.nullable()
			.optional()
			.transform(toNull),
	})
	.passthrough();

export const githubCheckSuitesResponseSchema = z
	.object({ check_suites: z.array(githubCheckSuiteSchema) })
	.passthrough();
export const githubCheckRunsResponseSchema = z
	.object({ check_runs: z.array(githubCheckRunSchema) })
	.passthrough();
export const githubWorkflowRunsResponseSchema = z
	.object({ workflow_runs: z.array(githubWorkflowRunSchema) })
	.passthrough();
export const githubWorkflowJobsResponseSchema = z
	.object({ jobs: z.array(githubWorkflowJobSchema) })
	.passthrough();
export const githubArtifactsResponseSchema = z
	.object({ artifacts: z.array(githubArtifactSchema) })
	.passthrough();

function toNull<TValue>(value: TValue | null | undefined): TValue | null {
	return value ?? null;
}
