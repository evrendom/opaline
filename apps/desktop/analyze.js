const { execFile } = require("node:child_process");
const { calculateEstimatedCost } = require("./pricing.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const home = os.homedir();
const claudeRoot = path.join(home, ".claude", "projects");
const codexRoot = path.join(home, ".codex");
const TEMPLATES = Object.fromEntries(
	["claude.sql", "codex.sql"].map((name) => [name, fs.readFileSync(path.join(__dirname, "analysis", name), "utf8")]),
);

function findClickhouse() {
	const candidates = [
		process.env.OPALINE_CLICKHOUSE,
		process.resourcesPath && path.join(process.resourcesPath, "clickhouse"),
	];
	const versions = path.join(home, ".clickhouse", "versions");
	try {
		for (const version of fs.readdirSync(versions).sort().reverse())
			candidates.push(path.join(versions, version, "clickhouse"));
	} catch {}
	return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function listFiles(directory, pattern) {
	try {
		return fs.readdirSync(directory).filter((name) => pattern.test(name));
	} catch {
		return [];
	}
}

function scanSessions() {
	const started = Date.now();
	const claudeFolders = listFiles(claudeRoot, /.*/);
	let claude = 0;
	for (const folder of claudeFolders) claude += listFiles(path.join(claudeRoot, folder), /\.jsonl$/).length;
	let codex = 0;
	try {
		codex = codexFolders().flatMap((folder) => listFiles(path.join(codexRoot, folder), /\.jsonl$/)).length;
	} catch {}
	return { claude, codex, folders: claudeFolders.length, ms: Date.now() - started };
}

function runQuery(binary, template, glob) {
	const sql = TEMPLATES[template].replace("{GLOB}", glob);
	const file = path.join(os.tmpdir(), `opaline-${process.pid}-${template}`);
	fs.writeFileSync(file, sql);
	return new Promise((resolve) => {
		execFile(
			"/usr/bin/nice",
			["-n", "10", binary, "local", "--queries-file", file],
			{ cwd: os.tmpdir(), maxBuffer: 16 * 1024 * 1024, timeout: 120_000 },
			(error, stdout, stderr) => {
				fs.rmSync(file, { force: true });
				const line = stdout.trim().split("\n").pop();
				try {
					resolve(error ? { error: stderr.trim().slice(-400) } : JSON.parse(line));
				} catch {
					resolve({ error: "Could not read the analysis result." });
				}
			},
		);
	});
}

const WINDOW_DAYS = 30;

function codexFolders() {
	const folders = ["archived_sessions"];
	for (let index = 0; index <= WINDOW_DAYS; index += 1) {
		const day = new Date(Date.now() - index * 86_400_000);
		const relative = `sessions/${day.getFullYear()}/${String(day.getMonth() + 1).padStart(2, "0")}/${String(day.getDate()).padStart(2, "0")}`;
		if (fs.existsSync(path.join(codexRoot, relative))) folders.push(relative);
	}
	return folders;
}

const CONTEXT_FOR_BAND = [0, 200_001, 272_001];

function priced(part) {
	if (!part || part.error) return part;
	const byDate = new Map();
	let cost = 0;
	let unpriced = 0;
	for (const [date, model, band, input, output, cacheRead, cacheWrite5m, cacheWrite1h] of part.daily_usage ?? []) {
		const value = calculateEstimatedCost({
			model,
			at: `${date}T12:00:00Z`,
			contextInputTokens: CONTEXT_FOR_BAND[band] ?? 0,
			inputTokens: Number(input),
			outputTokens: Number(output),
			cacheReadInputTokens: Number(cacheRead),
			cacheCreationInputTokens: Number(cacheWrite5m),
			cacheCreation1hInputTokens: Number(cacheWrite1h),
		});
		if (value === null) {
			unpriced += 1;
			continue;
		}
		cost += value;
		byDate.set(date, (byDate.get(date) ?? 0) + value);
	}
	const { daily_usage, ...rest } = part;
	return { ...rest, cost, unpriced_rows: unpriced, daily_cost: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)) };
}

async function analyzeSessions() {
	const started = Date.now();
	const found = scanSessions();
	const hasClaude = found.claude > 0;
	const hasCodex = found.codex > 0;
	if (!hasClaude && !hasCodex) return { claude: null, codex: null, ms: Date.now() - started };
	const binary = findClickhouse();
	if (!binary) return { error: `ClickHouse is not available on this ${process.platform === "darwin" ? "Mac" : "PC"}.` };
	const [claude, codex] = await Promise.all([
		hasClaude ? runQuery(binary, "claude.sql", `${claudeRoot}/**/*.jsonl`) : null,
		hasCodex ? runQuery(binary, "codex.sql", `${codexRoot}/{${codexFolders().join(",")}}/*.jsonl`) : null,
	]);
	return { claude: priced(claude), codex: priced(codex), ms: Date.now() - started };
}

module.exports = { analyzeSessions, scanSessions };
