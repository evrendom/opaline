const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * Folders macOS guards with a privacy prompt ("Opaline would like to access
 * files in your Documents folder"). The server reads the project folder of
 * every session it imports (git remote, package name, settings), so a session
 * that lives in one of these makes macOS ask. Opaline reads them on purpose
 * while onboarding loads, so the question comes then and not halfway through
 * the dashboard.
 */
const HOME_FOLDERS = [
	"Desktop",
	"Documents",
	"Downloads",
	"Library/Mobile Documents",
];
/** Each folder inside these is asked for on its own: one cloud provider or one disk. */
const HOME_CONTAINERS = ["Library/CloudStorage"];
const CONTAINERS = ["/Volumes"];

/** Claude Code names a project folder by its path with every other character turned into "-". */
function encode(folder) {
	return folder.replace(/[^A-Za-z0-9]/gu, "-").toLowerCase();
}

function holds(folder, { claudeFolders, codexPaths }) {
	const root = folder.toLowerCase();
	const encoded = encode(folder);
	return (
		codexPaths.some((cwd) => {
			const target = path.resolve(cwd).toLowerCase();
			return target === root || target.startsWith(`${root}/`);
		}) ||
		claudeFolders.some((name) => {
			const lower = name.toLowerCase();
			return lower === encoded || lower.startsWith(`${encoded}-`);
		})
	);
}

async function children(folder) {
	try {
		const entries = await fs.promises.readdir(folder, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => path.join(folder, entry.name));
	} catch {
		return [];
	}
}

/** The guarded folders the sessions live in, one per macOS question. */
async function guardedFolders(
	sessions,
	{ home = os.homedir(), list = children } = {},
) {
	const found = HOME_FOLDERS.map((folder) => path.join(home, folder)).filter(
		(folder) => holds(folder, sessions),
	);
	for (const container of [
		...HOME_CONTAINERS.map((folder) => path.join(home, folder)),
		...CONTAINERS,
	]) {
		if (!holds(container, sessions)) continue;
		for (const child of await list(container))
			if (holds(child, sessions)) found.push(child);
	}
	return found;
}

const CWD = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/u;

/** A Codex transcript records its folder in the first line; only the start of the file is read. */
async function codexCwd(file) {
	let handle;
	try {
		handle = await fs.promises.open(file, "r");
		const buffer = Buffer.alloc(4096);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const match = CWD.exec(buffer.subarray(0, bytesRead).toString("utf8"));
		return match ? JSON.parse(`"${match[1]}"`) : undefined;
	} catch {
		return undefined;
	} finally {
		await handle?.close().catch(() => {});
	}
}

async function sessionFolders({ claudeRoot, codexFiles }) {
	let claudeFolders = [];
	try {
		claudeFolders = await fs.promises.readdir(claudeRoot);
	} catch {}
	const codexPaths = [];
	for (const file of codexFiles) {
		const cwd = await codexCwd(file);
		if (cwd && !codexPaths.includes(cwd)) codexPaths.push(cwd);
	}
	return { claudeFolders, codexPaths };
}

/**
 * Reads each guarded folder the sessions live in, one after the other, so macOS
 * asks while onboarding loads. Each read waits on the user's answer, so it runs
 * off the main thread and onboarding keeps animating; nothing waits for it.
 */
async function askForSessionFolders({
	claudeRoot,
	codexFiles,
	platform = process.platform,
	read = fs.promises.readdir,
}) {
	if (platform !== "darwin") return [];
	const folders = await guardedFolders(
		await sessionFolders({ claudeRoot, codexFiles }),
	);
	const answers = [];
	for (const folder of folders) {
		const started = Date.now();
		const granted = await read(folder).then(
			() => true,
			(error) =>
				error.code === "EPERM" || error.code === "EACCES" ? false : null,
		);
		answers.push({ folder, granted, ms: Date.now() - started });
	}
	return answers;
}

module.exports = { askForSessionFolders, codexCwd, guardedFolders };
