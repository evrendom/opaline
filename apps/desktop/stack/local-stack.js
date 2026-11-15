const { execFile } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createCliRunner } = require("./cli-runner");
const {
	createImportLedger,
	failedPaths,
	IMPORT_BATCH,
	listRecentSessions,
} = require("./history");
const {
	CLOUD_URL,
	createSettingsStore,
	environmentLabel,
	environmentOrigin,
	normalizeServerUrl,
	validateEnvironment,
} = require("./settings");
const {
	describeImport,
	nextPollDelay,
	parseIngestStatus,
	statusSummary,
} = require("./status");

const SETUP_STEPS = ["runtimes", "databases", "server", "account", "agents"];
const DEFAULT_PORT = 4100;
const LINK_RETRY_MS = 30_000;
const INTRO_PARAM = "opaline-intro";

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
	const cliCandidates = [
		process.env.OPALINE_DESKTOP_CLI,
		path.join(appRoot, "cli", "cli.js"),
		resources && path.join(resources, "cli", "cli.js"),
		path.join(appRoot, "..", "cli", "dist", "cli.js"),
	];
	const cliPath = cliCandidates.find(
		(candidate) => candidate && fs.existsSync(candidate),
	);
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
		cliPath,
		clickhouse: runtime("clickhouse"),
		postgres: runtime("postgres"),
		bun: runtime("bun"),
		downloads,
		clickhouseDownload:
			downloads &&
			manifest.files?.clickhouse &&
			path.join(downloads, manifest.files.clickhouse),
		serverManifest,
	};
}

