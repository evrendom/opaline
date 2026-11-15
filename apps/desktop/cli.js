const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");

const cliPath = [
	process.env.OPALINE_DESKTOP_CLI,
	path.join(__dirname, "cli", "cli.js"),
	path.join(__dirname, "..", "cli", "dist", "cli.js"),
].find((candidate) => candidate && fs.existsSync(candidate));
let shellPath;

function loginShellPath() {
	shellPath ??= new Promise((resolve) => {
		execFile(
			process.env.SHELL || "/bin/zsh",
			["-ilc", 'printf "__OPALINE_PATH__%s__OPALINE_PATH__" "$PATH"'],
			{ timeout: 10_000 },
			(_error, stdout) => {
				const found = /__OPALINE_PATH__(.*)__OPALINE_PATH__/s.exec(stdout ?? "")?.[1];
				resolve(found || process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin");
			},
		);
	});
	return shellPath;
}

async function cliEnv() {
	return { ...process.env, PATH: await loginShellPath(), ELECTRON_RUN_AS_NODE: "1" };
}

const running = new Set();

async function runCli(args, onLine, env = {}) {
	const child = spawn(process.execPath, [cliPath, ...args], {
		env: { ...(await cliEnv()), ...env },
		stdio: ["ignore", "pipe", "pipe"],
	});
	running.add(child);
	child.on("close", () => running.delete(child));
	let buffer = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		buffer += chunk;
		let index = buffer.indexOf("\n");
		while (index >= 0) {
			const line = buffer.slice(0, index).trim();
			buffer = buffer.slice(index + 1);
			if (line) onLine(line);
			index = buffer.indexOf("\n");
		}
	});
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk) => {
		stderr = (stderr + chunk).slice(-4000);
	});
	const code = await new Promise((resolve) => {
		child.on("error", () => resolve(-1));
		child.on("close", resolve);
	});
	if (buffer.trim()) onLine(buffer.trim());
	return { code, stderr };
}

function parse(line) {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}

let cachedList;

function listRepositories() {
	if (cachedList && Date.now() - cachedList.at < 30_000) return cachedList.promise;
	const promise = readRepositories();
	cachedList = { at: Date.now(), promise };
	promise.catch(() => {
		if (cachedList?.promise === promise) cachedList = undefined;
	});
	return promise;
}

async function readRepositories() {
	let result;
	const { code, stderr } = await runCli(["repos", "list", "--json"], (line) => {
		result = parse(line) ?? result;
	});
	if (code !== 0 || !result) throw new Error(stderr.trim() || "Could not read your local repositories.");
	return result;
}

async function applyRepositories(options, apiBase, onEvent) {
	cachedList = undefined;
	const args = ["repos", "apply", "--json"];
	for (const key of options.enable ?? []) args.push("--enable", String(key));
	for (const key of options.disable ?? []) args.push("--disable", String(key));
	if (options.organization) args.push("--organization", String(options.organization));
	if (apiBase) args.push("--api-base", apiBase);
	let last;
	log(`apply: ${args.join(" ")}${options.code ? " (setup code in env)" : ""}`);
	const { code, stderr } = await runCli(
		args,
		(line) => {
		const event = parse(line);
		if (!event) return;
		log(`apply event: ${JSON.stringify(event).replace(/user_code=[^&"]+/, "user_code=…")}`);
		last = event;
		onEvent(event);
		},
		options.code ? { OPALINE_CONNECTION_CODE: String(options.code) } : {},
	);
	log(`apply exit ${code}${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ""}`);
	if (code !== 0 && last?.type !== "error") {
		last = { type: "error", message: stderr.trim() || "Opaline could not finish." };
		onEvent(last);
	}
	return last;
}

function log(message) {
	const file = path.join(app.getPath("logs"), "setup.log");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
}

function run(command, args) {
	return loginShellPath().then(
		(PATH) =>
			new Promise((resolve) => {
				execFile(command, args, { env: { ...process.env, PATH }, timeout: 120_000 }, (error, stdout, stderr) =>
					resolve({ ok: !error, stdout: stdout ?? "", output: `${stdout ?? ""}${stderr ?? ""}` }),
				).stdin.end();
			}),
	);
}

