const { afterEach, beforeEach, describe, expect, test } = require("bun:test");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const {
	buildFeed,
	compareVersions,
	createUpdater,
	defaultFeedUrl,
	githubAsset,
	isQuietFailure,
	parseFeed,
	releaseTag,
	updateZipName,
} = require("../updates");

const FEED_URL = defaultFeedUrl("arm64");
const ZIP_URL =
	"https://github.com/opalinehq/athena/releases/download/desktop-v0.2.0/Opaline-0.2.0-darwin-arm64.zip";

function feedFor(version, url = ZIP_URL) {
	return buildFeed({ version, url, date: "2026-11-16T00:00:00.000Z" });
}

function jsonResponse(body, status = 200, headers = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

function fakeAutoUpdater(order = []) {
	const updater = new EventEmitter();
	updater.feeds = [];
	updater.checks = 0;
	updater.installs = 0;
	updater.setFeedURL = (options) => updater.feeds.push(options);
	updater.checkForUpdates = () => {
		updater.checks++;
	};
	updater.quitAndInstall = () => {
		updater.installs++;
		order.push("quitAndInstall");
	};
	return updater;
}

function fakeUi({ restart = false, canPrompt = true } = {}) {
	const calls = [];
	return {
		calls,
		canPrompt: () => canPrompt,
		upToDate: (version) => calls.push(["upToDate", version]),
		downloading: (release) => calls.push(["downloading", release.version]),
		failed: (error) => calls.push(["failed", error.message]),
		askToRestart: async (release) => {
			calls.push(["askToRestart", release.version]);
			return restart;
		},
	};
}

let root;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "opaline-updates-"));
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function setup({
	fetch,
	ui = fakeUi(),
	env = {},
	currentVersion = "0.1.0",
	order = [],
	beforeInstall = async () => {
		order.push("beforeInstall");
	},
} = {}) {
	const autoUpdater = fakeAutoUpdater(order);
	const lines = [];
	const quits = [];
	const updater = createUpdater({
		autoUpdater,
		currentVersion,
		env,
		arch: "arm64",
		fetch,
		log: (line) => lines.push(line),
		ui,
		beforeInstall,
		quit: () => quits.push("quit"),
		feedFile: path.join(root, "update", "feed.json"),
		timers: {
			setTimeout: () => undefined,
			clearTimeout: () => {},
			setInterval: () => undefined,
			clearInterval: () => {},
		},
	});
	return { autoUpdater, updater, ui, lines, quits, order };
}

describe("versions", () => {
	test("compares release and prerelease versions the semver way", () => {
		expect(compareVersions("0.1.0", "0.1.1")).toBe(-1);
		expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
		expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
		expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
		expect(compareVersions("1.0.0-beta.2", "1.0.0")).toBe(-1);
		expect(compareVersions("1.0.0-beta.11", "1.0.0-beta.2")).toBe(1);
		expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
		expect(compareVersions("1.0.0-alpha.1", "1.0.0-beta")).toBe(-1);
		expect(compareVersions("1.0.0+build.5", "1.0.0")).toBe(0);
		expect(() => compareVersions("latest", "1.0.0")).toThrow("Not a version");
	});

	test("release names follow the version", () => {
		expect(releaseTag("0.2.0")).toBe("desktop-v0.2.0");
		expect(updateZipName("0.2.0", "arm64")).toBe(
			"Opaline-0.2.0-darwin-arm64.zip",
		);
		expect(FEED_URL).toBe(
			"https://github.com/opalinehq/athena/releases/download/desktop-latest/desktop-update-darwin-arm64.json",
		);
	});
});

describe("feed", () => {
	test("reads the current release from a Squirrel JSON file feed", () => {
		expect(parseFeed(feedFor("0.2.0"))).toEqual({
			version: "0.2.0",
			url: ZIP_URL,
			name: "Opaline 0.2.0",
			notes: "",
			date: "2026-11-16T00:00:00.000Z",
		});
	});

	test("rejects feeds without a usable current release", () => {
		expect(() => parseFeed(null)).toThrow("not a JSON object");
		expect(() => parseFeed({ releases: [] })).toThrow(
			"no valid currentRelease",
		);
		expect(() =>
			parseFeed({ ...feedFor("0.2.0"), currentRelease: "0.3.0" }),
		).toThrow("no release for 0.3.0");
		expect(() =>
			parseFeed(feedFor("0.2.0", "http://example.com/Opaline.zip")),
		).toThrow("no https download");
		expect(() => parseFeed(feedFor("0.2.0", "file:///tmp/a.zip"))).toThrow(
			"no https download",
		);
	});

	test("allows plain http only on this machine", () => {
		expect(
			parseFeed(feedFor("0.2.0", "http://127.0.0.1:8123/Opaline.zip")).url,
		).toBe("http://127.0.0.1:8123/Opaline.zip");
	});

	test("recognizes GitHub release asset links", () => {
		expect(githubAsset(ZIP_URL)).toEqual({
			owner: "opalinehq",
			repo: "athena",
			tag: "desktop-v0.2.0",
			name: "Opaline-0.2.0-darwin-arm64.zip",
		});
		expect(githubAsset("http://127.0.0.1:8123/feed.json")).toBeUndefined();
	});
});

