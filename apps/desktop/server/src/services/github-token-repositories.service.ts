import { getLogger } from "@logtape/logtape";
import type postgres from "postgres";
import { queryClickhouse } from "../clickhouse.js";
import { readGitHubSyncSkippedOrgIds } from "../lib/env.js";
import { refreshPrTotalsReadiness } from "./github-outcomes-readiness.service.js";
import {
	enqueueGitHubRepositorySweep,
	runGitHubRepositorySweep,
} from "./github-repository-sweep.service.js";
import {
	gitHubApiBaseUrl,
	gitHubTokenHeaders,
	observingGitHubFetch,
	readGitHubHistoryDays,
	readGitHubHost,
	readGitHubToken,
	readGitHubTokenInspection,
} from "./github-token.service.js";
import {
	enqueueL1EdgeDependents,
	enqueueL1EdgeScope,
} from "./l1-edges/l1-edge-queue.service.js";

type Environment = Readonly<Record<string, string | undefined>>;

const logger = getLogger(["rudel", "api", "github-token"]);
const TOKEN_INSTALLATION_PREFIX = "token:";
const RECHECK_MS = 6 * 3_600_000;
const DISCOVERY_INTERVAL_MS = 60_000;
const MAX_CHECKS_PER_PASS = 50;
const REQUEST_TIMEOUT_MS = 15_000;

export interface SessionRepository {
	readonly organizationId: string;
	readonly fullName: string;
}

export interface GitHubTokenAccount {
	readonly login: string;
	readonly id: string;
}

interface ReadableRepository {
	readonly id: string;
	readonly nodeId: string;
	readonly owner: string;
	readonly name: string;
	readonly fullName: string;
	readonly defaultBranch: string;
	readonly isPrivate: boolean;
}

type RepositoryCheck =
	| { readonly status: "readable"; readonly repository: ReadableRepository }
	| { readonly status: "unreadable" }
	| {
			readonly status: "stop";
			readonly reason: "rejected" | "rate-limited" | "unreachable";
	  };

export interface GitHubTokenBindResult {
	readonly bound: readonly string[];
	readonly unreadable: readonly string[];
	readonly reopened: number;
	readonly stopped: "rejected" | "rate-limited" | "unreachable" | null;
}

export interface GitHubTokenCollection {
	readonly repositories: number;
	readonly unreadable: readonly string[];
	readonly discoveredAt: string | null;
	readonly lastSweepAt: string | null;
	readonly pausedUntil: string | null;
}

const checkedAt = new Map<string, number>();
const unreadableByOrganization = new Map<string, readonly string[]>();
let discoveredAt: string | null = null;
let lastDiscoveryAt = 0;

export function forgetGitHubTokenDiscoveryForTests(): void {
	checkedAt.clear();
	unreadableByOrganization.clear();
	discoveredAt = null;
	lastDiscoveryAt = 0;
}

export function tokenInstallationId(organizationId: string): string {
	return `${TOKEN_INSTALLATION_PREFIX}${organizationId}`;
}

export function gitHubRepositoryFromRemote(
	remote: string,
	host: string,
): string | null {
	const value = remote
		.trim()
		.replace(/\/+$/u, "")
		.replace(/\.git$/iu, "");
	const escaped = host.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	const match = new RegExp(
		`^(?:(?:https?|ssh|git)://(?:[^@/\\s]+@)?${escaped}(?::[0-9]+)?/|[^@/\\s:]+@${escaped}:|${escaped}[:/])([A-Za-z0-9-]+)/([\\w.-]+)$`,
		"iu",
	).exec(value);
	const owner = match?.[1];
	const name = match?.[2];
	if (!owner || !name || name === "." || name === "..") return null;
	return `${owner}/${name}`;
}

