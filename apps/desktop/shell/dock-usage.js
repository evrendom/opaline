const fs = require("node:fs");
const path = require("node:path");
const {
	app,
	BrowserWindow,
	Menu,
	nativeImage,
	systemPreferences,
} = require("electron");

const TAIL_BYTES = 256 * 1024;
const WEEK_MINUTES = 7 * 24 * 60;
const AGENT_REFRESH_MS = 10 * 60 * 1000;
const READINGS_DEBOUNCE_MS = 500;
const ICON_SIZE = 512;
const DRAW_TIMEOUT_MS = 10_000;
const IDLE_CLOSE_MS = 60_000;
const MODES = ["claude", "codex", "both"];
const LABELS = { claude: "Claude Code", codex: "Codex", both: "Both" };

function latestReadings(text) {
	const found = {};
	const lines = text.split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i].trim();
		if (!line.startsWith("{")) continue;
		let reading;
		try {
			reading = JSON.parse(line);
		} catch {
			continue;
		}
		if (
			reading.kind === "ask" ||
			reading.modelScope ||
			typeof reading.usedPercent !== "number"
		)
			continue;
		const seen = found[reading.provider];
		if (seen && seen.at !== reading.at) continue;
		if (!seen) {
			found[reading.provider] = reading;
			continue;
		}
		const preferred = (r) =>
			r.windowMinutes === WEEK_MINUTES
				? Number.MAX_SAFE_INTEGER
				: (r.windowMinutes ?? 0);
		if (preferred(reading) > preferred(seen)) found[reading.provider] = reading;
	}
	return found;
}

function leftOf(reading) {
	return Math.max(0, Math.min(100, Math.round(100 - reading.usedPercent)));
}

function iconValue(mode, readings, connected) {
	const usable = (key) => connected.has(key) && readings[key];
	const keys =
		mode === "both"
			? ["claude", "codex"].filter(usable)
			: [mode].filter(usable);
	if (!keys.length) return null;
	return Math.round(
		keys.reduce((sum, key) => sum + leftOf(readings[key]), 0) / keys.length,
	);
}

function resetText(reading, now = new Date()) {
	if (!reading.resetsAt) return "";
	const at = new Date(reading.resetsAt);
	const ms = at - now;
	if (!(ms > 0)) return "";
	const hours = Math.floor(ms / 3_600_000);
	const minutes = Math.floor((ms % 3_600_000) / 60_000);
	const span =
		hours >= 48
			? `${Math.floor(hours / 24)}d ${hours % 24}h`
			: `${hours}h ${minutes}m`;
	const time = at.toLocaleTimeString("en-GB", {
		hour: "2-digit",
		minute: "2-digit",
	});
	const day =
		at.toDateString() === now.toDateString()
			? "today"
			: at.toLocaleDateString("en-GB", {
					weekday: "short",
					day: "numeric",
					month: "short",
				});
	return `Resets ${day} ${time} (in ${span})`;
}

function readTail(file) {
	let handle;
	try {
		handle = fs.openSync(file, "r");
		const { size } = fs.fstatSync(handle);
		const length = Math.min(size, TAIL_BYTES);
		const buffer = Buffer.alloc(length);
		fs.readSync(handle, buffer, 0, length, size - length);
		return buffer.toString("utf8");
	} catch {
		return "";
	} finally {
		if (handle !== undefined) fs.closeSync(handle);
	}
}

function systemIsDark() {
	return (
		systemPreferences.getUserDefault("AppleInterfaceStyle", "string") === "Dark"
	);
}

