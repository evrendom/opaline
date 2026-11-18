const fs = require("node:fs");

const MIN_VISIBLE_WIDTH = 120;
const MIN_VISIBLE_HEIGHT = 40;
const SAVE_DELAY_MS = 400;
const CASCADE_OFFSET = 24;

function isRect(value) {
	return (
		value &&
		["x", "y", "width", "height"].every((key) => Number.isFinite(value[key])) &&
		value.width > 0 &&
		value.height > 0
	);
}

function onScreen(bounds, areas) {
	return areas.some((area) => {
		const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
		const top = Math.max(bounds.y, area.y);
		const titleBarVisible = top < Math.min(bounds.y + MIN_VISIBLE_HEIGHT, area.y + area.height);
		return width >= MIN_VISIBLE_WIDTH && titleBarVisible;
	});
}

function cascade(bounds, area) {
	const x = bounds.x + CASCADE_OFFSET;
	const y = bounds.y + CASCADE_OFFSET;
	const fits = x + bounds.width <= area.x + area.width && y + bounds.height <= area.y + area.height;
	return fits ? { ...bounds, x, y } : { ...bounds, x: area.x, y: area.y };
}

function createWindowState({ file, screen, fsImpl = fs }) {
	let timer;

	function read() {
		try {
			const saved = JSON.parse(fsImpl.readFileSync(file, "utf8"));
			if (!isRect(saved?.bounds)) return undefined;
			return { bounds: saved.bounds, maximized: saved.maximized === true };
		} catch {
			return undefined;
		}
	}

	function load() {
		const saved = read();
		if (!saved) return undefined;
		const areas = screen.getAllDisplays().map((display) => display.workArea);
		return onScreen(saved.bounds, areas) ? saved : undefined;
	}

	function nextTo(win) {
		const bounds = win.getNormalBounds();
		return { bounds: cascade(bounds, screen.getDisplayMatching(bounds).workArea), maximized: false };
	}

	function save(win) {
		clearTimeout(timer);
		timer = undefined;
		if (win.isDestroyed() || win.isFullScreen()) return;
		try {
			fsImpl.writeFileSync(file, JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }));
		} catch {}
	}

	function track(win) {
		const later = () => {
			clearTimeout(timer);
			timer = setTimeout(() => save(win), SAVE_DELAY_MS);
		};
		for (const event of ["resize", "move", "maximize", "unmaximize"]) win.on(event, later);
		win.on("close", () => save(win));
	}

	return { load, nextTo, track };
}

module.exports = { createWindowState, onScreen, cascade };