describe("checks", () => {
	test("a missing or private feed is quiet: a log line, no dialog", async () => {
		const { updater, ui, lines, autoUpdater } = setup({
			fetch: async () => new Response("Not Found", { status: 404 }),
		});
		await updater.check();
		expect(ui.calls).toEqual([]);
		expect(autoUpdater.feeds).toEqual([]);
		expect(updater.state()).toEqual({ kind: "idle" });
		expect(lines.join("\n")).toContain("no update feed to read");
		expect(lines.join("\n")).toContain("404");
	});

	test("asked from the menu, a missing feed reads as up to date", async () => {
		const { updater, ui } = setup({
			fetch: async () => new Response("", { status: 404 }),
		});
		await updater.check({ interactive: true });
		expect(ui.calls).toEqual([["upToDate", "0.1.0"]]);
	});

	test("network failures stay quiet in the background and show when asked", async () => {
		const fetch = async () => {
			throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
		};
		const background = setup({ fetch });
		await background.updater.check();
		expect(background.ui.calls).toEqual([]);
		expect(background.lines.join("\n")).toContain("ENOTFOUND");
		const asked = setup({ fetch });
		await asked.updater.check({ interactive: true });
		expect(asked.ui.calls).toEqual([
			["failed", "Could not reach github.com (ENOTFOUND)."],
		]);
		expect(isQuietFailure(new Error("x"))).toBe(false);
	});

	test("a broken feed is reported only when asked", async () => {
		const { updater, ui } = setup({
			fetch: async () => jsonResponse({ currentRelease: "soon" }),
		});
		await updater.check();
		expect(ui.calls).toEqual([]);
		await updater.check({ interactive: true });
		expect(ui.calls).toEqual([
			["failed", "The update feed has no valid currentRelease."],
		]);
	});

	test("the same or an older version does not start the updater", async () => {
		for (const version of ["0.1.0", "0.0.9"]) {
			const { updater, autoUpdater, ui } = setup({
				fetch: async () => jsonResponse(feedFor(version)),
			});
			await updater.check({ interactive: true });
			expect(autoUpdater.feeds).toEqual([]);
			expect(autoUpdater.checks).toBe(0);
			expect(ui.calls).toEqual([["upToDate", "0.1.0"]]);
		}
	});

	test("a newer version hands the feed to Squirrel and asks to restart once downloaded", async () => {
		const requested = [];
		const { updater, autoUpdater, ui } = setup({
			fetch: async (url, init) => {
				requested.push([url, init.headers]);
				return jsonResponse(feedFor("0.2.0"));
			},
		});
		const changes = [];
		updater.on("change", (state) => changes.push(state.kind));
		await updater.check();
		expect(requested).toEqual([[FEED_URL, { accept: "application/json" }]]);
		expect(autoUpdater.feeds).toEqual([{ url: FEED_URL, serverType: "json" }]);
		expect(autoUpdater.checks).toBe(1);
		expect(updater.menuItem()).toEqual({
			label: "Downloading Opaline 0.2.0…",
			enabled: false,
		});
		autoUpdater.emit("update-downloaded");
		await Bun.sleep(0);
		expect(ui.calls).toEqual([["askToRestart", "0.2.0"]]);
		expect(updater.pending()).toBe(true);
		expect(updater.menuItem().label).toBe("Restart to Update to 0.2.0");
		expect(changes).toEqual(["checking", "downloading", "ready"]);
		await updater.check();
		expect(autoUpdater.checks).toBe(1);
	});

	test("the test feed override replaces the GitHub feed", async () => {
		const local = "http://127.0.0.1:8123/desktop-update-darwin-arm64.json";
		const { updater, autoUpdater } = setup({
			env: { OPALINE_UPDATE_FEED_URL: local },
			fetch: async (url) => {
				expect(url).toBe(local);
				return jsonResponse(
					feedFor("0.2.0", "http://127.0.0.1:8123/Opaline.zip"),
				);
			},
		});
		expect(updater.feedUrl).toBe(local);
		await updater.check();
		expect(autoUpdater.feeds).toEqual([{ url: local, serverType: "json" }]);
	});

	test("an updater error while downloading is quiet in the background", async () => {
		const { updater, autoUpdater, ui, lines } = setup({
			fetch: async () => jsonResponse(feedFor("0.2.0")),
		});
		await updater.check();
		autoUpdater.emit(
			"error",
			new Error("Code signature at URL did not pass validation"),
		);
		expect(ui.calls).toEqual([]);
		expect(updater.state()).toEqual({ kind: "idle" });
		expect(lines.at(-1)).toContain("did not pass validation");
	});

	test("asked while downloading, the menu check says so instead of checking again", async () => {
		const { updater, autoUpdater, ui } = setup({
			fetch: async () => jsonResponse(feedFor("0.2.0")),
		});
		await updater.check();
		await updater.check({ interactive: true });
		expect(ui.calls).toEqual([["downloading", "0.2.0"]]);
		expect(autoUpdater.checks).toBe(1);
	});
});