function bundleEnvironment(bundle) {
	const env = {};
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

function cliConfigDir(env = process.env) {
	return (
		env.OPALINE_CONFIG_DIR?.trim() ||
		env.RUDEL_CONFIG_DIR?.trim() ||
		path.join(os.homedir(), ".rudel")
	);
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

function readCliLogin(env = process.env) {
	const credentials = readJson(
		path.join(cliConfigDir(env), "credentials.json"),
	);
	if (!credentials || typeof credentials.apiBaseUrl !== "string")
		return undefined;
	try {
		return {
			origin: new URL(credentials.apiBaseUrl).origin,
			token: credentials.token,
		};
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

async function firstServerPort(env = process.env) {
	const requested = Number.parseInt(env.OPALINE_DESKTOP_SERVER_PORT ?? "", 10);
	if (Number.isInteger(requested) && requested > 0 && requested < 65_536)
		return requested;
	for (let port = DEFAULT_PORT; port < DEFAULT_PORT + 100; port++)
		if (await isPortFree(port)) return port;
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
	if (event.type === "agents") return { step: "agents", state: "done", event };
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
	const cli = createCliRunner({
		cliPath: bundle.cliPath,
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
	const watchedWindows = new WeakSet();
	const ledger = createImportLedger(path.join(userData, "history-import.json"));
	let cliImport = { running: false, completed: 0, total: 0 };
	let lastLink = 0;
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

	function mark(name) {
		log(`mark ${name} ${Math.round(process.uptime() * 1000)} ms after launch`);
	}

	function environment() {
		return settings.read().environment;
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

	async function startServer(options) {
		starting++;
		try {
			return await runServerStart(options);
		} finally {
			starting--;
		}
	}

	async function runServerStart({ wireAgents }) {
		const args = ["server", "start", "--json"];
		if (wireAgents) args.push("--yes");
		else args.push("--no-agent-setup");
		if (!localServer()) {
			const port = await firstServerPort();
			if (port && port !== DEFAULT_PORT) args.push("--port", String(port));
		}
		const result = await cli.run(args, { onEvent: forward });
		const error = result.events.find((event) => event.type === "error");
		if (result.code !== 0 || error)
			throw new Error(
				error?.message ??
					(result.stderr.trim().split("\n").at(-1) ||
						"The local server did not start."),
			);
		const login = result.events.find((event) => event.type === "login")?.url;
		if (login) pendingLogin = { url: login, at: Date.now() };
		return { setup: result.events.find((event) => event.type === "setup") };
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

	function prepare({ attempts = 2 } = {}) {
		preparing ??= (async () => {
			for (let attempt = 1; attempt <= attempts; attempt++) {
				try {
					return await startServer({ wireAgents: false });
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

	function ensureLocal() {
		ensuring ??= (async () => {
			try {
				progress("runtimes", "active");
				await preparing;
				const started = await startServer({ wireAgents: true });
				for (const step of SETUP_STEPS)
					if (setupProgress[step] !== "done") progress(step, "done");
				if (environment()?.kind !== "local")
					settings.write({ environment: { kind: "local" } });
				if (!settings.read().historyImportedAt)
					importHistory().catch((error) =>
						log(`history import did not start: ${error.message}`),
					);
				return { url: localServer()?.publicUrl, setup: started.setup };
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
		const result = await cli.run(["server", "open", "--json"]);
		if (result.code !== 0 || !result.last?.url)
			throw new Error(result.last?.message ?? "No sign-in link.");
		lastLink = Date.now();
		return result.last.url;
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

	function watchLoginRedirects(win) {
		if (watchedWindows.has(win)) return;
		watchedWindows.add(win);
		win.webContents.on("did-navigate", (_event, url) => {
			if ((environment() ?? { kind: "local" }).kind !== "local") return;
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

	async function localReady() {
		const server = localServer();
		return Boolean(server?.configured) && (await isHealthy(server.localUrl));
	}

	async function openLocal(win, target, intro) {
		let healthy = await localReady();
		if (environment()?.kind !== "local" || !healthy) {
			const ensured = ensureLocal();
			if (!healthy && preparing) {
				await preparing;
				healthy = await localReady();
			}
			if (healthy)
				ensured.catch((error) =>
					log(`local setup did not finish: ${error.message}`),
				);
			else await ensured;
		}
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

	async function signInToServer(win, url) {
		const login = readCliLogin();
		if (login?.origin === new URL(url).origin) return false;
		const args = ["login", "--server", url, "--json"];
		if (normalizeServerUrl(url).plaintext)
			args.push("--allow-insecure-api-base");
		const result = await cli.run(args, {
			onEvent: (event) => {
				emitter.emit("login", event);
				if (event.type === "authorize" && !win.isDestroyed())
					win.loadURL(event.url);
			},
		});
		if (result.code !== 0)
			throw new Error(result.last?.message ?? `Could not sign in to ${url}.`);
		return true;
	}

	async function openDashboard(win, target, { intro = false } = {}) {
		const current = environment() ?? { kind: "local" };
		const shape = (url) => (intro ? introUrl(url) : url);
		win.webContents.once("did-finish-load", () => mark("dashboard-loaded"));
		try {
			if (current.kind === "local") return await openLocal(win, target, intro);
			if (current.kind === "cloud")
				return await win.loadURL(shape(target ?? `${CLOUD_URL}/dashboard`));
			await win.loadURL(shape(target ?? `${current.url}/`));
			signInToServer(win, current.url)
				.then(
					(signedIn) =>
						signedIn && !win.isDestroyed() && win.loadURL(`${current.url}/`),
				)
				.catch((error) => {
					log(`server sign-in failed: ${error.message}`);
					emitter.emit("error", error);
				});
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

	async function ingestStatus() {
		const server = localServer();
		if (environment()?.kind !== "local" || !server?.apiKey)
			return { available: false };
		try {
			const response = await fetchWithTimeout(
				`${server.localUrl}/api/selfhost/ingest/status`,
				{ headers: { "x-api-key": server.apiKey } },
				2_000,
			);
			const body =
				response.status === 404
					? undefined
					: await response.json().catch(() => undefined);
			if (response.status === 404) await response.body?.cancel();
			return parseIngestStatus(response.status, body);
		} catch {
			return { available: false, error: true };
		}
	}

	async function sessionsToday(webContents) {
		if (
			!webContents ||
			webContents.isDestroyed() ||
			!isAppUrl(webContents.getURL())
		)
			return undefined;
		const day = new Date();
		const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
		const script = `fetch("/rpc/analytics/overview/kpis",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({json:{startDate:"${iso}",endDate:"${iso}"}})}).then(r=>r.ok?r.json():null).then(b=>b&&b.json?b.json.distinct_sessions:null).catch(()=>null)`;
		try {
			const value = await webContents.executeJavaScript(script, true);
			return typeof value === "number" ? value : undefined;
		} catch {
			return undefined;
		}
	}

	async function status(webContents) {
		const current = environment() ?? { kind: "local" };
		const label = environmentLabel(current);
		const target =
			current.kind === "local" ? localServer()?.localUrl : origin();
		const [running, ingest, today] = await Promise.all([
			target ? isHealthy(target) : Promise.resolve(false),
			ingestStatus(),
			sessionsToday(webContents),
		]);
		const paused = settings.read().uploadsPaused;
		const snapshot = {
			environment: current,
			label,
			running,
			sessionsToday: today,
			paused,
			ingest,
			import: describeImport(ingest, cliImport),
			cliImport: { ...cliImport },
		};
		return {
			...snapshot,
			lines: statusSummary({ ...snapshot, environment: label, cliImport }),
		};
	}

	function watchStatus(listener, { window } = {}) {
		let timer;
		let stopped = false;
		const tick = async () => {
			if (stopped) return;
			const webContents =
				window && !window.isDestroyed() ? window.webContents : undefined;
			const snapshot = await status(webContents).catch(() => undefined);
			if (snapshot) listener(snapshot);
			if (stopped) return;
			const delay = nextPollDelay({
				ingest: snapshot?.ingest,
				cliImport,
				windowVisible: Boolean(
					window && !window.isDestroyed() && window.isVisible(),
				),
			});
			timer = setTimeout(tick, delay);
			timer.unref?.();
		};
		tick();
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	}

	async function importHistory() {
		if (cliImport.running) return { started: false, reason: "running" };
		if (!isLocal()) return { started: false, reason: "not-local" };
		const ingest = await ingestStatus();
		if (ingest.available) {
			settings.write({ historyImportedAt: new Date().toISOString() });
			return { started: false, reason: "server" };
		}
		const sessions = listRecentSessions().filter(
			(session) => !ledger.has(session.key),
		);
		if (!sessions.length) {
			settings.write({ historyImportedAt: new Date().toISOString() });
			return { started: false, reason: "empty" };
		}
		cliImport = {
			running: true,
			completed: 0,
			total: sessions.length,
			failed: 0,
			startedAt: Date.now(),
		};
		emitter.emit("import", { ...cliImport });
		(async () => {
			for (let index = 0; index < sessions.length; index += IMPORT_BATCH) {
				if (!isLocal()) break;
				const batch = sessions.slice(index, index + IMPORT_BATCH);
				const result = await cli.run(
					["import", ...batch.map((session) => session.path)],
					{ priority: "background" },
				);
				if (result.code === null || result.code < 0) break;
				const failed = failedPaths(result.stderr);
				if (result.code !== 0 && failed.size === 0)
					for (const session of batch) failed.add(session.path);
				ledger.add(
					batch
						.filter((session) => !failed.has(session.path))
						.map((session) => session.key),
				);
				cliImport = {
					...cliImport,
					completed: cliImport.completed + batch.length,
					failed: cliImport.failed + failed.size,
				};
				emitter.emit("import", { ...cliImport });
			}
			cliImport = { ...cliImport, running: false, finishedAt: Date.now() };
			if (cliImport.completed >= cliImport.total)
				settings.write({ historyImportedAt: new Date().toISOString() });
			log(
				`history import: ${cliImport.completed - cliImport.failed} of ${cliImport.total} sessions in ${cliImport.finishedAt - cliImport.startedAt} ms, ${cliImport.failed} failed`,
			);
			emitter.emit("import", { ...cliImport });
		})().catch((error) => {
			cliImport = { ...cliImport, running: false };
			log(`history import failed: ${error.message}`);
		});
		return { started: true, sessions: sessions.length };
	}

	async function pauseUploads() {
		const result = await cli.run(["uploads", "pause", "--json"]);
		if (result.code !== 0)
			throw new Error(result.last?.message ?? "Could not pause uploads.");
		settings.write({ uploadsPaused: true });
		return result.last;
	}

	async function resumeUploads() {
		const result = await cli.run(["uploads", "resume", "--json"]);
		if (result.code !== 0)
			throw new Error(result.last?.message ?? "Could not resume uploads.");
		settings.write({ uploadsPaused: false });
		if (result.last?.queued > 0)
			cli
				.run(["import", "--retry", "--yes"], { priority: "background" })
				.catch(() => {});
		return result.last;
	}

	async function stopLocal(timeoutMs = 30_000) {
		if (!localServer()) return undefined;
		return cli.run(["server", "stop"], { timeoutMs });
	}

	function isLocal() {
		return (environment() ?? { kind: "local" }).kind === "local";
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
					await startServer({ wireAgents: false });
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

	async function shutdown() {
		shuttingDown = true;
		stopSupervising?.();
		cli.stopAll();
		if (!isLocal()) return;
		const started = Date.now();
		await stopLocal();
		log(`stopped the local server in ${Date.now() - started} ms`);
	}

	function afterLaunch({ delayMs = 10_000 } = {}) {
		if (!isLocal() || !localServer()?.configured) return;
		const timer = setTimeout(() => {
			if (!settings.read().historyImportedAt)
				importHistory().catch((error) =>
					log(`history import did not resume: ${error.message}`),
				);
		}, delayMs);
		timer.unref?.();
	}

	return {
		on: (name, listener) => emitter.on(name, listener),
		mark,
		off: (name, listener) => emitter.off(name, listener),
		bundle,
		settings,
		environment,
		origin,
		isAppUrl,
		localServer,
		prepare,
		warmClickHouse,
		ensureLocal,
		stopLocal,
		supervise,
		shutdown,
		isLocal,
		clickhouseBinary,
		openDashboard,
		signInLink,
		checkServer,
		useEnvironment,
		status,
		watchStatus,
		importHistory,
		pauseUploads,
		resumeUploads,
		afterLaunch,
		runCli: cli.run,
		stopAll: cli.stopAll,
	};
}

module.exports = {
	SETUP_STEPS,
	introUrl,
	firstServerPort,
	installedClickHouse,
	bundleEnvironment,
	createLocalStack,
	readCliLogin,
	readLocalServer,
	resolveBundle,
	serverDataDir,
	stepForEvent,
};