export async function listSessionRepositories(
	host: string,
	query: typeof queryClickhouse = queryClickhouse,
): Promise<SessionRepository[]> {
	const rows = await query<{ organization_id: string; git_remote: string }>({
		query: `SELECT organization_id, git_remote FROM rudel.session_analytics
			WHERE git_remote != '' AND organization_id != ''
			GROUP BY organization_id, git_remote LIMIT 20000`,
		clickhouse_settings: {
			max_execution_time: 15,
			max_memory_usage: String(512 * 1024 * 1024),
		},
	});
	const seen = new Map<string, SessionRepository>();
	for (const row of rows) {
		const fullName = gitHubRepositoryFromRemote(row.git_remote, host);
		if (!fullName) continue;
		const key = `${row.organization_id}\0${fullName.toLowerCase()}`;
		if (!seen.has(key))
			seen.set(key, { organizationId: row.organization_id, fullName });
	}
	return [...seen.values()];
}

export async function bindGitHubTokenRepositories(input: {
	readonly database: postgres.Sql;
	readonly repositories: readonly SessionRepository[];
	readonly token: string;
	readonly apiBaseUrl: string;
	readonly account: GitHubTokenAccount;
	readonly historyDays: number;
	readonly environment?: Environment;
	readonly fetch?: typeof globalThis.fetch;
	readonly now?: () => Date;
	readonly maxChecks?: number;
}): Promise<GitHubTokenBindResult> {
	const now = input.now ?? (() => new Date());
	const requestFetch = input.fetch ?? globalThis.fetch;
	const skipped = new Set(readGitHubSyncSkippedOrgIds(input.environment));
	const requested = [
		...new Set(input.repositories.map((entry) => entry.organizationId)),
	].filter((organizationId) => !skipped.has(organizationId));
	const organizations = new Set(
		requested.length === 0
			? []
			: (
					await input.database.unsafe<Array<{ id: string }>>(
						"SELECT id FROM organization WHERE id = ANY($1::text[])",
						[requested],
					)
				).map((row) => row.id),
	);
	await input.database.unsafe(
		"UPDATE github_app_installation SET account_id = $2, account_login = $3, updated_at = $4 WHERE starts_with(installation_id, $1) AND (account_id <> $2 OR account_login <> $3)",
		[
			TOKEN_INSTALLATION_PREFIX,
			input.account.id,
			input.account.login,
			now().toISOString(),
		],
	);
	const active = await input.database.unsafe<
		Array<{ organization_id: string; name: string }>
	>(
		"SELECT binding.organization_id, lower(binding.full_name) AS name FROM github_repository_binding binding INNER JOIN github_app_installation installation ON installation.installation_id = binding.installation_id AND installation.organization_id = binding.organization_id WHERE binding.organization_id = ANY($1::text[]) AND binding.status = 'active' AND installation.status = 'active'",
		[[...organizations]],
	);
	const bound = new Set(
		active.map((row) => `${row.organization_id}\0${row.name}`),
	);
	const wanted = new Map<
		string,
		{ fullName: string; organizations: string[] }
	>();
	for (const entry of input.repositories) {
		if (!organizations.has(entry.organizationId)) continue;
		const name = entry.fullName.toLowerCase();
		if (bound.has(`${entry.organizationId}\0${name}`)) continue;
		const target = wanted.get(name) ?? {
			fullName: entry.fullName,
			organizations: [],
		};
		target.organizations.push(entry.organizationId);
		wanted.set(name, target);
	}

	const boundNow: string[] = [];
	const unreadable = new Set<string>();
	const unreadableNames = new Set<string>();
	let stopped: GitHubTokenBindResult["stopped"] = null;
	let checks = 0;
	for (const [name, target] of wanted) {
		const cacheKey = `${input.account.id}\0${name}`;
		const previous = checkedAt.get(cacheKey);
		if (previous !== undefined && now().getTime() - previous < RECHECK_MS) {
			unreadable.add(target.fullName);
			unreadableNames.add(name);
			continue;
		}
		if (checks >= (input.maxChecks ?? MAX_CHECKS_PER_PASS)) break;
		checks += 1;
		const check = await readRepository(
			requestFetch,
			input.apiBaseUrl,
			input.token,
			`/repos/${target.fullName
				.split("/")
				.map((part) => encodeURIComponent(part))
				.join("/")}`,
		);
		if (check.status === "stop") {
			stopped = check.reason;
			break;
		}
		if (check.status === "unreadable") {
			checkedAt.set(cacheKey, now().getTime());
			unreadable.add(target.fullName);
			unreadableNames.add(name);
			continue;
		}
		checkedAt.delete(cacheKey);
		for (const organizationId of target.organizations) {
			await bindRepository({
				database: input.database,
				organizationId,
				account: input.account,
				repository: check.repository,
				namedAs: target.fullName,
				historyDays: input.historyDays,
				now: now(),
			});
			logger.info(
				"Collecting GitHub repository {repository} for workspace {organizationId} with the token of {login}",
				{
					repository: check.repository.fullName,
					organizationId,
					login: input.account.login,
				},
			);
		}
		boundNow.push(check.repository.fullName);
	}

	const reopened =
		stopped === null
			? await reopenReadableRepositories({
					database: input.database,
					fetch: requestFetch,
					apiBaseUrl: input.apiBaseUrl,
					token: input.token,
					account: input.account,
					historyDays: input.historyDays,
					now,
				})
			: 0;

	if (stopped === null) {
		discoveredAt = now().toISOString();
		unreadableByOrganization.clear();
		for (const organizationId of organizations)
			unreadableByOrganization.set(
				organizationId,
				input.repositories
					.filter(
						(entry) =>
							entry.organizationId === organizationId &&
							unreadableNames.has(entry.fullName.toLowerCase()),
					)
					.map((entry) => entry.fullName)
					.sort((left, right) => left.localeCompare(right)),
			);
	}
	return {
		bound: boundNow,
		unreadable: [...unreadable].sort((left, right) =>
			left.localeCompare(right),
		),
		reopened,
		stopped,
	};
}

