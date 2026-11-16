const { execFile, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createInterface } = require("node:readline");
const { app, BrowserWindow, dialog } = require("electron");

const MARKETPLACE = "opaline-local";
const LOCAL_PLUGIN = `opaline@${MARKETPLACE}`;
const CLOUD_PLUGIN = "opaline@opaline";
const INSTRUCTION_LINE =
	"For any analysis of coding-agent sessions (Claude Code or Codex), use the Opaline plugin; its answers open in the Opaline app.";
const SHELL_VARIABLES = ["PATH", "CODEX_HOME", "CLAUDE_CONFIG_DIR"];
let shellEnv;

function loginShellEnv() {
	shellEnv ??= new Promise((resolve) => {
		execFile(
			process.env.SHELL || "/bin/zsh",
			[
				"-ilc",
				SHELL_VARIABLES.map(
					(name) =>
						`printf "__OPALINE_${name}__%s__OPALINE_${name}__" "$${name}"`,
				).join("; "),
			],
			{ timeout: 10_000 },
			(_error, stdout) => {
				const found = (name) =>
					new RegExp(`__OPALINE_${name}__(.*?)__OPALINE_${name}__`, "s").exec(
						stdout ?? "",
					)?.[1] || process.env[name];
				const env = {};
				for (const name of SHELL_VARIABLES) {
					const value = found(name);
					if (value) env[name] = value;
				}
				env.PATH ??= "/usr/bin:/bin:/usr/sbin:/sbin";
				resolve(env);
			},
		);
	});
	return shellEnv;
}

function log(message) {
	const file = path.join(app.getPath("logs"), "setup.log");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
}

function run(command, args) {
	return loginShellEnv().then(
		(shell) =>
			new Promise((resolve) => {
				execFile(
					command,
					args,
					{ env: { ...process.env, ...shell }, timeout: 120_000 },
					(error, stdout, stderr) =>
						resolve({
							ok: !error,
							stdout: stdout ?? "",
							output: `${stdout ?? ""}${stderr ?? ""}`,
						}),
				).stdin.end();
			}),
	);
}

async function which(name) {
	const result = await run("/bin/sh", ["-c", `command -v ${name}`]);
	const found = result.output.trim().split("\n")[0];
	return result.ok && found ? found : undefined;
}

function parse(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function marketplaceDir() {
	return path.join(app.getPath("userData"), "agents", "marketplace");
}

function hookScript() {
	return path.join(app.getPath("userData"), "bin", "opaline-hook");
}

function writeIfChanged(file, content, mode) {
	try {
		if (fs.readFileSync(file, "utf8") === content) return false;
	} catch {}
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content, mode ? { mode } : undefined);
	return true;
}

function writeHookScript({ launcherPath, dataDir }) {
	const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
	return writeIfChanged(
		hookScript(),
		`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(process.execPath)} ${quote(launcherPath)} hook "$@" --data-dir ${quote(dataDir)}\n`,
		0o755,
	);
}

function treeDigest(hash, dir) {
	if (!dir) return;
	const walk = (relative) => {
		for (const entry of fs
			.readdirSync(path.join(dir, relative), { withFileTypes: true })
			.sort((a, b) => a.name.localeCompare(b.name))) {
			const child = path.join(relative, entry.name);
			if (entry.isDirectory()) walk(child);
			else if (entry.isFile())
				hash
					.update(`${child}\0`)
					.update(fs.readFileSync(path.join(dir, child)))
					.update("\0");
		}
	};
	hash.update("\0");
	walk("");
}