function createDockUsage({ agents, dataDir, development = false }) {
	const usageFile = path.join(dataDir, "data", "plan-usage.jsonl");
	const modeFile = path.join(app.getPath("userData"), "dock-usage");
	const drawPage = path.join(__dirname, "icon", "dock", "draw.html");
	let connected = new Set();
	let readings = {};
	let shown = null;
	let drawing = Promise.resolve();
	let watcher = null;
	let debounce = null;
	let timer = null;

	function savedMode() {
		try {
			const mode = fs.readFileSync(modeFile, "utf8").trim();
			if (MODES.includes(mode)) return mode;
		} catch {}
		return connected.has("claude") || !connected.has("codex")
			? "claude"
			: "codex";
	}

	function saveMode(mode) {
		fs.mkdirSync(path.dirname(modeFile), { recursive: true });
		fs.writeFileSync(modeFile, mode);
	}

	let page = null;
	let idle = null;

	function drawWindow() {
		page ??= (async () => {
			const window = new BrowserWindow({
				show: false,
				width: ICON_SIZE,
				height: ICON_SIZE,
				webPreferences: { offscreen: true, sandbox: true },
			});
			window.on("closed", () => {
				page = null;
			});
			await window.loadFile(drawPage);
			return window;
		})().catch((error) => {
			page = null;
			throw error;
		});
		return page;
	}

	function withTimeout(promise) {
		let timeout;
		return Promise.race([
			promise,
			new Promise(
				(_, reject) =>
					(timeout = setTimeout(
						() => reject(new Error("dock icon draw timed out")),
						DRAW_TIMEOUT_MS,
					)),
			),
		]).finally(() => clearTimeout(timeout));
	}

	async function draw(left, dark) {
		clearTimeout(idle);
		const window = await withTimeout(drawWindow());
		try {
			// The development icon is drawn on the light face (recoloured blue)
			// with the dark icon's white ring and digits, in both appearances.
			const theme = (layer) =>
				development ? (layer === "base" ? "light" : "dark") : dark ? "dark" : "light";
			const source = (layer, name = layer) =>
				`data:image/png;base64,${fs.readFileSync(path.join(__dirname, "icon", "dock", theme(layer), `${name}.png`)).toString("base64")}`;
			const layers = {
				base: source("base"),
				ring: source("ring"),
				number: source("number", String(left)),
			};
			const url = await withTimeout(
				window.webContents.executeJavaScript(
					`window.draw(${JSON.stringify({ left: left / 100, dark, size: ICON_SIZE, layers, dev: development })})`,
				),
			);
			return nativeImage.createFromDataURL(url);
		} finally {
			idle = setTimeout(() => {
				if (!window.isDestroyed()) window.destroy();
			}, IDLE_CLOSE_MS);
		}
	}

	function choices() {
		return MODES.filter((key) =>
			key === "both"
				? connected.has("claude") && connected.has("codex")
				: connected.has(key),
		);
	}

	function menu(mode) {
		const items = [];
		for (const key of ["claude", "codex"]) {
			if (
				!connected.has(key) ||
				!readings[key] ||
				(mode !== "both" && mode !== key)
			)
				continue;
			const left = leftOf(readings[key]);
			items.push({
				label: `${LABELS[key]} · ${left}% left`,
				sublabel: resetText(readings[key]) || undefined,
				enabled: false,
			});
		}
		const options = choices();
		if (options.length > 1) {
			if (items.length) items.push({ type: "separator" });
			items.push({ label: "Show on Icon", enabled: false });
			for (const key of options)
				items.push({
					label: LABELS[key],
					type: "radio",
					checked: key === mode,
					click: () => {
						saveMode(key);
						update();
					},
				});
		}
		app.dock.setMenu(Menu.buildFromTemplate(items));
	}

	function update() {
		readings = latestReadings(readTail(usageFile));
		const saved = savedMode();
		const mode = choices().includes(saved) ? saved : (choices()[0] ?? saved);
		const left = iconValue(mode, readings, connected);
		const dark = systemIsDark();
		menu(mode);
		const key = left === null ? null : `${left}:${dark}`;
		if (key === shown) return drawing;
		shown = key;
		drawing = drawing
			.then(async () => {
				if (shown !== key) return;
				app.dock.setIcon(
					left === null ? nativeImage.createEmpty() : await draw(left, dark),
				);
			})
			.catch(() => {});
		return drawing;
	}

	async function refreshAgents() {
		try {
			const statuses = await agents.statuses();
			connected = new Set(
				statuses
					.filter((status) => status.connected)
					.map((status) => status.key),
			);
		} catch {}
		return update();
	}

	function watch() {
		try {
			watcher = fs.watch(path.dirname(usageFile), (_, name) => {
				if (name && name !== path.basename(usageFile)) return;
				clearTimeout(debounce);
				debounce = setTimeout(update, READINGS_DEBOUNCE_MS);
			});
		} catch {
			watcher = null;
		}
	}

	function start() {
		if (process.platform !== "darwin") return;
		systemPreferences.subscribeNotification(
			"AppleInterfaceThemeChangedNotification",
			() => update(),
		);
		watch();
		timer = setInterval(() => {
			if (!watcher) watch();
			refreshAgents();
		}, AGENT_REFRESH_MS);
		refreshAgents();
	}

	function stop() {
		clearInterval(timer);
		clearTimeout(debounce);
		clearTimeout(idle);
		watcher?.close();
		page?.then((window) => window.destroy()).catch(() => {});
	}

	return { start, stop, refreshAgents };
}

module.exports = { createDockUsage, latestReadings, iconValue, leftOf };
