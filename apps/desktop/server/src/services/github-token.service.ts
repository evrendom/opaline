import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { GITHUB_REST_API_VERSION } from "@rudel/repo-intelligence-source-github";
import {
	DEFAULT_GITHUB_HISTORY_DAYS,
	isSelfHosted,
	parseGitHubHistoryDays,
} from "../lib/self-hosted.js";

type Environment = Readonly<Record<string, string | undefined>>;

const DEFAULT_HOST = "github.com";
const GH_TIMEOUT_MS = 10_000;
const GH_FALLBACK_BINARIES = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"];
const TOKEN_TTL_MS = 60_000;
const IDENTITY_TTL_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const REQUIRED_SCOPE = "repo";

export type GitHubTokenSource = "GITHUB_TOKEN" | "GH_TOKEN" | "gh";

export interface GitHubTokenCredentials {
	readonly kind: "token";
	readonly host: string;
	readonly apiBaseUrl: string;
	readonly read: () => Promise<string>;
}

export type GitHubRepositoryCredentials = GitHubTokenCredentials;

export type GitHubTokenResolution =
	| { readonly token: string; readonly source: GitHubTokenSource }
	| { readonly problem: "gh-missing" | "gh-signed-out" | "gh-failed" };

export type GhAuthTokenResult =
	| { readonly status: "ok"; readonly token: string }
	| { readonly status: "missing" | "signed-out" | "failed" };

export type GhAuthToken = (
	host: string,
	env: Environment,
) => Promise<GhAuthTokenResult>;

export interface GitHubRateLimit {
	readonly limit: number;
	readonly remaining: number;
	readonly resetAt: string;
}

export interface GitHubTokenIdentity {
	readonly login: string;
	readonly id: string;
	readonly scopes: readonly string[] | null;
}

export type GitHubTokenInspection =
	| {
			readonly status: "ok";
			readonly identity: GitHubTokenIdentity;
			readonly rateLimit: GitHubRateLimit | null;
	  }
	| { readonly status: "rejected"; readonly rateLimit: GitHubRateLimit | null }
	| {
			readonly status: "unreachable";
			readonly detail: string;
			readonly rateLimit: GitHubRateLimit | null;
	  };

export interface GitHubTokenStatus {
	readonly state: "ready" | "missing" | "rejected" | "unreachable";
	readonly source: GitHubTokenSource | null;
	readonly host: string;
	readonly login: string | null;
	readonly accountId: string | null;
	readonly scopes: readonly string[] | null;
	readonly missingScopes: readonly string[];
	readonly rateLimit: GitHubRateLimit | null;
	readonly message: string | null;
	readonly fix: string | null;
	readonly checkedAt: string;
}

export class GitHubTokenUnavailableError extends Error {
	constructor() {
		super("No GitHub token is available to this server.");
		this.name = "GitHubTokenUnavailableError";
	}
}

