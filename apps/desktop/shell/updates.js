const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REPOSITORY = "evrendom/opaline";
const FEED_TAG = "desktop-latest";
const FIRST_CHECK_MS = 60_000;
const CHECK_EVERY_MS = 4 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 20_000;
const INSTALL_FALLBACK_MS = 30_000;
const QUIET_STATUSES = new Set([401, 403, 404]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function feedAssetName(arch = process.arch, platform = process.platform) {
	return `desktop-update-${platform}-${arch}.json`;
}

function updateZipName(
	version,
	arch = process.arch,
	platform = process.platform,
) {
	return `Opaline-${version}-${platform}-${arch}.zip`;
}

function releaseTag(version) {
	return `desktop-v${version}`;
}

function defaultFeedUrl(arch = process.arch, platform = process.platform) {
	return `https://github.com/${REPOSITORY}/releases/download/${FEED_TAG}/${feedAssetName(arch, platform)}`;
}

function parseVersion(text) {
	const match =
		typeof text === "string" &&
		/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(
			text.trim(),
		);
	if (!match) return undefined;
	return {
		core: match.slice(1, 4).map(Number),
		pre: match[4] ? match[4].split(".") : [],
	};
}

function comparePre(a, b) {
	if (a.length === 0 || b.length === 0) return b.length - a.length;
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		if (a[index] === undefined) return -1;
		if (b[index] === undefined) return 1;
		const left = /^\d+$/u.test(a[index]) ? Number(a[index]) : undefined;
		const right = /^\d+$/u.test(b[index]) ? Number(b[index]) : undefined;
		if (left !== undefined && right !== undefined) {
			if (left !== right) return left - right;
		} else if (left !== undefined) return -1;
		else if (right !== undefined) return 1;
		else if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
	}
	return 0;
}

function compareVersions(a, b) {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right)
		throw new Error(
			`Not a version: ${left ? JSON.stringify(b) : JSON.stringify(a)}`,
		);
	for (let index = 0; index < 3; index++)
		if (left.core[index] !== right.core[index])
			return Math.sign(left.core[index] - right.core[index]);
	return Math.sign(comparePre(left.pre, right.pre));
}

function isAllowedDownload(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol === "https:") return true;
	return parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
}

function parseFeed(feed) {
	if (!feed || typeof feed !== "object")
		throw new Error("The update feed is not a JSON object.");
	const version = feed.currentRelease;
	if (!parseVersion(version))
		throw new Error("The update feed has no valid currentRelease.");
	const entry = Array.isArray(feed.releases)
		? feed.releases.find((release) => release?.version === version)
		: undefined;
	const update = entry?.updateTo;
	if (!update || update.version !== version)
		throw new Error(`The update feed lists no release for ${version}.`);
	if (typeof update.url !== "string" || !isAllowedDownload(update.url))
		throw new Error(`The update feed has no https download for ${version}.`);
	return {
		version,
		url: update.url,
		name: typeof update.name === "string" ? update.name : `Opaline ${version}`,
		notes: typeof update.notes === "string" ? update.notes : "",
		date: typeof update.pub_date === "string" ? update.pub_date : undefined,
	};
}

function buildFeed({ version, url, name, notes = "", date }) {
	const update = {
		version,
		name: name ?? `Opaline ${version}`,
		notes,
		pub_date: date ?? new Date().toISOString(),
		url,
	};
	return { currentRelease: version, releases: [{ version, updateTo: update }] };
}

class FeedError extends Error {
	constructor(message, status) {
		super(message);
		this.status = status;
	}
}

function isQuietFailure(error) {
	return QUIET_STATUSES.has(error?.status);
}

function githubAsset(url) {
	const match =
		/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)$/u.exec(
			url,
		);
	if (!match) return undefined;
	const [, owner, repo, tag, name] = match.map(decodeURIComponent);
	return { owner, repo, tag, name };
}

