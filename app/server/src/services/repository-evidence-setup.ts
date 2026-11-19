import { redactReturnedText } from "@rudel/secret-filter";

/**
 * The setup a session evidence capture recorded, copied from its manifest
 * into the evidence index (`REPOSITORY_EVIDENCE_SETUP_COLUMNS` in
 * `@rudel/ch-schema/repository-evidence-index`): the directories it read, the
 * setup files in them with their hashes, the settings, hooks, permission
 * rules, MCP servers and plugins of each settings layer, and the runtime
 * versions. Values are the manifest's own (CLI `local-context-source/types.ts`);
 * only their shape is flattened, one item per row. The setup_snapshots SQL
 * view names and versions each item.
 *
 * Every manifest field read here is optional or CLI-sanitised, so nothing
 * here throws: a field missing or of another shape is left out, never a
 * reason to refuse the capture.
 */

export interface RepositoryEvidenceSetup {
	readonly capture_reason: string;
	/** (id, origin, scope, status, absolutePath) */
	readonly context_roots: [string, string, string, string, string][];
	/** (rootId, path, categories, hash kind, hash, size, modifiedAt) */
	readonly setup_files: [
		string,
		string,
		string[],
		string,
		string,
		number,
		string,
	][];
	/** (agent, layer scope, layer path, kind, name, value) */
	readonly setup_settings: [string, string, string, string, string, string][];
	/** (field, value) */
	readonly runtime_versions: [string, string][];
}

/** Repository files that are agent setup, by the CLI's categories. */
const REPOSITORY_SETUP_CATEGORIES = new Set([
	"instruction",
	"skill-definition",
	"agent-config",
	"mcp-config",
	"hook-config",
]);
/** The one `custom` root that is setup: the project's Claude Code auto-memory. */
const PROJECT_MEMORY_ROOT = "claude-project-memory";
/** Lists of a Claude Code permissions block that hold rules. */
const PERMISSION_LISTS = ["allow", "deny", "ask", "additionalDirectories"];
/** Settings keys broken out into items of their own. */
const ITEMIZED_SETTINGS = new Set([
	"hooks",
	"permissions",
	"enabledPlugins",
	"env",
]);
const SECRET_NAME =
	/token(?!s)|secret|passw(?:or)?d|credential|cookie|private.?key|api.?key|access.?key/iu;
const REDACTED = "[REDACTED]";
/** Bounds per capture, above the CLI's own (200 items per list). */
const MAX_FILES = 5_000;
const MAX_SETTINGS = 5_000;
/** Longest value kept; the CLI already cuts strings, this bounds JSON values. */
const MAX_VALUE_CHARS = 4_096;
const UINT32_MAX = 4_294_967_295;
const CLAUDE = "claude_code";
const CODEX = "codex";

export function readRepositoryEvidenceSetup(
	manifest: unknown,
): RepositoryEvidenceSetup {
	const root = record(manifest) ?? {};
	return {
		capture_reason: text(root.captureReason)?.slice(0, 64) ?? "",
		...readFiles(root),
		setup_settings: readSettings(record(root.userConfiguration)).slice(
			0,
			MAX_SETTINGS,
		),
		runtime_versions: readRuntime(record(root.runtime)),
	};
}

function readFiles(
	manifest: Record<string, unknown>,
): Pick<RepositoryEvidenceSetup, "context_roots" | "setup_files"> {
	const roots = new Map<string, [string, string, string, string, string]>();
	for (const value of list(manifest.roots)) {
		const root = record(value);
		const id = text(root?.id);
		if (!root || id === undefined || roots.has(id)) continue;
		roots.set(id, [
			id,
			text(root.origin) ?? "",
			text(root.scope) ?? "",
			text(root.status) ?? "",
			text(root.absolutePath) ?? "",
		]);
	}
	const files: RepositoryEvidenceSetup["setup_files"] = [];
	for (const value of list(manifest.entries)) {
		if (files.length >= MAX_FILES) break;
		const entry = record(value);
		if (!entry || entry.kind !== "file") continue;
		const rootId = text(entry.rootId);
		const path = text(entry.path);
		const root = rootId === undefined ? undefined : roots.get(rootId);
		if (rootId === undefined || path === undefined || root === undefined)
			continue;
		const categories = list(entry.categories).filter(
			(category): category is string => typeof category === "string",
		);
		if (!isSetupFile(root, categories)) continue;
		const [hashKind, hash] = readHash(record(entry.hash));
		files.push([
			rootId,
			path,
			categories,
			hashKind,
			hash,
			typeof entry.size === "number" && entry.size >= 0
				? Math.min(Math.trunc(entry.size), UINT32_MAX)
				: 0,
			dateTime(entry.modifiedAtMs),
		]);
	}
	return { context_roots: [...roots.values()], setup_files: files };
}