function writeMarketplace({ pluginDir, localPluginDir, server }) {
	const root = marketplaceDir();
	const hook = (agent) => ({
		type: "command",
		command: `"${hookScript()}" ${agent}`,
	});
	const variants = {
		claude: {
			mcp: {
				type: "http",
				url: server.mcpUrl,
				headers: { Authorization: `Bearer ${server.apiKey}` },
			},
			hooks: {
				hooks: {
					SessionEnd: [{ hooks: [hook("claude")] }],
					Stop: [{ hooks: [hook("claude")] }],
				},
			},
		},
		codex: {
			mcp: {
				type: "http",
				url: server.mcpUrl,
				http_headers: { Authorization: `Bearer ${server.apiKey}` },
			},
			hooks: {
				hooks: {
					SessionEnd: [{ hooks: [{ ...hook("codex"), timeout: 3 }] }],
					Stop: [{ hooks: [hook("codex")] }],
				},
			},
		},
	};
	const hash = crypto.createHash("sha256").update(JSON.stringify(variants));
	treeDigest(hash, pluginDir);
	treeDigest(hash, localPluginDir);
	const fingerprint = hash.digest("hex").slice(0, 10);
	const base = String(
		parse(
			fs.readFileSync(
				path.join(pluginDir, ".claude-plugin", "plugin.json"),
				"utf8",
			),
		)?.version ?? "0.0.0",
	).split("-")[0];
	const version = `${base}-local.${fingerprint}`;
	for (const [agent, variant] of Object.entries(variants)) {
		const target = path.join(root, `opaline-${agent}`);
		fs.rmSync(target, { recursive: true, force: true });
		fs.cpSync(pluginDir, target, { recursive: true });
		if (localPluginDir)
			fs.cpSync(localPluginDir, target, { recursive: true, force: true });
		fs.writeFileSync(
			path.join(target, ".mcp.json"),
			`${JSON.stringify({ mcpServers: { opaline: variant.mcp } }, null, 2)}\n`,
		);
		if (variant.hooks) {
			fs.mkdirSync(path.join(target, "hooks"), { recursive: true });
			fs.writeFileSync(
				path.join(target, "hooks", "hooks.json"),
				`${JSON.stringify(variant.hooks, null, 2)}\n`,
			);
		}
		for (const manifest of [
			".claude-plugin/plugin.json",
			".codex-plugin/plugin.json",
		]) {
			const file = path.join(target, manifest);
			const value = parse(fs.readFileSync(file, "utf8"));
			if (!value) continue;
			fs.writeFileSync(
				file,
				`${JSON.stringify({ ...value, version }, null, "\t")}\n`,
			);
		}
	}
	writeIfChanged(
		path.join(root, ".claude-plugin", "marketplace.json"),
		`${JSON.stringify({ name: MARKETPLACE, owner: { name: "Opaline" }, metadata: { description: "Opaline on this Mac" }, plugins: [{ name: "opaline", source: "./opaline-claude", description: "Find where your coding agents get stuck or waste time and money, from the sessions on this Mac.", category: "Developer Tools" }] }, null, 2)}\n`,
	);
	writeIfChanged(
		path.join(root, ".agents", "plugins", "marketplace.json"),
		`${JSON.stringify({ name: MARKETPLACE, interface: { displayName: "Opaline on this Mac" }, plugins: [{ name: "opaline", source: { source: "local", path: "./opaline-codex" }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Developer Tools" }] }, null, 2)}\n`,
	);
	return { root, version };
}

const agents = {
	claude: {
		label: "Claude Code",
		plugins: (list) => (Array.isArray(list) ? list : []),
		matches: (plugin, id) => plugin.id === id,
		enabled: (plugin) => plugin.enabled !== false,
		install: ["plugin", "install", LOCAL_PLUGIN],
		update: ["plugin", "update", LOCAL_PLUGIN],
		removeCloud: ["plugin", "disable", CLOUD_PLUGIN],
	},
	codex: {
		label: "Codex",
		plugins: (list) => (Array.isArray(list?.installed) ? list.installed : []),
		matches: (plugin, id) => plugin.pluginId === id,
		enabled: (plugin) => plugin.installed !== false && plugin.enabled !== false,
		install: ["plugin", "add", LOCAL_PLUGIN],
		update: ["plugin", "add", LOCAL_PLUGIN],
		removeCloud: ["plugin", "remove", CLOUD_PLUGIN],
		afterInstall: trustCodexHooks,
	},
};

