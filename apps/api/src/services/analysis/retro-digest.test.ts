import { describe, expect, test } from "bun:test";
import {
	buildDigest,
	coverageOf,
	type DigestInputs,
	digestExampleRefs,
	editFacts,
	exampleRef,
	joinDigestRuns,
	maskSecrets,
	mergeSeverity,
	peakConcurrency,
	renderDigest,
	resolvePath,
	setupName,
	worktreeOf,
} from "./retro-digest.js";
import { digestCuts, noteCuts } from "./retro-digest-cuts.js";
import {
	CI_POLL_RE,
	contextSizesStatement,
	DB_CLIENT_RE,
	digestCallsSql,
	digestEditsSql,
	digestExampleTimesSql,
	digestRunsSql,
	digestSessionsSql,
	digestSeveritySql,
	digestUsageSql,
	focusPattern,
	INLINE_SCRIPT_RE,
	RULE_RE,
	SCRIPT_FUNCTION_RE,
	SECRET_RE,
	SEVERITY_RULES,
	SLEEP_POLL_RE,
	startDirsStatement,
	TMP_TARGET_RE,
} from "./retro-digest-sql.js";
import type { MeasureParams } from "./retro-measure-sql.js";
import { SQL_LIMITS } from "./sql-gateway.js";
import { prepareAgentSql, type SqlWindow } from "./sql-guard.js";
import { SQL_VIEWS } from "./sql-views.js";
import { SHELL_EDIT_ROUTES } from "./tool-groups.js";

const params: MeasureParams = {
	from: "2026-10-06",
	to: "2026-11-03",
	repository: "athena",
	limit: 20,
};

function guarded(sql: string) {
	const windows = new Map<string, SqlWindow[]>();
	const prepared = prepareAgentSql(
		sql,
		new Map(
			SQL_VIEWS.map((view) => [
				view.name,
				{
					windowColumn: view.windowColumn,
					statement: (window: SqlWindow) => {
						windows.set(view.name, [...(windows.get(view.name) ?? []), window]);
						return view.sql(false, window);
					},
				},
			]),
		),
		new Set(),
	);
	return { prepared, windows };
}

const statements = [
	{ label: "sessions", sql: digestSessionsSql(params) },
	{ label: "calls", sql: digestCallsSql(params) },
	{ label: "edits", sql: [digestEditsSql(params)] },
	{ label: "usage", sql: digestUsageSql(params) },
	{ label: "runs", sql: digestRunsSql(params) },
	{ label: "severity", sql: digestSeveritySql(params) },
].flatMap(({ label, sql }) =>
	sql.map((part, index) => ({ label: `${label} ${index + 1}`, sql: part })),
);

describe("digest statements", () => {
	test("each passes the sql guard and fits the statement size ClickHouse is given", () => {
		for (const { label, sql } of statements) {
			const { prepared } = guarded(sql);
			expect({ label, ok: prepared.ok }).toEqual({ label, ok: true });
			const bytes = prepared.ok
				? Buffer.byteLength(prepared.prepared.sql, "utf8")
				: Number.POSITIVE_INFINITY;
			expect({ label, fits: bytes < SQL_LIMITS.statementBytes }).toEqual({
				label,
				fits: true,
			});
		}
	});

	test("each picks the cohort the patterns tool picks and reads calls from the window start once", () => {
		for (const { label, sql } of statements) {
			expect({
				label,
				picked: sql.includes(
					"agent_id = '' AND ifNull(thread_source, '') != 'subagent'",
				),
			}).toEqual({ label, picked: true });
			const calls = guarded(sql).windows.get("calls") ?? [];
			expect({ label, scans: calls.length <= 1 }).toEqual({
				label,
				scans: true,
			});
			for (const window of calls)
				expect(window.from).toBe(
					"toDateTime64 ( '2026-10-06 00:00:00' , 3 , 'UTC' )",
				);
		}
	});

	test("the calls statement returns one row of ranked metrics, the failure share over agent calls and pushes", () => {
		const sql = digestCallsSql(params).join("\n;\n");
		expect(sql).toContain("AS ranked");
		expect(sql).toContain("countIf(call_level != 'inner' AND failed = 1)");
		expect(sql).toContain("kind = 'push_range'");
		expect(sql).toContain("ARRAY JOIN tags AS t");
		expect(sql).toContain("LIMIT 16 BY metric");
	});

	test("the sessions statement reads the first main-stream run's instruction and skill files", () => {
		const sql = digestSessionsSql(params).join("\n;\n");
		expect(sql).toContain(
			"kind IN ('instructions', 'agents_md', 'nested_memory', 'skill_body')",
		);
		expect(sql).toContain(
			"(user_id, session_id, turn_idx) IN (SELECT uid, sid, first_turn FROM per_session)",
		);
		expect(sql).toContain("genuine = 1 AND agent_id = ''");
	});

	test("the usage statement adds Codex subagent threads to their parent session and counts one compaction per boundary", () => {
		const sql = digestUsageSql(params).join("\n;\n");
		expect(sql).toContain("kind = 'parent_thread'");
		expect(sql).toContain("concat('thread ', r.session_id)");
		expect(sql).toContain(
			"e.event = 'compaction' AND e.subtype != 'compact_summary'",
		);
	});

	test("the runs statement gives every run its failed agent calls, the ones a row explains, and its first genuine prompt", () => {
		const sql = digestRunsSql(params).join("\n;\n");
		expect(sql).toContain("countIf(failed = 1 AND (denial_kind != ''");
		expect(sql).toContain("genuine = 1");
		expect(sql).toContain("toUInt8(ifNull(frustrated, false))");
	});

	test("the severity statement tags every matching call with each rule, never ranked or limited by frequency", () => {
		const sql = digestSeveritySql(params).join("\n;\n");
		for (const rule of SEVERITY_RULES)
			expect(sql).toContain(`'${rule.rule.replaceAll("'", "\\'")}'`);
		expect(sql).toContain("GROUP BY category, rule");
		for (const part of digestSeveritySql(params))
			expect(part.split("hits AS")[1]).not.toContain("HAVING");
		expect(sql).toContain("if(call_level = 'inner', '', output) AS output");
	});
});

