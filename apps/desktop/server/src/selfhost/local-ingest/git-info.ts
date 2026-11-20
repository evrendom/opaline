import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export interface GitInfo {
	readonly repositoryRoot?: string;
	readonly gitRemote?: string;
	readonly packageName?: string;
	readonly packageType?: string;
	readonly branch?: string;
	readonly sha?: string;
}

const GIT_TIMEOUT_MS = 5_000;

export function git(
	args: readonly string[],
): Promise<{ exitCode: number; stdout: string }> {
	return new Promise((done) => {
		execFile(
			"git",
			[...args],
			{
				timeout: GIT_TIMEOUT_MS,
				maxBuffer: 1024 * 1024,
				env: {
					...process.env,
					GIT_TERMINAL_PROMPT: "0",
					GIT_OPTIONAL_LOCKS: "0",
				},
			},
			(error, stdout) => {
				const code =
					error && typeof (error as { code?: unknown }).code === "number"
						? ((error as { code: number }).code ?? 1)
						: error
							? 1
							: 0;
				done({ exitCode: code, stdout: String(stdout ?? "") });
			},
		);
	});
}

export function normalizeRemoteUrl(url: string): string {
	const urlRemote = /^[a-z][a-z\d+.-]*:\/\/([^/]*)(.*)$/i.exec(url);
	const remote = urlRemote
		? `${urlRemote[1]?.replace(/^.*@/, "").replace(/:\d*$/, "")}${urlRemote[2]}`
		: url.replace(/^[^/@]+@/, "").replace(/:/, "/");
	return remote.replace(/\.git$/, "");
}

export async function getGitInfo(cwd: string): Promise<GitInfo> {
	const repositoryRoot = await getRepositoryRoot(cwd);
	const [remoteUrl, branch, sha, packageInfo] = await Promise.all([
		getGitRemoteUrl(repositoryRoot ?? cwd),
		gitOutput(["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]),
		gitOutput(["-C", cwd, "rev-parse", "HEAD"]),
		getPackageInfo(repositoryRoot ?? cwd, repositoryRoot),
	]);
	return {
		repositoryRoot,
		gitRemote: remoteUrl ? normalizeRemoteUrl(remoteUrl) : undefined,
		packageName: packageInfo?.name,
		packageType: packageInfo?.type,
		branch: branch ?? undefined,
		sha: sha ?? undefined,
	};
}

async function gitOutput(args: readonly string[]): Promise<string | null> {
	const result = await git(args);
	return result.exitCode === 0 ? result.stdout.trim() : null;
}

async function getRepositoryRoot(cwd: string): Promise<string | undefined> {
	let directory = resolve(cwd);
	while (!(await stat(directory).catch(() => null))?.isDirectory()) {
		const parent = dirname(directory);
		if (parent === directory) return undefined;
		directory = parent;
	}
	const result = await git([
		"-C",
		directory,
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir",
		"--show-toplevel",
	]);
	if (result.exitCode !== 0) return undefined;
	const [commonDirectory, worktreeRoot] = result.stdout.trim().split("\n");
	if (!commonDirectory || !worktreeRoot) return undefined;
	return basename(commonDirectory) === ".git"
		? dirname(commonDirectory)
		: worktreeRoot;
}

export async function getGitRemoteUrl(cwd: string): Promise<string | null> {
	const remote = await gitOutput(["-C", cwd, "remote", "get-url", "origin"]);
	return remote || null;
}

interface PackageInfo {
	readonly name: string;
	readonly type: string;
}

async function getPackageInfo(
	cwd: string,
	repositoryRoot: string | undefined,
): Promise<PackageInfo | null> {
	const root =
		repositoryRoot ??
		(await gitOutput(["-C", cwd, "rev-parse", "--show-toplevel"])) ??
		cwd;
	return (
		readPackage(root, "package.json", (text) => {
			const name = (JSON.parse(text) as { name?: unknown }).name;
			return typeof name === "string" && name ? name : undefined;
		}) ??
		readPackage(
			root,
			"pyproject.toml",
			(text) => text.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1],
		) ??
		readPackage(
			root,
			"Cargo.toml",
			(text) => text.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1],
		) ??
		readPackage(root, "go.mod", (text) => text.match(/^module\s+(\S+)/m)?.[1])
	);
}

function readPackage(
	root: string,
	file: string,
	name: (text: string) => string | undefined,
): PackageInfo | null {
	try {
		const path = join(root, file);
		if (!existsSync(path)) return null;
		const found = name(readFileSync(path, "utf-8"));
		return found ? { name: found, type: file } : null;
	} catch {
		return null;
	}
}
