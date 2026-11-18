import { z } from "zod";
import type { GitHubSourceOptions } from "./github-source.js";
import {
	createGitHubTransport,
	getNextPageCursor,
} from "./github-transport.js";

const id = z.number().int().nonnegative().safe().transform(String);
const sha = z.string().regex(/^[0-9a-f]{40}$/i);
const time = z.string().datetime({ offset: true });
const actor = z
	.object({ id: id.optional(), login: z.string() })
	.nullable()
	.optional();
const prLinks = z
	.array(z.object({ number: z.number().int().positive() }))
	.default([]);

export const sweepPullRequestSchema = z.object({
	id,
	node_id: z.string().optional(),
	number: z.number().int().positive(),
	state: z.string(),
	draft: z.boolean().default(false),
	created_at: time,
	updated_at: time,
	closed_at: time.nullable().default(null),
	merged_at: time.nullable().default(null),
	head: z.object({
		sha,
		ref: z.string(),
		repo: z.object({ id }).nullable().optional(),
	}),
	base: z.object({ ref: z.string() }),
	merge_commit_sha: sha.nullable().optional(),
	user: actor,
	title: z.string(),
	labels: z.array(z.object({ name: z.string() })).default([]),
	additions: z.number().int().nullable().optional(),
	deletions: z.number().int().nullable().optional(),
	changed_files: z.number().int().nullable().optional(),
	commits: z.number().int().nullable().optional(),
	merged_by: actor,
});

export const sweepRunSchema = z.object({
	id,
	workflow_id: id.optional(),
	name: z.string().nullable().optional(),
	path: z.string().optional(),
	check_suite_id: id.nullable().optional(),
	run_number: z.number().int().optional(),
	run_attempt: z.number().int().positive().default(1),
	event: z.string().optional(),
	head_sha: sha,
	head_branch: z.string().nullable().optional(),
	status: z.string().nullable(),
	conclusion: z.string().nullable(),
	created_at: time,
	updated_at: time,
	run_started_at: time.nullable().optional(),
	actor,
	triggering_actor: actor,
	pull_requests: prLinks,
	display_title: z.string().optional(),
});

export const sweepCheckSchema = z.object({
	id,
	name: z.string().optional(),
	head_sha: sha,
	status: z.string().nullable(),
	conclusion: z.string().nullable(),
	created_at: time.optional(),
	updated_at: time.optional(),
	started_at: time.nullable().optional(),
	completed_at: time.nullable().optional(),
	head_branch: z.string().nullable().optional(),
	app: z.object({ id, slug: z.string().optional() }).nullable().optional(),
	pull_requests: prLinks,
});

export const sweepStatusSchema = z.object({
	id,
	sha: sha.optional(),
	state: z.string(),
	context: z.string(),
	description: z.string().nullable().optional(),
	created_at: time,
	updated_at: time,
	creator: actor,
});

const jobSchema = z.object({
	created_at: time.nullable().optional(),
	id,
	run_id: id,
	run_attempt: z.number().int().positive().default(1),
	name: z.string(),
	status: z.string(),
	conclusion: z.string().nullable(),
	started_at: time.nullable(),
	completed_at: time.nullable(),
	runner_id: id.nullable().optional(),
	runner_name: z.string().nullable().optional(),
	labels: z.array(z.string()).default([]),
});

export type SweepPullRequest = z.infer<typeof sweepPullRequestSchema>;
export type SweepRun = z.infer<typeof sweepRunSchema>;
export type SweepCheck = z.infer<typeof sweepCheckSchema>;
export type SweepStatus = z.infer<typeof sweepStatusSchema>;
export type SweepJob = z.infer<typeof jobSchema>;

export function createGitHubSweepSource(options: GitHubSourceOptions = {}) {
	const transport = createGitHubTransport({
		authorization: options.authorization,
		baseUrl: options.baseUrl,
		conditionalCache: undefined,
		fetch: options.fetch,
		maxResponseBytes: options.maxResponseBytes,
		maxRetries: 0,
		maxRetryDelayMs: 0,
		now: options.now,
		sleep: options.sleep,
		userAgent: options.userAgent,
	});
	async function page<TSchema extends z.ZodTypeAny>(
		path: string,
		query: Record<string, string | number>,
		schema: TSchema,
	) {
		const result = await transport.requestJson(
			path,
			{ per_page: 100, ...query },
			schema,
		);
		return {
			data: result.data,
			hasNext: getNextPageCursor(result.metadata.link) !== null,
		};
	}
	return {
		runs: (root: string, from: string, to: string, currentPage: number) =>
			page(
				`${root}/actions/runs`,
				{ created: `${from}..${to}`, page: currentPage },
				z.object({
					total_count: z.number(),
					workflow_runs: z.array(sweepRunSchema),
				}),
			),
		jobs: (root: string, runId: string, attempt: number, currentPage: number) =>
			page(
				`${root}/actions/runs/${runId}/attempts/${attempt}/jobs`,
				{ page: currentPage },
				z.object({ jobs: z.array(jobSchema) }),
			),
		attempt: async (root: string, runId: string, attempt: number) =>
			(
				await transport.requestJson(
					`${root}/actions/runs/${runId}/attempts/${attempt}`,
					{},
					sweepRunSchema,
				)
			).data,
		pulls: (root: string, currentPage: number) =>
			page(
				`${root}/pulls`,
				{ state: "all", sort: "updated", direction: "desc", page: currentPage },
				z.array(sweepPullRequestSchema),
			),
		checks: (root: string, head: string, currentPage: number) =>
			page(
				`${root}/commits/${head}/check-runs`,
				{ filter: "all", page: currentPage },
				z.object({ check_runs: z.array(sweepCheckSchema) }),
			),
		statuses: (root: string, head: string, currentPage: number) =>
			page(
				`${root}/commits/${head}/statuses`,
				{ page: currentPage },
				z.array(sweepStatusSchema),
			).then((result) => ({ ...result, data: { statuses: result.data } })),
		commits: (root: string, number: number, currentPage: number) =>
			page(
				`${root}/pulls/${number}/commits`,
				{ page: currentPage },
				z.array(z.object({ sha })),
			),
	};
}
