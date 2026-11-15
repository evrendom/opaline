const {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
	bundleEnvironment,
	createLocalStack,
	readLocalServer,
	resolveBundle,
	stepForEvent,
} = require("../stack/local-stack");

const FAKE_CLI = `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + "\\n");
const out = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
const base = process.env.FAKE_BASE;
const key = args.slice(0, 2).join(" ");
if (key === "server start") {
	const dataDir = process.env.OPALINE_SERVER_DATA_DIR;
	const fresh = !fs.existsSync(path.join(dataDir, "server.json"));
	fs.mkdirSync(dataDir, { recursive: true });
	const port = Number(new URL(base).port);
	fs.writeFileSync(path.join(dataDir, "server.json"), JSON.stringify({ publicUrl: base, host: "127.0.0.1", port, setup: { apiKey: "key-1" } }));
	if (fresh) {
		out({ type: "runtime", name: "clickhouse", phase: "ready", version: "26.10.2.103", source: "explicit", path: "/r/ch" });
		out({ type: "starting", service: "clickhouse" });
		out({ type: "starting", service: "postgres" });
		out({ type: "starting", service: "server" });
		out({ type: "ready", url: base, localUrl: base, alreadyRunning: false });
		out({ type: "setup", created: true, credentials: "write", user: { id: "u", email: "me@x.dev", name: "Me" }, organization: { id: "o", slug: "me", name: "Me" } });
		out({ type: "login", url: base + "/api/selfhost/login?token=first" });
	} else {
		out({ type: "ready", url: base, localUrl: base, alreadyRunning: true });
		out({ type: "setup", created: false, credentials: "unchanged", user: { id: "u", email: "me@x.dev", name: "Me" }, organization: { id: "o", slug: "me", name: "Me" } });
		if (args.includes("--yes")) out({ type: "agents", hooks: [{ agent: "claude_code", status: "installed" }], mcp: ["Claude Code: added"] });
	}
	out({ type: "done", url: base });
} else if (key === "server open") {
	out({ url: base + "/api/selfhost/login?token=again", signIn: true, dashboardUrl: base });
} else if (args[0] === "login") {
	const server = args[args.indexOf("--server") + 1];
	out({ type: "authorize", url: server + "/welcome?user_code=AB-CD", userCode: "AB-CD" });
	fs.writeFileSync(path.join(process.env.OPALINE_CONFIG_DIR, "credentials.json"), JSON.stringify({ apiBaseUrl: server, token: "k2" }));
	out({ type: "signed-in", apiBase: server });
	out({ type: "done", apiBase: server });
} else if (args[0] === "import") {
	const failed = args.slice(1).filter((file) => file.includes("fail"));
	for (const file of failed) process.stderr.write("Upload of " + file + " failed: boom\\n");
	process.exit(failed.length ? 1 : 0);
} else if (key === "uploads pause") {
	out({ paused: true, pausedAt: "2026-11-09T00:00:00Z" });
} else if (key === "uploads resume") {
	out({ paused: false, wasPaused: true, queued: 0 });
}
`;

let root;
let server;
let base;
let healthy = true;
const saved = {};
const ENV = [
	"CLAUDE_CONFIG_DIR",
	"CODEX_HOME",
	"OPALINE_SERVER_DATA_DIR",
	"OPALINE_CONFIG_DIR",
	"OPALINE_DESKTOP_CLI",
	"OPALINE_DESKTOP_SERVER_PORT",
	"FAKE_LOG",
	"FAKE_BASE",
];

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === "/health/ready")
				return new Response("ok", { status: healthy ? 200 : 503 });
			if (url.pathname === "/api/selfhost/info")
				return Response.json({
					selfHosted: true,
					version: "0.18.0",
					appUrl: url.origin,
					mcpUrl: `${url.origin}/api/mcp`,
					setupComplete: true,
				});
			return new Response("not found", { status: 404 });
		},
	});
	base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

