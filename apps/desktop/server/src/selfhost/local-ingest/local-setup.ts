import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Source } from "@rudel/api-routes";
import type { ClickHouseExecutor } from "../../clickhouse.js";
import {
	persistRepositoryEvidenceIndex,
	type RepositoryEvidenceIndexRow,
} from "../../services/repository-evidence-index.service.js";
import { readRepositoryEvidenceSetup } from "../../services/repository-evidence-setup.js";

export const LOCAL_SETUP_CAPTURE_REASON = "local-import";

export interface LocalSetupPaths {
	readonly home: string;
	readonly codexHome: string;
	readonly managedSettings: string;
}

export interface LocalSetupSession {
	readonly organizationId: string;
	readonly userId: string;
	readonly sessionId: string;
	readonly source: Source;
	readonly projectPath: string;
	readonly repository: string;
}

type ReadText = (path: string) => Promise<string | null>;

const CODEX_MANIFEST_KEYS = new Set([
	"approval_policy",
	"sandbox_mode",
	"notify",
]);

export function localSetupPaths(
	env: Readonly<Record<string, string | undefined>> = process.env,
	home = env.HOME ?? "",
): LocalSetupPaths {
	return {
		home,
		codexHome: env.CODEX_HOME?.trim() || join(home, ".codex"),
		managedSettings:
			process.platform === "darwin"
				? "/Library/Application Support/ClaudeCode/managed-settings.json"
				: "/etc/claude-code/managed-settings.json",
	};
}

export async function readLocalSetupManifest(
	projectPath: string,
	paths: LocalSetupPaths,
	read: ReadText = readText,
): Promise<Record<string, unknown>> {
	const json = async (path: string) => parseJson(await read(path));
	const layers = await Promise.all(
		[
			["managed", paths.managedSettings, paths.managedSettings],
			[
				"user",
				"~/.claude/settings.json",
				join(paths.home, ".claude/settings.json"),
			],
			[
				"user-local",
				"~/.claude/settings.local.json",
				join(paths.home, ".claude/settings.local.json"),
			],
			...(projectPath
				? [
						[
							"project",
							".claude/settings.json",
							join(projectPath, ".claude/settings.json"),
						],
						[
							"project-local",
							".claude/settings.local.json",
							join(projectPath, ".claude/settings.local.json"),
						],
					]
				: []),
		].map(async ([scope, path, absolute]) => {
			const settings = await json(absolute ?? "");
			return {
				scope,
				path,
				status: settings ? "parsed" : "absent",
				settings: settings ?? null,
			};
		}),
	);
	const user = layers.find((layer) => layer.scope === "user")?.settings;
	const state = await json(join(paths.home, ".claude.json"));
	const projects = record(state?.projects);
	const codexText = await read(join(paths.codexHome, "config.toml"));
	const codex = codexText === null ? null : parseToml(codexText);
	return {
		captureReason: LOCAL_SETUP_CAPTURE_REASON,
		roots: [
			root(
				"claude-user-home",
				"user",
				"agent-config",
				join(paths.home, ".claude"),
			),
			...(codex
				? [root("codex-user-home", "user", "agent-config", paths.codexHome)]
				: []),
			...(projectPath
				? [root("repository", "repository", "repository", projectPath)]
				: []),
		],
		entries: [],
		userConfiguration: {
			claude: {
				settings: { path: "~/.claude/settings.json" },
				hooks: userHooks(user?.hooks),
				settingsLayers: layers.filter((layer) => layer.settings !== null),
				mcpServers: [
					...mcpServers(state?.mcpServers, "user"),
					...mcpServers(record(projects?.[projectPath])?.mcpServers, "local"),
				],
			},
			...(codex
				? {
						codex: {
							config: { path: "$CODEX_HOME/config.toml" },
							approvalPolicy: codex.approval_policy ?? null,
							sandboxMode: codex.sandbox_mode ?? null,
							notify: Array.isArray(codex.notify) ? codex.notify : [],
							mcpServers: mcpServers(codex.mcp_servers, "user"),
							plugins: enabledOf(codex.plugins),
							features: record(codex.features) ?? {},
							settings: Object.fromEntries(
								Object.entries(codex).filter(
									([key, value]) =>
										!CODEX_MANIFEST_KEYS.has(key) &&
										(typeof value !== "object" || value === null),
								),
							),
						},
					}
				: {}),
		},
	};
}

