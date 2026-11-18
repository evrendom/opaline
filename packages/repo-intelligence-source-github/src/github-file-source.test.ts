import { describe, expect, test } from "bun:test";
import { createGitHubFileSource } from "./github-file-source.js";
import { createGitHubAuthorization } from "./github-transport.js";

const COMMIT = "a".repeat(40);

function sourceAnswering(bodies: Record<string, unknown>) {
	const requested: string[] = [];
	const source = createGitHubFileSource({
		authorization: createGitHubAuthorization("installation-token"),
		baseUrl: "https://api.github.example",
		maxRetries: 0,
		fetch: (async (input: string | URL | Request) => {
			const url = String(input);
			requested.push(url);
			const body = bodies[url];
			return body === undefined
				? new Response("{}", { status: 404 })
				: Response.json(body);
		}) as typeof fetch,
	});
	return { source, requested };
}

describe("GitHub file source", () => {
	test("reads the default branch head and its recursive tree", async () => {
		const { source } = sourceAnswering({
			"https://api.github.example/repos/acme/widget/branches/release%2F1": {
				commit: { sha: COMMIT },
			},
			[`https://api.github.example/repos/acme/widget/git/trees/${COMMIT}?recursive=1`]:
				{
					truncated: false,
					tree: [
						{ path: "src", type: "tree" },
						{ path: "src/index.ts", type: "blob", size: 12 },
						{ path: "vendor/lib", type: "commit" },
					],
				},
		});
		const head = await source.branchHead("acme", "widget", "release/1");
		expect(head).toBe(COMMIT);
		expect(await source.tree("acme", "widget", head)).toEqual({
			truncated: false,
			tree: [
				{ path: "src", type: "tree" },
				{ path: "src/index.ts", type: "blob", size: 12 },
				{ path: "vendor/lib", type: "commit" },
			],
		});
	});

	test("reads a file by path at a commit, encoding each segment", async () => {
		const { source, requested } = sourceAnswering({
			[`https://api.github.example/repos/acme/widget/contents/docs/read%20me%23.md?ref=${COMMIT}`]:
				{
					type: "file",
					path: "docs/read me#.md",
					size: 5,
					encoding: "base64",
					content: "aGVsbG8=\n",
				},
		});
		const file = await source.file(
			"acme",
			"widget",
			"docs/read me#.md",
			COMMIT,
		);
		expect(file.content).toBe("aGVsbG8=\n");
		expect(requested).toHaveLength(1);
	});

	test("surfaces GitHub's 404 as a not-found source error", async () => {
		const { source } = sourceAnswering({});
		await expect(
			source.branchHead("acme", "gone", "main"),
		).rejects.toMatchObject({ kind: "not-found" });
	});
});