describe("trusted digest statements", () => {
	const scope = {
		workspaceId: "ws1",
		users: ["u1", "u2"],
		sessions: ["s1", "s2"],
	};

	test("are scoped to the workspace and the cohort by parameters, never by inlined ids", () => {
		for (const statement of [
			startDirsStatement(scope),
			contextSizesStatement(scope),
		]) {
			expect(statement.query).toContain("organization_id = {ws:String}");
			expect(statement.query).toContain(
				"has(arrayZip({users:Array(String)}, {ids:Array(String)}), (user_id, session_id))",
			);
			expect(statement.query).not.toContain("'s1'");
			expect(statement.query_params).toMatchObject({
				ws: "ws1",
				ids: ["s1", "s2"],
				users: ["u1", "u2"],
			});
		}
	});

	test("start dirs come from session_analytics.project_path, the latest ingest", () => {
		expect(startDirsStatement(scope).query).toContain(
			"argMax(project_path, ingested_at)",
		);
	});

	test("context sizes count deduplicated usage events, a Codex session's responses over its token-count transitions, against the cohort's own p90", () => {
		const query = contextSizesStatement(scope).query;
		expect(query).toContain("record_kind = 'event' AND is_deleted = 0");
		expect(query).toContain("agent_id = 'main' AS main_stream");
		expect(query).toContain("NOT (identity_kind = 'transition'");
		expect(query).toContain("quantileExact(0.9)(size) AS p90");
		expect(query).not.toContain("400000");
	});
});

