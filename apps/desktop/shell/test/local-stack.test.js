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

const FAKE_LAUNCHER = `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + "\\n");
const out = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
const base = process.env.FAKE_BASE;
if (args[0] === "start") {
	const failFile = process.env.FAKE_FAIL_FILE;
	const left = failFile && fs.existsSync(failFile) ? Number(fs.readFileSync(failFile, "utf8")) : 0;
	if (left > 0) {
		fs.writeFileSync(failFile, String(left - 1));
		out({ type: "error", message: "fetch failed" });
		process.exit(1);
	}
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
		out({ type: "setup", created: true, credentials: "keep", user: { id: "u", email: "me@x.dev", name: "Me" }, organization: { id: "o", slug: "me", name: "Me" } });
		out({ type: "login", url: base + "/api/selfhost/login?token=first" });
	} else {
		out({ type: "ready", url: base, localUrl: base, alreadyRunning: true });
	}
	out({ type: "done", url: base });
} else if (args[0] === "open") {
	out({ url: base + "/api/selfhost/login?token=again", signIn: true, dashboardUrl: base });
}
`;

let root;
let server;
let base;
let healthy = true;
const saved = {};
const ENV = [
	"OPALINE_SERVER_DATA_DIR",
	"OPALINE_DESKTOP_LOCAL_SERVER",
	"OPALINE_DESKTOP_SERVER_PORT",
	"FAKE_LOG",
	"FAKE_BASE",
	"FAKE_FAIL_FILE",
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
	fs.writeFileSync(path.join(root, "local-server.js"), FAKE_LAUNCHER);
	process.env.OPALINE_SERVER_DATA_DIR = path.join(root, "server");
	process.env.OPALINE_DESKTOP_LOCAL_SERVER = path.join(root, "local-server.js");
	process.env.FAKE_LOG = path.join(root, "calls.jsonl");
	process.env.FAKE_BASE = base;
	process.env.OPALINE_DESKTOP_SERVER_PORT = "4100";
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

function fakeApp() {
	return {
		isPackaged: false,
		getAppPath: () => root,
		getPath: (name) => path.join(root, name === "logs" ? "logs" : "userData"),
	};
}

function fakeWindow(cookies = [], fetch) {
	const loaded = [];
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
			on: () => {},
			once: () => {},
			isDestroyed: () => false,
			getURL: () => loaded.at(-1) ?? "",
		},
	};
}