/**
 * Setup is every file of the user, admin and plugin roots (they are agent
 * configuration by construction) and the agent files of the repository (or a
 * root of another origin), but never
 * saved tool outputs or other `custom` roots, nor the files a skill bundles
 * besides its SKILL.md (its definition stands for it), nor unclassified
 * files of skill and plugin directories.
 */
function isSetupFile(
	root: readonly [string, string, string, string, string],
	categories: readonly string[],
): boolean {
	const [id, origin, scope] = root;
	if (scope === "custom" && id !== PROJECT_MEMORY_ROOT) return false;
	if (
		categories.includes("skill-resource") &&
		!categories.includes("skill-definition")
	)
		return false;
	// Skill and plugin directories also hold files no agent reads (.DS_Store).
	if (
		scope === "skills" &&
		categories.every((category) => category === "other")
	)
		return false;
	if (origin === "user" || origin === "admin") return true;
	return categories.some((category) =>
		REPOSITORY_SETUP_CATEGORIES.has(category),
	);
}

/** The hash as (kind, value): sha256-source, sha256-stored, a git algorithm, or omitted. */
function readHash(hash: Record<string, unknown> | undefined): [string, string] {
	const value = text(hash?.value);
	if (hash?.status === "available" && value !== undefined)
		return [`sha256-${text(hash.scope) ?? "source"}`, value];
	if (hash?.status === "git-object" && value !== undefined)
		return [text(hash.algorithm) ?? "git-unknown", value];
	return ["omitted", ""];
}

function readSettings(
	configuration: Record<string, unknown> | undefined,
): RepositoryEvidenceSetup["setup_settings"] {
	if (!configuration) return [];
	const items: RepositoryEvidenceSetup["setup_settings"] = [];
	const add = (
		agent: string,
		scope: string,
		path: string,
		kind: string,
		name: string,
		value: unknown,
	) => {
		items.push([
			agent,
			scope,
			path,
			kind,
			name,
			kind === "setting"
				? settingText(name, value)
				: kind === "mcp_server"
					? redactedText(value)
					: valueText(value),
		]);
	};
	const claude = record(configuration.claude);
	if (claude) {
		const userPath = text(record(claude.settings)?.path) ?? "";
		for (const value of list(claude.settingsLayers)) {
			const layer = record(value);
			const scope = text(layer?.scope);
			const path = text(layer?.path);
			if (!layer || scope === undefined || path === undefined) continue;
			const settings = record(layer.settings);
			const user = scope === "user";
			// The user layer's hooks come from the CLI's per-hook summary, which
			// keeps each hook when the layer's own copy is cut or redacted.
			if (!user) addLayerHooks(settings?.hooks, scope, path, add);
			addPermissions(
				record(settings?.permissions) ??
					(user ? record(claude.permissions) : undefined),
				scope,
				path,
				add,
			);
			for (const [name, enabled] of Object.entries(
				record(settings?.enabledPlugins) ??
					(user ? (record(claude.enabledPlugins) ?? {}) : {}),
			))
				add(CLAUDE, scope, path, "plugin", name, enabled);
			for (const [name, setting] of Object.entries(settings ?? {}))
				if (!ITEMIZED_SETTINGS.has(name))
					add(CLAUDE, scope, path, "setting", name, setting);
			const env = settings?.env;
			if (record(env))
				for (const [name, value] of Object.entries(record(env) ?? {}))
					add(CLAUDE, scope, path, "setting", `env.${name}`, value);
			else if (env !== undefined)
				add(CLAUDE, scope, path, "setting", "env", REDACTED);
		}
		for (const hook of list(claude.hooks))
			addHook(record(hook), CLAUDE, "user", userPath, add);
		for (const value of list(claude.mcpServers)) {
			const server = record(value);
			const name = text(server?.name);
			if (!server || name === undefined) continue;
			const { scope, ...rest } = server;
			const layer = text(scope) ?? "user";
			add(
				CLAUDE,
				layer,
				layer === "managed" ? "managed-mcp.json" : "~/.claude.json",
				"mcp_server",
				name,
				rest,
			);
		}
	}
	const codex = record(configuration.codex);
	if (codex) {
		const config = text(record(codex.config)?.path) ?? "";
		const hooks = text(record(codex.hooksFile)?.path) ?? "";
		for (const hook of list(codex.hooks))
			addHook(record(hook), CODEX, "user", hooks, add);
		for (const value of list(codex.mcpServers)) {
			const server = record(value);
			const name = text(server?.name);
			if (server && name !== undefined)
				add(CODEX, "user", config, "mcp_server", name, server);
		}
		for (const [name, enabled] of Object.entries(record(codex.plugins) ?? {}))
			add(CODEX, "user", config, "plugin", name, enabled);
		for (const key of ["approvalPolicy", "sandboxMode"] as const)
			if (codex[key] !== null && codex[key] !== undefined)
				add(CODEX, "user", config, "setting", key, codex[key]);
		if (list(codex.notify).length > 0)
			add(CODEX, "user", config, "setting", "notify", codex.notify);
		for (const [name, value] of Object.entries(record(codex.settings) ?? {}))
			add(CODEX, "user", config, "setting", name, value);
		for (const group of ["features", "apps", "connectors", "tools"] as const)
			for (const [name, enabled] of Object.entries(record(codex[group]) ?? {}))
				add(CODEX, "user", config, "setting", `${group}.${name}`, enabled);
	}
	return items;
}