describe("digest patterns", () => {
	const re = (source: string) => new RegExp(source.replace("(?i)", ""), "iu");

	test("sleep and poll loops", () => {
		for (const command of [
			"sleep 30 && gh pr checks 12",
			"gh run watch 123",
			"until curl -s x; do sleep 2; done",
			"cd x && sleep 5",
		])
			expect({ command, hit: re(SLEEP_POLL_RE).test(command) }).toEqual({
				command,
				hit: true,
			});
		for (const command of ["git log --since=sleepy", "bun test"])
			expect({ command, hit: re(SLEEP_POLL_RE).test(command) }).toEqual({
				command,
				hit: false,
			});
	});

	test("CI polling", () => {
		expect(re(CI_POLL_RE).test("gh pr checks 301 --watch")).toBe(true);
		expect(re(CI_POLL_RE).test("gh run view 99 --log-failed")).toBe(true);
		expect(re(CI_POLL_RE).test("gh pr view 3 --json statusCheckRollup")).toBe(
			true,
		);
		expect(re(CI_POLL_RE).test("gh pr create")).toBe(false);
	});

	test("inline scripts and the function they define", () => {
		const command =
			"cd x && python3 - <<'EOF'\ndef edit(p, pairs):\n    s=open(p).read()\nEOF";
		expect(re(INLINE_SCRIPT_RE).test(command)).toBe(true);
		expect(re(INLINE_SCRIPT_RE).test("python3 scripts/run.py")).toBe(false);
		expect(new RegExp(SCRIPT_FUNCTION_RE, "u").exec(command)?.[1]).toBe(
			"def edit(p, pairs)",
		);
	});

	test("edit routes take the first matching shell pattern", () => {
		const route = (command: string) =>
			SHELL_EDIT_ROUTES.find(([, pattern]) => re(pattern).test(command))?.[0];
		expect(route("apply_patch <<'PATCH'")).toBe("apply_patch (shell)");
		expect(route("cat > /tmp/a.mjs <<'EOF'")).toBe("cat/tee > file");
		expect(route("sed -i '' 's/a/b/' f.ts")).toBe("sed/perl -i");
		expect(route("bun run gen > out.ts")).toBe("interpreter command");
		expect(route("echo x > f")).toBe("echo/printf > file");
		expect(route("rm f")).toBeUndefined();
	});

	test("severity rules are heuristics over shell commands that leave searches, /tmp and WHERE-bound deletes alone", () => {
		const hit = (rule: string, command: string) => {
			const found = SEVERITY_RULES.find((r) => r.rule === rule);
			const focus = found?.focus;
			return focus ? re(focus).test(command) : false;
		};
		expect(hit("rm -rf outside /tmp", "cd x && rm -rf node_modules")).toBe(
			true,
		);
		expect(re(TMP_TARGET_RE).test("/tmp/build")).toBe(true);
		expect(re(TMP_TARGET_RE).test("$TMPDIR/x")).toBe(true);
		expect(re(TMP_TARGET_RE).test("~/repo")).toBe(false);
		expect(
			hit("git push --force", "git push --force-with-lease origin x"),
		).toBe(true);
		expect(hit("git push --force", "git push origin x")).toBe(false);
		expect(hit("git reset --hard", "git reset --hard origin/main")).toBe(true);
		expect(hit("git clean -fd", "git clean -fdx")).toBe(true);
		expect(hit("SQL DELETE without WHERE", "psql -c 'DELETE FROM jobs'")).toBe(
			true,
		);
		expect(re(DB_CLIENT_RE).test("psql -c 'DELETE FROM jobs'")).toBe(true);
		expect(re(DB_CLIENT_RE).test("grep -rn DELETE src")).toBe(false);
		expect(hit("deploy or publish command", "vercel deploy --prod")).toBe(true);
		expect(
			hit("git checkout -- / git restore", "git checkout -- src/a.ts"),
		).toBe(true);
		expect(
			re(SECRET_RE).test("token ghp_abcdefghijklmnopqrstuvwxyz0123456789"),
		).toBe(true);
		expect(re(SECRET_RE).test("sha 0123456789abcdef")).toBe(false);
	});

	test("a severity quote is the text around the match", () => {
		const focus = new RegExp(
			focusPattern(String.raw`\bgit\s+reset\s[^;&|\n]*--hard\b`),
			"u",
		);
		expect(
			focus.exec("cd ~/repo && git reset --hard origin/main && bun test")?.[1],
		).toBe("d ~/repo && git reset --hard origin/main && bun test");
		expect(focusPattern("(?i)\\bDROP")).toBe("(.{0,12}(?i:\\bDROP).{0,45})");
	});
});

describe("digest paths and spans", () => {
	test("paths resolve against the run's cwd with the home dir as ~", () => {
		expect(resolvePath("src/a.ts", "/Users/x/repo")).toBe("~/repo/src/a.ts");
		expect(resolvePath("/Users/x/repo/./b/../c.ts", "")).toBe("~/repo/c.ts");
		expect(resolvePath("/tmp/x.py", "/Users/x/repo")).toBe("/tmp/x.py");
	});

	test("a worktree is the longest start dir holding the file, else the dir above its source tree, else two dirs under ~", () => {
		const starts = ["~/a/b/c", "~/a/b"];
		expect(worktreeOf("~/a/b/c/d.ts", starts)).toBe("~/a/b/c");
		expect(worktreeOf("~/w/proj-x/apps/web/x.ts", starts)).toBe("~/w/proj-x");
		expect(worktreeOf("~/w/proj-y/README.md", starts)).toBe("~/w/proj-y");
	});

	test("peak concurrency of subagent spans", () => {
		expect(
			peakConcurrency([
				{ t0: 0, t1: 10 },
				{ t0: 5, t1: 15 },
				{ t0: 10, t1: 20 },
			]),
		).toBe(2);
	});

	test("setup file names stay short", () => {
		expect(
			setupName("agents_md repository repository:github.com/o/r:AGENTS.md"),
		).toBe("repo:AGENTS.md");
		expect(
			setupName("instructions member ~/.claude/projects/x/memory/MEMORY.md"),
		).toBe("~/.claude/…/memory/MEMORY.md");
	});
});

const MIN = 60_000;