export async function runGitHubTokenRepositorySweep(input: {
	readonly database: postgres.Sql;
	readonly signal?: AbortSignal;
	readonly environment?: Environment;
	readonly fetch?: typeof globalThis.fetch;
	readonly now?: () => Date;
	readonly listRepositories?: (host: string) => Promise<SessionRepository[]>;
}): Promise<{ enabled: boolean; requests: number; hasMore: boolean }> {
	const environment = input.environment ?? process.env;
	const idle = { enabled: true, requests: 0, hasMore: false };
	const resolution = await readGitHubToken(environment);
	if (!("token" in resolution)) return idle;
	const host = readGitHubHost(environment);
	const apiBaseUrl = gitHubApiBaseUrl(host);
	const requestFetch = observingGitHubFetch(input.fetch);
	const inspection = await readGitHubTokenInspection({
		token: resolution.token,
		apiBaseUrl,
		fetch: requestFetch,
	});
	if (inspection.status !== "ok") return idle;
	const historyDays = readGitHubHistoryDays(environment);
	if (Date.now() - lastDiscoveryAt >= DISCOVERY_INTERVAL_MS) {
		lastDiscoveryAt = Date.now();
		try {
			await bindGitHubTokenRepositories({
				database: input.database,
				repositories: await (input.listRepositories ?? listSessionRepositories)(
					host,
				),
				token: resolution.token,
				apiBaseUrl,
				account: inspection.identity,
				historyDays,
				environment,
				fetch: requestFetch,
				now: input.now,
			});
		} catch (error) {
			logger.warn(
				"Finding the GitHub repositories named by sessions failed: {error}",
				{ error: error instanceof Error ? error.message : String(error) },
			);
		}
	}
	try {
		return await runGitHubRepositorySweep({
			config: {
				kind: "token",
				host,
				apiBaseUrl,
				read: async () => resolution.token,
			},
			database: input.database,
			environment,
			fetch: requestFetch,
			historyDays,
			now: input.now,
			signal: input.signal,
		});
	} catch (error) {
		logger.warn(
			"The GitHub repository sweep stopped; the next pass resumes where it was: {error}",
			{
				error:
					error instanceof Error
						? `${error.name}: ${error.message}`
						: String(error),
			},
		);
		throw error;
	}
}

