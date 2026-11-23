const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, autoUpdater, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, Notification, powerMonitor, screen, shell } = require("electron");

const explicitUrl = process.env.OPALINE_URL;
const isDev = Boolean(explicitUrl);

const isMac = process.platform === "darwin";
if (isMac) {
	const library = path.join(os.homedir(), "Library");
	app.setPath("appData", path.join(library, "Application Support"));
	app.setPath("userData", path.join(library, "Application Support", app.getName()));
	app.setPath("logs", path.join(library, "Logs", app.getName()));
}
// Elsewhere Electron's defaults hold: ~/.config/Opaline on Linux, %APPDATA%\Opaline on Windows.
if (isDev) app.setPath("userData", `${app.getPath("userData")} Dev`);
process.env.OPALINE_SERVER_DATA_DIR ||= path.join(app.getPath("userData"), "server");

if (!app.requestSingleInstanceLock()) {
	app.quit();
	return;
}

const { OPALINE_SCHEME, deepLinkFromArgv, deepLinkTarget, isDeepLink, openedUrl } = require("./deep-link");

let pendingLink = deepLinkFromArgv(process.argv);

app.on("open-url", (event, url) => {
	event.preventDefault();
	openLink(url);
});

const { analyzeSessions, scanSessions, sessionSources } = require("./analyze");
const { askForSessionFolders } = require("./folder-access");
const { createAgents } = require("./agents");
const { createDockUsage } = require("./dock-usage");
const { createLocalStack, introUrl } = require("./stack/local-stack");
const { createStarPrompt } = require("./star-prompt");
const { createEnvironmentMenu } = require("./environments");
const { keepClaudeTranscripts } = require("./stack/transcripts");
const { createUpdateDialogs, createUpdateNotifier, createUpdater } = require("./updates");
const { createWindowState } = require("./window-state");

app.userAgentFallback = `${app.userAgentFallback
	.replace(/\sElectron\/\S+/, "")
	.replace(/\s(opaline-desktop|Opaline)\/\S+/, "")} OpalineDesktop/${app.getVersion()}`;

const stack = createLocalStack({ app });
const agents = createAgents({ stack });
// Anything but a signed release (electron ., a dev URL, an ad-hoc package.sh build) shows the development icon.
const developmentBuild = isDev || !app.isPackaged || readBuild()?.release !== true;
const dockUsage = createDockUsage({ agents, dataDir: process.env.OPALINE_SERVER_DATA_DIR, development: developmentBuild });
const updates = app.isPackaged && !isDev ? (isMac ? createAppUpdater() : createAppNotifier()) : undefined;

function updateLog(line) {
	try {
		fs.mkdirSync(app.getPath("logs"), { recursive: true });
		fs.appendFileSync(path.join(app.getPath("logs"), "updates.log"), `${new Date().toISOString()} ${line}\n`);
	} catch {}
}

/** Linux and Windows builds cannot replace themselves: they say a new version is out and open its download page. */
function createAppNotifier() {
	return createUpdateNotifier({
		currentVersion: app.getVersion(),
		log: updateLog,
		stateFile: path.join(app.getPath("userData"), "update", "notified.json"),
		ui: createUpdateDialogs({
			dialog,
			window: () => {
				const win = mainWindow();
				return win?.isVisible() ? win : undefined;
			},
			canPrompt: () => !quitting && !onboardingOpen(),
			Notification,
		}),
		openDownload: (url) => shell.openExternal(url),
	});
}

function createAppUpdater() {
	return createUpdater({
		autoUpdater,
		currentVersion: app.getVersion(),
		log: updateLog,
		feedFile: path.join(app.getPath("userData"), "update", "feed.json"),
		ui: createUpdateDialogs({
			dialog,
			window: () => {
				const win = mainWindow();
				return win?.isVisible() ? win : undefined;
			},
			canPrompt: () => !quitting && !onboardingOpen(),
			Notification,
		}),
		beforeInstall: stopForUpdate,
		quit: () => app.quit(),
	});
}

