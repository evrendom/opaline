const { execFile } = require("node:child_process");
const { calculateEstimatedCost } = require("./pricing.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const home = os.homedir();
const claudeRoot = path.join(home, ".claude", "projects");
const codexRoot = path.join(home, ".codex");
const geminiRoot = path.join(process.env.GEMINI_CLI_HOME || home, ".gemini");
const t3Providers = path.join(home, ".t3", "userdata", "providers", "antigravity");
const TEMPLATES = Object.fromEntries(
	["claude.sql", "codex.sql", "gemini.sql", "gemini-cli.sql", "antigravity.sql", "antigravity-conversations.sql"].map((name) => [
		name,
		fs.readFileSync(path.join(__dirname, "analysis", name), "utf8"),
	]),
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
		codex = codexFolders().flatMap((folder) => listFiles(path.join(codexRoot, folder), /\.jsonl(\.zst)?$/)).length;
	} catch {}
	const sources = geminiSources();
	const gemini =
		sources.cli.reduce((count, chats) => count + listFiles(chats, /^session-.*\.jsonl?$/).length, 0) +
		sources.brains.reduce(
			(count, brain) =>
				count +
				listFiles(brain, /.*/).filter((conversation) =>
					fs.existsSync(path.join(brain, conversation, ".system_generated", "logs", "transcript.jsonl")),
				).length,
			0,
		);
	return { claude, codex, gemini, folders: claudeFolders.length, ms: Date.now() - started };
}

// Two threads keep the parse of a few GB of transcripts near 1 GB of memory
// (all cores took 3.6 GB on 3.8 GB of Claude Code sessions) and leave the
// cores to the intro animation and the server starting beside it.
const ANALYSIS_THREADS = 2;

/**
 * Where Gemini sessions are: Gemini CLI's project chats, and Antigravity's
 * brain folders (its own, and each T3 Code workspace's), with the
 * conversation database beside each brain.
 */
function geminiSources() {
	const cli = listFiles(path.join(geminiRoot, "tmp"), /.*/)
		.map((folder) => path.join(geminiRoot, "tmp", folder, "chats"))
		.filter((chats) => fs.existsSync(chats));
	const brains = [
		path.join(geminiRoot, "antigravity-cli", "brain"),
		path.join(geminiRoot, "antigravity", "brain"),
		...listFiles(t3Providers, /.*/).map((id) => path.join(t3Providers, id, "antigravity-acp", "brain")),
	].filter((brain) => fs.existsSync(brain));
	const databases = brains
		.map((brain) => path.join(path.dirname(brain), "conversation_summaries.db"))
		.filter((database) => fs.existsSync(database));
	return { cli, brains, databases };
}

/** gemini.sql with one INSERT per folder and database that holds sessions. */
function geminiQuery() {
	const { cli, brains, databases } = geminiSources();
	const fill = (template, key, value) => TEMPLATES[template].replace(key, value.replaceAll("'", "\\'"));
	const inserts = [
		...cli
			.filter((chats) => listFiles(chats, /^session-.*\.jsonl$/).length > 0)
			.map((chats) => fill("gemini-cli.sql", "{GLOB}", `${chats}/session-*.jsonl`)),
		...brains
			.filter((brain) =>
				listFiles(brain, /.*/).some((conversation) =>
					fs.existsSync(path.join(brain, conversation, ".system_generated", "logs", "transcript_full.jsonl")),
				),
			)
			.map((brain) => fill("antigravity.sql", "{GLOB}", `${brain}/*/.system_generated/logs/transcript_full.jsonl`)),
		...databases.map((database) => fill("antigravity-conversations.sql", "{DB}", database)),
	];
	return TEMPLATES["gemini.sql"].replace("{SOURCES}", inserts.join("\n\n"));
}

function runQuery(binary, template, glob) {
	return runSql(binary, template, TEMPLATES[template].replace("{GLOB}", glob));
}

function runSql(binary, template, sql) {
	const file = path.join(os.tmpdir(), `opaline-${process.pid}-${template}`);
	fs.writeFileSync(file, sql);
	return new Promise((resolve) => {
		execFile(
			"/usr/bin/nice",
			["-n", "10", binary, "local", `--max_threads=${ANALYSIS_THREADS}`, "--queries-file", file],
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
	const hasGemini = found.gemini > 0;
	if (!hasClaude && !hasCodex && !hasGemini)
		return { claude: null, codex: null, gemini: null, ms: Date.now() - started };
	const binary = findClickhouse();
	if (!binary) return { error: `ClickHouse is not available on this ${process.platform === "darwin" ? "Mac" : "PC"}.` };
	// One after the other, so the two parses never hold memory at the same time.
	const claude = hasClaude ? await runQuery(binary, "claude.sql", `${claudeRoot}/**/*.jsonl`) : null;
	const codex = hasCodex
		? await runQuery(binary, "codex.sql", `${codexRoot}/{${codexFolders().join(",")}}/*.{jsonl,jsonl.zst}`)
		: null;
	const gemini = hasGemini ? await runSql(binary, "gemini.sql", geminiQuery()) : null;
	return { claude: priced(claude), codex: priced(codex), gemini: priced(gemini), ms: Date.now() - started };
}

/** Where the transcripts are, for asking about the folders their sessions ran in. */
function sessionSources() {
	let codexFiles = [];
	try {
		codexFiles = codexFolders().flatMap((folder) =>
			listFiles(path.join(codexRoot, folder), /\.jsonl$/).map((name) => path.join(codexRoot, folder, name)),
		);
	} catch {}
	return { claudeRoot, codexFiles, geminiRoot };
}

module.exports = { analyzeSessions, geminiQuery, scanSessions, sessionSources };
