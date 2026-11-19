const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const FALLBACK_PATH =
	"/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";

function parseJsonLine(line) {
	if (!line.startsWith("{")) return undefined;
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}

function priorityCommand(priority, command, args, platform = process.platform) {
	if (priority === "background" && platform === "darwin")
		return { command: "/usr/sbin/taskpolicy", args: ["-b", command, ...args] };
	if (priority === "background" || priority === "low")
		return {
			command: "/usr/bin/nice",
			args: ["-n", priority === "background" ? "15" : "10", command, ...args],
		};
	return { command, args };
}

function createCliRunner({
	cliPath,
	environment = () => ({}),
	log = () => {},
	cacheFile,
}) {
	let shellPath;
	const running = new Set();

	function loginShellPath() {
		shellPath ??= readCachedPath().then(
			(cached) =>
				cached ??
				new Promise((resolve) => {
					execFile(
						process.env.SHELL || "/bin/zsh",
						["-ilc", 'printf "__OPALINE_PATH__%s__OPALINE_PATH__" "$PATH"'],
						{
							timeout: 10_000,
							env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
						},
						(_error, stdout) => {
							const found = /__OPALINE_PATH__(.*)__OPALINE_PATH__/su.exec(
								stdout ?? "",
							)?.[1];
							const value = found || process.env.PATH || FALLBACK_PATH;
							writeCachedPath(value);
							resolve(value);
						},
					);
				}),
		);
		return shellPath;
	}

	async function readCachedPath() {
		if (!cacheFile) return undefined;
		try {
			const cached = JSON.parse(await fs.promises.readFile(cacheFile, "utf8"));
			if (
				typeof cached.path === "string" &&
				Date.now() - cached.at < 7 * 86_400_000
			) {
				setTimeout(() => {
					shellPath = undefined;
					cacheFile &&
						fs.promises
							.rm(cacheFile, { force: true })
							.then(loginShellPath, () => {});
				}, 30_000).unref?.();
				return cached.path;
			}
		} catch {}
		return undefined;
	}

	function writeCachedPath(value) {
		if (!cacheFile) return;
		fs.promises
			.mkdir(path.dirname(cacheFile), { recursive: true })
			.then(() =>
				fs.promises.writeFile(
					cacheFile,
					JSON.stringify({ at: Date.now(), path: value }),
				),
			)
			.catch(() => {});
	}

	async function run(args, options = {}) {
		const PATH = await loginShellPath();
		const launch = priorityCommand(options.priority, process.execPath, [
			cliPath,
			...args,
		]);
		const started = Date.now();
		const child = spawn(launch.command, launch.args, {
			env: {
				...process.env,
				...environment(),
				...options.env,
				PATH,
				ELECTRON_RUN_AS_NODE: "1",
				DO_NOT_TRACK: "1",
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		running.add(child);
		const events = [];
		let buffer = "";
		let stderr = "";
		const flush = (line) => {
			const trimmed = line.trim();
			if (!trimmed) return;
			const event = parseJsonLine(trimmed);
			if (event) {
				events.push(event);
				options.onEvent?.(event);
			} else options.onLine?.(trimmed);
		};
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			buffer += chunk;
			let index = buffer.indexOf("\n");
			while (index >= 0) {
				flush(buffer.slice(0, index));
				buffer = buffer.slice(index + 1);
				index = buffer.indexOf("\n");
			}
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			stderr = (stderr + chunk).slice(-8000);
		});
		const timer = options.timeoutMs
			? setTimeout(() => child.kill("SIGTERM"), options.timeoutMs)
			: undefined;
		const code = await new Promise((resolve) => {
			child.on("error", () => resolve(-1));
			child.on("close", (exitCode) => resolve(exitCode ?? -1));
		});
		if (timer) clearTimeout(timer);
		running.delete(child);
		flush(buffer);
		log(
			`cli ${args.slice(0, 2).join(" ")} exit ${code} in ${Date.now() - started} ms${code !== 0 && stderr.trim() ? `: ${stderr.trim().slice(-400)}` : ""}`,
		);
		return { code, stderr, events, last: events.at(-1) };
	}

	function stopAll() {
		for (const child of running) child.kill("SIGTERM");
	}

	return { loginShellPath, run, stopAll };
}

module.exports = { createCliRunner, parseJsonLine, priorityCommand };
