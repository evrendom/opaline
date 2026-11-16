const { execFile } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createCliRunner } = require("./cli-runner");
const {
	CLOUD_URL,
	createSettingsStore,
	environmentOrigin,
	normalizeServerUrl,
	validateEnvironment,
} = require("./settings");

const SETUP_STEPS = ["runtimes", "databases", "server", "account"];
const DEFAULT_PORT = 4100;
const LINK_RETRY_MS = 30_000;
const INTRO_PARAM = "opaline-intro";
const BLOCKED_PORTS = new Set([
	1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
	87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
	139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
	540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
	2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
	6679, 6697, 10080,
]);

function introUrl(url) {
	const next = new URL(url);
	next.searchParams.set(INTRO_PARAM, "1");
	return next.toString();
}

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

function firstExisting(candidates) {
	return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function resolveBundle({ app, resourcesPath }) {
	const bundled =
		process.resourcesPath &&
		(fs.existsSync(path.join(process.resourcesPath, "runtimes")) ||
			fs.existsSync(path.join(process.resourcesPath, "server")));
	const resources =
		resourcesPath ??
		process.env.OPALINE_DESKTOP_RESOURCES ??
		(app.isPackaged || bundled ? process.resourcesPath : undefined);
	const appRoot = app.getAppPath();
	const launcherPath = firstExisting([
		process.env.OPALINE_DESKTOP_LOCAL_SERVER,
		path.join(appRoot, "local-server", "local-server.js"),
		path.join(
			appRoot,
			"..",
			"..",
			"packages",
			"local-server",
			"dist",
			"local-server.js",
		),
	]);
	const pluginDir = firstExisting([
		path.join(appRoot, "agent-plugin"),
		path.join(appRoot, "..", "..", "plugins", "opaline"),
	]);
	const localPluginDir = firstExisting([
		path.join(appRoot, "agent-plugin-local"),
		path.join(appRoot, "..", "..", "plugins", "opaline-local"),
	]);
	const runtimesDir = resources && path.join(resources, "runtimes");
	const manifest = runtimesDir
		? readJson(path.join(runtimesDir, "runtimes.json"))
		: undefined;
	const runtime = (name) => {
		const relative =
			manifest?.layout === "downloads" ? undefined : manifest?.[name]?.path;
		const absolute = relative && path.join(runtimesDir, relative);
		return absolute && fs.existsSync(absolute) ? absolute : undefined;
	};
	const downloads =
		manifest?.layout === "downloads" &&
		Object.values(manifest.files ?? {}).every((file) =>
			fs.existsSync(path.join(runtimesDir, "downloads", file)),
		)
			? path.join(runtimesDir, "downloads")
			: undefined;
	const serverDir = resources && path.join(resources, "server");
	let serverManifest;
	try {
		const name = fs
			.readdirSync(serverDir)
			.filter((file) => /^opaline-server-.+\.json$/u.test(file))
			.sort()
			.at(-1);
		if (name) serverManifest = path.join(serverDir, name);
	} catch {}
	return {
		resources,
		launcherPath,
		pluginDir,
		localPluginDir,
		clickhouse: runtime("clickhouse"),
		postgres: runtime("postgres"),
		bun: runtime("bun"),
		downloads,
		serverManifest,
	};
}

function bundleEnvironment(bundle) {
	const env = { OPALINE_DESKTOP_APP: "1" };
	if (bundle.clickhouse) env.OPALINE_CLICKHOUSE_BIN = bundle.clickhouse;
	if (bundle.postgres) env.OPALINE_POSTGRES_BIN_DIR = bundle.postgres;
	if (bundle.bun) env.OPALINE_BUN_BIN = bundle.bun;
	if (bundle.downloads) {
		env.OPALINE_DOWNLOAD_CACHE = bundle.downloads;
		env.OPALINE_SERVER_RUNTIMES = "download";
	}
	if (bundle.serverManifest && !process.env.OPALINE_SERVER_DIR)
		env.OPALINE_SERVER_ARTIFACT = bundle.serverManifest;
	return env;
}

function serverDataDir(env = process.env) {
	const explicit = env.OPALINE_SERVER_DATA_DIR?.trim();
	return explicit
		? path.resolve(explicit)
		: path.join(os.homedir(), ".opaline", "server");
}

function readLocalServer(dataDir = serverDataDir()) {
	const state = readJson(path.join(dataDir, "server.json"));
	if (
		!state ||
		typeof state.publicUrl !== "string" ||
		typeof state.port !== "number"
	)
		return undefined;
	const host =
		state.host === "0.0.0.0" || state.host === "::" ? "127.0.0.1" : state.host;
	return {
		publicUrl: state.publicUrl,
		localUrl: `http://${host.includes(":") ? `[${host}]` : host}:${state.port}`,
		apiKey:
			typeof state.setup?.apiKey === "string" ? state.setup.apiKey : undefined,
		configured: Boolean(state.setup),
	};
}

function installedClickHouse(dataDir = serverDataDir()) {
	try {
		const name = fs
			.readdirSync(path.join(dataDir, "bin"))
			.filter((entry) => /^clickhouse-\d[\d.]*$/u.test(entry))
			.sort()
			.at(-1);
		const binary = name && path.join(dataDir, "bin", name, "clickhouse");
		return binary && fs.existsSync(binary) ? binary : undefined;
	} catch {
		return undefined;
	}
}

function isPortFree(port) {
	return new Promise((resolve) => {
		const probe = net.createServer();
		probe.once("error", () => resolve(false));
		probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
	});
}

async function firstServerPort(env = process.env, isFree = isPortFree) {
	const requested = Number.parseInt(env.OPALINE_DESKTOP_SERVER_PORT ?? "", 10);
	const valid =
		Number.isInteger(requested) && requested > 0 && requested < 65_536;
	if (valid && !BLOCKED_PORTS.has(requested)) return requested;
	const start = valid ? requested : DEFAULT_PORT;
	for (let port = start; port < start + 100 && port < 65_536; port++)
		if (!BLOCKED_PORTS.has(port) && (await isFree(port))) return port;
	return undefined;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 3_000) {
	return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

async function isHealthy(origin, timeoutMs = 1_500) {
	try {
		const response = await fetchWithTimeout(
			`${origin}/health/ready`,
			{},
			timeoutMs,
		);
		await response.body?.cancel();
		return response.ok;
	} catch {
		return false;
	}
}

function stepForEvent(event) {
	if (event.type === "runtime")
		return {
			step: "runtimes",
			state: event.phase === "ready" ? "progress" : "active",
			event,
		};
	if (event.type === "starting")
		return {
			step: event.service === "server" ? "server" : "databases",
			state: "active",
			event,
		};
	if (event.type === "ready") return { step: "server", state: "done", event };
	if (event.type === "setup") return { step: "account", state: "done", event };
	if (event.type === "error") return { step: undefined, state: "error", event };
	return undefined;
}

function createLocalStack(options) {
	const { app } = options;
	const emitter = new EventEmitter();
	const userData = app.getPath("userData");
	const logFile = path.join(app.getPath("logs"), "local-stack.log");
	const log = (line) => {
		options.log?.(line);
		try {
			fs.mkdirSync(path.dirname(logFile), { recursive: true });
			fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
		} catch {}
	};
	const bundle = resolveBundle(options);
	const settings = createSettingsStore(userData);
	const launcher = createCliRunner({
		cliPath: bundle.launcherPath,
		environment: () => bundleEnvironment(bundle),
		log,
		cacheFile: path.join(userData, "shell-path.json"),
	});
	let preparing;
	let ensuring;
	let starting = 0;
	let shuttingDown = false;
	let stopSupervising;
	let pendingLogin;
	let lastLink = 0;
	const watchedWindows = new WeakSet();
	const setupProgress = Object.fromEntries(
		SETUP_STEPS.map((step) => [step, "pending"]),
	);

	function progress(step, state, detail) {
		if (step) setupProgress[step] = state === "progress" ? "active" : state;
		emitter.emit("progress", {
			step,
			state,
			detail,
			steps: { ...setupProgress },
		});
	}

	function mark(name) {
		log(`mark ${name} ${Math.round(process.uptime() * 1000)} ms after launch`);
	}

	function forward(event) {
		if (event.type === "runtime" && event.phase === "ready") {
			mark(`runtime-${event.name}`);
			emitter.emit("runtime", event);
		}
		if (event.type === "ready") mark("server-ready");
		const mapped = stepForEvent(event);
		if (mapped) progress(mapped.step, mapped.state, mapped.event);
		if (event.type === "log") log(`server: ${event.message}`);
	}

	function environment() {
		return settings.read().environment;
	}

	function isLocal() {
		return (environment() ?? { kind: "local" }).kind === "local";
	}

	function localServer() {
		return readLocalServer();
	}

	function origin() {
		return environmentOrigin(
			environment() ?? { kind: "local" },
			localServer()?.publicUrl,
		);
	}

	function isAppUrl(url) {
		try {
			return new URL(url).origin === origin();
		} catch {
			return false;
		}
	}

	async function startServer({ priority } = {}) {
		starting++;
		try {
			const args = ["start"];
			if (!localServer()) {
				const port = await firstServerPort();
				if (port && port !== DEFAULT_PORT) args.push("--port", String(port));
			}
			const result = await launcher.run(args, { onEvent: forward, priority });
			const error = result.events.find((event) => event.type === "error");
			if (result.code !== 0 || error)
				throw new Error(
					error?.message ??
						(result.stderr.trim().split("\n").at(-1) ||
							"The local server did not start."),
				);
			const login = result.events.find((event) => event.type === "login")?.url;
			if (login) pendingLogin = { url: login, at: Date.now() };
			emitter.emit("server", localServer());
			return { setup: result.events.find((event) => event.type === "setup") };
		} finally {
			starting--;
		}
	}

	function clickhouseBinary(timeoutMs = 120_000) {
		const ready = bundle.clickhouse ?? installedClickHouse();
		if (ready) return Promise.resolve(ready);
		prepare();
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				emitter.off("runtime", listener);
				resolve(installedClickHouse());
			}, timeoutMs);
			const listener = (event) => {
				if (event.name !== "clickhouse") return;
				clearTimeout(timer);
				emitter.off("runtime", listener);
				resolve(event.path);
			};
			emitter.on("runtime", listener);
		});
	}

	function prepare({ attempts = 2, priority } = {}) {
		preparing ??= (async () => {
			for (let attempt = 1; attempt <= attempts; attempt++) {
				try {
					return await startServer({ priority });
				} catch (error) {
					log(`prepare attempt ${attempt} failed: ${error.message}`);
					if (shuttingDown) break;
				}
			}
			preparing = undefined;
			return undefined;
		})();
		return preparing;
	}

	function warmClickHouse() {
		if (!bundle.clickhouse) return;
		const started = Date.now();
		execFile(bundle.clickhouse, ["--version"], { timeout: 300_000 }, (error) =>
			log(
				`clickhouse first run ${error ? "failed" : "done"} in ${Date.now() - started} ms`,
			),
		);
	}

	async function ready() {
		const server = localServer();
		if (server?.configured && (await isHealthy(server.localUrl))) return server;
		await (preparing ?? prepare());
		const next = localServer();
		if (next?.configured && (await isHealthy(next.localUrl))) return next;
		await startServer();
		return localServer();
	}

	function ensureLocal() {
		ensuring ??= (async () => {
			try {
				progress("runtimes", "active");
				const server = await ready();
				if (!server?.configured)
					throw new Error("The local server is not set up.");
				for (const step of SETUP_STEPS)
					if (setupProgress[step] !== "done") progress(step, "done");
				if (environment()?.kind !== "local")
					settings.write({ environment: { kind: "local" } });
				return { url: server.publicUrl };
			} catch (error) {
				progress(undefined, "error", { message: error.message });
				throw error;
			} finally {
				ensuring = undefined;
			}
		})();
		return ensuring;
	}

	async function signInLink() {
		if (pendingLogin && Date.now() - pendingLogin.at < 8 * 60_000) {
			const { url } = pendingLogin;
			pendingLogin = undefined;
			lastLink = Date.now();
			return url;
		}
		const result = await launcher.run(["open"]);
		if (result.code !== 0 || !result.last?.url)
			throw new Error(result.last?.message ?? "No sign-in link.");
		lastLink = Date.now();
		return result.last.url;
	}

	async function hasSessionCookie(webContents, url) {
		try {
			const cookies = await webContents.session.cookies.get({ url });
			return cookies.some((cookie) =>
				/better-auth\.session_token$/u.test(cookie.name),
			);
		} catch {
			return false;
		}
	}

	async function signInSession(webContents, link, url) {
		if (typeof webContents.session.fetch !== "function") return false;
		try {
			const response = await webContents.session.fetch(link, {
				credentials: "include",
			});
			await response.body?.cancel();
		} catch (error) {
			log(`sign-in in the background failed: ${error.message}`);
			return false;
		}
		return hasSessionCookie(webContents, url);
	}

	function watchLoginRedirects(win) {
		if (watchedWindows.has(win)) return;
		watchedWindows.add(win);
		win.webContents.on("did-navigate", (_event, url) => {
			if (!isLocal()) return;
			const parsed = new URL(url);
			if (parsed.origin !== origin() || parsed.pathname !== "/login") return;
			if (Date.now() - lastLink < LINK_RETRY_MS) return;
			signInLink()
				.then((link) => !win.isDestroyed() && win.loadURL(link))
				.catch((error) =>
					log(`sign-in link after /login failed: ${error.message}`),
				);
		});
	}

	async function openLocal(win, target, intro) {
		await ensureLocal();
		const server = localServer();
		if (!server) throw new Error("The local server is not set up.");
		watchLoginRedirects(win);
		const base = target ?? `${server.publicUrl}${intro ? "/dashboard" : "/"}`;
		const url = intro ? introUrl(base) : base;
		if (await hasSessionCookie(win.webContents, server.publicUrl))
			return win.loadURL(url);
		const link = await signInLink();
		if (await signInSession(win.webContents, link, server.publicUrl)) {
			mark("signed-in");
			return win.loadURL(url);
		}
		return win.loadURL(link);
	}

	async function openDashboard(win, target, { intro = false } = {}) {
		const current = environment() ?? { kind: "local" };
		const shape = (url) => (intro ? introUrl(url) : url);
		win.webContents.once("did-finish-load", () => mark("dashboard-loaded"));
		try {
			if (current.kind === "local") return await openLocal(win, target, intro);
			if (current.kind === "cloud")
				return await win.loadURL(shape(target ?? `${CLOUD_URL}/dashboard`));
			return await win.loadURL(shape(target ?? `${current.url}/`));
		} catch (error) {
			log(`openDashboard failed: ${error.message}`);
			emitter.emit("error", error);
			throw error;
		}
	}

	async function checkServer(url) {
		const normalized = normalizeServerUrl(url);
		if (!normalized.ok) return normalized;
		try {
			const response = await fetchWithTimeout(
				`${normalized.url}/api/selfhost/info`,
				{},
				5_000,
			);
			if (response.status === 404)
				return {
					ok: false,
					message: `${normalized.url} is not a self-hosted Opaline server.`,
				};
			if (!response.ok)
				return {
					ok: false,
					message: `${normalized.url} answered ${response.status}.`,
				};
			const info = await response.json();
			if (info?.selfHosted !== true)
				return {
					ok: false,
					message: `${normalized.url} is not a self-hosted Opaline server.`,
				};
			return { ...normalized, version: info.version };
		} catch (error) {
			return {
				ok: false,
				message: `Could not reach ${normalized.url} (${error.message}).`,
			};
		}
	}

	async function stopLocal(timeoutMs = 30_000) {
		if (!localServer()) return undefined;
		const started = Date.now();
		const result = await launcher.run(["stop"], { timeoutMs });
		log(`stopped the local server in ${Date.now() - started} ms`);
		return result;
	}

	async function useEnvironment(next, win) {
		const target = validateEnvironment(next);
		if (!target) throw new Error("Unknown environment.");
		if (target.kind === "server") {
			const checked = await checkServer(target.url);
			if (!checked.ok) throw new Error(checked.message);
		}
		if (target.kind === "local") await ensureLocal();
		else stopLocal().catch(() => {});
		settings.write({ environment: target });
		emitter.emit("environment", target);
		if (win && !win.isDestroyed()) await openDashboard(win);
		return target;
	}

	function supervise({
		intervalMs = 15_000,
		allowedMisses = 2,
		onRestart,
	} = {}) {
		stopSupervising?.();
		let misses = 0;
		let timer;
		const schedule = () => {
			if (shuttingDown) return;
			timer = setTimeout(tick, intervalMs);
			timer.unref?.();
		};
		const tick = async () => {
			const server = localServer();
			if (!isLocal() || !server?.configured || starting > 0) {
				misses = 0;
				return schedule();
			}
			if (await isHealthy(server.localUrl, 3_000)) misses = 0;
			else misses++;
			if (misses >= allowedMisses && !shuttingDown && starting === 0) {
				misses = 0;
				mark("server-restart");
				try {
					await startServer();
					mark("server-restarted");
					onRestart?.();
				} catch (error) {
					log(`restart failed: ${error.message}`);
				}
			}
			schedule();
		};
		schedule();
		stopSupervising = () => {
			clearTimeout(timer);
			stopSupervising = undefined;
		};
		return stopSupervising;
	}

	function setServerPriority(background) {
		if (process.platform !== "darwin") return;
		for (const name of ["clickhouse", "postgres", "server"]) {
			const record = readJson(path.join(serverDataDir(), "run", `${name}.pid`));
			if (!Number.isInteger(record?.pid)) continue;
			execFile(
				"/usr/sbin/taskpolicy",
				[background ? "-b" : "-B", "-p", String(record.pid)],
				(error) =>
					error && log(`priority of ${name} not changed: ${error.message}`),
			);
		}
		mark(background ? "server-background" : "server-foreground");
	}

	function detach() {
		shuttingDown = true;
		stopSupervising?.();
		launcher.stopAll();
	}

	async function shutdown() {
		detach();
		if (!isLocal()) return;
		await stopLocal();
	}

	function agentServer() {
		const server = localServer();
		if (!server?.configured || !server.apiKey) return undefined;
		return {
			url: server.publicUrl,
			mcpUrl: `${server.publicUrl}/api/mcp`,
			apiKey: server.apiKey,
			dataDir: serverDataDir(),
		};
	}

	return {
		on: (name, listener) => emitter.on(name, listener),
		off: (name, listener) => emitter.off(name, listener),
		mark,
		bundle,
		settings,
		environment,
		isLocal,
		origin,
		isAppUrl,
		localServer,
		agentServer,
		prepare,
		ready,
		warmClickHouse,
		setServerPriority,
		ensureLocal,
		stopLocal,
		clickhouseBinary,
		openDashboard,
		signInLink,
		checkServer,
		useEnvironment,
		supervise,
		detach,
		shutdown,
		runLauncher: launcher.run,
	};
}

module.exports = {
	SETUP_STEPS,
	introUrl,
	firstServerPort,
	installedClickHouse,
	bundleEnvironment,
	createLocalStack,
	readLocalServer,
	resolveBundle,
	serverDataDir,
	stepForEvent,
};
