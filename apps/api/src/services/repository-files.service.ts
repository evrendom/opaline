import type {
	RepositoryFile,
	RepositoryFiles,
	RepositoryTreeEntry,
} from "@rudel/api-routes";
import {
	createGitHubAuthorization,
	createGitHubFileSource,
	type GitHubFileSource,
	GitHubSourceError,
} from "@rudel/repo-intelligence-source-github";
import {
	isHighRiskCredentialPath,
	redactReturnedText,
} from "@rudel/secret-filter";
import type postgres from "postgres";
import { readGitHubSyncSkippedOrgIds } from "../lib/env.js";
import { demoRepositoryFilesDependencies } from "./demo-repository-files.js";
import {
	createGitHubInstallationAccessToken,
	type GitHubRepositoryAppConfig,
	readGitHubRepositoryAppConfig,
} from "./github-app.service.js";

// Both caps keep a response well under the API's 3.75 MB limit.
export const MAX_TREE_ENTRIES = 20_000;
export const MAX_FILE_BYTES = 512 * 1024;
// Installation tokens live an hour; renew well before GitHub expires them.
const TOKEN_TTL_MS = 50 * 60_000;

interface RepositoryFilesBinding {
	readonly defaultBranch: string;
	readonly installationId: string;
	readonly name: string;
	readonly owner: string;
}

export interface RepositoryFilesDependencies {
	readonly findBinding: (input: {
		organizationId: string;
		owner: string;
		name: string;
	}) => Promise<RepositoryFilesBinding | null>;
	readonly sourceFor: (
		installationId: string,
	) => Promise<GitHubFileSource> | null;
}

const UNAVAILABLE = (
	reason: "not-github" | "not-connected" | "unreachable",
) => ({ status: "unavailable" as const, reason });

export function parseGitHubRepoKey(repoKey: string) {
	const match = /^remote:github\.com\/([^/]+)\/([^/]+)$/iu.exec(repoKey);
	return match?.[1] && match[2] ? { owner: match[1], name: match[2] } : null;
}

export async function listRepositoryFiles(
	input: { organizationId: string; repoKey: string },
	deps: RepositoryFilesDependencies = dependenciesFor(input.organizationId),
): Promise<RepositoryFiles> {
	const located = await locate(input, deps);
	if ("status" in located) return located;
	const { binding, source } = located;
	return readOrUnreachable(async () => {
		const commitSha = await source.branchHead(
			binding.owner,
			binding.name,
			binding.defaultBranch,
		);
		const tree = await source.tree(binding.owner, binding.name, commitSha);
		const entries: RepositoryTreeEntry[] = [];
		for (const entry of tree.tree) {
			if (entry.type === "commit") continue;
			entries.push({
				path: entry.path,
				type: entry.type === "tree" ? "dir" : "file",
				size: entry.type === "blob" ? (entry.size ?? null) : null,
			});
		}
		return {
			status: "available" as const,
			repository: {
				owner: binding.owner,
				name: binding.name,
				branch: binding.defaultBranch,
				commitSha,
			},
			entries: entries.slice(0, MAX_TREE_ENTRIES),
			truncated: tree.truncated || entries.length > MAX_TREE_ENTRIES,
		};
	});
}

export async function readRepositoryFile(
	input: {
		organizationId: string;
		repoKey: string;
		path: string;
		commitSha: string;
	},
	deps: RepositoryFilesDependencies = dependenciesFor(input.organizationId),
): Promise<RepositoryFile> {
	if (isHighRiskCredentialPath(input.path))
		return { status: "withheld", path: input.path, size: null };
	const located = await locate(input, deps);
	if ("status" in located) return located;
	const { binding, source } = located;
	return readOrUnreachable(async () => {
		const file = await source.file(
			binding.owner,
			binding.name,
			input.path,
			input.commitSha,
		);
		if (file.size > MAX_FILE_BYTES || file.encoding !== "base64")
			return { status: "too-large", path: input.path, size: file.size };
		const bytes = Buffer.from(file.content, "base64");
		if (isBinary(bytes))
			return { status: "binary", path: input.path, size: file.size };
		return {
			status: "text",
			path: input.path,
			size: file.size,
			content: redactReturnedText(bytes.toString("utf8")),
		};
	});
}

async function locate(
	input: { organizationId: string; repoKey: string },
	deps: RepositoryFilesDependencies,
) {
	const repo = parseGitHubRepoKey(input.repoKey);
	if (!repo) return UNAVAILABLE("not-github");
	const binding = await deps.findBinding({
		organizationId: input.organizationId,
		...repo,
	});
	const source = binding ? deps.sourceFor(binding.installationId) : null;
	if (!binding || !source) return UNAVAILABLE("not-connected");
	return { binding, source: await source };
}

async function readOrUnreachable<T>(
	read: () => Promise<T>,
): Promise<T | ReturnType<typeof UNAVAILABLE>> {
	try {
		return await read();
	} catch (error) {
		if (
			error instanceof GitHubSourceError &&
			(error.kind === "not-found" ||
				error.kind === "forbidden" ||
				error.status === 409)
		)
			return UNAVAILABLE("unreachable");
		throw error;
	}
}

/** Git's own heuristic: a NUL byte in the first 8 KB. */
function isBinary(bytes: Uint8Array) {
	return bytes.subarray(0, 8000).includes(0);
}

const tokens = new Map<string, { token: Promise<string>; expiresAt: number }>();

function dependenciesFor(organizationId: string): RepositoryFilesDependencies {
	return readGitHubSyncSkippedOrgIds().includes(organizationId)
		? demoRepositoryFilesDependencies()
		: defaultDependencies();
}

function defaultDependencies(): RepositoryFilesDependencies {
	return {
		findBinding: async (input) => {
			const { sqlClient } = await import("../db.js");
			return findGitHubRepositoryBindingByName(sqlClient, input);
		},
		sourceFor: (installationId) => {
			const config = readGitHubRepositoryAppConfig();
			if (!config) return null;
			return installationToken(config, installationId).then((token) =>
				createGitHubFileSource({
					authorization: createGitHubAuthorization(token),
				}),
			);
		},
	};
}

function installationToken(
	config: GitHubRepositoryAppConfig,
	installationId: string,
) {
	const cached = tokens.get(installationId);
	if (cached && cached.expiresAt > Date.now()) return cached.token;
	const token = createGitHubInstallationAccessToken({ config, installationId });
	tokens.set(installationId, {
		token,
		expiresAt: Date.now() + TOKEN_TTL_MS,
	});
	token.catch(() => tokens.delete(installationId));
	return token;
}

async function findGitHubRepositoryBindingByName(
	database: postgres.Sql,
	input: { organizationId: string; owner: string; name: string },
): Promise<RepositoryFilesBinding | null> {
	const rows = await database.unsafe<
		Array<{
			default_branch: string;
			installation_id: string;
			name: string;
			owner: string;
		}>
	>(
		"SELECT binding.installation_id, binding.owner, binding.name, binding.default_branch FROM github_repository_binding binding INNER JOIN github_app_installation installation ON installation.installation_id = binding.installation_id WHERE binding.organization_id = $1 AND lower(binding.owner) = lower($2) AND lower(binding.name) = lower($3) AND binding.status = 'active' AND installation.status = 'active' LIMIT 1",
		[input.organizationId, input.owner, input.name],
	);
	const row = rows[0];
	return row
		? {
				defaultBranch: row.default_branch,
				installationId: row.installation_id,
				name: row.name,
				owner: row.owner,
			}
		: null;
}
