const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, screen, shell } = require("electron");

const explicitUrl = process.env.OPALINE_URL;
const isDev = Boolean(explicitUrl);

const library = path.join(os.homedir(), "Library");
app.setPath("appData", path.join(library, "Application Support"));
app.setPath("userData", path.join(library, "Application Support", app.getName()));
app.setPath("logs", path.join(library, "Logs", app.getName()));
if (isDev) app.setPath("userData", `${app.getPath("userData")} Dev`);
process.env.OPALINE_SERVER_DATA_DIR ||= path.join(app.getPath("userData"), "server");

const { analyzeSessions, scanSessions } = require("./analyze");
const { createAgents } = require("./agents");
const { createLocalStack, introUrl } = require("./stack/local-stack");
const { createEnvironmentMenu } = require("./environments");
const { keepClaudeTranscripts } = require("./stack/transcripts");

app.userAgentFallback = `${app.userAgentFallback
	.replace(/\sElectron\/\S+/, "")
	.replace(/\s(opaline-desktop|Opaline)\/\S+/, "")} OpalineDesktop/${app.getVersion()}`;

const stack = createLocalStack({ app });
const agents = createAgents({
	stack,
	confirmCloudSwitch: async (label) => {
		const { response } = await dialog.showMessageBox(onboardingWindow ?? mainWindow(), {
			type: "question",
			buttons: ["Use This Mac", "Keep Opaline Cloud"],
			defaultId: 0,
			cancelId: 1,
			message: `${label} is connected to Opaline Cloud.`,
			detail: `Connect ${label} to Opaline on this Mac instead? Its Opaline Cloud plugin is turned off; you can turn it back on in ${label} at any time.`,
		});
		return response === 0;
	},
});

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
			footer.className = "flex flex-col gap-2 p-2";
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

function createWindow({ url, bounds, intro = false } = {}) {
	const win = new BrowserWindow({
		width: 1440,
		height: 900,
		...bounds,
		minWidth: 800,
		minHeight: 520,
		title: "Opaline",
		titleBarStyle: "hidden",
		trafficLightPosition: { x: 15, y: 16 },
		show: false,
		backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#efefef",
		webPreferences: { devTools: isDev, preload: path.join(__dirname, "preload.js"), additionalArguments: isDev ? ["--opaline-debug"] : [] },
	});
	if (!bounds)
		win.once("ready-to-show", () => {
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
		if (isAppUrl(next)) createWindow({ url: next });
		else shell.openExternal(next);
		return { action: "deny" };
	});
	appWindows.add(win);
	win.on("closed", () => appWindows.delete(win));
	const target = url ?? explicitUrl;
	if (target) win.loadURL(intro ? introUrl(target) : target);
	else stack.openDashboard(win, undefined, { intro }).catch(() => {});
	return win;
}

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

function revealApp(from, duration) {
	stack.mark("open-clicked");
	const bounds = from.getBounds();
	const win = createWindow({ bounds, intro: true });
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
		webPreferences: { devTools: isDev, preload: path.join(__dirname, "onboarding-preload.js"), additionalArguments: isDev ? ["--opaline-debug"] : [] },
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
		webPreferences: { devTools: isDev, preload: path.join(__dirname, "onboarding-preload.js") },
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

function appIcon(bundle) {
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

ipcMain.handle("onboarding:scan", (event) => (fromOnboarding(event) ? scanSessions() : null));
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
			}
		: null,
);
ipcMain.handle("onboarding:agents", (event) => (fromOnboarding(event) ? agents.statuses() : null));
ipcMain.handle("onboarding:connect", (event, key) => (fromOnboarding(event) ? agents.connect(key) : null));
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
	if (!replaced && BrowserWindow.getAllWindows().length > 1) return onboardingWindow.destroy();
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

ipcMain.on("app:replay-open", (event) => {
	if (!isDev || !fromApp(event) || onboardingWindow) return;
	replaced = BrowserWindow.fromWebContents(event.sender);
	onboardingDone = false;
	createOnboardingWindow("replay");
	onboardingWindow.once("show", () => replaced?.hide());
});

function reloadAppWindows() {
	for (const win of appWindows) if (!win.isDestroyed() && isAppUrl(win.webContents.getURL())) win.reload();
}

function mainWindow() {
	const focused = BrowserWindow.getFocusedWindow();
	if (focused && appWindows.has(focused)) return focused;
	return [...appWindows].findLast((win) => !win.isDestroyed());
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

app.whenReady().then(() => {
	stack.mark("ready");
	if (!explicitUrl)
		Menu.setApplicationMenu(
			createEnvironmentMenu({
				stack,
				window: mainWindow,
				openWindow: () => createWindow(),
				quitCompletely,
			}),
		);
	if (onboarding) {
		nativeTheme.themeSource = "dark";
		createOnboarding();
	} else {
		nativeTheme.themeSource = savedTheme();
		createWindow();
	}
	if (!explicitUrl) {
		stack.supervise({ onRestart: reloadAppWindows });
		stack.ready().then(() => agents.refresh()).catch(() => {});
	}
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

let stopServer = false;
let stopping;
let stopped = false;

function quitCompletely() {
	stopServer = true;
	app.quit();
}

app.on("before-quit", (event) => {
	quitting = true;
	if (onboardingWindow && !onboardingWindow.isDestroyed()) onboardingWindow.setClosable(true);
	if (stopped || explicitUrl) return;
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

module.exports = { stack };