function createFetcher({ fetch, token, timeoutMs = FETCH_TIMEOUT_MS }) {
	async function request(url, init = {}) {
		let response;
		try {
			response = await fetch(url, {
				...init,
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			throw new FeedError(
				`Could not reach ${new URL(url).host} (${error.cause?.code ?? error.message}).`,
			);
		}
		return response;
	}

	async function ok(response, what) {
		if (response.ok) return response;
		await response.body?.cancel?.();
		throw new FeedError(
			`${what} answered ${response.status}.`,
			response.status,
		);
	}

	async function signedAssetUrl(url) {
		const asset = githubAsset(url);
		if (!asset) return url;
		const headers = {
			authorization: `Bearer ${token}`,
			"x-github-api-version": "2022-11-28",
		};
		const release = await ok(
			await request(
				`https://api.github.com/repos/${asset.owner}/${asset.repo}/releases/tags/${encodeURIComponent(asset.tag)}`,
				{ headers: { ...headers, accept: "application/vnd.github+json" } },
			),
			`The release ${asset.tag}`,
		).then((response) => response.json());
		const found = release.assets?.find((item) => item.name === asset.name);
		if (!found)
			throw new FeedError(
				`The release ${asset.tag} has no ${asset.name}.`,
				404,
			);
		const redirect = await request(found.url, {
			headers: { ...headers, accept: "application/octet-stream" },
			redirect: "manual",
		});
		const location = redirect.headers.get("location");
		await redirect.body?.cancel?.();
		if (!location)
			throw new FeedError(
				`The asset ${asset.name} answered ${redirect.status} without a download link.`,
				redirect.status,
			);
		return location;
	}

	async function json(url) {
		const target = token ? await signedAssetUrl(url) : url;
		const response = await ok(
			await request(target, { headers: { accept: "application/json" } }),
			"The update feed",
		);
		try {
			return await response.json();
		} catch {
			throw new FeedError("The update feed is not valid JSON.");
		}
	}

	return { json, downloadUrl: (url) => (token ? signedAssetUrl(url) : url) };
}

function createUpdater(options) {
	const {
		autoUpdater,
		currentVersion,
		env = process.env,
		arch = process.arch,
		platform = process.platform,
		fetch = globalThis.fetch,
		log = () => {},
		ui,
		beforeInstall = async () => {},
		quit = () => {},
		feedFile,
		timers = { setTimeout, clearTimeout, setInterval, clearInterval },
	} = options;
	const feedUrl =
		env.OPALINE_UPDATE_FEED_URL?.trim() || defaultFeedUrl(arch, platform);
	const token = env.OPALINE_UPDATE_GITHUB_TOKEN?.trim() || undefined;
	const fetcher = createFetcher({ fetch, token });
	const emitter = new EventEmitter();
	let state = { kind: "idle" };
	let interactive = false;
	let running;
	let first;
	let every;

	function set(next) {
		state = next;
		emitter.emit("change", state);
	}

	function finish(next, report) {
		const asked = interactive;
		interactive = false;
		set(next);
		if (asked) report?.();
	}

	autoUpdater.on("update-downloaded", () => {
		if (state.kind !== "downloading") return;
		const { release } = state;
		log(`update ${release.version} downloaded`);
		interactive = false;
		set({ kind: "ready", release });
		ui.notifyReady?.(release, () => offer({ asked: true }));
		offer();
	});

	autoUpdater.on("update-not-available", () => {
		if (state.kind !== "downloading") return;
		log(`the updater found no update at the feed for ${state.release.version}`);
		finish({ kind: "idle" }, () => ui.upToDate(currentVersion));
	});

	autoUpdater.on("error", (error) => {
		const message = error?.message ?? String(error);
		log(`updater error: ${message}`);
		if (state.kind === "installing") return quit();
		if (state.kind !== "downloading" && state.kind !== "checking") return;
		finish({ kind: "idle" }, () => ui.failed(new Error(message)));
	});

	async function squirrelFeedUrl(release) {
		if (!token) return feedUrl;
		const url = await fetcher.downloadUrl(release.url);
		fs.mkdirSync(path.dirname(feedFile), { recursive: true });
		fs.writeFileSync(feedFile, JSON.stringify(buildFeed({ ...release, url })));
		return pathToFileURL(feedFile).href;
	}

	async function run() {
		set({ kind: "checking" });
		let release;
		try {
			release = parseFeed(await fetcher.json(feedUrl));
		} catch (error) {
			if (isQuietFailure(error)) {
				log(`no update feed to read (${error.message})`);
				return finish({ kind: "idle" }, () => ui.upToDate(currentVersion));
			}
			log(`update check failed: ${error.message}`);
			return finish({ kind: "idle" }, () => ui.failed(error));
		}
		if (compareVersions(release.version, currentVersion) <= 0) {
			log(`up to date: ${currentVersion}, feed ${release.version}`);
			return finish({ kind: "idle" }, () => ui.upToDate(currentVersion));
		}
		log(`update ${release.version} found, downloading`);
		try {
			const url = await squirrelFeedUrl(release);
			set({ kind: "downloading", release });
			if (interactive) ui.downloading(release);
			autoUpdater.setFeedURL({ url, serverType: "json" });
			autoUpdater.checkForUpdates();
		} catch (error) {
			log(`update download failed to start: ${error.message}`);
			finish({ kind: "idle" }, () => ui.failed(error));
		}
	}

	function check({ interactive: asked = false } = {}) {
		if (asked) interactive = true;
		if (state.kind === "ready") {
			interactive = false;
			if (asked) offer({ asked: true });
			return running ?? Promise.resolve();
		}
		if (state.kind === "downloading") {
			interactive = false;
			if (asked) ui.downloading(state.release);
			return Promise.resolve();
		}
		if (state.kind === "installing") return Promise.resolve();
		running ??= run().finally(() => {
			running = undefined;
		});
		return running;
	}

	let asking = false;

	async function offer({ asked = false } = {}) {
		if (state.kind !== "ready" || asking) return;
		if (!asked && !ui.canPrompt()) {
			log(`update ${state.release.version} waits for a quit or the menu`);
			return;
		}
		asking = true;
		let restart;
		try {
			restart = await ui.askToRestart(state.release);
		} finally {
			asking = false;
		}
		if (state.kind !== "ready") return;
		if (restart) return install();
		log(`update ${state.release.version} postponed until Opaline quits`);
	}

	async function install() {
		if (state.kind !== "ready") return false;
		const { release } = state;
		set({ kind: "installing", release });
		log(`installing ${release.version}: stopping the local server first`);
		try {
			await beforeInstall();
		} catch (error) {
			log(`stopping before the update failed: ${error.message}`);
		}
		log(`installing ${release.version}: handing over to the updater`);
		const fallback = timers.setTimeout(quit, INSTALL_FALLBACK_MS);
		fallback?.unref?.();
		try {
			autoUpdater.quitAndInstall();
		} catch (error) {
			timers.clearTimeout(fallback);
			log(`quitAndInstall failed: ${error.message}`);
			quit();
		}
		return true;
	}

	function start({ firstMs = FIRST_CHECK_MS, everyMs = CHECK_EVERY_MS } = {}) {
		stop();
		first = timers.setTimeout(() => check(), firstMs);
		every = timers.setInterval(() => check(), everyMs);
		first?.unref?.();
		every?.unref?.();
	}

	function stop() {
		if (first) timers.clearTimeout(first);
		if (every) timers.clearInterval(every);
		first = every = undefined;
	}

	function menuItem() {
		if (state.kind === "checking")
			return { label: "Checking for Updates…", enabled: false };
		if (state.kind === "downloading")
			return {
				label: `Downloading Opaline ${state.release.version}…`,
				enabled: false,
			};
		if (state.kind === "ready")
			return {
				label: `Restart to Update to ${state.release.version}`,
				click: () => install(),
			};
		if (state.kind === "installing")
			return { label: "Installing Update…", enabled: false };
		return {
			label: "Check for Updates…",
			click: () => check({ interactive: true }),
		};
	}

	return {
		feedUrl,
		state: () => state,
		pending: () => state.kind === "ready",
		check,
		install,
		start,
		stop,
		menuItem,
		on: (name, listener) => emitter.on(name, listener),
	};
}

function releasePageUrl(version, repository = REPOSITORY) {
	return `https://github.com/${repository}/releases/tag/${releaseTag(version)}`;
}

/**
 * For builds that cannot install an update themselves (Linux, Windows): reads the
 * same feed as the macOS updater and, once per version, offers to open the
 * release page.
 */
function createUpdateNotifier(options) {
	const {
		currentVersion,
		env = process.env,
		arch = process.arch,
		platform = process.platform,
		fetch = globalThis.fetch,
		log = () => {},
		ui,
		openDownload,
		stateFile,
		timers = { setTimeout, clearTimeout, setInterval, clearInterval },
	} = options;
	const feedUrl =
		env.OPALINE_UPDATE_FEED_URL?.trim() || defaultFeedUrl(arch, platform);
	const fetcher = createFetcher({ fetch });
	const emitter = new EventEmitter();
	let available;
	let running;
	let first;
	let every;

	function notifiedVersion() {
		try {
			return JSON.parse(fs.readFileSync(stateFile, "utf8")).version;
		} catch {
			return undefined;
		}
	}

	function remember(version) {
		try {
			fs.mkdirSync(path.dirname(stateFile), { recursive: true });
			fs.writeFileSync(stateFile, JSON.stringify({ version }));
		} catch (error) {
			log(`could not save the notified version: ${error.message}`);
		}
	}

	async function offer(release, { asked }) {
		if (!asked && (!ui.canPrompt() || notifiedVersion() === release.version))
			return;
		remember(release.version);
		if (!asked)
			ui.notifyAvailable?.(release, () =>
				openDownload(releasePageUrl(release.version)),
			);
		if (await ui.offerDownload(release, currentVersion))
			openDownload(releasePageUrl(release.version));
	}

	async function run({ asked }) {
		let release;
		try {
			release = parseFeed(await fetcher.json(feedUrl));
		} catch (error) {
			log(`update check failed: ${error.message}`);
			if (asked)
				await (isQuietFailure(error)
					? ui.upToDate(currentVersion)
					: ui.failed(error));
			return;
		}
		if (compareVersions(release.version, currentVersion) <= 0) {
			log(`up to date: ${currentVersion}, feed ${release.version}`);
			if (asked) await ui.upToDate(currentVersion);
			return;
		}
		log(`update ${release.version} is out`);
		if (available?.version !== release.version) {
			available = release;
			emitter.emit("change", { kind: "available", release });
		}
		await offer(release, { asked });
	}

	function check({ interactive = false } = {}) {
		running ??= run({ asked: interactive }).finally(() => {
			running = undefined;
		});
		return running;
	}

	return {
		on: (event, listener) => emitter.on(event, listener),
		start() {
			first = timers.setTimeout(() => check(), FIRST_CHECK_MS);
			every = timers.setInterval(() => check(), CHECK_EVERY_MS);
		},
		stop() {
			timers.clearTimeout(first);
			timers.clearInterval(every);
		},
		check,
		pending: () => false,
		menuItem: () => ({
			label: available
				? `Download Opaline ${available.version}…`
				: "Check for Updates…",
			click: () =>
				available
					? openDownload(releasePageUrl(available.version))
					: check({ interactive: true }),
		}),
	};
}

function createUpdateDialogs({ dialog, window, canPrompt, Notification }) {
	const show = (options) => {
		const parent = window();
		return parent
			? dialog.showMessageBox(parent, options)
			: dialog.showMessageBox(options);
	};
	// A system notification, so an update is seen with Opaline in the
	// background or behind onboarding too. Kept referenced: a collected
	// notification loses its click handler.
	let shown;
	const notify = (title, body, onClick) => {
		if (!Notification?.isSupported?.()) return;
		shown?.close();
		shown = new Notification({ title, body });
		shown.on("click", () => {
			shown = undefined;
			onClick();
		});
		shown.show();
	};
	return {
		canPrompt,
		notifyReady: (release, onClick) =>
			notify(
				`Opaline ${release.version} is ready to install`,
				"Click to restart Opaline now, or it updates the next time you quit.",
				onClick,
			),
		notifyAvailable: (release, onClick) =>
			notify(
				`Opaline ${release.version} is available`,
				"Click to open its download page.",
				onClick,
			),
		upToDate: (version) =>
			show({
				type: "info",
				message: "Opaline is up to date",
				detail: `${version} is the newest version.`,
				buttons: ["OK"],
			}),
		downloading: (release) =>
			show({
				type: "info",
				message: `Downloading Opaline ${release.version}`,
				detail: "Opaline asks you to restart once the update is ready.",
				buttons: ["OK"],
			}),
		failed: (error) =>
			show({
				type: "warning",
				message: "Could not check for updates",
				detail: error.message,
				buttons: ["OK"],
			}),
		offerDownload: async (release, currentVersion) => {
			const { response } = await show({
				type: "info",
				message: `Opaline ${release.version} is available`,
				detail: `You have ${currentVersion}. Download the new version from its release page and install it over this one.`,
				buttons: ["Download", "Later"],
				defaultId: 0,
				cancelId: 1,
			});
			return response === 0;
		},
		askToRestart: async (release) => {
			const { response } = await show({
				type: "info",
				message: `Opaline ${release.version} is ready to install`,
				detail:
					"Restarting stops the local server and starts it again on the new version. Choose Later to install it when you quit Opaline.",
				buttons: ["Restart to Update", "Later"],
				defaultId: 0,
				cancelId: 1,
			});
			return response === 0;
		},
	};
}

module.exports = {
	REPOSITORY,
	FEED_TAG,
	buildFeed,
	compareVersions,
	createUpdateDialogs,
	createUpdateNotifier,
	createUpdater,
	defaultFeedUrl,
	feedAssetName,
	githubAsset,
	isQuietFailure,
	parseFeed,
	releasePageUrl,
	releaseTag,
	updateZipName,
};