export function readGitHubHost(env: Environment = process.env): string {
	const raw = env.GH_HOST?.trim().toLowerCase();
	if (!raw) return DEFAULT_HOST;
	const host = raw.replace(/^https?:\/\//u, "").replace(/\/.*$/u, "");
	return /^[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?$/u.test(host)
		? host
		: DEFAULT_HOST;
}

export function gitHubApiBaseUrl(host: string): string {
	if (host === DEFAULT_HOST) return "https://api.github.com";
	if (host.endsWith(".ghe.com")) return `https://api.${host}`;
	return `https://${host}/api/v3`;
}

export function readGitHubHistoryDays(env: Environment = process.env): number {
	return (
		parseGitHubHistoryDays(env.OPALINE_GITHUB_HISTORY_DAYS) ??
		DEFAULT_GITHUB_HISTORY_DAYS
	);
}

export function isGitHubRepositoryCollectionConfigured(
	env: Environment = process.env,
): boolean {
	return isSelfHosted(env);
}

export async function readGitHubRepositoryCredentials(
	env: Environment = process.env,
): Promise<GitHubRepositoryCredentials | null> {
	if (!isSelfHosted(env)) return null;
	return readResolvedGitHubTokenCredentials(env);
}

export async function readResolvedGitHubTokenCredentials(
	env: Environment = process.env,
): Promise<GitHubTokenCredentials | null> {
	const resolution = await readGitHubToken(env);
	if (!("token" in resolution)) return null;
	const host = readGitHubHost(env);
	return {
		kind: "token",
		host,
		apiBaseUrl: gitHubApiBaseUrl(host),
		read: async () => resolution.token,
	};
}

export async function resolveGitHubToken(
	env: Environment = process.env,
	ghAuthToken: GhAuthToken = runGhAuthToken,
): Promise<GitHubTokenResolution> {
	for (const source of ["GITHUB_TOKEN", "GH_TOKEN"] as const) {
		const value = env[source]?.trim();
		if (value) return { token: value, source };
	}
	const result = await ghAuthToken(readGitHubHost(env), env);
	return result.status === "ok"
		? { token: result.token, source: "gh" }
		: { problem: `gh-${result.status}` };
}

let tokenCache:
	| { readonly at: number; readonly resolution: Promise<GitHubTokenResolution> }
	| undefined;

export function readGitHubToken(
	env: Environment = process.env,
	now = Date.now(),
): Promise<GitHubTokenResolution> {
	if (tokenCache && now - tokenCache.at < TOKEN_TTL_MS)
		return tokenCache.resolution;
	const resolution = resolveGitHubToken(env);
	tokenCache = { at: now, resolution };
	return resolution;
}

export function forgetGitHubTokenForTests(): void {
	tokenCache = undefined;
	identityCache = undefined;
	observedRateLimit = undefined;
}

export function createGhAuthToken(binaries: readonly string[]): GhAuthToken {
	return async (host, env) => {
		for (const binary of binaries) {
			const result = await execGhAuthToken(binary, host, env);
			if (result.status !== "missing") return result;
		}
		return { status: "missing" };
	};
}

export const runGhAuthToken = createGhAuthToken([
	"gh",
	...GH_FALLBACK_BINARIES,
]);

function execGhAuthToken(
	binary: string,
	host: string,
	env: Environment,
): Promise<GhAuthTokenResult> {
	return new Promise((resolve) => {
		execFile(
			binary,
			["auth", "token", "--hostname", host],
			{
				env: {
					...(env as NodeJS.ProcessEnv),
					GH_PROMPT_DISABLED: "1",
					GH_NO_UPDATE_NOTIFIER: "1",
				},
				maxBuffer: 64 * 1024,
				timeout: GH_TIMEOUT_MS,
				windowsHide: true,
			},
			(error, stdout) => {
				if (error) {
					const code = (error as NodeJS.ErrnoException).code;
					if (code === "ENOENT" || code === "EACCES")
						resolve({ status: "missing" });
					else if ((error as { killed?: boolean }).killed)
						resolve({ status: "failed" });
					else resolve({ status: "signed-out" });
					return;
				}
				const token = String(stdout).trim();
				resolve(
					/^[\x21-\x7e]+$/u.test(token)
						? { status: "ok", token }
						: { status: "signed-out" },
				);
			},
		);
	});
}

export function gitHubTokenHeaders(token: string): Record<string, string> {
	return {
		Accept: "application/vnd.github+json",
		Authorization: `Bearer ${token}`,
		"User-Agent": "opaline-repository-evidence/1",
		"X-GitHub-Api-Version": GITHUB_REST_API_VERSION,
	};
}

export function readGitHubRateLimit(headers: Headers): GitHubRateLimit | null {
	const limit = Number(headers.get("x-ratelimit-limit"));
	const remaining = Number(headers.get("x-ratelimit-remaining"));
	const reset = Number(headers.get("x-ratelimit-reset"));
	if (
		!headers.has("x-ratelimit-remaining") ||
		!Number.isFinite(limit) ||
		!Number.isFinite(remaining) ||
		!Number.isFinite(reset) ||
		reset <= 0
	)
		return null;
	return {
		limit,
		remaining,
		resetAt: new Date(reset * 1000).toISOString(),
	};
}

let observedRateLimit:
	| { readonly at: number; readonly rateLimit: GitHubRateLimit }
	| undefined;

export function noteGitHubRateLimit(headers: Headers, now = Date.now()): void {
	const rateLimit = readGitHubRateLimit(headers);
	if (rateLimit) observedRateLimit = { at: now, rateLimit };
}

export function observingGitHubFetch(
	requestFetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
	return Object.assign(
		async (url: string | URL | Request, init?: RequestInit) => {
			const response = await requestFetch(url, init);
			noteGitHubRateLimit(response.headers);
			return response;
		},
		{ preconnect: requestFetch.preconnect },
	);
}

export async function inspectGitHubToken(input: {
	readonly token: string;
	readonly apiBaseUrl: string;
	readonly fetch?: typeof globalThis.fetch;
}): Promise<GitHubTokenInspection> {
	let response: Response;
	try {
		response = await (input.fetch ?? globalThis.fetch)(
			`${input.apiBaseUrl}/user`,
			{
				headers: gitHubTokenHeaders(input.token),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			},
		);
	} catch {
		return {
			status: "unreachable",
			detail: `no answer from ${new URL(input.apiBaseUrl).host}`,
			rateLimit: null,
		};
	}
	const rateLimit = readGitHubRateLimit(response.headers);
	if (response.status === 401) {
		await response.body?.cancel();
		return { status: "rejected", rateLimit };
	}
	if (!response.ok) {
		await response.body?.cancel();
		return {
			status: "unreachable",
			detail:
				rateLimit?.remaining === 0
					? `rate limited until ${rateLimit.resetAt}`
					: `HTTP ${response.status} from ${new URL(input.apiBaseUrl).host}`,
			rateLimit,
		};
	}
	const body: unknown = await response.json().catch(() => null);
	if (
		typeof body !== "object" ||
		body === null ||
		typeof Reflect.get(body, "login") !== "string" ||
		typeof Reflect.get(body, "id") !== "number"
	)
		return {
			status: "unreachable",
			detail: "an unexpected answer to GET /user",
			rateLimit,
		};
	const scopes = response.headers.get("x-oauth-scopes");
	return {
		status: "ok",
		identity: {
			login: String(Reflect.get(body, "login")),
			id: String(Reflect.get(body, "id")),
			scopes:
				scopes === null
					? null
					: scopes
							.split(",")
							.map((scope) => scope.trim())
							.filter(Boolean),
		},
		rateLimit,
	};
}

let identityCache:
	| {
			readonly at: number;
			readonly fingerprint: string;
			readonly inspection: Promise<GitHubTokenInspection>;
	  }
	| undefined;

export function readGitHubTokenInspection(input: {
	readonly token: string;
	readonly apiBaseUrl: string;
	readonly fetch?: typeof globalThis.fetch;
	readonly now?: number;
}): Promise<GitHubTokenInspection> {
	const now = input.now ?? Date.now();
	const fingerprint = createHash("sha256")
		.update(`${input.apiBaseUrl}\0${input.token}`)
		.digest("hex");
	if (
		identityCache &&
		identityCache.fingerprint === fingerprint &&
		now - identityCache.at < IDENTITY_TTL_MS
	)
		return identityCache.inspection;
	const inspection = inspectGitHubToken(input).then((result) => {
		if (result.status !== "ok" && identityCache?.fingerprint === fingerprint)
			identityCache = { ...identityCache, at: 0 };
		if (result.rateLimit)
			observedRateLimit = { at: now, rateLimit: result.rateLimit };
		return result;
	});
	identityCache = { at: now, fingerprint, inspection };
	return inspection;
}

export async function readGitHubTokenStatus(
	options: {
		readonly env?: Environment;
		readonly fetch?: typeof globalThis.fetch;
		readonly now?: () => Date;
		readonly resolve?: (env: Environment) => Promise<GitHubTokenResolution>;
	} = {},
): Promise<GitHubTokenStatus> {
	const env = options.env ?? process.env;
	const now = options.now ?? (() => new Date());
	const host = readGitHubHost(env);
	const resolution = await (options.resolve ?? readGitHubToken)(env);
	const base = {
		host,
		checkedAt: now().toISOString(),
		login: null,
		accountId: null,
		scopes: null,
		missingScopes: [],
	};
	if (!("token" in resolution))
		return {
			...base,
			state: "missing",
			source: null,
			rateLimit: null,
			...describeMissingToken(resolution.problem, host),
		};
	const inspection = await readGitHubTokenInspection({
		token: resolution.token,
		apiBaseUrl: gitHubApiBaseUrl(host),
		fetch: options.fetch,
		now: now().getTime(),
	});
	const rateLimit = latestRateLimit(inspection.rateLimit, now());
	if (inspection.status === "rejected")
		return {
			...base,
			state: "rejected",
			source: resolution.source,
			rateLimit,
			message:
				resolution.source === "gh"
					? `GitHub rejected the GitHub CLI's token for ${host}.`
					: `GitHub rejected the token in ${resolution.source}. Replace it with a valid token that has the repo scope and restart the server.`,
			fix: resolution.source === "gh" ? ghLoginCommand(host) : null,
		};
	if (inspection.status === "unreachable")
		return {
			...base,
			state: "unreachable",
			source: resolution.source,
			rateLimit,
			message: `GitHub could not be asked who the token belongs to: ${inspection.detail}.`,
			fix: null,
		};
	const { identity } = inspection;
	const missingScopes =
		identity.scopes === null || identity.scopes.includes(REQUIRED_SCOPE)
			? []
			: [REQUIRED_SCOPE];
	return {
		...base,
		state: "ready",
		source: resolution.source,
		login: identity.login,
		accountId: identity.id,
		scopes: identity.scopes,
		missingScopes,
		rateLimit,
		message:
			missingScopes.length > 0
				? "The token has no repo scope, so private repositories and their CI logs cannot be read."
				: null,
		fix:
			missingScopes.length > 0 && resolution.source === "gh"
				? `gh auth refresh${host === DEFAULT_HOST ? "" : ` --hostname ${host}`} --scopes repo`
				: null,
	};
}

export function describeGitHubTokenStatus(status: GitHubTokenStatus): string {
	if (status.state !== "ready")
		return `${status.message ?? "no token"}${status.fix ? ` Fix: ${status.fix}` : ""}`;
	const via =
		status.source === "gh"
			? "the GitHub CLI (gh)"
			: `the ${status.source} variable`;
	const scopes =
		status.scopes === null
			? "a token without classic scopes"
			: `scopes ${status.scopes.join(", ") || "none"}`;
	return `token from ${via} for ${status.login} on ${status.host}, ${scopes}${status.message ? `. ${status.message}${status.fix ? ` Fix: ${status.fix}` : ""}` : ""}`;
}

function latestRateLimit(
	fromInspection: GitHubRateLimit | null,
	now: Date,
): GitHubRateLimit | null {
	const rateLimit = observedRateLimit?.rateLimit ?? fromInspection;
	if (!rateLimit || Date.parse(rateLimit.resetAt) > now.getTime())
		return rateLimit;
	return { ...rateLimit, remaining: rateLimit.limit };
}

function ghLoginCommand(host: string): string {
	return `gh auth login${host === DEFAULT_HOST ? "" : ` --hostname ${host}`} --scopes repo`;
}

function describeMissingToken(
	problem: "gh-missing" | "gh-signed-out" | "gh-failed",
	host: string,
): { message: string; fix: string } {
	if (problem === "gh-missing")
		return {
			message:
				"No GitHub token: GITHUB_TOKEN and GH_TOKEN are not set, and the GitHub CLI (gh) is not installed where the server runs. Install gh and sign in, or set GITHUB_TOKEN in the server's environment.",
			fix: ghLoginCommand(host),
		};
	if (problem === "gh-failed")
		return {
			message: `The GitHub CLI did not answer within ${GH_TIMEOUT_MS / 1000} seconds.`,
			fix: `gh auth status${host === DEFAULT_HOST ? "" : ` --hostname ${host}`}`,
		};
	return {
		message: `No GitHub token: GITHUB_TOKEN and GH_TOKEN are not set, and the GitHub CLI is not signed in to ${host}.`,
		fix: ghLoginCommand(host),
	};
}
