const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HISTORY_DAYS = 30;
const IMPORT_BATCH = 10;

function listJsonl(directory) {
	try {
		return fs
			.readdirSync(directory, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
			.map((entry) => path.join(directory, entry.name));
	} catch {
		return [];
	}
}

function listDirectories(directory) {
	try {
		return fs
			.readdirSync(directory, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => path.join(directory, entry.name));
	} catch {
		return [];
	}
}

function claudeProjectsDir(env = process.env, home = os.homedir()) {
	const configDir = env.CLAUDE_CONFIG_DIR?.trim();
	return path.join(configDir || path.join(home, ".claude"), "projects");
}

function codexHome(env = process.env, home = os.homedir()) {
	return env.CODEX_HOME?.trim() || path.join(home, ".codex");
}

function listRecentSessions({
	env = process.env,
	home = os.homedir(),
	days = HISTORY_DAYS,
	now = Date.now(),
} = {}) {
	const since = now - days * 86_400_000;
	const candidates = [];
	for (const project of listDirectories(claudeProjectsDir(env, home)))
		for (const file of listJsonl(project))
			candidates.push({ agent: "claude_code", path: file });
	const codex = codexHome(env, home);
	for (const year of listDirectories(path.join(codex, "sessions")))
		for (const month of listDirectories(year))
			for (const day of listDirectories(month))
				for (const file of listJsonl(day))
					candidates.push({ agent: "codex", path: file });
	for (const file of listJsonl(path.join(codex, "archived_sessions")))
		candidates.push({ agent: "codex", path: file });
	const sessions = [];
	for (const candidate of candidates) {
		try {
			const stat = fs.statSync(candidate.path);
			if (stat.mtimeMs < since || stat.size === 0) continue;
			sessions.push({
				...candidate,
				mtimeMs: stat.mtimeMs,
				size: stat.size,
				key: `${candidate.path}:${Math.round(stat.mtimeMs)}:${stat.size}`,
			});
		} catch {}
	}
	return sessions.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function createImportLedger(file) {
	let cached;
	function read() {
		if (cached) return cached;
		try {
			cached = new Set(JSON.parse(fs.readFileSync(file, "utf8")).imported);
		} catch {
			cached = new Set();
		}
		return cached;
	}
	function add(keys) {
		const set = read();
		for (const key of keys) set.add(key);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const temporary = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(temporary, JSON.stringify({ imported: [...set] }), {
			mode: 0o600,
		});
		fs.renameSync(temporary, file);
	}
	return { has: (key) => read().has(key), add };
}

function failedPaths(stderr) {
	const failed = new Set();
	for (const match of stderr.matchAll(/^Upload of (.+?) failed: /gmu))
		failed.add(match[1]);
	return failed;
}

module.exports = {
	HISTORY_DAYS,
	IMPORT_BATCH,
	createImportLedger,
	failedPaths,
	listRecentSessions,
};