const NO_SCROLLBARS = `
* {
	scrollbar-width: none !important;
}

::-webkit-scrollbar {
	display: none !important;
}
`;

const REPLAY_BUTTON = `(() => {
	if (typeof window.opalineDesktop?.replayOpen !== "function" || window.__replayButton) return;
	window.__replayButton = true;
	const place = () => {
		if (document.querySelector("[data-opaline-replay]")) return;
		const settings = [...document.querySelectorAll('[data-slot="sidebar-footer"] [data-slot="sidebar-menu-button"]')].find((element) => element.textContent.trim() === "Settings");
		const template = settings ?? document.querySelector('[data-slot="sidebar-content"] [data-slot="sidebar-menu"] [data-slot="sidebar-menu-button"]');
		if (!template) return;
		let list = settings?.closest('[data-slot="sidebar-menu"]');
		if (!list) {
			const content = document.querySelector('[data-slot="sidebar-content"]');
			if (!content) return;
			const footer = document.createElement("div");
			// Inline, from the space steps: Tailwind only generates the classes
			// the UI's source uses, so a class written here may not exist.
			footer.style.cssText = "display:flex;flex-direction:column;gap:var(--space-m);padding:var(--space-m)";
			list = document.createElement("ul");
			list.className = template.closest('[data-slot="sidebar-menu"]')?.className ?? "";
			footer.append(list);
			content.after(footer);
		}
		const item = document.createElement("li");
		item.className = template.closest("li")?.className ?? "";
		item.dataset.opalineReplay = "";
		const button = document.createElement("button");
		button.type = "button";
		button.className = template.className;
		button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg><span>Replay opening</span>';
		button.addEventListener("click", () => window.opalineDesktop.replayOpen());
		item.append(button);
		list.append(item);
	};
	place();
	new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
})();`;

function appOrigin() {
	return explicitUrl ? new URL(explicitUrl).origin : stack.origin();
}

function isAppUrl(url) {
	try {
		return new URL(url).origin === appOrigin();
	} catch {
		return false;
	}
}

const appWindows = new Set();
let pageBackground;
const windowState = createWindowState({ file: path.join(app.getPath("userData"), "window-state.json"), screen });

function placement() {
	const other = mainWindow();
	return other ? windowState.nextTo(other) : windowState.load();
}

