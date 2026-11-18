import "./helpers/local-integration-guard.js";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import {
	REPOSITORY_EVIDENCE_PROTOCOL,
	RepositoryEvidenceInitInputSchema,
} from "@rudel/api-routes";
import {
	createSplitStats,
	splitSessionTranscript,
	summarizeSplit,
} from "@rudel/api-routes/transcript-records";
import { getClickhouse } from "../clickhouse.js";
import { storeLocalSetup } from "../selfhost/local-ingest/local-setup.js";
import type { AgentQueryLimiter } from "../services/analysis/agent-query-slots.js";
import { setupFileIdentity } from "../services/analysis/received-setup.js";
import { runSql, type SqlCaller } from "../services/analysis/sql-gateway.js";
import {
	createMemorySqlQuota,
	createMemorySqlResultStore,
} from "../services/analysis/sql-results.js";
import { buildRunIndex } from "../services/l1-edges/run-index.service.js";
import {
	buildRepositoryEvidenceIndexRow,
	persistRepositoryEvidenceIndexRows,
} from "../services/repository-evidence-index.service.js";
import {
	hashTranscriptContent,
	writeTranscriptRecords,
} from "../services/transcript-records-ingest.service.js";
import { setupManifest } from "./helpers/setup-manifest.js";

/**
 * Setup snapshots end to end against real ClickHouse (NEW-2): Ana works in
 * the same repository on two days; before the second she adds a PreToolUse
 * hook to the repository's settings and a deny rule. Each session's start
 * capture is indexed from its manifest as the API indexes an upload; a third
 * session has only a later sweep capture. setup_snapshots lists what each
 * capture found, named as setup_files names it, the hook dates to between
 * the two sessions, and runs.coverage_gaps keeps setup_snapshot only for the
 * session without a capture at session time.
 */

setDefaultTimeout(180_000);

