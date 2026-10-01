import { getLogger } from "@logtape/logtape";
import {
	type CliUpdateStatus,
	isCliVersionOlder,
	parseCliVersion,
} from "@rudel/api-routes";
import type postgres from "postgres";

const logger = getLogger(["rudel", "api", "cli-version"]);
const NPM_LATEST_CLI_URL = "https://registry.npmjs.org/opaline/latest";
const LATEST_CHECK_INTERVAL_MS = 60 * 60 * 1_000;

let latest: { version: string | null; checkedAt: number } | null = null;

/** Best-effort: never fails or blocks the upload that reports the version. */
export async function recordUserCliVersion(
	sql: postgres.Sql,
	userId: string,
	rawVersion: unknown,
): Promise<void> {
	const version = parseCliVersion(rawVersion);
	if (!version) return;
	try {
		await sql`
			INSERT INTO user_cli_version (user_id, version, seen_at)
			VALUES (${userId}, ${version}, CURRENT_TIMESTAMP)
			ON CONFLICT (user_id) DO UPDATE
			SET version = EXCLUDED.version, seen_at = EXCLUDED.seen_at
		`;
	} catch (error) {
		logger.warn("Could not record the user's CLI version: {error}", { error });
	}
}

/** The newest published CLI, checked at most hourly; on failure the last known value stays. */
export async function readLatestCliVersion(
	fetchLatest: typeof fetch = fetch,
	now = Date.now(),
): Promise<string | null> {
	if (latest && now - latest.checkedAt < LATEST_CHECK_INTERVAL_MS)
		return latest.version;
	let version = latest?.version ?? null;
	try {
		const response = await fetchLatest(NPM_LATEST_CLI_URL, {
			signal: AbortSignal.timeout(2_000),
		});
		if (response.ok)
			version =
				parseCliVersion(
					((await response.json()) as { version?: unknown }).version,
				) ?? version;
	} catch (error) {
		logger.warn("Could not read the latest CLI version: {error}", { error });
	}
	latest = { version, checkedAt: now };
	return version;
}

export function resetLatestCliVersionForTests(): void {
	latest = null;
}

export async function getCliUpdateStatus(
	sql: postgres.Sql,
	userId: string,
): Promise<CliUpdateStatus> {
	const [rows, latestVersion] = await Promise.all([
		sql<
			{ version: string }[]
		>`SELECT version FROM user_cli_version WHERE user_id = ${userId}`,
		readLatestCliVersion(),
	]);
	const installedVersion = parseCliVersion(rows[0]?.version);
	return {
		installedVersion,
		latestVersion,
		outdated:
			installedVersion !== null &&
			latestVersion !== null &&
			isCliVersionOlder(installedVersion, latestVersion),
	};
}