function createWindow({ url, link, bounds, intro = false } = {}) {
	const placed = bounds ? { bounds } : placement();
	const win = new BrowserWindow({
		width: 1440,
		height: 900,
		...placed?.bounds,
		minWidth: 800,
		minHeight: 520,
		title: "Opaline",
		...(isMac
			? { titleBarStyle: "hidden", trafficLightPosition: { x: 15, y: 16 } }
			: { autoHideMenuBar: true, icon: path.join(__dirname, "icon", "Opaline.png") }),
		show: false,
		backgroundColor: pageBackground ?? (nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#efefef"),
		webPreferences: { spellcheck: false, devTools: isDev, preload: path.join(__dirname, "preload.js"), additionalArguments: isDev ? ["--opaline-debug"] : [] },
	});
	if (!bounds)
		win.once("ready-to-show", () => {
			if (placed?.maximized) win.maximize();
			win.show();
			stack.mark("window-shown");
		});
	const syncFullScreen = () =>
		win.webContents
			.executeJavaScript(
				`document.documentElement.toggleAttribute("data-fullscreen", ${win.isFullScreen()})`,
			)
			.catch(() => {});
	win.on("enter-full-screen", syncFullScreen);
	win.on("leave-full-screen", syncFullScreen);
	win.webContents.on("did-finish-load", syncFullScreen);
	win.webContents.on("dom-ready", () => win.webContents.insertCSS(NO_SCROLLBARS).catch(() => {}));
	if (isDev) win.webContents.on("did-finish-load", () => win.webContents.executeJavaScript(REPLAY_BUTTON).catch(() => {}));
	win.webContents.setWindowOpenHandler(({ url: next }) => {
		const opened = openedUrl(next, appOrigin());
		if (opened.kind === "app") createWindow({ url: opened.url });
		else if (opened.kind === "link") openLink(opened.url);
		else if (opened.kind === "external") shell.openExternal(opened.url);
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (event, next) => {
		if (!isDeepLink(next)) return;
		event.preventDefault();
		openLink(next);
	});
	appWindows.add(win);
	windowState.track(win);
	win.on("closed", () => appWindows.delete(win));
	const target = url ?? (explicitUrl ? (link ?? explicitUrl) : undefined);
	if (target) win.loadURL(intro ? introUrl(target) : target);
	else openDashboardIn(win, link, { intro });
	return win;
}

const openingWindows = new WeakMap();
const START_PROBLEM_PAGE = path.join(__dirname, "start-window", "index.html");

function isStartProblemPage(url) {
	try {
		return new URL(url).protocol === "file:" && decodeURIComponent(new URL(url).pathname) === START_PROBLEM_PAGE;
	} catch {
		return false;
	}
}

function openDashboardIn(win, link, options) {
	const opened = stack.openDashboard(win, link, options).then(
		() => {},
		(error) => {
			if (quitting || win.isDestroyed() || openingWindows.get(win) !== opened) return;
			stack.mark("start-problem-shown");
			win.loadFile(START_PROBLEM_PAGE, { query: { message: error.message } }).catch(() => {});
		},
	);
	openingWindows.set(win, opened);
	opened.finally(() => {
		if (openingWindows.get(win) === opened) openingWindows.delete(win);
	});
	return opened;
}

function recoverWindows({ reload = false } = {}) {
	if (quitting) return;
	for (const win of appWindows) {
		if (win.isDestroyed() || openingWindows.has(win)) continue;
		const url = win.webContents.getURL();
		if (isAppUrl(url)) {
			if (reload) win.reload();
		} else if (!url || isStartProblemPage(url)) openDashboardIn(win);
	}
}

ipcMain.on("app:retry-start", (event) => {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!win || !appWindows.has(win) || !isStartProblemPage(event.senderFrame?.url ?? "") || openingWindows.has(win)) return;
	openDashboardIn(win);
});

ipcMain.on("app:background", (event, color) => {
	const win = BrowserWindow.fromWebContents(event.sender);
	if (!win || !appWindows.has(win) || typeof color !== "string" || !/^#[0-9a-f]{6}$/.test(color)) return;
	win.setBackgroundColor(color);
	pageBackground = color;
});

function fromApp(event) {
	return isAppUrl(event.senderFrame?.url ?? "");
}

let onboardingWindow;

function onboardedMarker() {
	return path.join(app.getPath("userData"), "onboarded");
}

function themeFile() {
	return path.join(app.getPath("userData"), "theme");
}

function savedTheme() {
	try {
		const theme = fs.readFileSync(themeFile(), "utf8").trim();
		return theme === "light" || theme === "dark" ? theme : "system";
	} catch {
		return "system";
	}
}

const SWAP_FALLBACK_MS = 5000;

function centeredBounds(area, width, height, center = { x: area.x + area.width / 2, y: area.y + area.height / 2 }) {
	const w = Math.min(width, area.width);
	const h = Math.min(height, area.height);
	return {
		x: Math.round(Math.min(Math.max(center.x - w / 2, area.x), area.x + area.width - w)),
		y: Math.round(Math.min(Math.max(center.y - h / 2, area.y), area.y + area.height - h)),
		width: w,
		height: h,
	};
}

let replaced;

async function revealApp(from, duration) {
	stack.mark("open-clicked");
	const bounds = from.getBounds();
	const link = await takeLink();
	const win = createWindow({ bounds, link, intro: true });
	let painted = false;
	const ready = (event) => {
		if (event.sender !== win.webContents) return;
		painted = true;
		stack.mark("intro-ready");
	};
	ipcMain.on("app:intro-ready", ready);
	const loaded = new Promise((resolve) => win.once("ready-to-show", resolve));
	const grown = new Promise((resolve) => setTimeout(resolve, duration));
	Promise.all([grown, loaded]).then(() => {
		win.showInactive();
		if (!from.isDestroyed()) from.moveTop();
		const began = Date.now();
		const timer = setInterval(() => {
			if (!painted && Date.now() - began < SWAP_FALLBACK_MS) return;
			clearInterval(timer);
			ipcMain.removeListener("app:intro-ready", ready);
			win.focus();
			if (!from.isDestroyed()) from.destroy();
			if (replaced && !replaced.isDestroyed()) replaced.destroy();
			replaced = undefined;
			stack.mark("handover");
		}, 16);
	});
}

let quitting = false;
let onboardingDone = false;

// macOS briefly reports a transparent, frameless window as hidden while it
// settles in, and Chromium then stops its vsync: the intro froze for ~1 s about
// 1.5 s in on 6 of 6 launches. Without background throttling the onboarding
// windows keep drawing (0 of 6 froze).
const ONBOARDING_RENDERING = { backgroundThrottling: false };

function createOnboardingWindow(page = "") {
	const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
	const nativeShadow = process.platform === "darwin";
	onboardingWindow = new BrowserWindow({
		...(nativeShadow ? centeredBounds(area, 960, 640) : centeredBounds(area, 1120, 800)),
		frame: false,
		hasShadow: nativeShadow,
		resizable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		closable: false,
		show: false,
		transparent: true,
		backgroundColor: "#00000000",
		webPreferences: { ...ONBOARDING_RENDERING, spellcheck: false, devTools: isDev, preload: path.join(__dirname, "onboarding-preload.js"), additionalArguments: isDev ? ["--opaline-debug"] : [] },
	});
	onboardingWindow.setIgnoreMouseEvents(true, { forward: true });
	onboardingWindow.on("close", (event) => {
		if (!quitting && !onboardingDone) event.preventDefault();
	});
	onboardingWindow.once("ready-to-show", () => {
		onboardingWindow.show();
		onboardingWindow.focus();
		stack.mark("onboarding-shown");
	});
	onboardingWindow.on("closed", () => {
		onboardingWindow = undefined;
	});
	onboardingWindow.loadFile(path.join(__dirname, "onboarding-window", "index.html"), { hash: page });
}

function createOnboarding() {
	if (process.env.OPALINE_ONBOARDING !== "overlay") return createOnboardingWindow();
	const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	onboardingWindow = new BrowserWindow({
		...display.bounds,
		frame: false,
		transparent: true,
		hasShadow: false,
		resizable: false,
		movable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		skipTaskbar: true,
		enableLargerThanScreen: true,
		show: false,
		backgroundColor: "#00000000",
		vibrancy: "fullscreen-ui",
		visualEffectState: "active",
		webPreferences: { ...ONBOARDING_RENDERING, spellcheck: false, devTools: isDev, preload: path.join(__dirname, "onboarding-preload.js") },
	});
	onboardingWindow.setAlwaysOnTop(true, "screen-saver");
	onboardingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	onboardingWindow.once("ready-to-show", () => {
		onboardingWindow.show();
		onboardingWindow.focus();
	});
	onboardingWindow.on("closed", () => {
		onboardingWindow = undefined;
	});
	onboardingWindow.loadFile(path.join(__dirname, "onboarding", "index.html"));
}

// Gemini's mark on an app-icon tile, for Gemini sessions on Macs without the
// Antigravity app.
const GEMINI_ICON = `data:image/svg+xml,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="70" y1="186" x2="186" y2="70" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1C7DFF"/><stop offset="0.52" stop-color="#1C69FF"/><stop offset="1" stop-color="#B07CF7"/></linearGradient></defs><rect x="24" y="24" width="208" height="208" rx="47" fill="#fff"/><path fill="url(#g)" transform="translate(78 78) scale(4.1667)" d="M12 24A14.3 14.3 0 0 0 0 12 14.3 14.3 0 0 0 12 0a14.3 14.3 0 0 0 12 12 14.3 14.3 0 0 0-12 12Z"/></svg>',
)}`;

function appIcon(bundle) {
	if (!isMac) return null;
	if (bundle.endsWith(".png"))
		return fs.existsSync(bundle) ? nativeImage.createFromPath(bundle).resize({ width: 256 }).toDataURL() : null;
	if (!fs.existsSync(bundle)) return null;
	try {
		const icon = execFileSync("/usr/bin/plutil", ["-extract", "CFBundleIconFile", "raw", "-o", "-", path.join(bundle, "Contents", "Info.plist")]).toString().trim();
		const icns = path.join(bundle, "Contents", "Resources", icon.endsWith(".icns") ? icon : `${icon}.icns`);
		const cache = path.join(app.getPath("userData"), "icons", `${path.basename(bundle, ".app")}.png`);
		if (!fs.existsSync(cache)) {
			fs.mkdirSync(path.dirname(cache), { recursive: true });
			execFileSync("/usr/bin/sips", ["-s", "format", "png", "-Z", "256", icns, "--out", cache], { stdio: "ignore" });
		}
		return nativeImage.createFromPath(cache).toDataURL();
	} catch {
		return null;
	}
}

function fromOnboarding(event) {
	return Boolean(onboardingWindow) && event.sender === onboardingWindow.webContents;
}

let foldersAsked = false;

/** macOS asks about Documents and the like while onboarding loads, not later in the dashboard. */
function askForFolders() {
	if (foldersAsked) return;
	foldersAsked = true;
	askForSessionFolders(sessionSources()).then(
		(answers) => {
			for (const { folder, granted, ms } of answers)
				stack.mark(`folder-access ${folder} ${granted === null ? "unreadable" : granted ? "granted" : "denied"} after ${ms} ms`);
		},
		(error) => stack.mark(`folder-access failed: ${error.message}`),
	);
}

ipcMain.handle("onboarding:scan", (event) => {
	if (!fromOnboarding(event)) return null;
	askForFolders();
	return scanSessions();
});
ipcMain.handle("onboarding:analyze", async (event) => {
	if (!fromOnboarding(event)) return null;
	process.env.OPALINE_CLICKHOUSE ??= await stack.clickhouseBinary();
	stack.mark("analysis-started");
	const result = await analyzeSessions();
	stack.mark("analysis-done");
	return result;
});
ipcMain.handle("onboarding:icons", (event) =>
	fromOnboarding(event)
		? {
				claude: appIcon("/Applications/Claude.app"),
				codex:
					appIcon("/Applications/Codex.app") ??
					appIcon("/Applications/ChatGPT.app/Contents/Resources/icon-codex-dark-color.png"),
				gemini: appIcon("/Applications/Antigravity.app") ?? GEMINI_ICON,
				antigravity: appIcon("/Applications/Antigravity.app") ?? "antigravity.svg",
			}
		: null,
);
ipcMain.handle("onboarding:agents", (event) => (fromOnboarding(event) ? agents.statuses() : null));
ipcMain.handle("onboarding:connect", async (event, key) => {
	if (!fromOnboarding(event)) return null;
	const status = await agents.connect(key);
	dockUsage.refreshAgents();
	return status;
});
ipcMain.on("onboarding:theme", (event, theme) => {
	if (!fromOnboarding(event) || !["light", "dark", "system"].includes(theme)) return;
	nativeTheme.themeSource = theme;
	fs.writeFileSync(themeFile(), theme);
});
ipcMain.on("onboarding:finish", (event, duration) => {
	if (!fromOnboarding(event)) return;
	restoreServerPriority();
	fs.writeFileSync(onboardedMarker(), new Date().toISOString());
	onboardingDone = true;
	if (!replaced && BrowserWindow.getAllWindows().length > 1) {
		onboardingWindow.destroy();
		return showPendingLink();
	}
	revealApp(onboardingWindow, Number(duration) || 750);
});

ipcMain.handle("onboarding:expand", (event) => {
	if (!fromOnboarding(event)) return null;
	const current = onboardingWindow.getBounds();
	const area = screen.getDisplayMatching(current).workArea;
	const next = centeredBounds(area, 1440, 900, { x: current.x + current.width / 2, y: current.y + current.height / 2 });
	onboardingWindow.setHasShadow(false);
	onboardingWindow.setBounds(next);
	return { width: next.width, height: next.height };
});

ipcMain.on("onboarding:pass-through", (event, through) => {
	if (fromOnboarding(event)) onboardingWindow?.setIgnoreMouseEvents(Boolean(through), { forward: true });
});

// "Star Opaline" card in the rail: asks once, after an hour of active use.
// OPALINE_STAR_PROMPT=now (development builds only) asks straight away.
const starPrompt = createStarPrompt({
	file: path.join(app.getPath("userData"), "star-prompt.json"),
	idleSeconds: () => powerMonitor.getSystemIdleTime(),
	fetchJson: (url) => net.fetch(url, { headers: { Accept: "application/vnd.github+json" } }).then((response) => (response.ok ? response.json() : null)),
	openInBackground: (url) => shell.openExternal(url, { activate: false }),
	...(isDev && process.env.OPALINE_STAR_PROMPT === "now" ? { askAfterMs: 0 } : {}),
});
const STAR_TICK_MS = 30_000;
setInterval(() => {
	const focused = BrowserWindow.getFocusedWindow();
	starPrompt.tick(Boolean(focused && appWindows.has(focused)));
}, STAR_TICK_MS).unref?.();
ipcMain.handle("star:status", (event) => (fromApp(event) ? starPrompt.status() : { show: false, count: null }));
ipcMain.handle("star:star", (event) => (fromApp(event) ? starPrompt.star() : null));
ipcMain.on("star:dismiss", (event) => {
	if (fromApp(event)) starPrompt.dismiss();
});

ipcMain.on("app:replay-open", (event) => {
	if (!isDev || !fromApp(event) || onboardingWindow) return;
	replaced = BrowserWindow.fromWebContents(event.sender);
	onboardingDone = false;
	createOnboardingWindow("replay");
	onboardingWindow.once("show", () => replaced?.hide());
});

function mainWindow() {
	const focused = BrowserWindow.getFocusedWindow();
	if (focused && appWindows.has(focused)) return focused;
	return [...appWindows].findLast((win) => !win.isDestroyed());
}

function focusCurrentWindow() {
	if (quitting) return;
	if (process.platform === "darwin") app.show();
	const win = onboardingWindow && !onboardingWindow.isDestroyed() ? onboardingWindow : mainWindow();
	if (!win) return createWindow();
	if (win.isMinimized()) win.restore();
	if (win.isVisible()) win.focus();
	app.focus({ steal: true });
}

async function linkOrigin() {
	const origin = appOrigin();
	if (origin || explicitUrl || !stack.isLocal()) return origin;
	const server = await stack.ready().catch(() => undefined);
	return server?.publicUrl;
}

async function takeLink() {
	const raw = pendingLink;
	pendingLink = undefined;
	if (!raw) return undefined;
	const target = deepLinkTarget(raw, await linkOrigin());
	stack.mark(target ? "link-opened" : "link-rejected");
	return target;
}

function onboardingOpen() {
	return Boolean(onboardingWindow) && !onboardingWindow.isDestroyed() && !onboardingDone;
}

async function showPendingLink() {
	if (!pendingLink || quitting || !app.isReady()) return;
	if (onboardingOpen()) return focusCurrentWindow();
	const target = await takeLink();
	if (!target || quitting) return focusCurrentWindow();
	const win = mainWindow();
	if (!win) return createWindow({ link: target });
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
	if (process.platform === "darwin") app.show();
	app.focus({ steal: true });
	if (explicitUrl) win.loadURL(target);
	else openDashboardIn(win, target);
}

function openLink(raw) {
	if (quitting) return;
	pendingLink = raw;
	showPendingLink();
}

const onboarding = Boolean(process.env.OPALINE_ONBOARDING) || !fs.existsSync(onboardedMarker());
let serverQuiet = onboarding && !explicitUrl;

function restoreServerPriority() {
	if (!serverQuiet) return;
	serverQuiet = false;
	stack.setServerPriority(false);
}

try {
	const kept = keepClaudeTranscripts();
	stack.mark(`claude-transcripts ${kept.changed ? `kept for ${kept.days} days` : kept.reason}`);
} catch (error) {
	stack.mark(`claude-transcripts not changed: ${error.message}`);
}

if (!explicitUrl && stack.isLocal()) {
	stack.warmClickHouse();
	stack.prepare().then((started) => {
		if (started) stack.setServerPriority(serverQuiet);
	});
}

app.on("second-instance", (_event, argv) =>
	app.whenReady().then(() => {
		const link = deepLinkFromArgv(argv);
		if (link) openLink(link);
		else focusCurrentWindow();
	}),
);

function readBuild() {
	try {
		return JSON.parse(fs.readFileSync(path.join(__dirname, "build.json"), "utf8"));
	} catch {
		return null;
	}
}

const build = readBuild();
app.setAboutPanelOptions({
	applicationName: "Opaline",
	applicationVersion: app.getVersion(),
	version: build ? `${build.commit}${build.dirty ? "-dirty" : ""}` : "",
	copyright: `© ${new Date().getFullYear()} Opaline`,
});

app.whenReady().then(() => {
	stack.mark("ready");
	if (app.isPackaged && !isDev && !app.isDefaultProtocolClient(OPALINE_SCHEME))
		app.setAsDefaultProtocolClient(OPALINE_SCHEME);
	if (!explicitUrl)
		Menu.setApplicationMenu(
			createEnvironmentMenu({
				stack,
				window: mainWindow,
				openWindow: () => createWindow(),
				quitCompletely,
				updates,
			}),
		);
	if (onboarding) {
		nativeTheme.themeSource = "dark";
		createOnboarding();
	} else {
		nativeTheme.themeSource = savedTheme();
		if (pendingLink) showPendingLink();
		else createWindow();
	}
	if (!explicitUrl) {
		stack.on("server", () => recoverWindows());
		stack.on("healthy", () => recoverWindows());
		stack.supervise({ onRestart: () => recoverWindows({ reload: true }) });
		stack.ready().then(() => agents.refresh()).catch(() => {});
	}
	dockUsage.start();
	updates?.start();
	app.on("activate", () => {
		if (!quitting && BrowserWindow.getAllWindows().length === 0 && !pendingLink) createWindow();
	});
});

let stopServer = false;
let stopping;
let stopped = false;

function quitCompletely() {
	stopServer = true;
	app.quit();
}

async function stopForUpdate() {
	quitting = true;
	stopServer = true;
	for (const win of BrowserWindow.getAllWindows()) win.hide();
	await stack.shutdown().catch((error) => updateLog(`server stop before the update failed: ${error.message}`));
	stopped = true;
	for (const win of BrowserWindow.getAllWindows()) win.destroy();
}

app.on("before-quit", (event) => {
	quitting = true;
	if (onboardingWindow && !onboardingWindow.isDestroyed()) onboardingWindow.setClosable(true);
	if (stopped || explicitUrl) return;
	if (updates?.pending()) stopServer = true;
	if (!stopServer) {
		stack.detach();
		return;
	}
	event.preventDefault();
	for (const win of BrowserWindow.getAllWindows()) win.hide();
	stopping ??= stack
		.shutdown()
		.catch(() => {})
		.finally(() => {
			stopped = true;
			app.quit();
		});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

module.exports = { stack, updates };