beforeEach(() => {
	healthy = true;
	root = fs.mkdtempSync(path.join(os.tmpdir(), "opaline-desktop-controller-"));
	for (const key of ENV) saved[key] = process.env[key];
	fs.mkdirSync(path.join(root, "config"));
	fs.writeFileSync(path.join(root, "cli.js"), FAKE_CLI);
	fs.writeFileSync(path.join(root, "userData-shell.json"), "");
	process.env.OPALINE_SERVER_DATA_DIR = path.join(root, "server");
	process.env.OPALINE_CONFIG_DIR = path.join(root, "config");
	process.env.OPALINE_DESKTOP_CLI = path.join(root, "cli.js");
	process.env.FAKE_LOG = path.join(root, "calls.jsonl");
	process.env.FAKE_BASE = base;
	process.env.OPALINE_DESKTOP_SERVER_PORT = "4100";
	process.env.CLAUDE_CONFIG_DIR = path.join(root, "claude");
	process.env.CODEX_HOME = path.join(root, "codex");
	writeSession("claude/projects/-work-app/a.jsonl", 1);
	writeSession("claude/projects/-work-app/b.jsonl", 2);
	writeSession("claude/projects/-work-old/old.jsonl", 40 * 24 * 60);
	writeSession("codex/sessions/2026/11/09/rollout-c.jsonl", 3);
	fs.mkdirSync(path.join(root, "userData"), { recursive: true });
	fs.writeFileSync(
		path.join(root, "userData", "shell-path.json"),
		JSON.stringify({ at: Date.now(), path: "/usr/bin:/bin" }),
	);
});

afterEach(() => {
	for (const key of ENV) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
	fs.rmSync(root, { recursive: true, force: true });
});

function writeSession(relative, minutesAgo) {
	const file = path.join(root, relative);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, "{}\n");
	const at = new Date(Date.now() - minutesAgo * 60_000);
	fs.utimesSync(file, at, at);
	return file;
}

function fakeApp() {
	return {
		isPackaged: false,
		getAppPath: () => root,
		getPath: (name) => path.join(root, name === "logs" ? "logs" : "userData"),
	};
}

function fakeWindow(cookies = [], fetch) {
	const loaded = [];
	const handlers = {};
	return {
		loaded,
		isDestroyed: () => false,
		isVisible: () => true,
		loadURL: async (url) => {
			loaded.push(url);
		},
		webContents: {
			session: {
				cookies: { get: async () => cookies },
				...(fetch ? { fetch: (url) => fetch(url, cookies) } : {}),
			},
			on: (name, handler) => {
				handlers[name] = handler;
			},
			once: () => {},
			isDestroyed: () => false,
			getURL: () => loaded.at(-1) ?? "",
			executeJavaScript: async () => 7,
		},
	};
}