type AddItem = (
	agent: string,
	scope: string,
	path: string,
	kind: string,
	name: string,
	value: unknown,
) => void;

/** A Claude Code settings layer's `{ event: [{ matcher, hooks: [...] }] }`. */
function addLayerHooks(
	value: unknown,
	scope: string,
	path: string,
	add: AddItem,
): void {
	for (const [event, groups] of Object.entries(record(value) ?? {}))
		for (const group of list(groups)) {
			const matcher = record(group)?.matcher;
			for (const hook of list(record(group)?.hooks)) {
				const definition = record(hook);
				if (!definition) continue;
				addHook(
					{
						event,
						matcher,
						type: definition.type,
						command: definition.command,
						timeoutSeconds: definition.timeout,
						async: definition.async,
					},
					CLAUDE,
					scope,
					path,
					add,
				);
			}
		}
}

/** One hook, named by its event, valued by the CLI's hook fields. */
function addHook(
	hook: Record<string, unknown> | undefined,
	agent: string,
	scope: string,
	path: string,
	add: AddItem,
): void {
	const event = text(hook?.event);
	if (!hook || event === undefined) return;
	add(agent, scope, path, "hook", event, {
		matcher: nullable(hook.matcher),
		type: nullable(hook.type),
		command: nullable(hook.command),
		timeoutSeconds: nullable(hook.timeoutSeconds),
		async: nullable(hook.async),
	});
}

/** Each rule of the rule lists; any other permissions key is a setting. */
function addPermissions(
	permissions: Record<string, unknown> | undefined,
	scope: string,
	path: string,
	add: AddItem,
): void {
	for (const [key, value] of Object.entries(permissions ?? {})) {
		if (!PERMISSION_LISTS.includes(key)) {
			if (value !== null && value !== undefined)
				add(CLAUDE, scope, path, "setting", `permissions.${key}`, value);
			continue;
		}
		for (const rule of list(value))
			if (typeof rule === "string")
				add(CLAUDE, scope, path, "permission", key, rule);
	}
}

const RUNTIME_FIELDS = [
	["os", ["platform", "release", "arch"]],
	["cli", ["runtime", "version"]],
	["tools", ["node", "bun", "git", "python"]],
	["agentHost", ["name", "version", "originator"]],
] as const;

function readRuntime(
	runtime: Record<string, unknown> | undefined,
): [string, string][] {
	const versions: [string, string][] = [];
	for (const [group, fields] of RUNTIME_FIELDS) {
		const values = record(runtime?.[group]);
		for (const field of fields) {
			const value = text(values?.[field]);
			if (value !== undefined) versions.push([`${group}.${field}`, value]);
		}
	}
	return versions;
}

function settingText(name: string, value: unknown): string {
	if (SECRET_NAME.test(name.split(".").at(-1) ?? name)) return REDACTED;
	return redactedText(value);
}

function redactedText(value: unknown): string {
	return redactReturnedText(valueText(value)).slice(0, MAX_VALUE_CHARS);
}

function valueText(value: unknown): string {
	const rendered =
		typeof value === "string" ? value : (JSON.stringify(value) ?? "null");
	return rendered.slice(0, MAX_VALUE_CHARS);
}

function dateTime(value: unknown): string {
	const instant = new Date(typeof value === "number" ? value : 0);
	const valid = Number.isFinite(instant.getTime()) ? instant : new Date(0);
	return valid.toISOString().replace("T", " ").replace("Z", "");
}

function nullable(value: unknown): unknown {
	return value === undefined ? null : value;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function list(value: unknown): readonly unknown[] {
	return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