async function which(name) {
	const result = await run("/bin/sh", ["-c", `command -v ${name}`]);
	const found = result.output.trim().split("\n")[0];
	return result.ok && found ? found : undefined;
}

async function installCommand() {
	const existing = await which("opaline");
	const target = path.join(os.homedir(), ".local", "bin", "opaline");
	const ours = (file) => {
		try {
			return fs.readFileSync(file, "utf8").includes("OPALINE_DESKTOP_LAUNCHER=1");
		} catch {
			return false;
		}
	};
	if (existing && !ours(existing)) return log(`cli: kept existing ${existing}`);
	const dataDir = process.env.OPALINE_SERVER_DATA_DIR ? `OPALINE_SERVER_DATA_DIR="\${OPALINE_SERVER_DATA_DIR:-${process.env.OPALINE_SERVER_DATA_DIR}}" ` : "";
	const script = `#!/bin/sh\n${dataDir}OPALINE_DESKTOP_LAUNCHER=1 ELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${cliPath}" "$@"\n`;
	if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === script) return log(`cli: ${target} up to date`);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, script, { mode: 0o755 });
	log(`cli: wrote ${target}${(await loginShellPath()).split(":").includes(path.dirname(target)) ? "" : " (not on PATH)"}`);
}

const PLUGIN = "opaline@opaline";

const agents = {
	claude: {
		find: (list) => list.find((plugin) => plugin.id === PLUGIN),
		install: ["plugin", "install", PLUGIN],
	},
	codex: {
		find: (list) => list.installed.find((plugin) => plugin.pluginId === PLUGIN && plugin.installed),
		install: ["plugin", "add", PLUGIN],
	},
};

async function inspectAgent(key) {
	const binary = await which(key);
	if (!binary) return { binary };
	const list = parse((await run(binary, ["plugin", "list", "--json"])).stdout);
	return { binary, plugin: list && agents[key].find(list) };
}

function agentStatus(key, { binary, plugin }) {
	return { key, installed: Boolean(binary), connected: Boolean(plugin?.enabled), version: plugin?.version ?? null };
}

function agentStatuses() {
	return Promise.all(Object.keys(agents).map(async (key) => agentStatus(key, await inspectAgent(key))));
}

function failure(output) {
	return output
		.split("\n")
		.map((line) => line.replace(/^[✘✖×]\s*/, "").trim())
		.filter(Boolean)
		.slice(-6)
		.join("\n")
		.slice(-600);
}

async function connectAgent(key) {
	if (!Object.hasOwn(agents, key)) throw new Error("Unknown agent.");
	const found = await inspectAgent(key);
	if (!found.binary || found.plugin?.enabled) return agentStatus(key, found);
	if (!/\bopaline\b/.test((await run(found.binary, ["plugin", "marketplace", "list"])).output)) {
		const added = await run(found.binary, ["plugin", "marketplace", "add", "opalinehq/athena"]);
		log(`${key}: marketplace add ${added.ok ? "ok" : `failed: ${added.output.trim()}`}`);
		if (!added.ok)
			return { ...agentStatus(key, found), error: "Couldn’t download the plugin", detail: failure(added.output) };
	}
	const installed = await run(found.binary, agents[key].install);
	log(`${key}: plugin install ${installed.ok ? "ok" : `failed: ${installed.output.trim()}`}`);
	if (!installed.ok)
		return { ...agentStatus(key, found), error: "Couldn’t install the plugin", detail: failure(installed.output) };
	return agentStatus(key, await inspectAgent(key));
}

function installCommandLine() {
	return installCommand().catch((error) => log(`setup step failed: ${error instanceof Error ? error.message : String(error)}`));
}

function stopAll() {
	for (const child of running) child.kill("SIGTERM");
}

module.exports = { agentStatuses, applyRepositories, connectAgent, installCommandLine, listRepositories, stopAll };