function calls() {
	if (!fs.existsSync(process.env.FAKE_LOG)) return [];
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
	test("finds the runtimes, the server package and the launcher in the app", () => {
		const resources = path.join(root, "Resources");
		const appRoot = path.join(resources, "app");
		for (const file of [
			"runtimes/clickhouse-1/clickhouse",
			"runtimes/postgres-1/bin/postgres",
			"runtimes/bun-1/bun",
			"server/opaline-server-0.18.0.json",
			"server/opaline-server-0.18.0.tgz",
			"app/local-server/local-server.js",
			"app/agent-plugin/.mcp.json",
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
		delete process.env.OPALINE_DESKTOP_LOCAL_SERVER;
		const bundle = resolveBundle({
			app: { ...fakeApp(), isPackaged: true, getAppPath: () => appRoot },
			resourcesPath: resources,
		});
		expect(bundle.launcherPath).toBe(
			path.join(appRoot, "local-server", "local-server.js"),
		);
		expect(bundle.pluginDir).toBe(path.join(appRoot, "agent-plugin"));
		expect(bundleEnvironment(bundle)).toEqual({
			OPALINE_DESKTOP_APP: "1",
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

	test("reads the local server URL and key, and maps launcher events to setup steps", () => {
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
		expect(stepForEvent({ type: "setup" })).toMatchObject({
			step: "account",
			state: "done",
		});
		expect(stepForEvent({ type: "log" })).toBeUndefined();
	});
});

describe("the local stack controller", () => {
	test("first launch: prepare, then hand the first sign-in link to the window", async () => {
		const stack = createLocalStack({ app: fakeApp() });
		const steps = [];
		stack.on("progress", (event) => steps.push([event.step, event.state]));
		await stack.prepare();
		const win = fakeWindow();
		await stack.openDashboard(win);
		expect(win.loaded).toEqual([`${base}/api/selfhost/login?token=first`]);
		expect(stack.environment()).toEqual({ kind: "local" });
		expect(calls()).toEqual([["start"]]);
		for (const step of ["runtimes", "databases", "server", "account"])
			expect(steps).toContainEqual([step, "done"]);
		expect(stack.agentServer()).toEqual({
			url: base,
			mcpUrl: `${base}/api/mcp`,
			apiKey: "key-1",
			dataDir: path.join(root, "server"),
		});
	});

	test("the intro opens signed in: the window's session follows the sign-in link, then loads the dashboard with the intro flag", async () => {
		const stack = createLocalStack({ app: fakeApp() });
		await stack.prepare();
		const fetched = [];
		const win = fakeWindow([], async (url, cookies) => {
			fetched.push(url);
			cookies.push({ name: "better-auth.session_token", value: "x" });
			return new Response(null, { status: 200 });
		});
		await stack.openDashboard(win, undefined, { intro: true });
		expect(fetched).toEqual([`${base}/api/selfhost/login?token=first`]);
		expect(win.loaded).toEqual([`${base}/dashboard?opaline-intro=1`]);
	});

	test("a later launch with a session cookie and a running server loads the dashboard without a new start", async () => {
		const stack = createLocalStack({ app: fakeApp() });
		await stack.prepare();
		await stack.ensureLocal();
		fs.writeFileSync(process.env.FAKE_LOG, "");
		const again = createLocalStack({ app: fakeApp() });
		const win = fakeWindow([{ name: "better-auth.session_token", value: "x" }]);
		await again.openDashboard(win);
		expect(win.loaded).toEqual([`${base}/`]);
		expect(calls()).toEqual([]);
		expect(again.isAppUrl(`${base}/repos`)).toBe(true);
		expect(again.isAppUrl("https://opaline.so/")).toBe(false);
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
		expect(calls()).toEqual([["start"]]);
	});

	test("callers that need the server while a start failed share one new start instead of racing two", async () => {
		process.env.FAKE_FAIL_FILE = path.join(root, "fail");
		fs.writeFileSync(process.env.FAKE_FAIL_FILE, "2");
		const stack = createLocalStack({ app: fakeApp() });
		const prepared = stack.prepare();
		const [dashboard, agents] = await Promise.all([
			stack.ready(),
			stack.ready(),
		]);
		expect(await prepared).toBeUndefined();
		expect(dashboard?.configured).toBe(true);
		expect(agents?.configured).toBe(true);
		expect(calls()).toEqual([["start"], ["start"], ["start"]]);
	});

	test("the supervisor finishes a server that runs but was never set up, then tells the windows", async () => {
		const dataDir = process.env.OPALINE_SERVER_DATA_DIR;
		fs.mkdirSync(dataDir, { recursive: true });
		const port = Number(new URL(base).port);
		fs.writeFileSync(
			path.join(dataDir, "server.json"),
			JSON.stringify({ publicUrl: base, host: "127.0.0.1", port }),
		);
		const stack = createLocalStack({ app: fakeApp() });
		const seen = [];
		stack.on("healthy", () => seen.push("healthy"));
		let restarted = 0;
		const stop = stack.supervise({
			intervalMs: 20,
			allowedMisses: 2,
			onRestart: () => {
				restarted++;
				seen.push("restarted");
			},
		});
		await until(() => seen.includes("healthy"));
		stop();
		expect(restarted).toBe(1);
		expect(seen).toEqual(["restarted", "healthy"]);
		expect(calls()).toEqual([["start"]]);
		expect(stack.localServer()?.configured).toBe(true);
	});

	test("the supervisor says once when the server answers again, so a window that could not open retries", async () => {
		const stack = createLocalStack({ app: fakeApp() });
		await stack.prepare();
		healthy = false;
		let answered = 0;
		stack.on("healthy", () => answered++);
		const stop = stack.supervise({ intervalMs: 20, allowedMisses: 1_000 });
		await new Promise((resolve) => setTimeout(resolve, 120));
		expect(answered).toBe(0);
		healthy = true;
		await until(() => answered === 1);
		await new Promise((resolve) => setTimeout(resolve, 120));
		stop();
		expect(answered).toBe(1);
	});

	test("a plain quit leaves the server running; quitting completely or leaving this Mac stops it", async () => {
		const stack = createLocalStack({ app: fakeApp() });
		await stack.prepare();
		await stack.ensureLocal();
		fs.writeFileSync(process.env.FAKE_LOG, "");
		stack.detach();
		expect(calls()).toEqual([]);
		await stack.shutdown();
		expect(calls()).toEqual([["stop"]]);
		fs.writeFileSync(process.env.FAKE_LOG, "");
		const other = createLocalStack({ app: fakeApp() });
		await other.useEnvironment({
			kind: "server",
			url: base.replace("127.0.0.1", "localhost"),
		});
		await until(() => calls().length === 1);
		expect(calls()).toEqual([["stop"]]);
		fs.writeFileSync(process.env.FAKE_LOG, "");
		await other.shutdown();
		expect(calls()).toEqual([]);
	});

	test("your server: the window opens it and signs in there; then back to this Mac", async () => {
		const stack = createLocalStack({ app: fakeApp() });
		await stack.prepare();
		await stack.ensureLocal();
		const win = fakeWindow([{ name: "better-auth.session_token", value: "x" }]);
		const other = base.replace("127.0.0.1", "localhost");
		await stack.useEnvironment({ kind: "server", url: other }, win);
		expect(win.loaded).toEqual([`${other}/`]);
		expect(stack.isAppUrl(`${other}/x`)).toBe(true);
		await expect(
			stack.useEnvironment({ kind: "server", url: "http://127.0.0.1:9" }, win),
		).rejects.toThrow("Could not reach");
		await stack.useEnvironment({ kind: "local" }, win);
		expect(stack.environment()).toEqual({ kind: "local" });
		expect(win.loaded.at(-1)).toBe(`${base}/`);
	});
});
