const { afterEach, beforeEach, describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
	createSettingsStore,
	environmentLabel,
	environmentOrigin,
	normalizeServerUrl,
	validateEnvironment,
} = require("../stack/settings");
const {
	describeImport,
	formatEta,
	nextPollDelay,
	parseIngestStatus,
	statusSummary,
} = require("../stack/status");
const {
	createCliRunner,
	parseJsonLine,
	priorityCommand,
} = require("../stack/cli-runner");

let root;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "opaline-desktop-stack-"));
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("environments", () => {
	test("server addresses become origins, with http only for local networks by default", () => {
		expect(normalizeServerUrl("https://opaline.acme.dev/")).toEqual({
			ok: true,
			url: "https://opaline.acme.dev",
			plaintext: false,
		});
		expect(normalizeServerUrl("opaline.acme.dev")).toEqual({
			ok: true,
			url: "https://opaline.acme.dev",
			plaintext: false,
		});
		expect(normalizeServerUrl("nas.local:4100")).toEqual({
			ok: true,
			url: "http://nas.local:4100",
			plaintext: true,
		});
		expect(normalizeServerUrl("192.168.2.74:4100")).toEqual({
			ok: true,
			url: "http://192.168.2.74:4100",
			plaintext: true,
		});
		expect(normalizeServerUrl("localhost:4200")).toEqual({
			ok: true,
			url: "http://localhost:4200",
			plaintext: false,
		});
		expect(normalizeServerUrl("").ok).toBe(false);
		expect(normalizeServerUrl("https://x.dev/team").ok).toBe(false);
		expect(normalizeServerUrl("https://me:pw@x.dev").ok).toBe(false);
		expect(normalizeServerUrl("ftp://x.dev").ok).toBe(false);
	});

	test("labels, origins and validation", () => {
		expect(environmentLabel({ kind: "local" })).toBe("This Mac");
		expect(environmentLabel({ kind: "cloud" })).toBe("Opaline Cloud");
		expect(
			environmentLabel({ kind: "server", url: "http://nas.local:4100" }),
		).toBe("nas.local:4100");
		expect(environmentOrigin({ kind: "local" }, "http://localhost:4100")).toBe(
			"http://localhost:4100",
		);
		expect(environmentOrigin({ kind: "cloud" })).toBe("https://opaline.so");
		expect(
			validateEnvironment({ kind: "server", url: "nas.local:4100/" }),
		).toEqual({
			kind: "server",
			url: "http://nas.local:4100",
			plaintext: true,
		});
		expect(
			validateEnvironment({ kind: "cloud", url: "https://evil.dev" }),
		).toEqual({ kind: "cloud", url: "https://opaline.so" });
		expect(validateEnvironment({ kind: "elsewhere" })).toBeUndefined();
	});

	test("the settings file survives a restart and drops invalid values", () => {
		const store = createSettingsStore(root);
		expect(store.read()).toMatchObject({
			environment: undefined,
			theme: "system",
			uploadsPaused: false,
		});
		store.write({ environment: { kind: "local" }, uploadsPaused: true });
		expect(fs.statSync(store.file).mode & 0o777).toBe(0o600);
		expect(createSettingsStore(root).read()).toMatchObject({
			environment: { kind: "local" },
			uploadsPaused: true,
		});
		fs.writeFileSync(
			store.file,
			JSON.stringify({
				environment: { kind: "server", url: "javascript:alert(1)" },
			}),
		);
		expect(createSettingsStore(root).read().environment).toBeUndefined();
	});
});

describe("status", () => {
	test("the import endpoint degrades to unavailable on 404 or a bad answer", () => {
		expect(parseIngestStatus(404)).toEqual({ available: false });
		expect(parseIngestStatus(500, {})).toEqual({
			available: false,
			error: true,
		});
		expect(
			parseIngestStatus(200, {
				state: "importing",
				sessionsSeen: 420,
				sessionsIngested: 120,
				sessionsQueued: 300,
				bytesQueued: 1e9,
				lastIngestAt: "2026-11-09T10:00:00Z",
				etaSeconds: 95,
				backgroundPriority: true,
			}),
		).toEqual({
			available: true,
			state: "importing",
			sessionsSeen: 420,
			sessionsIngested: 120,
			sessionsQueued: 300,
			bytesQueued: 1e9,
			lastIngestAt: "2026-11-09T10:00:00Z",
			etaSeconds: 95,
			backgroundPriority: true,
		});
	});

	test("import progress comes from the server, else from the CLI upload", () => {
		const ingest = parseIngestStatus(200, {
			state: "importing",
			sessionsSeen: 420,
			sessionsIngested: 120,
			sessionsQueued: 300,
			etaSeconds: 95,
		});
		expect(describeImport(ingest)).toBe(
			"Importing history: 120 of 420 sessions, about 2 min left",
		);
		expect(
			describeImport(
				{ available: false },
				{ running: true, completed: 3, total: 40 },
			),
		).toBe("Importing history: 3 of 40 sessions");
		expect(
			describeImport({ available: false }, { running: false }),
		).toBeUndefined();
		expect(formatEta(30)).toBe("less than a minute left");
		expect(formatEta(5400)).toBe("about 1 h 30 min left");
		expect(formatEta(null)).toBe("");
	});

	test("polling slows down when nothing happens and the window is hidden", () => {
		expect(
			nextPollDelay({
				ingest: { available: false },
				cliImport: { running: true },
			}),
		).toBe(5_000);
		expect(
			nextPollDelay({ ingest: { available: false }, windowVisible: true }),
		).toBe(60_000);
		expect(
			nextPollDelay({ ingest: { available: false }, windowVisible: false }),
		).toBe(300_000);
	});

	test("summary lines for a menu bar", () => {
		expect(
			statusSummary({
				environment: "This Mac",
				running: true,
				sessionsToday: 1,
				paused: true,
				ingest: { available: false },
				cliImport: { running: true, completed: 2, total: 5 },
			}),
		).toEqual([
			"Opaline is running on this Mac",
			"1 session today",
			"Importing history: 2 of 5 sessions",
			"Uploads are paused",
		]);
		expect(
			statusSummary({ environment: "nas.local:4100", running: false }),
		).toEqual(["nas.local:4100 is not reachable"]);
	});
});