function session(sid: string, source = "claude_code") {
	return [
		sid,
		source,
		"cli",
		1,
		4,
		1,
		0,
		30,
		20,
		3,
		4,
		1,
		["instructions member ~/AGENTS.md"],
		2,
		"u1",
	];
}

const run = (
	rid: string,
	sid: string,
	turn: number,
	extra: Partial<Record<string, number | string>> = {},
) => [
	rid,
	sid,
	"",
	turn,
	extra.minutes ?? 1,
	extra.active ?? 1,
	extra.frustrated ?? 0,
	extra.reasked ?? 0,
	extra.failed ?? 0,
	extra.sorted ?? 0,
	extra.quote ?? `prompt ${rid}`,
	extra.chars ?? 20,
	extra.kind ?? "",
];

function inputs(): DigestInputs {
	return {
		sessions: {
			sessions: [session("s1"), session("s2"), session("s3", "codex")],
			repeats: [["fix the tests", 2, "s1", 3]],
			repeat_totals: [1, 1],
			rule_totals: [3, 2],
			rules: [
				[
					"dont use a mono",
					2,
					2,
					"s1",
					4,
					"dont use a mono font",
					"2026-10-07 10:00:00.000",
				],
				[
					"always dark mode first",
					1,
					1,
					"s2",
					2,
					"always dark mode first",
					"2026-10-08 10:00:00.000",
				],
			],
			streams: [
				["s1", "a1", 1],
				["s1", "a2", 1],
			],
			models: [["claude-x", 10, 2, 8]],
			links: [],
			unrecorded: [
				["codex", "timed_out_calls", 3, 3],
				["codex", "compact_trigger", 3, 3],
				["claude_code", "goal", 9, 9],
			],
			runs_by_source: [
				["claude_code", 9],
				["codex", 3],
			],
		},
		calls: {
			ranked: [
				[
					"refusals",
					[["guard: STOP: no bunx", 3, 3, 0, 2, ["s1", "s2"], "s1#2", "", 3]],
				],
				["checks", [["test", 10, 2, 5.5, 2, ["s1"], "s1#3", "", 10]]],
				[
					"families",
					[["bun test", 10, 2, 5.5, 2, ["s1"], "s1#3", "bun test", 10]],
				],
				[
					"routes",
					[
						["python inline script", 5, 0, 7, 2, ["s2"], "s2#1", "", 5],
						["edit tool Edit", 4, 0, 4, 2, ["s1"], "s1#1", "", 4],
					],
				],
				[
					"edit_basis",
					[
						["script", 5, 0, 7, 2, ["s2"], "s2#1", "", 5],
						["tool", 4, 0, 4, 2, ["s1"], "s1#1", "", 4],
					],
				],
			],
			share: [100, 7, 80, 5, 0, 0, 2, 0],
			push_stats: [2, 1, 0, 0],
		},
		edits: {
			edits: [
				["s1", "", 1, 0, ["/Users/x/w/apps/a.ts"], ["edit"], "/Users/x/w"],
				["s2", "", 1, 30 * MIN, ["apps/a.ts"], ["delete"], "/Users/x/w"],
				[
					"s2",
					"",
					2,
					50 * MIN,
					["/Users/x/w/apps/a.ts", "/Users/x/other/apps/b.ts"],
					["write", "edit"],
					"/Users/x/w",
				],
				["s3", "", 1, 0, ["/tmp/probe.py"], ["write"], "/Users/x/v"],
				["s1", "", 2, 70 * MIN, ["/tmp/probe2.py"], ["write"], "/Users/x/w"],
			],
		},
		usage: {
			per_session: [["s1", 3, 1_000_000, 2.5, 0, 0, "1"]],
			sub_spans: [
				["s1", "a1", 0, 10 * MIN],
				["s1", "a2", 5 * MIN, 12 * MIN],
			],
			compactions: [
				["claude_code", 1, "manual", 2, 1, "s1#4"],
				["codex", 1, "", 1, 1, "s3#1"],
			],
		},
		runs: {
			runs: [
				run("r1", "s1", 1, {
					frustrated: 1,
					failed: 2,
					sorted: 1,
					minutes: 50,
					active: 10,
				}),
				run("r2", "s1", 2, {
					quote: "this is wrong again",
					failed: 3,
					minutes: 2,
					active: 2,
				}),
				run("r3", "s2", 1, {
					frustrated: 1,
					minutes: 40,
					active: 8,
					failed: 1,
				}),
				run("r4", "s2", 2, {
					quote: "no that broke it",
					chars: 900,
					kind: "queued",
					minutes: 1,
					active: 1,
				}),
				run("r5", "s3", 1, { minutes: 3, active: 3 }),
			],
		},
		severity: [
			{
				severity: [
					[
						"destructive",
						"git reset --hard",
						1,
						1,
						[["s2#2", "git reset --hard origin/main"]],
					],
				],
			},
			{
				severity: [
					[
						"destructive",
						"git reset --hard",
						2,
						1,
						[["s3#1", "git reset --hard HEAD"]],
					],
					["secrets", ".env file read", 1, 1, [["s1#1", ".env"]]],
				],
			},
		],
		startDirs: [
			{ session_id: "s1", start_dir: "/Users/x/w" },
			{ session_id: "s2", start_dir: "/Users/x/w" },
			{ session_id: "s3", start_dir: "/Users/x/v" },
		],
		contextSizes: [
			{
				source: "claude_code",
				main_stream: 1,
				requests: 10,
				unrecorded: 0,
				q: [100_000, 300_000, 450_000],
				largest: 500_000,
				p90: 300_000,
				above_p90: 1,
				sessions_above: 1,
				ids: ["s1"],
			},
			{
				source: "codex",
				main_stream: 1,
				requests: 4,
				unrecorded: 4,
				q: [0, 0, 0],
				largest: 0,
				p90: 0,
				above_p90: 0,
				sessions_above: 0,
				ids: [],
			},
		],
		patterns: [
			{
				id: "fc_0123456789",
				kind: "failing_call",
				signature: "bunx: STOP",
				count: 3,
				runs: 3,
				sessions: 3,
				minutes: 1,
				examples: ["s1#2", "s2#1"],
				rids: ["r2"],
			},
			{
				id: "th_0123456789",
				kind: "theme",
				signature: "prompts that say x",
				count: 3,
				runs: 3,
				sessions: 3,
				minutes: 1,
				examples: ["s1#2"],
				rids: ["r5"],
			},
		],
	};
}

