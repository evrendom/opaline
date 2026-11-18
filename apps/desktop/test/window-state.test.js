const { describe, expect, test } = require("bun:test");
const { cascade, createWindowState, onScreen } = require("../window-state");

const laptop = { x: 0, y: 25, width: 1512, height: 920 };
const external = { x: 1512, y: -300, width: 2560, height: 1415 };

function memoryFs(initial) {
	const files = new Map(initial ? [["state.json", initial]] : []);
	return {
		files,
		readFileSync: (file) => {
			if (!files.has(file)) throw new Error("missing");
			return files.get(file);
		},
		writeFileSync: (file, data) => files.set(file, data),
	};
}

function fakeScreen(areas) {
	return {
		getAllDisplays: () => areas.map((workArea) => ({ workArea })),
		getDisplayMatching: () => ({ workArea: areas[0] }),
	};
}

function fakeWindow(bounds, { maximized = false, fullScreen = false } = {}) {
	const handlers = {};
	return {
		handlers,
		on: (event, fn) => {
			handlers[event] = fn;
		},
		getNormalBounds: () => bounds,
		isMaximized: () => maximized,
		isFullScreen: () => fullScreen,
		isDestroyed: () => false,
	};
}

describe("onScreen", () => {
	test("a window on the laptop or the external display is on screen", () => {
		expect(
			onScreen({ x: 100, y: 60, width: 1200, height: 800 }, [laptop]),
		).toBe(true);
		expect(
			onScreen({ x: 2000, y: -200, width: 1200, height: 800 }, [
				laptop,
				external,
			]),
		).toBe(true);
	});

	test("a window left on a display that is gone is not", () => {
		expect(
			onScreen({ x: 2000, y: -200, width: 1200, height: 800 }, [laptop]),
		).toBe(false);
	});

	test("a window whose title bar sits above the screen is not", () => {
		expect(
			onScreen({ x: 100, y: -900, width: 1200, height: 800 }, [laptop]),
		).toBe(false);
	});
});

describe("window state", () => {
	test("restores the saved bounds and maximized state", () => {
		const saved = {
			bounds: { x: 80, y: 60, width: 1200, height: 780 },
			maximized: true,
		};
		const state = createWindowState({
			file: "state.json",
			screen: fakeScreen([laptop]),
			fsImpl: memoryFs(JSON.stringify(saved)),
		});
		expect(state.load()).toEqual(saved);
	});

	test("ignores bounds from a display that is no longer attached", () => {
		const saved = {
			bounds: { x: 2000, y: -200, width: 1200, height: 780 },
			maximized: false,
		};
		const state = createWindowState({
			file: "state.json",
			screen: fakeScreen([laptop]),
			fsImpl: memoryFs(JSON.stringify(saved)),
		});
		expect(state.load()).toBeUndefined();
	});

	test("ignores a missing or broken file", () => {
		expect(
			createWindowState({
				file: "state.json",
				screen: fakeScreen([laptop]),
				fsImpl: memoryFs(),
			}).load(),
		).toBeUndefined();
		expect(
			createWindowState({
				file: "state.json",
				screen: fakeScreen([laptop]),
				fsImpl: memoryFs("{"),
			}).load(),
		).toBeUndefined();
	});

	test("saves the normal bounds when the window closes", () => {
		const fsImpl = memoryFs();
		const state = createWindowState({
			file: "state.json",
			screen: fakeScreen([laptop]),
			fsImpl,
		});
		const win = fakeWindow(
			{ x: 10, y: 40, width: 1000, height: 700 },
			{ maximized: true },
		);
		state.track(win);
		win.handlers.close();
		expect(JSON.parse(fsImpl.files.get("state.json"))).toEqual({
			bounds: { x: 10, y: 40, width: 1000, height: 700 },
			maximized: true,
		});
	});

	test("does not save a full-screen window", () => {
		const fsImpl = memoryFs();
		const state = createWindowState({
			file: "state.json",
			screen: fakeScreen([laptop]),
			fsImpl,
		});
		const win = fakeWindow(
			{ x: 10, y: 40, width: 1000, height: 700 },
			{ fullScreen: true },
		);
		state.track(win);
		win.handlers.close();
		expect(fsImpl.files.has("state.json")).toBe(false);
	});
});

describe("cascade", () => {
	test("opens a second window offset from the first", () => {
		expect(
			cascade({ x: 100, y: 100, width: 800, height: 600 }, laptop),
		).toEqual({ x: 124, y: 124, width: 800, height: 600 });
	});

	test("goes back to the corner when the offset would leave the screen", () => {
		expect(
			cascade({ x: 700, y: 330, width: 800, height: 600 }, laptop),
		).toEqual({ x: 0, y: 25, width: 800, height: 600 });
	});
});