describe("install", () => {
	test("the local server stops before Squirrel quits and swaps the app", async () => {
		const order = [];
		let release;
		const stopped = new Promise((resolve) => {
			release = resolve;
		});
		const { updater, autoUpdater } = setup({
			order,
			ui: fakeUi({ restart: true }),
			fetch: async () => jsonResponse(feedFor("0.2.0")),
			beforeInstall: async () => {
				order.push("stop-started");
				await stopped;
				order.push("stop-finished");
			},
		});
		await updater.check();
		autoUpdater.emit("update-downloaded");
		await Bun.sleep(0);
		expect(updater.state().kind).toBe("installing");
		expect(order).toEqual(["stop-started"]);
		expect(autoUpdater.installs).toBe(0);
		release();
		await Bun.sleep(0);
		expect(order).toEqual(["stop-started", "stop-finished", "quitAndInstall"]);
	});

	test("Later keeps the update for the next quit, and the menu installs it", async () => {
		const { updater, autoUpdater, order, lines } = setup({
			fetch: async () => jsonResponse(feedFor("0.2.0")),
		});
		await updater.check();
		autoUpdater.emit("update-downloaded");
		await Bun.sleep(0);
		expect(lines.at(-1)).toContain("postponed until Opaline quits");
		expect(updater.pending()).toBe(true);
		expect(autoUpdater.installs).toBe(0);
		await updater.menuItem().click();
		expect(order).toEqual(["beforeInstall", "quitAndInstall"]);
		expect(updater.pending()).toBe(false);
	});

	test("no prompt while it cannot ask (onboarding), the update still waits", async () => {
		const ui = fakeUi({ restart: true, canPrompt: false });
		const { updater, autoUpdater } = setup({
			ui,
			fetch: async () => jsonResponse(feedFor("0.2.0")),
		});
		await updater.check();
		autoUpdater.emit("update-downloaded");
		await Bun.sleep(0);
		expect(ui.calls).toEqual([]);
		expect(updater.pending()).toBe(true);
		await updater.check({ interactive: true });
		expect(ui.calls).toEqual([["askToRestart", "0.2.0"]]);
	});

	test("an updater error after the server stopped still quits the app", async () => {
		const { updater, autoUpdater, quits } = setup({
			ui: fakeUi({ restart: true }),
			fetch: async () => jsonResponse(feedFor("0.2.0")),
		});
		await updater.check();
		autoUpdater.emit("update-downloaded");
		await Bun.sleep(0);
		autoUpdater.emit("error", new Error("No update available"));
		expect(quits).toEqual(["quit"]);
	});

	test("install does nothing without a downloaded update", async () => {
		const { updater, order } = setup({ fetch: async () => jsonResponse({}) });
		expect(await updater.install()).toBe(false);
		expect(order).toEqual([]);
	});
});

describe("private repository token", () => {
	test("resolves feed and download through the GitHub API and gives Squirrel a local feed", async () => {
		const requests = [];
		const signed = (name) => `https://objects.example.test/${name}?sig=1`;
		const fetch = async (url, init) => {
			requests.push({ url, auth: init.headers?.authorization });
			if (url.endsWith("/releases/tags/desktop-latest"))
				return jsonResponse({
					assets: [
						{
							name: "desktop-update-darwin-arm64.json",
							url: "https://api.github.com/assets/1",
						},
					],
				});
			if (url.endsWith("/releases/tags/desktop-v0.2.0"))
				return jsonResponse({
					assets: [
						{
							name: "Opaline-0.2.0-darwin-arm64.zip",
							url: "https://api.github.com/assets/2",
						},
					],
				});
			if (url === "https://api.github.com/assets/1")
				return new Response(null, {
					status: 302,
					headers: { location: signed("feed.json") },
				});
			if (url === "https://api.github.com/assets/2")
				return new Response(null, {
					status: 302,
					headers: { location: signed("Opaline.zip") },
				});
			if (url === signed("feed.json")) return jsonResponse(feedFor("0.2.0"));
			return new Response("", { status: 404 });
		};
		const { updater, autoUpdater } = setup({
			env: { OPALINE_UPDATE_GITHUB_TOKEN: "test-token" },
			fetch,
		});
		await updater.check();
		const [{ url, serverType }] = autoUpdater.feeds;
		expect(serverType).toBe("json");
		const local = JSON.parse(fs.readFileSync(fileURLToPath(url), "utf8"));
		expect(parseFeed(local).url).toBe(signed("Opaline.zip"));
		for (const request of requests)
			expect(request.auth).toBe(
				new URL(request.url).host === "api.github.com"
					? "Bearer test-token"
					: undefined,
			);
	});

	test("a token without access is as quiet as no token", async () => {
		const { updater, ui, lines } = setup({
			env: { OPALINE_UPDATE_GITHUB_TOKEN: "test-token" },
			fetch: async () => jsonResponse({ message: "Not Found" }, 404),
		});
		await updater.check();
		expect(ui.calls).toEqual([]);
		expect(lines.join("\n")).not.toContain("test-token");
	});
});
