import { z } from "zod";
import type { GitHubSourceOptions } from "./github-source.js";
import { createGitHubTransport } from "./github-transport.js";

const sha = z.string().regex(/^[0-9a-f]{40}$/i);

const branchSchema = z.object({ commit: z.object({ sha }) });

const treeSchema = z.object({
	tree: z.array(
		z.object({
			path: z.string(),
			// `commit` entries are submodules.
			type: z.enum(["blob", "tree", "commit"]),
			size: z.number().int().nonnegative().optional(),
		}),
	),
	truncated: z.boolean(),
});

// Above 1 MB GitHub answers with `encoding: "none"` and no content.
const contentSchema = z.object({
	type: z.literal("file"),
	path: z.string(),
	size: z.number().int().nonnegative(),
	encoding: z.string(),
	content: z.string(),
});

export type GitHubTreeEntry = z.infer<typeof treeSchema>["tree"][number];
export type GitHubFileContent = z.infer<typeof contentSchema>;

export function createGitHubFileSource(options: GitHubSourceOptions = {}) {
	const transport = createGitHubTransport({
		authorization: options.authorization,
		baseUrl: options.baseUrl,
		conditionalCache: undefined,
		fetch: options.fetch,
		maxResponseBytes: options.maxResponseBytes,
		maxRetries: options.maxRetries,
		maxRetryDelayMs: options.maxRetryDelayMs,
		now: options.now,
		sleep: options.sleep,
		userAgent: options.userAgent,
	});
	const root = (owner: string, name: string) =>
		`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
	return {
		branchHead: async (owner: string, name: string, branch: string) =>
			(
				await transport.requestJson(
					`${root(owner, name)}/branches/${encodeURIComponent(branch)}`,
					{},
					branchSchema,
				)
			).data.commit.sha,
		tree: async (owner: string, name: string, commitSha: string) =>
			(
				await transport.requestJson(
					`${root(owner, name)}/git/trees/${encodeURIComponent(commitSha)}`,
					{ recursive: 1 },
					treeSchema,
				)
			).data,
		file: async (
			owner: string,
			name: string,
			path: string,
			commitSha: string,
		): Promise<GitHubFileContent> =>
			(
				await transport.requestJson(
					`${root(owner, name)}/contents/${path
						.split("/")
						.map(encodeURIComponent)
						.join("/")}`,
					{ ref: commitSha },
					contentSchema,
				)
			).data,
	};
}

export type GitHubFileSource = ReturnType<typeof createGitHubFileSource>;