function calls() {
	return fs
		.readFileSync(process.env.FAKE_LOG, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

async function until(check, timeoutMs = 5_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out");
}

describe("bundle", () => {
	test("finds the runtimes, the server package and the CLI in the resources", () => {
		const resources = path.join(root, "Resources");
		for (const file of [
			"runtimes/clickhouse-1/clickhouse",
			"runtimes/postgres-1/bin/postgres",
			"runtimes/bun-1/bun",
			"server/opaline-server-0.18.0.json",
			"server/opaline-server-0.18.0.tgz",
			"cli/cli.js",
		]) {
			fs.mkdirSync(path.dirname(path.join(resources, file)), {
				recursive: true,
			});
			fs.writeFileSync(path.join(resources, file), "");
		}
		fs.writeFileSync(
			path.join(resources, "runtimes", "runtimes.json"),
			JSON.stringify({
				clickhouse: { path: "clickhouse-1/clickhouse" },
				postgres: { path: "postgres-1/bin" },
				bun: { path: "bun-1/bun" },
			}),
		);
		const saved = process.env.OPALINE_DESKTOP_CLI;
		delete process.env.OPALINE_DESKTOP_CLI;
		const bundle = resolveBundle({
			app: { ...fakeApp(), isPackaged: true },
			resourcesPath: resources,
		});
		process.env.OPALINE_DESKTOP_CLI = saved;
		expect(bundle.cliPath).toBe(path.join(resources, "cli", "cli.js"));
		expect(bundleEnvironment(bundle)).toEqual({
			OPALINE_CLICKHOUSE_BIN: path.join(
				resources,
				"runtimes/clickhouse-1/clickhouse",
			),
			OPALINE_POSTGRES_BIN_DIR: path.join(resources, "runtimes/postgres-1/bin"),
			OPALINE_BUN_BIN: path.join(resources, "runtimes/bun-1/bun"),
			OPALINE_SERVER_ARTIFACT: path.join(
				resources,
				"server/opaline-server-0.18.0.json",
			),
		});
	});

	test("reads the local server URL and key, and maps CLI events to setup steps", () => {
		const dataDir = path.join(root, "s");
		fs.mkdirSync(dataDir);
		fs.writeFileSync(
			path.join(dataDir, "server.json"),
			JSON.stringify({
				publicUrl: "http://localhost:4100",
				host: "0.0.0.0",
				port: 4100,
				setup: { apiKey: "k" },
			}),
		);
		expect(readLocalServer(dataDir)).toEqual({
			publicUrl: "http://localhost:4100",
			localUrl: "http://127.0.0.1:4100",
			apiKey: "k",
			configured: true,
		});
		expect(
			stepForEvent({ type: "starting", service: "postgres" }),
		).toMatchObject({ step: "databases", state: "active" });
		expect(stepForEvent({ type: "starting", service: "server" })).toMatchObject(
			{ step: "server", state: "active" },
		);
		expect(stepForEvent({ type: "agents" })).toMatchObject({
			step: "agents",
			state: "done",
		});
		expect(stepForEvent({ type: "log" })).toBeUndefined();
	});
});

describe("the local stack controller", () => {
	test("first launch: prepare, hand the login link to the window, then wire agents and import history", async () => {
		const stack = createLocalStack({ app: fakeApp() });
		const steps = [];
		stack.on("progress", (event) => steps.push([event.step, event.state]));
		await stack.prepare();
		const win = fakeWindow();
		await stack.openDashboard(win);
		expect(win.loaded).toEqual([`${base}/api/selfhost/login?token=first`]);
		await until(() => stack.settings.read().historyImportedAt !== undefined);
		expect(stack.environment()).toEqual({ kind: "local" });
		expect(calls()).toEqual([
			["server", "start", "--json", "--no-agent-setup"],
			["server", "start", "--json", "--yes"],
			[
				"import",
				path.join(root, "claude/projects/-work-app/a.jsonl"),
				path.join(root, "claude/projects/-work-app/b.jsonl"),
				path.join(root, "codex/sessions/2026/11/09/rollout-c.jsonl"),
			],
		]);
		for (const step of ["runtimes", "databases", "server", "account", "agents"])
			expect(steps).toContainEqual([step, "done"]);
		await until(() => stack.settings.read().historyImportedAt !== undefined);
		const status = await stack.status(win.webContents);
		expect(status).toMatchObject({
			running: true,
			sessionsToday: 7,
			ingest: { available: false },
			label: "This Mac",
		});
		expect(status.lines[0]).toBe("Opaline is running on this Mac");
	});

	test("the intro opens signed in: the window's session follows the sign-in link, then loads the dashboard with the intro flag", async () => {
		const stack = createLocalStack({ app: fakeApp() });
		await stack.prepare();
		const fetched = [];
		const win = fakeWindow([], async (url, cookies) => {
			fetched.push(url);
			cookies.push({ name: "better-auth.session_token", value: "x" });
			return new Response(null, { status: 302 });
		});
		await stack.openDashboard(win, undefined, { intro: true });
		expect(fetched).toEqual([`${base}/api/selfhost/login?token=first`]);
		expect(win.loaded).toEqual([`${base}/dashboard?opaline-intro=1`]);
	});

	test("the supervisor restarts a local server that stops answering", async () => {
		const stack = createLocalStack({ app: fakeApp() });
		await stack.prepare();
		await stack.ensureLocal();
		fs.writeFileSync(process.env.FAKE_LOG, "");
		let restarted = 0;
		healthy = false;
		const stop = stack.supervise({
			intervalMs: 20,
			allowedMisses: 2,
			onRestart: () => {
				restarted++;
				healthy = true;
			},
		});
		await until(() => restarted === 1);
		stop();
		expect(calls().filter((args) => args[0] === "server")).toEqual([
			["server", "start", "--json", "--no-agent-setup"],
		]);
	});

	test("quitting stops the local server, and leaving this Mac stops it too", async () => {
		const stack = createLocalStack({ app: fakeApp() });
		await stack.prepare();
		await stack.ensureLocal();
		await until(() => stack.settings.read().historyImportedAt !== undefined);
		fs.writeFileSync(process.env.FAKE_LOG, "");
		await stack.shutdown();
		expect(calls()).toEqual([["server", "stop"]]);
		fs.writeFileSync(process.env.FAKE_LOG, "");
		const other = createLocalStack({ app: fakeApp() });
		await other.useEnvironment({ kind: "cloud" });
		await until(() => calls().length === 1);
		expect(calls()).toEqual([["server", "stop"]]);
		fs.writeFileSync(process.env.FAKE_LOG, "");
		await other.shutdown();
		expect(calls()).toEqual([]);
	});

	test("later launch with a session cookie loads the dashboard without the CLI", async () => {
		const stack = createLocalStack({ app: fakeApp() });
		await stack.prepare();
		await stack.ensureLocal();
		fs.writeFileSync(process.env.FAKE_LOG, "");
		const again = createLocalStack({ app: fakeApp() });
		const win = fakeWindow([{ name: "better-auth.session_token", value: "x" }]);
		await again.openDashboard(win);
		expect(win.loaded).toEqual([`${base}/`]);
		expect(fs.readFileSync(process.env.FAKE_LOG, "utf8")).toBe("");
		expect(again.isAppUrl(`${base}/repos`)).toBe(true);
		expect(again.isAppUrl("https://opaline.so/")).toBe(false);
	});

	test("switching to your server signs the CLI in through the window, then back to this Mac", async () => {
		const stack = createLocalStack({ app: fakeApp() });
		await stack.prepare();
		await stack.ensureLocal();
		const win = fakeWindow([{ name: "better-auth.session_token", value: "x" }]);
		const other = base.replace("127.0.0.1", "localhost");
		await stack.useEnvironment({ kind: "server", url: other }, win);
		await until(() => win.loaded.length >= 3);
		expect(win.loaded).toEqual([
			`${other}/`,
			`${other}/welcome?user_code=AB-CD`,
			`${other}/`,
		]);
		expect(stack.isAppUrl(`${other}/x`)).toBe(true);
		await expect(
			stack.useEnvironment({ kind: "server", url: "http://127.0.0.1:9" }, win),
		).rejects.toThrow("Could not reach");
		await stack.useEnvironment({ kind: "local" }, win);
		expect(stack.environment()).toEqual({ kind: "local" });
		expect(
			calls()
				.filter((args) => args[0] === "server" && args[1] === "start")
				.at(-1),
		).toEqual(["server", "start", "--json", "--yes"]);
		expect(win.loaded.at(-1)).toBe(`${base}/`);
	});

	test("a later launch resumes the history import with only what is not imported yet", async () => {
		const stack = createLocalStack({ app: fakeApp() });
		await stack.prepare();
		await stack.ensureLocal();
		await until(() => stack.settings.read().historyImportedAt !== undefined);
		stack.settings.write({ historyImportedAt: undefined });
		const fresh = writeSession("claude/projects/-work-app/new.jsonl", 0);
		const failing = writeSession("claude/projects/-work-fail/fail.jsonl", 5);
		fs.writeFileSync(process.env.FAKE_LOG, "");
		const later = createLocalStack({ app: fakeApp() });
		later.afterLaunch({ delayMs: 0 });
		await until(() => later.settings.read().historyImportedAt !== undefined);
		expect(calls()).toEqual([["import", fresh, failing]]);
		const status = await later.status();
		expect(status.cliImport).toMatchObject({
			running: false,
			completed: 2,
			total: 2,
			failed: 1,
		});
		fs.writeFileSync(process.env.FAKE_LOG, "");
		later.settings.write({ historyImportedAt: undefined });
		expect(await later.importHistory()).toEqual({ started: true, sessions: 1 });
		await until(() => calls().length === 1);
		expect(calls()).toEqual([["import", failing]]);
	});

	test("the history import never uploads when the app is not on this Mac", async () => {
		const stack = createLocalStack({ app: fakeApp() });
		stack.settings.write({ environment: { kind: "cloud" } });
		expect(await stack.importHistory()).toEqual({
			started: false,
			reason: "not-local",
		});
		stack.afterLaunch({ delayMs: 0 });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(fs.existsSync(process.env.FAKE_LOG)).toBe(false);
	});

	test("pause and resume uploads", async () => {
		const stack = createLocalStack({ app: fakeApp() });
		expect(await stack.pauseUploads()).toMatchObject({ paused: true });
		expect(stack.settings.read().uploadsPaused).toBe(true);
		expect(await stack.resumeUploads()).toMatchObject({
			paused: false,
			queued: 0,
		});
		expect(stack.settings.read().uploadsPaused).toBe(false);
	});
});