function instructionFile(key, env = process.env) {
	if (key === "claude")
		return path.join(
			env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
			"CLAUDE.md",
		);
	return path.join(
		env.CODEX_HOME || path.join(os.homedir(), ".codex"),
		"AGENTS.md",
	);
}

function readText(file) {
	try {
		return fs.readFileSync(file, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return "";
		throw error;
	}
}

function hasInstructionLine(text) {
	return text.split("\n").some((line) => line.trim() === INSTRUCTION_LINE);
}

function addInstructionLine(file) {
	const text = readText(file);
	if (hasInstructionLine(text)) return false;
	const gap = text === "" ? "" : text.endsWith("\n") ? "\n" : "\n\n";
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, `${gap}${INSTRUCTION_LINE}\n`);
	return true;
}

function removeInstructionLine(file) {
	const text = readText(file);
	if (!hasInstructionLine(text)) return false;
	const lines = text.split("\n");
	const kept = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (lines[index].trim() !== INSTRUCTION_LINE) {
			kept.push(lines[index]);
			continue;
		}
		const next = lines[index + 1];
		if (kept.at(-1) === "" && (next === undefined || next === "")) kept.pop();
	}
	const rest = kept.join("\n");
	if (rest.trim() === "") fs.rmSync(file, { force: true });
	else fs.writeFileSync(file, rest);
	return true;
}

function instructionsAnswerFile() {
	return path.join(app.getPath("userData"), "agents", "instructions.json");
}

function instructionsAnswer() {
	const answer = parse(readText(instructionsAnswerFile()))?.answer;
	return answer === "accepted" || answer === "declined" ? answer : undefined;
}

async function offerInstructionLine({ keys, env, confirm }) {
	const files = keys.map((key) => instructionFile(key, env));
	const remembered = instructionsAnswer();
	if (remembered)
		return {
			answer: remembered,
			added:
				remembered === "accepted"
					? files.slice(0, 1).filter(addInstructionLine)
					: [],
		};
	const answer = (await confirm(files)) ? "accepted" : "declined";
	writeIfChanged(
		instructionsAnswerFile(),
		`${JSON.stringify({ answer, answeredAt: new Date().toISOString() }, null, 2)}\n`,
	);
	return {
		answer,
		added: answer === "accepted" ? files.filter(addInstructionLine) : [],
	};
}

function removeInstructionLines({ keys, env }) {
	if (instructionsAnswer() !== "accepted") return [];
	return keys
		.map((key) => instructionFile(key, env))
		.filter(removeInstructionLine);
}

async function askInstructionLine(files) {
	const home = os.homedir();
	const names = files.map((file) =>
		file.startsWith(`${home}/`) ? `~/${file.slice(home.length + 1)}` : file,
	);
	const options = {
		type: "question",
		buttons: ["Add the Line", "Don’t Add"],
		defaultId: 1,
		cancelId: 1,
		message: "Use Opaline for all session analysis?",
		detail: `Opaline can add one line to ${names.join(" and ")}, so your agents use the Opaline plugin whenever you ask about your sessions:\n\n“${INSTRUCTION_LINE}”\n\nNothing else in ${names.length > 1 ? "these files" : "this file"} changes, and you can delete the line at any time.`,
	};
	const parent = BrowserWindow.getFocusedWindow();
	const { response } = await (parent
		? dialog.showMessageBox(parent, options)
		: dialog.showMessageBox(options));
	return response === 0;
}

async function inspectAgent(key) {
	const binary = await which(key);
	if (!binary) return { binary };
	const listed = parse(
		(await run(binary, ["plugin", "list", "--json"])).stdout,
	);
	const plugins = agents[key].plugins(listed);
	const find = (id) =>
		plugins.find(
			(plugin) =>
				agents[key].matches(plugin, id) && agents[key].enabled(plugin),
		);
	return {
		binary,
		listed: listed !== null,
		local: find(LOCAL_PLUGIN),
		cloud: find(CLOUD_PLUGIN),
	};
}

function agentStatus(key, { binary, local }) {
	return {
		key,
		installed: Boolean(binary),
		connected: Boolean(local),
		version: local?.version ?? null,
	};
}

