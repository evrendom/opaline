// Launches a built Opaline.app with onboarding forced and a fresh server data
// folder, and times every animation frame of the onboarding window. It also
// records long tasks, main-process event-loop stalls, the page's calls into the
// main process, and CPU per process. See docs/desktop-performance.md.
//
//   node scripts/perf/intro-frames.mjs <Opaline.app> <empty server data folder> <out.json> [seconds=8] [home]
//
// `home` runs the app as a first install: an empty folder with links to the
// session folders only (.claude/projects, .codex/sessions,
// .codex/archived_sessions), so the agents' own settings are not touched.
// Quit Opaline first: only one copy runs at a time. Stop the server afterwards:
//   ELECTRON_RUN_AS_NODE=1 <app>/Contents/MacOS/Opaline <app>/Contents/Resources/app/local-server/local-server.js stop --data-dir <folder>
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const t0 = Date.now();
const [appPath, dataDir, out, secondsArg = "8", home = ""] =
	process.argv.slice(2);
if (!appPath || !dataDir || !out) {
	console.error(
		"usage: intro-frames.mjs <Opaline.app> <server data folder> <out.json> [seconds] [home]",
	);
	process.exit(2);
}
const binary = path.join(appPath, "Contents", "MacOS", "Opaline");
const seconds = Number(secondsArg);
const PAGE_PORT = 9361;
const MAIN_PORT = 9339;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = {
	...process.env,
	OPALINE_SERVER_DATA_DIR: dataDir,
	OPALINE_ONBOARDING: "1",
	...(home ? { HOME: home } : {}),
};
delete env.ELECTRON_RUN_AS_NODE;
// Covered windows would stop drawing and hide the measurement; these flags keep
// the page drawing whatever else is on screen.
spawn(
	binary,
	[
		`--inspect=${MAIN_PORT}`,
		`--remote-debugging-port=${PAGE_PORT}`,
		"--disable-backgrounding-occluded-windows",
		"--disable-renderer-backgrounding",
		"--disable-background-timer-throttling",
	],
	{ env, stdio: "ignore", detached: true },
).unref();

const cpu = [];
const sampler = setInterval(() => {
	try {
		const rows = execSync("ps -axo %cpu=,command=", { encoding: "utf8" }).split(
			"\n",
		);
		const sum = (re) =>
			rows
				.filter((r) => re.test(r))
				.reduce((a, r) => a + Number(r.trim().split(/\s+/)[0] || 0), 0);
		cpu.push({
			t: Date.now() - t0,
			main: sum(/MacOS\/Opaline/),
			renderer: sum(/Opaline\.app.*Helper \(Renderer\)/),
			analysis: sum(/clickhouse local/),
			server: sum(/\/bun\b/),
			clickhouse: sum(/clickhouse (server|.*--config)/),
			postgres: sum(/postgres|initdb/),
		});
	} catch {}
}, 500);

async function json(port, pathname) {
	for (;;) {
		try {
			return await (await fetch(`http://127.0.0.1:${port}${pathname}`)).json();
		} catch {
			await sleep(25);
		}
	}
}
function client(url) {
	const ws = new WebSocket(url);
	let id = 0;
	const pending = new Map();
	ws.onmessage = (e) => {
		const m = JSON.parse(e.data);
		if (m.id) pending.get(m.id)?.(m);
	};
	const ready = new Promise((r) => (ws.onopen = r));
	const call = (method, params = {}) =>
		Promise.race([
			new Promise((r) => {
				pending.set(++id, r);
				ws.send(JSON.stringify({ id, method, params }));
			}),
			sleep(30_000).then(() => {
				throw new Error(`${method} timed out`);
			}),
		]);
	const evaluate = async (expression) =>
		(
			await call("Runtime.evaluate", {
				expression,
				returnByValue: true,
				awaitPromise: true,
			})
		).result?.result?.value;
	return { ready, call, evaluate };
}

let target;
while (!target) {
	target = (await json(PAGE_PORT, "/json")).find((x) =>
		x.url.includes("onboarding-window"),
	);
	if (!target) await sleep(25);
}
const pageSeenMs = Date.now() - t0;
const main = client((await json(MAIN_PORT, "/json"))[0].webSocketDebuggerUrl);
await main.ready;
await main.evaluate(`(() => {
	const T0 = ${t0};
	const { ipcMain, BrowserWindow } = process.mainModule.require("electron");
	globalThis.__calls = [];
	globalThis.__stalls = [];
	const note = (what) => globalThis.__calls.push({ at: Date.now() - T0, what });
	const handlers = ipcMain._invokeHandlers;
	if (handlers) for (const [channel, fn] of handlers) handlers.set(channel, (...args) => { note("invoke " + channel); return fn(...args); });
	const emit = ipcMain.emit.bind(ipcMain);
	ipcMain.emit = (channel, ...args) => { if (typeof channel === "string" && !channel.startsWith("ELECTRON")) note("send " + channel); return emit(channel, ...args); };
	for (const win of BrowserWindow.getAllWindows())
		for (const m of ["setIgnoreMouseEvents", "setBounds", "setHasShadow", "show", "focus", "hide"]) {
			const original = win[m].bind(win);
			win[m] = (...args) => { note("window " + m); return original(...args); };
		}
	let last = Date.now();
	setInterval(() => { const now = Date.now(); if (now - last > 50) globalThis.__stalls.push({ at: now - T0, ms: now - last - 20 }); last = now; }, 20);
	return true;
})()`);
const page = client(target.webSocketDebuggerUrl);
await page.ready;
await page.evaluate(
	`window.__frames = []; (function f(prev) { requestAnimationFrame((now) => { window.__frames.push({ at: Math.round(now + performance.timeOrigin - ${t0}), ms: now - prev }); f(now); }); })(performance.now()); true`,
);
await page.evaluate(
	`window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ at: Math.round(e.startTime + performance.timeOrigin - ${t0}), ms: Math.round(e.duration) }); }).observe({ type: "longtask", buffered: true }); true`,
);
while (Date.now() - t0 < seconds * 1000) await sleep(100);

const frames = await page.evaluate("window.__frames");
const longTasks = await page.evaluate("window.__long");
const mainStalls = await main.evaluate("globalThis.__stalls");
const mainCalls = await main.evaluate("globalThis.__calls");
clearInterval(sampler);
const perSecond = [];
for (let s = 0; s < seconds; s++) {
	const inSecond = frames.filter(
		(f) => f.at >= s * 1000 && f.at < (s + 1) * 1000,
	);
	const c = cpu.filter((x) => x.t >= s * 1000 && x.t < (s + 1) * 1000);
	const cores = c.length
		? +(
				c.reduce(
					(a, x) =>
						a +
						x.main +
						x.renderer +
						x.analysis +
						x.server +
						x.clickhouse +
						x.postgres,
					0,
				) /
				c.length /
				100
			).toFixed(1)
		: null;
	perSecond.push({
		s,
		frames: inSecond.length,
		worstMs: Math.round(Math.max(0, ...inSecond.map((f) => f.ms))),
		cores,
	});
}
const freezes = frames
	.filter((f) => f.ms > 200)
	.map((f) => ({ endedAt: f.at, ms: Math.round(f.ms) }));
const result = {
	pageSeenMs,
	frames: frames.length,
	slowFrames: frames.filter((f) => f.ms > 25).length,
	freezes,
	longTasks,
	mainStalls,
	mainCalls,
	perSecond,
};
fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.log(
	JSON.stringify({
		pageSeenMs,
		frames: frames.length,
		slowFrames: result.slowFrames,
		freezes,
	}),
);
process.exit(0);
