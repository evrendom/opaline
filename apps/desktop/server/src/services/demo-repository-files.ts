import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import {
	type GitHubFileSource,
	GitHubSourceError,
} from "@rudel/repo-intelligence-source-github";
import { z } from "zod";
import type { RepositoryFilesDependencies } from "./repository-files.service.js";

const SnapshotSchema = z.object({
	version: z.literal(1),
	repositories: z.array(
		z.object({
			owner: z.string(),
			name: z.string(),
			defaultBranch: z.string(),
			commitSha: z.string().regex(/^[0-9a-f]{40}$/u),
			files: z.record(z.string(), z.string()),
		}),
	),
});

export type DemoRepositorySnapshot = z.infer<typeof SnapshotSchema>;
type DemoRepository = DemoRepositorySnapshot["repositories"][number];

let bundled: Promise<DemoRepositorySnapshot> | undefined;

function loadBundledSnapshot() {
	bundled ??= readFile(
		new URL("./demo-repository-files.json.gz", import.meta.url),
	).then((bytes) =>
		SnapshotSchema.parse(JSON.parse(gunzipSync(bytes).toString("utf8"))),
	);
	return bundled;
}

export function demoRepositoryFilesDependencies(
	load: () => Promise<DemoRepositorySnapshot> = loadBundledSnapshot,
): RepositoryFilesDependencies {
	const repositoryOf = async (owner: string, name: string) =>
		(await load()).repositories.find(
			(repository) =>
				repository.owner.toLowerCase() === owner.toLowerCase() &&
				repository.name.toLowerCase() === name.toLowerCase(),
		);
	return {
		findBinding: async ({ owner, name }) => {
			const repository = await repositoryOf(owner, name);
			return repository
				? {
						defaultBranch: repository.defaultBranch,
						installationId: `${repository.owner}/${repository.name}`,
						name: repository.name,
						owner: repository.owner,
					}
				: null;
		},
		sourceFor: () => Promise.resolve(demoFileSource(repositoryOf)),
	};
}

function demoFileSource(
	repositoryOf: (
		owner: string,
		name: string,
	) => Promise<DemoRepository | undefined>,
): GitHubFileSource {
	const at = async (owner: string, name: string, commitSha?: string) => {
		const repository = await repositoryOf(owner, name);
		if (!repository || (commitSha && commitSha !== repository.commitSha))
			throw notFound(`/repos/${owner}/${name}`);
		return repository;
	};
	return {
		branchHead: async (owner, name, branch) => {
			const repository = await at(owner, name);
			if (branch !== repository.defaultBranch)
				throw notFound(`/repos/${owner}/${name}/branches/${branch}`);
			return repository.commitSha;
		},
		tree: async (owner, name, commitSha) => ({
			tree: treeEntries((await at(owner, name, commitSha)).files),
			truncated: false,
		}),
		file: async (owner, name, path, commitSha) => {
			const repository = await at(owner, name, commitSha);
			if (!Object.hasOwn(repository.files, path))
				throw notFound(`/repos/${owner}/${name}/contents/${path}`);
			const bytes = Buffer.from(repository.files[path] ?? "", "utf8");
			return {
				type: "file",
				path,
				size: bytes.byteLength,
				encoding: "base64",
				content: bytes.toString("base64"),
			};
		},
	};
}

function treeEntries(files: Readonly<Record<string, string>>) {
	const directories = new Set<string>();
	const entries: { path: string; type: "blob" | "tree"; size?: number }[] = [];
	for (const [path, content] of Object.entries(files)) {
		const parts = path.split("/");
		for (let depth = 1; depth < parts.length; depth++)
			directories.add(parts.slice(0, depth).join("/"));
		entries.push({
			path,
			type: "blob",
			size: Buffer.byteLength(content, "utf8"),
		});
	}
	for (const path of directories) entries.push({ path, type: "tree" });
	return entries.sort((left, right) => (left.path < right.path ? -1 : 1));
}

function notFound(endpoint: string) {
	return new GitHubSourceError({
		kind: "not-found",
		message: "Not in the demo repository snapshot.",
		endpoint,
		status: 404,
		requestId: null,
		retryAfterMs: null,
	});
}