function agentStatuses() {
	return Promise.all(
		Object.keys(agents).map(async (key) =>
			agentStatus(key, await inspectAgent(key)),
		),
	);
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

function appServer(binary, work) {
	return loginShellEnv().then(
		(shell) =>
			new Promise((resolve, reject) => {
				const child = spawn(binary, ["app-server"], {
					env: { ...process.env, ...shell },
					stdio: ["pipe", "pipe", "ignore"],
				});
				const pending = new Map();
				let next = 0;
				const finish = (settle, value) => {
					clearTimeout(timer);
					child.kill();
					settle(value);
				};
				const timer = setTimeout(
					() => finish(reject, new Error("codex app-server timed out")),
					30_000,
				);
				child.on("error", (error) => finish(reject, error));
				child.on("exit", () =>
					finish(reject, new Error("codex app-server exited")),
				);
				createInterface({ input: child.stdout }).on("line", (line) => {
					const message = parse(line);
					const waiter = pending.get(message?.id);
					if (!waiter) return;
					pending.delete(message.id);
					if (message.error)
						waiter.reject(new Error(message.error.message ?? "error"));
					else waiter.resolve(message.result);
				});
				const send = (message) =>
					child.stdin.write(`${JSON.stringify(message)}\n`);
				const request = (method, params) =>
					new Promise((resolveRequest, rejectRequest) => {
						next += 1;
						pending.set(next, {
							resolve: resolveRequest,
							reject: rejectRequest,
						});
						send({ id: next, method, params });
					});
				request("initialize", {
					clientInfo: { name: "opaline", version: app.getVersion() },
				})
					.then(() => {
						send({ method: "initialized" });
						return work(request);
					})
					.then(
						(value) => finish(resolve, value),
						(error) => finish(reject, error),
					);
			}),
	);
}

async function trustCodexHooks(binary) {
	try {
		const trusted = await appServer(binary, async (request) => {
			const listed = await request("hooks/list", { cwds: [os.homedir()] });
			const ours = new Map(
				(listed?.data ?? [])
					.flatMap((entry) => entry.hooks ?? [])
					.filter(
						(hook) =>
							hook.pluginId === LOCAL_PLUGIN &&
							hook.command?.includes(hookScript()) &&
							hook.enabled !== false &&
							(hook.trustStatus === "untrusted" ||
								hook.trustStatus === "modified"),
					)
					.map((hook) => [hook.key, { trusted_hash: hook.currentHash }]),
			);
			if (ours.size)
				await request("config/batchWrite", {
					edits: [
						{
							keyPath: "hooks.state",
							mergeStrategy: "upsert",
							value: Object.fromEntries(ours),
						},
					],
				});
			return [...ours.keys()];
		});
		log(`codex: hooks trusted: ${trusted.join(", ") || "none needed"}`);
	} catch (error) {
		log(`codex: hooks not trusted: ${error.message}`);
	}
}

async function addMarketplace(key, binary, root) {
	if (
		(await run(binary, ["plugin", "marketplace", "list"])).output.includes(
			MARKETPLACE,
		)
	)
		return { ok: true };
	const added = await run(binary, ["plugin", "marketplace", "add", root]);
	log(
		`${key}: marketplace add ${added.ok ? "ok" : `failed: ${added.output.trim()}`}`,
	);
	return added;
}

function createAgents({ stack, confirmInstructionLine = askInstructionLine }) {
	const marketplaceSources = () => ({
		pluginDir: stack.bundle.pluginDir,
		localPluginDir: stack.bundle.localPluginDir,
	});

	async function prepareMarketplace() {
		const server =
			stack.agentServer() ??
			(await stack.ready().then(() => stack.agentServer()));
		if (!server) throw new Error("The local Opaline server is not ready yet.");
		if (!stack.bundle.pluginDir || !stack.bundle.launcherPath)
			throw new Error("This build has no agent plugin.");
		if (!stack.bundle.localPluginDir)
			log("this build has no local plugin text; agents get the cloud text");
		writeHookScript({
			launcherPath: stack.bundle.launcherPath,
			dataDir: server.dataDir,
		});
		return writeMarketplace({ ...marketplaceSources(), server });
	}

	async function offerInstructions(key) {
		try {
			const others = await Promise.all(
				Object.keys(agents)
					.filter((other) => other !== key)
					.map(async (other) =>
						(await inspectAgent(other)).local ? other : null,
					),
			);
			const { answer, added } = await offerInstructionLine({
				keys: [key, ...others.filter(Boolean)],
				env: await loginShellEnv(),
				confirm: confirmInstructionLine,
			});
			log(
				`instruction line ${answer}${added.length ? `, added to ${added.join(", ")}` : ""}`,
			);
		} catch (error) {
			log(`instruction line not offered: ${error.message}`);
		}
	}

	async function connect(key) {
		if (!Object.hasOwn(agents, key)) throw new Error("Unknown agent.");
		const found = await inspectAgent(key);
		if (!found.binary || found.local) return agentStatus(key, found);
		if (found.cloud) {
			const removed = await run(found.binary, agents[key].removeCloud);
			log(
				`${key}: cloud plugin ${removed.ok ? "turned off" : `not turned off: ${removed.output.trim()}`}`,
			);
			if (!removed.ok)
				return {
					...agentStatus(key, found),
					error: "Couldn’t turn off the cloud plugin",
					detail: failure(removed.output),
				};
		}
		let marketplace;
		try {
			marketplace = await prepareMarketplace();
		} catch (error) {
			return {
				...agentStatus(key, found),
				error: "Opaline isn’t ready yet",
				detail: error.message,
			};
		}
		const added = await addMarketplace(key, found.binary, marketplace.root);
		if (!added.ok)
			return {
				...agentStatus(key, found),
				error: "Couldn’t add the plugin",
				detail: failure(added.output),
			};
		const installed = await run(found.binary, agents[key].install);
		log(
			`${key}: plugin install ${installed.ok ? "ok" : `failed: ${installed.output.trim()}`}`,
		);
		if (!installed.ok)
			return {
				...agentStatus(key, found),
				error: "Couldn’t install the plugin",
				detail: failure(installed.output),
			};
		await agents[key].afterInstall?.(found.binary);
		const status = agentStatus(key, await inspectAgent(key));
		if (status.connected) await offerInstructions(key);
		return status;
	}

	async function refresh() {
		const server = stack.agentServer();
		if (!server || !stack.bundle.pluginDir || !stack.bundle.launcherPath)
			return;
		writeHookScript({
			launcherPath: stack.bundle.launcherPath,
			dataDir: server.dataDir,
		});
		const statuses = await Promise.all(
			Object.keys(agents).map(async (key) => [key, await inspectAgent(key)]),
		);
		try {
			const removed = removeInstructionLines({
				keys: statuses
					.filter(([, found]) => found.binary && found.listed && !found.local)
					.map(([key]) => key),
				env: await loginShellEnv(),
			});
			if (removed.length)
				log(`instruction line removed from ${removed.join(", ")}`);
		} catch (error) {
			log(`instruction line not removed: ${error.message}`);
		}
		if (!statuses.some(([, found]) => found.local)) return;
		const { version } = writeMarketplace({ ...marketplaceSources(), server });
		for (const [key, found] of statuses) {
			if (!found.local || found.local.version === version) continue;
			const updated = await run(found.binary, agents[key].update);
			log(
				`${key}: plugin update to ${version} ${updated.ok ? "ok" : `failed: ${updated.output.trim()}`}`,
			);
			if (updated.ok) await agents[key].afterInstall?.(found.binary);
		}
	}

	return { statuses: agentStatuses, connect, refresh };
}

module.exports = {
	createAgents,
	writeMarketplace,
	instructionFile,
	addInstructionLine,
	removeInstructionLine,
	offerInstructionLine,
	removeInstructionLines,
	INSTRUCTION_LINE,
	LOCAL_PLUGIN,
	CLOUD_PLUGIN,
};
