import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SERVER_SETTINGS_FILE = "server.env";

const MANAGED_BY_THE_CLI = new Set([
	"NODE_ENV",
	"OPALINE_SELF_HOSTED",
	"PORT",
	"HOST",
	"APP_URL",
	"ALLOWED_ORIGIN",
	"PG_CONNECTION_STRING",
	"CLICKHOUSE_URL",
	"CLICKHOUSE_USERNAME",
	"CLICKHOUSE_PASSWORD",
	"CLICKHOUSE_FLAVOR",
	"BETTER_AUTH_SECRET",
	"CRON_SECRET",
	"OPALINE_DATA_DIR",
	"OPALINE_SETUP_TOKEN",
	"OPALINE_WEB_DIR",
]);

const LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u;

export interface ServerSettings {
	readonly path: string;
	readonly settings: Readonly<Record<string, string>>;
	readonly problems: readonly string[];
}

export function readServerSettings(dataDir: string): ServerSettings {
	const path = join(dataDir, SERVER_SETTINGS_FILE);
	if (!existsSync(path)) return { path, settings: {}, problems: [] };
	const settings: Record<string, string> = {};
	const problems: string[] = [];
	readFileSync(path, "utf8")
		.split(/\r?\n/u)
		.forEach((raw, index) => {
			const line = raw.trim();
			if (line === "" || line.startsWith("#")) return;
			const match = LINE.exec(line);
			const name = match?.[1];
			if (!match || name === undefined) {
				problems.push(
					`${path} line ${index + 1} is not NAME=value; it was skipped.`,
				);
				return;
			}
			if (MANAGED_BY_THE_CLI.has(name)) {
				problems.push(
					`${name} in ${path} is ignored: opaline server sets it itself (see opaline server --help).`,
				);
				return;
			}
			settings[name] = unquote(match[2] ?? "");
		});
	return { path, settings, problems };
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (
		trimmed.length >= 2 &&
		((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
			(trimmed.startsWith("'") && trimmed.endsWith("'")))
	)
		return trimmed.slice(1, -1);
	return trimmed;
}