export async function readGitHubTokenCollection(
	database: postgres.Sql,
	organizationId: string | null,
	now = new Date(),
): Promise<GitHubTokenCollection> {
	const [row] = await database.unsafe<
		Array<{
			repositories: number;
			last_sweep: Date | string | null;
			paused_until: Date | string | null;
		}>
	>(
		`SELECT
		  (SELECT count(DISTINCT lower(binding.full_name))::int FROM github_repository_binding binding INNER JOIN github_app_installation installation ON installation.installation_id = binding.installation_id AND installation.organization_id = binding.organization_id
		   WHERE starts_with(binding.installation_id, $1) AND binding.status = 'active' AND installation.status = 'active' AND ($2::text IS NULL OR binding.organization_id = $2)) AS repositories,
		  (SELECT max(sweep.updated_at) FROM github_repository_sweep sweep INNER JOIN github_repository_binding binding USING (organization_id, repository_id)
		   WHERE starts_with(binding.installation_id, $1) AND ($2::text IS NULL OR sweep.organization_id = $2)) AS last_sweep,
		  (SELECT max(sweep_rate_reset_at) FROM github_app_installation
		   WHERE starts_with(installation_id, $1) AND status = 'active' AND sweep_rate_remaining = 0 AND sweep_rate_reset_at > $3::timestamptz AND ($2::text IS NULL OR organization_id = $2)) AS paused_until`,
		[TOKEN_INSTALLATION_PREFIX, organizationId, now.toISOString()],
	);
	return {
		repositories: row?.repositories ?? 0,
		unreadable:
			organizationId === null
				? [...new Set([...unreadableByOrganization.values()].flat())].sort(
						(left, right) => left.localeCompare(right),
					)
				: (unreadableByOrganization.get(organizationId) ?? []),
		discoveredAt,
		lastSweepAt: isoOrNull(row?.last_sweep ?? null),
		pausedUntil: isoOrNull(row?.paused_until ?? null),
	};
}

async function bindRepository(input: {
	readonly database: postgres.Sql;
	readonly organizationId: string;
	readonly account: GitHubTokenAccount;
	readonly repository: ReadableRepository;
	readonly namedAs: string;
	readonly historyDays: number;
	readonly now: Date;
}): Promise<void> {
	const installationId = tokenInstallationId(input.organizationId);
	const at = input.now.toISOString();
	const { repository } = input;
	await input.database.begin(async (transaction) => {
		await transaction.unsafe(
			"INSERT INTO github_app_installation (installation_id, organization_id, account_id, account_login, account_type, repository_selection, permissions, status, installed_by_user_id, installed_at, updated_at) VALUES ($1, $2, $3, $4, 'User', 'selected', '{}'::jsonb, 'active', NULL, $5, $5) ON CONFLICT (installation_id) DO UPDATE SET account_id = EXCLUDED.account_id, account_login = EXCLUDED.account_login, status = 'active', updated_at = EXCLUDED.updated_at WHERE github_app_installation.organization_id = EXCLUDED.organization_id",
			[
				installationId,
				input.organizationId,
				input.account.id,
				input.account.login,
				at,
			],
		);
		await transaction.unsafe(
			"INSERT INTO github_repository_binding (organization_id, repository_id, installation_id, node_id, owner, name, full_name, default_branch, is_private, status, last_synced_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $10, $10) ON CONFLICT (organization_id, repository_id) DO UPDATE SET installation_id = EXCLUDED.installation_id, node_id = EXCLUDED.node_id, owner = EXCLUDED.owner, name = EXCLUDED.name, full_name = EXCLUDED.full_name, default_branch = EXCLUDED.default_branch, is_private = EXCLUDED.is_private, status = 'active', last_synced_at = EXCLUDED.last_synced_at, updated_at = EXCLUDED.updated_at",
			[
				input.organizationId,
				repository.id,
				installationId,
				repository.nodeId,
				repository.owner,
				repository.name,
				repository.fullName,
				repository.defaultBranch,
				repository.isPrivate,
				at,
			],
		);
		await enqueueGitHubRepositorySweep(
			{ organizationId: input.organizationId, repositoryId: repository.id },
			input.now,
			transaction,
			true,
			input.historyDays,
		);
		await enqueueL1EdgeScope(transaction, {
			kind: "repository",
			organizationId: input.organizationId,
			repositoryId: repository.id,
		});
		await enqueueL1EdgeDependents(
			transaction,
			input.organizationId,
			[
				...new Set([
					`name:${repository.fullName.toLowerCase()}`,
					`name:${input.namedAs.toLowerCase()}`,
				]),
			],
			{ limit: 1_000 },
		);
		await refreshPrTotalsReadiness(
			transaction,
			input.organizationId,
			input.now,
		);
	});
}