export function localSetupRow(
	session: LocalSetupSession,
	manifest: unknown,
	now: Date,
): RepositoryEvidenceIndexRow {
	const at = clickHouseTime(now);
	return {
		agent_id: "",
		available_skills: [],
		capture_completed_at: at,
		capture_id: `local:${session.sessionId}`,
		capture_lifecycle: "checkpoint",
		capture_started_at: at,
		capture_status: "complete",
		context_facets: [],
		context_id: uuidOf(`${session.source}:${session.sessionId}`),
		coverage_areas: [],
		coverage_status: "partial",
		first_action_at: null,
		first_action_basis: "unavailable",
		first_action_relationship: "unknown",
		index_version: String(now.getTime()),
		indexed_at: at,
		manifest_object_id: "",
		organization_id: session.organizationId,
		user_id: session.userId,
		parent_agent_id: "",
		parent_context_id: null,
		repository_host: "",
		repository_id: session.repository,
		repository_name: "",
		repository_owner: "",
		repository_provider: "",
		run_id: "",
		segment_id: "",
		session_id: session.sessionId,
		session_source: session.source,
		worktree_id: session.projectPath,
		...readRepositoryEvidenceSetup(manifest),
	};
}

export async function storeLocalSetup(input: {
	readonly clickhouse: ClickHouseExecutor;
	readonly session: LocalSetupSession;
	readonly paths: LocalSetupPaths;
	readonly now: Date;
	readonly read?: ReadText;
}): Promise<void> {
	const manifest = await readLocalSetupManifest(
		input.session.projectPath,
		input.paths,
		input.read,
	);
	await persistRepositoryEvidenceIndex({
		clickhouse: input.clickhouse,
		row: localSetupRow(input.session, manifest, input.now),
	});
}

function root(id: string, origin: string, scope: string, absolutePath: string) {
	return { id, origin, scope, status: "collected", absolutePath };
}

function userHooks(hooks: unknown): Record<string, unknown>[] {
	const flat: Record<string, unknown>[] = [];
	for (const [event, groups] of Object.entries(record(hooks) ?? {}))
		for (const group of Array.isArray(groups) ? groups : [])
			for (const hook of Array.isArray(record(group)?.hooks)
				? (record(group)?.hooks as unknown[])
				: []) {
				const definition = record(hook);
				if (!definition) continue;
				flat.push({
					event,
					matcher: record(group)?.matcher ?? null,
					type: definition.type ?? null,
					command: definition.command ?? null,
					timeoutSeconds: definition.timeout ?? null,
					async: definition.async ?? null,
				});
			}
	return flat;
}

function mcpServers(value: unknown, scope: string): Record<string, unknown>[] {
	return Object.entries(record(value) ?? {}).flatMap(([name, raw]) => {
		const server = record(raw);
		if (!server) return [];
		return [
			{
				name,
				transport:
					server.type ?? server.transport ?? (server.url ? "http" : "stdio"),
				command: server.command ?? null,
				args: Array.isArray(server.args) ? server.args : [],
				url: server.url ?? null,
				enabled: server.enabled ?? null,
				envKeys: Object.keys(record(server.env) ?? {}),
				headerKeys: Object.keys(
					record(server.headers) ?? record(server.http_headers) ?? {},
				),
				bearerTokenEnvVar: server.bearer_token_env_var ?? null,
				scope,
			},
		];
	});
}

function enabledOf(value: unknown): Record<string, boolean> {
	return Object.fromEntries(
		Object.entries(record(value) ?? {}).map(([name, plugin]) => [
			name,
			record(plugin)?.enabled !== false,
		]),
	);
}

async function readText(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

function parseJson(text: string | null): Record<string, unknown> | undefined {
	if (text === null) return undefined;
	try {
		return record(JSON.parse(text));
	} catch {
		return undefined;
	}
}

function parseToml(text: string): Record<string, unknown> | null {
	try {
		return record(Bun.TOML.parse(text)) ?? null;
	} catch {
		return null;
	}
}

function uuidOf(key: string): string {
	const hex = createHash("sha256")
		.update(`opaline-local-setup:${key}`)
		.digest("hex");
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		`5${hex.slice(13, 16)}`,
		`${((Number.parseInt(hex[16] ?? "0", 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}`,
		hex.slice(20, 32),
	].join("-");
}

function clickHouseTime(date: Date): string {
	return date.toISOString().replace("T", " ").replace("Z", "");
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
