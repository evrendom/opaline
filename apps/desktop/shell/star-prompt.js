const { execFile } = require("node:child_process");
const fs = require("node:fs");

const REPO = "evrendom/opaline";
const REPO_URL = `https://github.com/${REPO}`;
// The card asks for a star once someone has actively used the app for an hour.
const ASK_AFTER_MS = 60 * 60 * 1000;
// Time only counts while an Opaline window is focused and the Mac isn't idle.
const IDLE_LIMIT_S = 5 * 60;
const COUNT_TTL_MS = 6 * 60 * 60 * 1000;
const GH_TIMEOUT_MS = 8_000;
// Electron apps opened from Finder get a bare PATH; gh usually lives here.
const GH_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

function ghRunner() {
	return (args) =>
		new Promise((resolve) => {
			const PATH = [...GH_PATHS, process.env.PATH].filter(Boolean).join(":");
			execFile(
				"gh",
				args,
				{ env: { ...process.env, PATH }, timeout: GH_TIMEOUT_MS },
				(error, stdout) => resolve({ ok: !error, stdout: stdout ?? "" }),
			);
		});
}

function createStarPrompt({
	file,
	fsImpl = fs,
	now = Date.now,
	idleSeconds = () => 0,
	gh = ghRunner(),
	fetchJson,
	openInBackground,
	askAfterMs = ASK_AFTER_MS,
}) {
	let state = {
		usedMs: 0,
		dismissedAt: null,
		starredAt: null,
		count: null,
		countAt: 0,
	};
	try {
		state = { ...state, ...JSON.parse(fsImpl.readFileSync(file, "utf8")) };
	} catch {}
	let lastTick = null;
	let alreadyStarredChecked = false;

	function save() {
		try {
			fsImpl.writeFileSync(file, JSON.stringify(state));
		} catch {}
	}

	// Called on a timer. Counts the time since the last tick when a window had
	// focus and the user wasn't idle; anything else resets the stopwatch.
	function tick(focused) {
		const t = now();
		if (focused && idleSeconds() < IDLE_LIMIT_S && lastTick !== null) {
			state.usedMs += Math.min(t - lastTick, 2 * 60 * 1000);
			save();
		}
		lastTick = focused ? t : null;
	}

	async function starCount() {
		if (state.count !== null && now() - state.countAt < COUNT_TTL_MS)
			return state.count;
		const viaGh = await gh([
			"api",
			`repos/${REPO}`,
			"--jq",
			".stargazers_count",
		]);
		let count = viaGh.ok
			? Number.parseInt(viaGh.stdout.trim(), 10)
			: Number.NaN;
		if (!Number.isFinite(count) && fetchJson) {
			const repo = await fetchJson(
				`https://api.github.com/repos/${REPO}`,
			).catch(() => null);
			count = Number(repo?.stargazers_count);
		}
		if (!Number.isFinite(count)) return state.count;
		state.count = count;
		state.countAt = now();
		save();
		return count;
	}

	// gh answers 204 for a starred repository and 404 otherwise.
	async function checkAlreadyStarred() {
		if (alreadyStarredChecked) return;
		alreadyStarredChecked = true;
		const result = await gh(["api", `user/starred/${REPO}`, "--silent"]);
		if (result.ok) {
			state.starredAt ??= now();
			save();
		}
	}

	async function status() {
		const due =
			state.usedMs >= askAfterMs &&
			state.dismissedAt == null &&
			state.starredAt == null;
		if (!due) return { show: false, count: null };
		await checkAlreadyStarred();
		if (state.starredAt != null) return { show: false, count: null };
		const count = await starCount();
		return { show: count !== null, count };
	}

	// Stars from the signed-in gh when it can; otherwise opens the repository
	// in the browser without bringing it to the front, so Opaline keeps focus.
	async function star() {
		state.starredAt = now();
		save();
		const result = await gh([
			"api",
			"--method",
			"PUT",
			`user/starred/${REPO}`,
			"--silent",
		]);
		if (result.ok) {
			if (state.count !== null) state.count += 1;
			save();
			return { via: "gh" };
		}
		await openInBackground?.(REPO_URL);
		return { via: "browser" };
	}

	function dismiss() {
		state.dismissedAt = now();
		save();
	}

	return { tick, status, star, dismiss, state: () => ({ ...state }) };
}

module.exports = { createStarPrompt, ASK_AFTER_MS, IDLE_LIMIT_S, REPO_URL };