describe("digest", () => {
	const scope = {
		repository: "athena",
		from: "2026-10-06",
		to: "2026-11-03",
		latest: null,
		listed: null,
	};
	const section = (id: string) =>
		buildDigest(inputs(), scope).sections.find((s) => s.id === id);

	test("edit facts: edits outside the start dir, helper scripts in scratch dirs, files deleted then written again", () => {
		const sessions = [
			{ sid: "s1", start: "~/w" },
			{ sid: "s2", start: "~/w" },
			{ sid: "s3", start: "~/v" },
		] as unknown as Parameters<typeof editFacts>[1];
		const facts = editFacts(inputs().edits, sessions);
		expect(facts.outside.map((o) => o.sid)).toEqual(["s2"]);
		expect(facts.outsideRoots).toEqual([["~/other", 1]]);
		expect(facts.scripts).toEqual([
			{ dir: "/tmp", sessions: ["s1", "s3"], files: 2, ex: "s3#1" },
		]);
		expect(facts.recreated).toEqual([
			{ file: "~/w/apps/a.ts", sid: "s2", ex: "s2#2" },
		]);
	});

	test("severity: every rule's occurrences add up over the shards, sessions summed over shards are an upper bound, and a lost-work line from the edits", () => {
		const merged = mergeSeverity(inputs().severity);
		expect(merged.find((hit) => hit.rule === "git reset --hard")).toMatchObject(
			{ n: 3, sessions: 2 },
		);
		const rows = section("i")?.rows ?? [];
		expect(rows.map((row) => row.metric)).toEqual([
			"destructive commands",
			"credential or secret exposure",
			"reverted or lost work",
		]);
		expect(rows[0]?.value).toContain("git reset --hard 3 (up to 2 sess)");
		expect(rows[2]?.value).toContain(
			"file deleted then written again 1 (1 sess)",
		);
		expect(section("i")?.missing).toEqual([
			"production-looking writes or deploys: none matched",
		]);
		for (const row of rows) expect(row.definition.length).toBeGreaterThan(30);
	});

	test("loaded at start lists every instruction file and counts the skills past two", () => {
		const files = [
			"instructions member ~/.claude/CLAUDE.md",
			"nested_memory member ~/.claude/projects/x/memory/MEMORY.md",
			"agents_md member ~/AGENTS.md",
			"skill_body member ~/.claude/skills/a/SKILL.md",
			"skill_body member ~/.claude/skills/b/SKILL.md",
			"skill_body member ~/.claude/skills/c/SKILL.md",
		];
		const base = inputs();
		const sessions = (base.sessions.sessions as unknown[][]).map((row) =>
			row.map((cell, index) => (index === 12 ? files : cell)),
		);
		const loaded = buildDigest(
			{ ...base, sessions: { ...base.sessions, sessions } },
			scope,
		)
			.sections.find((s) => s.id === "a")
			?.rows.find((row) => row.metric === "loaded at start");
		expect(loaded?.value).toContain("~/AGENTS.md 2");
		expect(loaded?.value).toContain("~/.claude/…/memory/MEMORY.md 2");
		expect(loaded?.value).toContain(", +1 more skills");
	});

	test("a list cut at its LIMIT says how many it kept of how many, in each section that reads it", () => {
		const base = inputs();
		const cut = {
			...base,
			sessions: {
				...base.sessions,
				streams: Array.from({ length: 5000 }, (_, i) => ["s1", `a${i}`, 1]),
				streams_total: 5120,
			},
			edits: { ...base.edits, edits_total: 4 },
			calls: {
				...base.calls,
				ranked: [
					["refusals", [], 7],
					["checks", [], 6],
				],
			},
		};
		const cuts = digestCuts(cut);
		expect([...cuts]).toEqual([
			[
				"h",
				[
					"subagents: 5,000 of 5,120 subagent streams were read, so the sessions with subagents are a lower bound",
				],
			],
			["a", ["refusal reasons: the top 6 of 7 were read"]],
		]);
		const text = renderDigest(noteCuts(buildDigest(cut, scope), cuts));
		expect(text).toContain(
			"- cut: subagents: 5,000 of 5,120 subagent streams were read",
		);
		expect(text).toContain("Claude subagent streams 5120 in 1 sessions");
	});

	test("severity: rules from several statements come out in the order one statement sorts them", () => {
		const merged = mergeSeverity([
			{ severity: [["secrets", "secret-looking string in output", 1, 1, []]] },
			{
				severity: [
					["destructive", "rm -rf outside /tmp", 2, 1, []],
					["secrets", ".env file read", 1, 1, []],
				],
			},
		]);
		expect(merged.map((hit) => hit.rule)).toEqual([
			"rm -rf outside /tmp",
			".env file read",
			"secret-looking string in output",
		]);
	});

	test("runs: each run gets its failed calls and first prompt from their own statements, or none", () => {
		expect(
			joinDigestRuns({
				runs: [
					["r1", "s1", "", 1, 2.5, 1, 0, 0],
					["r2", "s1", "", 2, 1, 1, 1, 0],
				],
				failures: [["r2", 3, 1]],
				asked: [["r1", "fix it", 6, ""]],
			}),
		).toEqual({
			runs: [
				["r1", "s1", "", 1, 2.5, 1, 0, 0, 0, 0, "fix it", 6, ""],
				["r2", "s1", "", 2, 1, 1, 1, 0, 3, 1, "", 0, ""],
			],
		});
	});

	test("unexplained: coverage counts what patterns and rows explain, the rest is listed with examples", () => {
		const facts = inputs().runs.runs as unknown[][];
		const runs = facts.map((t) => ({
			rid: String(t[0]),
			sid: String(t[1]),
			aid: "",
			turn: Number(t[3]),
			minutes: Number(t[4]),
			active: Number(t[5]),
			frustrated: t[6] === 1,
			reasked: t[7] === 1,
			failed: Number(t[8]),
			sorted: Number(t[9]),
			quote: String(t[10]),
			chars: Number(t[11]),
			kind: String(t[12]),
		}));
		const { coverage, upset } = coverageOf(runs, inputs().patterns);
		expect(coverage.frustrated).toEqual({ explained: 1, total: 2 });
		expect(coverage.failed).toEqual({ explained: 4, total: 6 });
		expect(coverage.active).toEqual({ explained: 5, total: 24 });
		expect(upset.map((run) => run.rid)).toEqual(["r3"]);
		const rows = section("j")?.rows ?? [];
		expect(rows[0]?.metric).toBe("coverage");
		expect(rows[0]?.value).toContain(
			"frustrated prompts and re-asks 1/2 (50%)",
		);
		expect(
			rows.find((row) =>
				row.metric.startsWith("frustrated prompts and re-asks no pattern"),
			)?.value,
		).toContain('s2#2 "no that broke it"');
		expect(
			rows.find((row) => row.metric === "long runs no pattern covers")?.value,
		).toContain("at or above p90 (50 min)");
		expect(
			rows.find(
				(row) => row.metric === "failed calls no pattern or row explains",
			)?.value,
		).toContain("2 in 2 sessions");
		expect(
			rows.find(
				(row) => row.metric === "long or steering prompts no theme covers",
			)?.value,
		).toContain("1 queued while working");
	});

	test("not recorded is said, never shown as zero", () => {
		const text = renderDigest(buildDigest(inputs(), scope));
		expect(text).toContain(
			"Not recorded (never shown as 0): claude_code: nothing (every row is recorded); codex: call timeouts, compaction trigger, queued prompts.",
		);
		expect(text).toContain("- skipped: context size codex main: not recorded");
		expect(text).toContain("- skipped: call timeouts: not recorded for codex");
		expect(text).toContain("codex main trigger not recorded 1");
		expect(text).toContain("(queued: not recorded for codex)");
	});

	test("examples carry their run's start, the prompt's timestamp in the transcript, so a reader can find them there", () => {
		const digest = buildDigest(inputs(), scope);
		const refs = digestExampleRefs(digest);
		expect(refs.length).toBeGreaterThan(0);
		const times = new Map(
			refs.map((ref, index) => [
				`${ref.sessionId}${ref.agentId ? `:${ref.agentId}` : ""}#${ref.turn}`,
				new Date(Date.UTC(2026, 10, 3, 9, index)).toISOString(),
			]),
		);
		const lines = renderDigest(digest, undefined, [], times)
			.split("\n")
			.filter((line) => line.includes(" e.g. "));
		expect(lines.some((line) => line.includes(" at 2026-11-03T09:"))).toBe(
			true,
		);
		for (const line of lines.filter((line) =>
			/ e\.g\. [^\s"]+#\d+$/u.test(line.replace(/ at \S+$/u, "")),
		))
			expect(line).toMatch(/ e\.g\. \S+#\d+ at 2026-11-03T09:\d{2}:00\.000Z$/u);
		expect(renderDigest(digest)).not.toMatch(/#\d+ at 20/u);
	});

	test("an example id reads as session, stream and turn, and its time is looked up in the picked runs only", () => {
		expect(exampleRef("s-1#4")).toEqual({
			sessionId: "s-1",
			agentId: "",
			turn: 4,
		});
		expect(exampleRef("s-1:a9f#2")).toEqual({
			sessionId: "s-1",
			agentId: "a9f",
			turn: 2,
		});
		expect(exampleRef("ids s-1 s-2")).toBeNull();
		const sql = digestExampleTimesSql(params, [
			{ sessionId: "s-1", agentId: "", turn: 4 },
			{ sessionId: "s'1", agentId: "a9f", turn: 2 },
		]);
		expect(sql).toContain(
			"(session_id, agent_id, turn_idx) IN (('s-1', '', 4), ('s\\'1', 'a9f', 2))",
		);
		expect(sql).toContain("(user_id, session_id) IN (SELECT arrayJoin(");
	});

	test("rules the person states in later prompts are listed, those said in 2+ sessions first", () => {
		const row = buildDigest(inputs(), scope)
			.sections.flatMap((section) => section.rows)
			.find((candidate) => candidate.metric === "rules said in prompts");
		expect(row?.value).toBe(
			'3 prompts in 2 sessions; said in 2+ sessions: 1; "dont use a mono" 2 sess 2 texts: s1#4 "dont use a mono font" · "always dark mode first" 1 sess 1 texts: s2#2 "always dark mode first"',
		);
		expect(row?.example).toBe("s1#4");
		const rule = new RegExp(RULE_RE, "gu");
		expect(
			"ok but dont use a mono font. and from now on test in dia, not chrome".match(
				rule,
			),
		).toEqual(["dont use a mono", "from now on test in dia"]);
		expect("i dont know".match(rule)).toEqual(["dont know"]);
	});

	test("thresholds come from the cohort: context size p90 and long runs", () => {
		const text = renderDigest(buildDigest(inputs(), scope));
		expect(text).toContain(
			"context size claude_code main: 10 requests; p50 100k, p90 300k, p99 450k, max 500k; above p90 (300k) in 1 sessions",
		);
		expect(text).not.toContain(">200k");
	});

	test("every row carries a definition, and the text names the scope and the cohort", () => {
		const digest = buildDigest(inputs(), scope);
		for (const row of digest.sections.flatMap((s) => s.rows))
			expect({
				metric: row.metric,
				defined: row.definition.length > 10,
			}).toEqual({ metric: row.metric, defined: true });
		const text = renderDigest(digest, 1234);
		expect(text.split("\n")[0]).toBe(
			"retro digest athena 2026-10-06..2026-11-03: 3 sessions (claude_code 2, codex 1), 1.2 s",
		);
		expect(text).toContain(
			"subagent fan-out: 1 sessions ran subagents (2 streams), 1 ran 2+ at once",
		);
		expect(text).not.toMatch(
			/sessions overlapping|another session|within an hour/u,
		);
	});

	test("file edits by route count calls and file touches, by route and by basis", () => {
		const row = buildDigest(inputs(), scope)
			.sections.flatMap((s) => s.rows)
			.find((r) => r.metric === "file edits by route");
		expect(row?.value).toBe(
			"python inline script 5 calls, 7 file touches (56% of calls, 2 sess); edit tool Edit 4 calls, 4 file touches (44% of calls, 2 sess); by basis: script 5 calls, 7 file touches; tool 4 calls, 4 file touches",
		);
		expect(row?.definition).toContain("file touches = paths of those calls");
		expect(row?.example).toBe("s2#1");
	});

	test("an empty cohort renders every section without rows", () => {
		const empty = buildDigest(
			{
				sessions: {},
				calls: {},
				edits: {},
				usage: {},
				runs: {},
				severity: [],
				startDirs: [],
				contextSizes: [],
				patterns: [],
			},
			scope,
		);
		expect(empty.sessions).toBe(0);
		expect(renderDigest(empty)).toContain("## a. Start and setup");
	});
});

describe("digest secrets", () => {
	const openai = `sk-proj-${"A1b2C3d4E5".repeat(4)}`;
	const github = `ghp_${"q8W7e6R5t4Y3u2I1o0P9".repeat(2)}`;
	const anthropic = `sk-ant-api03-${"Zx9Yw8Vu7T".repeat(5)}`;
	const vercel = "vt_9f8e7d6c5b4a3210";
	const scope = {
		repository: "athena",
		from: "2026-10-06",
		to: "2026-11-03",
		latest: null,
		listed: null,
	};

	test("a secret-looking token keeps its prefix and length", () => {
		expect(maskSecrets(`OPENAI_API_KEY=${openai} bun run`)).toBe(
			"OPENAI_API_KEY=sk-…[48 chars] bun run",
		);
		expect(maskSecrets(`git push https://x:${github}@github.com/o/r`)).toBe(
			"git push https://x:ghp_…[44 chars]@github.com/o/r",
		);
		expect(maskSecrets("aws s3 ls --profile p AKIAIOSFODNN7EXAMPLE")).toBe(
			"aws s3 ls --profile p AKIA…[20 chars]",
		);
		expect(
			maskSecrets(
				"curl -H 'x: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlc2ln'",
			),
		).toBe("curl -H 'x: eyJ…[57 chars]'");
		expect(
			maskSecrets("-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQEA"),
		).toBe("-----BEGIN RSA PRIVATE KEY-----…[49 chars]");
	});

	test(".env-style pairs whose key looks secret keep the key and the value's length", () => {
		expect(
			maskSecrets(
				`VERCEL_TOKEN=${vercel} DB_PASSWORD='hunter2hunter2' vercel deploy --prod`,
			),
		).toBe(
			"VERCEL_TOKEN=…[19 chars] DB_PASSWORD='…[14 chars]' vercel deploy --prod",
		);
		for (const text of [
			"NODE_ENV=production PATH=/usr/bin bun test",
			"git reset --hard origin/main",
			"cat apps/api/.env.local",
			"task-runner --watch src",
		])
			expect(maskSecrets(text)).toBe(text);
	});

	test("masking is idempotent", () => {
		const text = `export OPENAI_API_KEY=${openai} GITHUB_TOKEN=${github} SECRET=abcdef123456`;
		const once = maskSecrets(text);
		expect(maskSecrets(once)).toBe(once);
	});

	test("severity examples and every other row mask secrets before they are cut", () => {
		const base = inputs();
		const digest = buildDigest(
			{
				...base,
				severity: [
					{
						severity: [
							[
								"production",
								"deploy or publish command",
								1,
								1,
								[["s1#1", `VERCEL_TOKEN=${vercel} vercel deploy --prod`]],
							],
							[
								"destructive",
								"rm -rf outside /tmp",
								1,
								1,
								[
									[
										"s2#1",
										`cd build && echo done; export KEY=${anthropic} && rm -rf dist`,
									],
								],
							],
						],
					},
				],
				patterns: [
					...base.patterns,
					{
						id: "fc_secret0001",
						kind: "failing_call",
						signature: `gh: bad credentials for ${github}`,
						count: 9,
						runs: 9,
						sessions: 3,
						minutes: 2,
						examples: ["s3#1"],
						rids: [],
					},
				],
			},
			scope,
		);
		const text = renderDigest(digest);
		for (const out of [text, JSON.stringify(digest)])
			for (const secret of [openai, github, anthropic, vercel])
				expect(out).not.toContain(secret.slice(8, 16));
		const severity = digest.sections.find((s) => s.id === "i")?.rows ?? [];
		expect(
			severity.find((r) => r.metric === "production-looking writes or deploys")
				?.value,
		).toContain('"VERCEL_TOKEN=…[19 chars] vercel deploy …"');
		expect(
			severity.find((r) => r.metric === "destructive commands")?.value,
		).toContain('"cd build && echo done; export KEY=sk-…[63 chars]…"');
		expect(text).toContain("gh: bad credentials for ghp_…[44 chars]");
	});
});
