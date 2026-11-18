import { describe, expect, test } from "bun:test";
import {
	type GitHubFileSource,
	GitHubSourceError,
} from "@rudel/repo-intelligence-source-github";
import {
	listRepositoryFiles,
	MAX_FILE_BYTES,
	MAX_TREE_ENTRIES,
	parseGitHubRepoKey,
	type RepositoryFilesDependencies,
	readRepositoryFile,
} from "./repository-files.service.js";

const COMMIT = "c".repeat(40);
const REPO_KEY = "remote:github.com/Acme/Widget";
const BINDING = {
	defaultBranch: "main",
	installationId: "42",
	name: "widget",
	owner: "acme",
};

function deps(
	source: Partial<GitHubFileSource>,
	binding: typeof BINDING | null = BINDING,
): RepositoryFilesDependencies & { lookups: unknown[] } {
	const lookups: unknown[] = [];
	return {
		lookups,
		findBinding: async (input) => {
			lookups.push(input);
			return binding;
		},
		sourceFor: async () => source as GitHubFileSource,
	};
}

function base64(text: string | Uint8Array) {
	return Buffer.from(text).toString("base64");
}

function notFound() {
	return new GitHubSourceError({
		kind: "not-found",
		message: "gone",
		endpoint: "/repos/acme/widget",
		status: 404,
		requestId: null,
		retryAfterMs: null,
	});
}

describe("parseGitHubRepoKey", () => {
	test("reads owner and name from a github.com remote key only", () => {
		expect(parseGitHubRepoKey("remote:github.com/acme/widget")).toEqual({
			owner: "acme",
			name: "widget",
		});
		expect(parseGitHubRepoKey("remote:gitlab.com/acme/widget")).toBeNull();
		expect(parseGitHubRepoKey("path:/Users/me/widget")).toBeNull();
		expect(
			parseGitHubRepoKey("remote:github.com/acme/widget/extra"),
		).toBeNull();
	});
});

describe("listRepositoryFiles", () => {
	test("lists the default branch head's files and directories, skipping submodules", async () => {
		const dependencies = deps({
			branchHead: async () => COMMIT,
			tree: async () => ({
				truncated: false,
				tree: [
					{ path: "src", type: "tree" },
					{ path: "src/index.ts", type: "blob", size: 120 },
					{ path: "vendor/lib", type: "commit" },
				],
			}),
		});
		const files = await listRepositoryFiles(
			{ organizationId: "org", repoKey: REPO_KEY },
			dependencies,
		);
		expect(dependencies.lookups).toEqual([
			{ organizationId: "org", owner: "Acme", name: "Widget" },
		]);
		expect(files).toEqual({
			status: "available",
			repository: {
				owner: "acme",
				name: "widget",
				branch: "main",
				commitSha: COMMIT,
			},
			entries: [
				{ path: "src", type: "dir", size: null },
				{ path: "src/index.ts", type: "file", size: 120 },
			],
			truncated: false,
		});
	});

	test("caps the tree and marks it truncated", async () => {
		const files = await listRepositoryFiles(
			{ organizationId: "org", repoKey: REPO_KEY },
			deps({
				branchHead: async () => COMMIT,
				tree: async () => ({
					truncated: false,
					tree: Array.from({ length: MAX_TREE_ENTRIES + 1 }, (_, index) => ({
						path: `f${index}`,
						type: "blob" as const,
						size: 1,
					})),
				}),
			}),
		);
		expect(files.status === "available" && files.entries.length).toBe(
			MAX_TREE_ENTRIES,
		);
		expect(files.status === "available" && files.truncated).toBe(true);
	});

	test("explains repos it can't read", async () => {
		const input = { organizationId: "org", repoKey: REPO_KEY };
		expect(
			await listRepositoryFiles(
				{ organizationId: "org", repoKey: "path:/tmp/widget" },
				deps({}),
			),
		).toEqual({ status: "unavailable", reason: "not-github" });
		expect(await listRepositoryFiles(input, deps({}, null))).toEqual({
			status: "unavailable",
			reason: "not-connected",
		});
		expect(
			await listRepositoryFiles(input, {
				findBinding: async () => BINDING,
				sourceFor: () => null,
			}),
		).toEqual({ status: "unavailable", reason: "not-connected" });
		expect(
			await listRepositoryFiles(
				input,
				deps({
					branchHead: async () => {
						throw notFound();
					},
				}),
			),
		).toEqual({ status: "unavailable", reason: "unreachable" });
	});

	test("lets rate limits and outages fail so the client can retry", async () => {
		const rateLimited = new GitHubSourceError({
			kind: "rate-limit",
			message: "slow down",
			endpoint: "/repos/acme/widget",
			status: 429,
			requestId: null,
			retryAfterMs: 1000,
		});
		await expect(
			listRepositoryFiles(
				{ organizationId: "org", repoKey: REPO_KEY },
				deps({
					branchHead: async () => {
						throw rateLimited;
					},
				}),
			),
		).rejects.toBe(rateLimited);
	});
});

describe("readRepositoryFile", () => {
	const input = {
		organizationId: "org",
		repoKey: REPO_KEY,
		path: "src/config.ts",
		commitSha: COMMIT,
	};
	const answering = (content: string, size: number, encoding = "base64") =>
		deps({
			file: async (_owner, _name, path) => ({
				type: "file",
				path,
				size,
				encoding,
				content,
			}),
		});

	test("decodes text and redacts credentials in it", async () => {
		const text =
			'export const port = 3000;\nconst password = "hunter2-secret";\n';
		expect(
			await readRepositoryFile(input, answering(base64(text), text.length)),
		).toEqual({
			status: "text",
			path: "src/config.ts",
			size: text.length,
			content: 'export const port = 3000;\nconst password = "[redacted]";\n',
		});
	});

	test("withholds credential files without asking GitHub", async () => {
		const dependencies = answering(base64("TOKEN=x"), 7);
		expect(
			await readRepositoryFile(
				{ ...input, path: "apps/api/.env.production" },
				dependencies,
			),
		).toEqual({
			status: "withheld",
			path: "apps/api/.env.production",
			size: null,
		});
		expect(dependencies.lookups).toEqual([]);
	});

	test("returns only the size of binary and oversized files", async () => {
		expect(
			await readRepositoryFile(
				input,
				answering(base64(new Uint8Array([137, 80, 78, 71, 0, 1])), 6),
			),
		).toEqual({ status: "binary", path: "src/config.ts", size: 6 });
		expect(
			await readRepositoryFile(input, answering("", 3_000_000, "none")),
		).toEqual({ status: "too-large", path: "src/config.ts", size: 3_000_000 });
		expect(
			await readRepositoryFile(
				input,
				answering(base64("x"), MAX_FILE_BYTES + 1),
			),
		).toEqual({
			status: "too-large",
			path: "src/config.ts",
			size: MAX_FILE_BYTES + 1,
		});
	});
});