describe("the CLI runner", () => {
	test("priorities: taskpolicy -b on macOS for background work, nice elsewhere", () => {
		expect(priorityCommand("background", "/A", ["x"], "darwin")).toEqual({
			command: "/usr/sbin/taskpolicy",
			args: ["-b", "/A", "x"],
		});
		expect(priorityCommand("background", "/A", ["x"], "linux")).toEqual({
			command: "/usr/bin/nice",
			args: ["-n", "15", "/A", "x"],
		});
		expect(priorityCommand("low", "/A", ["x"], "darwin")).toEqual({
			command: "/usr/bin/nice",
			args: ["-n", "10", "/A", "x"],
		});
		expect(priorityCommand(undefined, "/A", ["x"], "darwin")).toEqual({
			command: "/A",
			args: ["x"],
		});
	});

	test("JSON lines become events, other lines stay text", () => {
		expect(parseJsonLine('{"type":"ready"}')).toEqual({ type: "ready" });
		expect(parseJsonLine("Starting ClickHouse")).toBeUndefined();
		expect(parseJsonLine("{broken")).toBeUndefined();
	});

	test("runs the CLI with the bundle environment and streams events", async () => {
		const cli = path.join(root, "cli.js");
		fs.writeFileSync(
			cli,
			`process.stdout.write(JSON.stringify({type:"argv",args:process.argv.slice(2),bin:process.env.OPALINE_CLICKHOUSE_BIN,dnt:process.env.DO_NOT_TRACK,node:process.env.ELECTRON_RUN_AS_NODE})+"\\nplain line\\n");process.stdout.write('{"type":"done"}');process.stderr.write("warn");process.exit(3);`,
		);
		const cacheFile = path.join(root, "shell-path.json");
		fs.writeFileSync(
			cacheFile,
			JSON.stringify({ at: Date.now(), path: "/usr/bin:/bin" }),
		);
		const lines = [];
		const runner = createCliRunner({
			cliPath: cli,
			environment: () => ({ OPALINE_CLICKHOUSE_BIN: "/r/clickhouse" }),
			cacheFile,
		});
		const events = [];
		const result = await runner.run(["server", "start", "--json"], {
			onEvent: (event) => events.push(event),
			onLine: (line) => lines.push(line),
		});
		expect(result.code).toBe(3);
		expect(result.stderr).toBe("warn");
		expect(events).toEqual([
			{
				type: "argv",
				args: ["server", "start", "--json"],
				bin: "/r/clickhouse",
				dnt: "1",
				node: "1",
			},
			{ type: "done" },
		]);
		expect(lines).toEqual(["plain line"]);
		expect(result.last).toEqual({ type: "done" });
	});
});

describe("history", () => {
	const {
		createImportLedger,
		failedPaths,
		listRecentSessions,
	} = require("../stack/history");

	test("lists Claude Code and Codex transcripts of the last 30 days, newest first", () => {
		const make = (relative, daysAgo, content = "{}\n") => {
			const file = path.join(root, relative);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, content);
			const at = new Date(Date.now() - daysAgo * 86_400_000);
			fs.utimesSync(file, at, at);
			return file;
		};
		const recent = make("home/.claude/projects/-w-a/s1.jsonl", 1);
		make("home/.claude/projects/-w-a/s1/subagents/agent-1.jsonl", 1);
		make("home/.claude/projects/-w-a/old.jsonl", 31);
		make("home/.claude/projects/-w-a/empty.jsonl", 1, "");
		const codex = make("home/.codex/sessions/2026/11/08/rollout-1.jsonl", 2);
		const archived = make("home/.codex/archived_sessions/rollout-0.jsonl", 3);
		const sessions = listRecentSessions({
			env: {},
			home: path.join(root, "home"),
		});
		expect(sessions.map((session) => [session.agent, session.path])).toEqual([
			["claude_code", recent],
			["codex", codex],
			["codex", archived],
		]);
		const moved = listRecentSessions({
			env: {
				CLAUDE_CONFIG_DIR: path.join(root, "elsewhere"),
				CODEX_HOME: path.join(root, "none"),
			},
			home: path.join(root, "home"),
		});
		expect(moved).toEqual([]);
	});

	test("the ledger remembers imported sessions across restarts", () => {
		const file = path.join(root, "ledger.json");
		createImportLedger(file).add(["a:1:2", "b:3:4"]);
		const again = createImportLedger(file);
		expect(again.has("a:1:2")).toBe(true);
		expect(again.has("c:5:6")).toBe(false);
		expect(fs.statSync(file).mode & 0o777).toBe(0o600);
	});

	test("failed uploads are read from the CLI's stderr", () => {
		expect([
			...failedPaths(
				"Upload of /a b.jsonl failed: boom\nother\nUpload of /c.jsonl failed: x\n",
			),
		]).toEqual(["/a b.jsonl", "/c.jsonl"]);
	});
});