const RUN = `setup_snapshots_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const workspace = `${RUN}_ws`;
const ana = `${RUN}_ana`;
const ben = `${RUN}_ben`;
const before = `${RUN}_before`;
const after = `${RUN}_after`;
const swept = `${RUN}_swept`;
const bens = `${RUN}_ben_session`;
const clickhouse = getClickhouse();
const dayMs = 86_400_000;
const baseMs = Date.now() - 3 * dayMs;

const unlimited: AgentQueryLimiter = {
	withAgentQuerySlot: async (_workspaceId, work) => await work(),
};
const reader = (userId: string, ownSessionsOnly: boolean): SqlCaller => ({
	workspaceId: workspace,
	reader: { userId, role: "member", ownSessionsOnly },
});
const sqlEnv = () => ({
	executor: clickhouse,
	results: createMemorySqlResultStore(),
	quota: createMemorySqlQuota({ queries: 1_000, windowMs: 3_600_000 }),
	limiter: unlimited,
	githubRepositories: async () => [],
});

async function sql(query: string, caller = reader(ana, false)) {
	const outcome = await runSql(caller, { query, title: "setup" }, sqlEnv());
	if (!outcome.ok) throw new Error(outcome.error.message);
	return outcome.result.table.split("\n");
}

const HOOK = {
	matcher: "Bash",
	hooks: [{ type: "command", command: "scripts/guard.sh", timeout: 10 }],
};

/** The manifest of a capture: the fixture, with the repository hook once it was added. */
function manifest(hooked: boolean, captureReason?: string) {
	const base = setupManifest(
		captureReason === undefined ? {} : { captureReason },
	);
	const layers = base.userConfiguration.claude.settingsLayers.map((layer) =>
		layer.scope === "project" && hooked
			? {
					...layer,
					settings: {
						...(layer.settings ?? {}),
						model: "sonnet",
						hooks: { PreToolUse: [HOOK] },
						permissions: {
							deny: ["Bash(rm -rf:*)", "Bash(git push --force:*)"],
						},
					},
				}
			: layer.scope === "project"
				? { ...layer, settings: { permissions: { deny: ["Bash(rm -rf:*)"] } } }
				: layer,
	);
	return {
		...base,
		userConfiguration: {
			...base.userConfiguration,
			claude: { ...base.userConfiguration.claude, settingsLayers: layers },
		},
	};
}

async function capture(input: {
	userId: string;
	sessionId: string;
	contextId: string;
	atMs: number;
	lifecycle: "start" | "checkpoint" | "end";
	manifest: unknown;
	indexedAtMs?: number;
}): Promise<void> {
	const at = new Date(input.atMs).toISOString();
	const evidence = RepositoryEvidenceInitInputSchema.parse({
		capture: {
			baseGitCommit: null,
			contextId: input.contextId,
			headGitCommit: null,
			parentContextId: null,
			timing: {
				captureCompletedAt: at,
				captureStartedAt: at,
				firstActionAt: null,
				firstActionBasis: "native-hook",
				firstActionRelationship: "before-first-action",
				lifecycle: input.lifecycle,
			},
			transcriptWatermark: null,
		},
		coverage: [{ area: "git-state", reason: null, status: "complete" }],
		manifestObjectId: `sha256:${"a".repeat(64)}`,
		objects: [
			{
				byteLength: 1,
				contentEncoding: "identity",
				filterVersion: 1,
				kind: "context-manifest",
				mediaType: "application/json",
				objectId: `sha256:${"a".repeat(64)}`,
				sha256: "a".repeat(64),
			},
		],
		operationId: crypto.randomUUID(),
		organizationId: workspace,
		protocol: REPOSITORY_EVIDENCE_PROTOCOL,
		repository: {
			local: {
				installationId: crypto.randomUUID(),
				repositoryId: `local-repository:${"b".repeat(64)}`,
				worktreeId: `local-worktree:${"c".repeat(64)}`,
			},
			provider: {
				host: "github.com",
				name: "shop",
				nodeId: "R_shop",
				owner: "acme",
				provider: "github",
				repositoryId: "4242",
			},
		},
		session: {
			agentId: null,
			parentAgentId: null,
			runId: input.sessionId,
			segmentId: input.sessionId,
			sessionId: input.sessionId,
			source: "claude_code",
		},
	});
	await persistRepositoryEvidenceIndexRows({
		clickhouse,
		rows: [
			buildRepositoryEvidenceIndexRow(
				evidence,
				input.manifest,
				new Date(input.indexedAtMs ?? input.atMs + 1_000),
				input.userId,
			),
		],
	});
}

/** A one-run session, indexed so the runs view holds it. */
async function session(
	userId: string,
	sessionId: string,
	atMs: number,
): Promise<void> {
	const sessionDate = new Date(atMs).toISOString();
	const line = (offset: number, body: Record<string, unknown>) =>
		JSON.stringify({
			sessionId,
			cwd: "/Users/dev/code/shop",
			version: "2.1.300",
			timestamp: new Date(atMs + offset * 1_000).toISOString(),
			...body,
		});
	const content = [
		line(1, {
			type: "user",
			message: { role: "user", content: "Fix the login test" },
		}),
		line(2, {
			type: "assistant",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Fixed." }],
			},
		}),
	].join("\n");
	const stats = createSplitStats();
	await writeTranscriptRecords(clickhouse, {
		organizationId: workspace,
		userId,
		sessionId,
		source: "claude_code",
		revision: "1",
		sessionDate,
		contentSha256: hashTranscriptContent(content),
		assertWritable: async () => {},
		drafts: splitSessionTranscript(
			{ content, sessionDate, source: "claude_code" },
			stats,
		),
		summary: () => summarizeSplit(stats),
	});
	await clickhouse.insert({
		table: "rudel.session_analytics",
		asyncInsert: false,
		values: [
			{
				organization_id: workspace,
				user_id: userId,
				session_id: sessionId,
				source: "claude_code",
				session_date: sessionDate.replace("T", " ").replace("Z", ""),
				last_interaction_date: sessionDate.replace("T", " ").replace("Z", ""),
				project_path: "/shop",
				git_remote: "git@github.com:acme/shop.git",
				model_used: "claude-opus-5-5",
				revision: "1",
			},
		],
	});
	await buildRunIndex({
		executor: clickhouse,
		organizationId: workspace,
		session: { userId, source: "claude_code", sessionId },
		buildRevision: 1,
		beforeWrite: async () => {},
	});
}

afterAll(async () => {
	for (const table of [
		"rudel.repository_session_evidence_index",
		"rudel.transcript_records",
		"rudel.run_index",
		"rudel.run_requests",
		"rudel.run_setup",
		"rudel.setup_texts",
		"rudel.session_analytics",
	])
		await clickhouse.execute({
			query: `DELETE FROM ${table} WHERE organization_id = {workspace:String} SETTINGS lightweight_deletes_sync = 2`,
			query_params: { workspace },
		});
});

test("setup snapshots list each capture's setup, date a hook added between sessions, and close the runs' coverage gap", async () => {
	const beforeCapture = crypto.randomUUID();
	const afterCapture = crypto.randomUUID();
	const sweepCapture = crypto.randomUUID();
	for (const [userId, sessionId, atMs] of [
		[ana, before, baseMs],
		[ana, after, baseMs + dayMs],
		[ana, swept, baseMs + 2 * dayMs],
		[ben, bens, baseMs + dayMs],
	] as const)
		await session(userId, sessionId, atMs);
	await capture({
		userId: ana,
		sessionId: before,
		contextId: beforeCapture,
		atMs: baseMs,
		lifecycle: "start",
		manifest: manifest(false),
	});
	// Indexed twice (a re-index carries a newer index version): one capture.
	for (const indexedAtMs of [baseMs + dayMs + 1_000, baseMs + dayMs + 5_000])
		await capture({
			userId: ana,
			sessionId: after,
			contextId: afterCapture,
			atMs: baseMs + dayMs,
			lifecycle: "start",
			manifest: manifest(true),
			indexedAtMs,
		});
	await capture({
		userId: ana,
		sessionId: swept,
		contextId: sweepCapture,
		atMs: baseMs + 3 * dayMs,
		lifecycle: "checkpoint",
		manifest: manifest(true, "task-output-sweep"),
	});
	await capture({
		userId: ben,
		sessionId: bens,
		contextId: crypto.randomUUID(),
		atMs: baseMs + dayMs,
		lifecycle: "start",
		manifest: manifest(false),
	});

	// Files are named as setup_files names them, from the capture's roots.
	const named = (path: string) =>
		setupFileIdentity(
			{ kind: "instructions", path, name: "", cwd: "/Users/dev/code/shop" },
			{
				source: "claude_code",
				repository: "github.com/acme/shop",
				memberId: ana,
			},
		).setupFile;
	expect(
		await sql(
			`SELECT kind, scope, setup_item, version_kind FROM setup_snapshots
			WHERE capture_id = '${beforeCapture}' AND kind NOT IN ('hook', 'permission_rule', 'mcp_server', 'plugin', 'setting', 'runtime')
			ORDER BY setup_item`,
		),
	).toEqual([
		"kind | scope | setup_item | version_kind",
		...[
			`memory | user | ${named("/Users/dev/.claude/projects/-Users-dev-code-shop/memory/MEMORY.md")} | sha256-source`,
			`command | user | ${named("/Users/dev/.claude/commands/ship.md")} | sha256-source`,
			`config | user | ${named("/Users/dev/.claude/settings.json")} | sha256-source`,
			`skill | plugin | ${named("/Users/dev/.claude/plugins/cache/acme/review/1.0.0/skills/review/SKILL.md")} | omitted`,
			`skill | repository | ${named("/Users/dev/code/shop/.claude/skills/deploy/SKILL.md")} | git-sha1`,
			`instruction | repository | ${named("/Users/dev/code/shop/CLAUDE.md")} | sha256-source`,
		].sort((a, b) => {
			const item = (row: string) => row.split(" | ")[2] ?? "";
			return item(a) < item(b) ? -1 : item(a) > item(b) ? 1 : 0;
		}),
	]);
	expect(named("/Users/dev/code/shop/CLAUDE.md")).toBe(
		"repository:github.com/acme/shop:CLAUDE.md",
	);

	// What the second session's start capture has that the first one's had not.
	expect(
		await sql(
			`SELECT kind, scope, location, name, value FROM setup_snapshots
			WHERE capture_id = '${afterCapture}' AND kind IN ('hook', 'permission_rule')
				AND setup_item NOT IN (SELECT setup_item FROM setup_snapshots WHERE capture_id = '${beforeCapture}')
			ORDER BY kind, name`,
		),
	).toEqual([
		"kind | scope | location | name | value",
		'hook | repository | .claude/settings.json | PreToolUse | {"matcher":"Bash","type":"command","command":"scripts/guard.sh","timeoutSeconds":10,"async":null}',
		"permission_rule | repository | .claude/settings.json | deny | Bash(git push --force:*)",
	]);

	// The repository's model overrides the member's; other kinds have no effective value.
	expect(
		await sql(
			`SELECT location, value, effective FROM setup_snapshots
			WHERE capture_id = '${afterCapture}' AND kind = 'setting' AND name = 'model'
			ORDER BY location`,
		),
	).toEqual([
		"location | value | effective",
		".claude/settings.json | sonnet | true",
		"~/.claude/settings.json | opus | false",
	]);
	expect(
		await sql(
			`SELECT countIf(effective IS NULL) = countIf(kind != 'setting') AS others_null,
				countIf(kind = 'setting' AND effective) AS applied
			FROM setup_snapshots WHERE capture_id = '${beforeCapture}'`,
		),
	).toEqual(["others_null | applied", "1 | 3"]);

	// Dated: between the member's last capture without it and her first with it.
	expect(
		await sql(
			`SELECT session_id, lifecycle, at_session_time, capture_reason,
				countIf(kind = 'hook' AND name = 'PreToolUse' AND scope = 'repository') AS repository_hooks,
				countIf(kind = 'runtime') AS runtime_fields,
				count() AS items
			FROM setup_snapshots WHERE user_id = '${ana}'
			GROUP BY session_id, lifecycle, at_session_time, capture_reason, captured_at ORDER BY captured_at`,
		),
	).toEqual([
		"session_id | lifecycle | at_session_time | capture_reason | repository_hooks | runtime_fields | items",
		`${before} | start | true |  | 0 | 10 | 25`,
		`${after} | start | true |  | 1 | 10 | 28`,
		`${swept} | checkpoint | false | task-output-sweep | 1 | 10 | 28`,
	]);

	// Runs of sessions captured at session time have no setup_snapshot gap;
	// the swept session's capture is not of its time.
	expect(
		await sql(
			`SELECT session_id, has(coverage_gaps, 'setup_snapshot') AS gap FROM runs
			WHERE user_id = '${ana}' ORDER BY session_id`,
		),
	).toEqual([
		"session_id | gap",
		`${after} | 0`,
		`${before} | 0`,
		`${swept} | 1`,
	]);

	// The setup a run started with joins runs by session.
	expect(
		await sql(
			`SELECT r.session_id, countIf(s.kind = 'hook' AND s.scope = 'repository') AS repository_hooks
			FROM runs AS r INNER JOIN setup_snapshots AS s ON s.user_id = r.user_id AND s.session_id = r.session_id
			WHERE s.lifecycle = 'start' AND s.at_session_time AND s.captured_at <= r.started_at + INTERVAL 1 MINUTE
			GROUP BY r.session_id ORDER BY r.session_id`,
		),
	).toEqual([
		"session_id | repository_hooks",
		`${after} | 1`,
		`${before} | 0`,
		`${bens} | 0`,
	]);

	// A member held to their own sessions reads only their own captures.
	expect(
		await sql(
			"SELECT DISTINCT user_id FROM setup_snapshots",
			reader(ben, true),
		),
	).toEqual(["user_id", ben]);
});

test("the desktop app's import writes this machine's settings as one capture per session, replaced on the next import", async () => {
	const local = `${RUN}_local`;
	await session(ana, local, baseMs + 4 * dayMs);
	const files = new Map<string, string>([
		[
			"/Users/dev/.claude/settings.json",
			JSON.stringify({
				model: "opus",
				autoCompactEnabled: false,
				env: { ANTHROPIC_AUTH_TOKEN: "sk-ant-api03-abcdefghijklmnop" },
			}),
		],
		[
			"/Users/dev/code/shop/.claude/settings.local.json",
			JSON.stringify({ model: "sonnet" }),
		],
	]);
	const store = (at: number) =>
		storeLocalSetup({
			clickhouse,
			session: {
				organizationId: workspace,
				userId: ana,
				sessionId: local,
				source: "claude_code",
				projectPath: "/Users/dev/code/shop",
				repository: "github.com/acme/shop",
			},
			paths: {
				home: "/Users/dev",
				codexHome: "/Users/dev/.codex",
				managedSettings: "/nonexistent/managed-settings.json",
			},
			now: new Date(at),
			read: async (path) => files.get(path) ?? null,
		});
	await store(baseMs + 4 * dayMs + 60_000);
	files.set(
		"/Users/dev/.claude/settings.json",
		JSON.stringify({ model: "opus", autoCompactEnabled: true }),
	);
	await store(baseMs + 4 * dayMs + 120_000);
	expect(
		await sql(
			`SELECT capture_reason, at_session_time, scope, location, name, value, effective
			FROM setup_snapshots WHERE session_id = '${local}' AND kind = 'setting'
			ORDER BY name, location`,
		),
	).toEqual([
		"capture_reason | at_session_time | scope | location | name | value | effective",
		"local-import | false | user | ~/.claude/settings.json | autoCompactEnabled | true | true",
		"local-import | false | repository | .claude/settings.local.json | model | sonnet | true",
		"local-import | false | user | ~/.claude/settings.json | model | opus | false",
	]);
	expect(
		await sql(
			`SELECT has(coverage_gaps, 'setup_snapshot') AS gap FROM runs WHERE session_id = '${local}'`,
		),
	).toEqual(["gap", "1"]);
});