async function reopenReadableRepositories(input: {
	readonly database: postgres.Sql;
	readonly fetch: typeof globalThis.fetch;
	readonly apiBaseUrl: string;
	readonly token: string;
	readonly account: GitHubTokenAccount;
	readonly historyDays: number;
	readonly now: () => Date;
}): Promise<number> {
	const rows = await input.database.unsafe<
		Array<{ organization_id: string; repository_id: string }>
	>(
		`SELECT DISTINCT binding.organization_id, binding.repository_id FROM github_repository_binding binding
		 INNER JOIN github_repository_sweep sweep USING (organization_id, repository_id)
		 WHERE starts_with(binding.installation_id, $1) AND binding.status = 'active' AND sweep.status = 'unavailable' AND sweep.error IN ('github-403', 'github-404')`,
		[TOKEN_INSTALLATION_PREFIX],
	);
	let reopened = 0;
	for (const row of rows) {
		const cacheKey = `${input.account.id}\0#${row.repository_id}`;
		const previous = checkedAt.get(cacheKey);
		if (previous !== undefined && input.now().getTime() - previous < RECHECK_MS)
			continue;
		checkedAt.set(cacheKey, input.now().getTime());
		const check = await readRepository(
			input.fetch,
			input.apiBaseUrl,
			input.token,
			`/repositories/${encodeURIComponent(row.repository_id)}`,
		);
		if (check.status === "stop") break;
		if (check.status !== "readable") continue;
		await enqueueGitHubRepositorySweep(
			{
				organizationId: row.organization_id,
				repositoryId: row.repository_id,
			},
			input.now(),
			input.database,
			true,
			input.historyDays,
		);
		reopened += 1;
	}
	return reopened;
}

async function readRepository(
	requestFetch: typeof globalThis.fetch,
	apiBaseUrl: string,
	token: string,
	path: string,
): Promise<RepositoryCheck> {
	let response: Response;
	try {
		response = await requestFetch(`${apiBaseUrl}${path}`, {
			headers: gitHubTokenHeaders(token),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch {
		return { status: "stop", reason: "unreachable" };
	}
	if (response.status === 401) {
		await response.body?.cancel();
		return { status: "stop", reason: "rejected" };
	}
	if (
		response.status === 429 ||
		(response.status === 403 &&
			(response.headers.get("x-ratelimit-remaining") === "0" ||
				response.headers.has("retry-after")))
	) {
		await response.body?.cancel();
		return { status: "stop", reason: "rate-limited" };
	}
	if (
		response.status === 403 ||
		response.status === 404 ||
		response.status === 451
	) {
		await response.body?.cancel();
		return { status: "unreadable" };
	}
	if (!response.ok) {
		await response.body?.cancel();
		return { status: "stop", reason: "unreachable" };
	}
	const value: unknown = await response.json().catch(() => null);
	const repository = parseRepository(value);
	return repository
		? { status: "readable", repository }
		: { status: "stop", reason: "unreachable" };
}

function parseRepository(value: unknown): ReadableRepository | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	const owner = record.owner as Record<string, unknown> | null | undefined;
	if (
		typeof record.id !== "number" ||
		typeof record.node_id !== "string" ||
		typeof record.name !== "string" ||
		typeof record.full_name !== "string" ||
		typeof record.default_branch !== "string" ||
		typeof record.private !== "boolean" ||
		typeof owner?.login !== "string"
	)
		return null;
	return {
		id: String(record.id),
		nodeId: record.node_id,
		owner: owner.login,
		name: record.name,
		fullName: record.full_name,
		defaultBranch: record.default_branch,
		isPrivate: record.private,
	};
}

function isoOrNull(value: Date | string | null): string | null {
	if (value === null) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
