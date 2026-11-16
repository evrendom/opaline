const { execFile, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createInterface } = require("node:readline");
const { app } = require("electron");

const MARKETPLACE = "opaline-local";
const LOCAL_PLUGIN = `opaline@${MARKETPLACE}`;
const CLOUD_PLUGIN = "opaline@opaline";
let shellPath;

function loginShellPath() {
	shellPath ??= new Promise((resolve) => {
		execFile(
			process.env.SHELL || "/bin/zsh",
			["-ilc", 'printf "__OPALINE_PATH__%s__OPALINE_PATH__" "$PATH"'],
			{ timeout: 10_000 },
			(_error, stdout) => {
				const found = /__OPALINE_PATH__(.*)__OPALINE_PATH__/s.exec(
					stdout ?? "",
				)?.[1];
				resolve(found || process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin");
			},
		);
	});
	return shellPath;
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
				execFile(
					command,
					args,
					{ env: { ...process.env, PATH }, timeout: 120_000 },
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

function writeMarketplace({ pluginDir, server }) {
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
	const fingerprint = crypto
		.createHash("sha256")
		.update(JSON.stringify(variants))
		.digest("hex")
		.slice(0, 10);
	let version;
	for (const [agent, variant] of Object.entries(variants)) {
		const target = path.join(root, `opaline-${agent}`);
		fs.rmSync(target, { recursive: true, force: true });
		fs.cpSync(pluginDir, target, { recursive: true });
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
			version = `${String(value.version).split("-")[0]}-local.${fingerprint}`;
			value.version = version;
			fs.writeFileSync(file, `${JSON.stringify(value, null, "\t")}\n`);
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

async function inspectAgent(key) {
	const binary = await which(key);
	if (!binary) return { binary };
	const plugins = agents[key].plugins(
		parse((await run(binary, ["plugin", "list", "--json"])).stdout),
	);
	const find = (id) =>
		plugins.find(
			(plugin) =>
				agents[key].matches(plugin, id) && agents[key].enabled(plugin),
		);
	return { binary, local: find(LOCAL_PLUGIN), cloud: find(CLOUD_PLUGIN) };
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
	return loginShellPath().then(
		(PATH) =>
			new Promise((resolve, reject) => {
				const child = spawn(binary, ["app-server"], {
					env: { ...process.env, PATH },
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

function createAgents({ stack }) {
	async function prepareMarketplace() {
		const server =
			stack.agentServer() ??
			(await stack.ready().then(() => stack.agentServer()));
		if (!server) throw new Error("The local Opaline server is not ready yet.");
		if (!stack.bundle.pluginDir || !stack.bundle.launcherPath)
			throw new Error("This build has no agent plugin.");
		writeHookScript({
			launcherPath: stack.bundle.launcherPath,
			dataDir: server.dataDir,
		});
		return writeMarketplace({ pluginDir: stack.bundle.pluginDir, server });
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
		return agentStatus(key, await inspectAgent(key));
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
		if (!statuses.some(([, found]) => found.local)) return;
		const { version } = writeMarketplace({
			pluginDir: stack.bundle.pluginDir,
			server,
		});
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

module.exports = { createAgents, writeMarketplace, LOCAL_PLUGIN, CLOUD_PLUGIN };
