import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	expect,
	test,
} from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CREDENTIALS_FILE } from "../retire/state.js";
import {
	makeHome,
	persistentClaudeHook,
	read,
	readJson,
	testEnv,
	write,
} from "./helpers.js";

// The bundle is what npm ships and what hook runtimes are copies of.
let outdir: string;
let bundle: string;
let home: string;
let cwd: string;
let cleanup: () => void;

beforeAll(async () => {
	outdir = mkdtempSync(join(tmpdir(), "opaline-bundle-"));
	const result = await Bun.build({
		entrypoints: [join(import.meta.dir, "..", "bin", "cli.ts")],
		outdir,
		target: "node",
	});
	if (!result.success) throw new AggregateError(result.logs);
	bundle = join(outdir, "cli.js");
});
afterAll(() => rmSync(outdir, { recursive: true, force: true }));
beforeEach(() => {
	({ home, cwd, cleanup } = makeHome());
});
afterEach(() => cleanup());

function runNode(
	args: string[],
	options: {
		input?: string;
		env?: Record<string, string>;
		preload?: string;
		entry?: string;
	} = {},
) {
	const result = spawnSync(
		"node",
		[
			...(options.preload ? ["--import", options.preload] : []),
			options.entry ?? bundle,
			...args,
		],
		{
			cwd,
			env: options.env ?? testEnv(home),
			input: options.input ?? "",
			encoding: "utf8",
			timeout: 30_000,
		},
	);
	return {
		status: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

function seedInstall(configDir: string): string {
	const runtime = join(configDir, "runtime", "cli.js");
	// An older release's runtime; its version marker is what updaters compare.
	write(
		runtime,
		readFileSync(bundle, "utf8").replace(
			/version: "[^"]+"/u,
			'version: "0.0.1"',
		),
	);
	write(join(configDir, CREDENTIALS_FILE), {
		token: "secret",
		apiBaseUrl: "https://opaline.so",
		authType: "api-key",
		user: { id: "u", email: "e@example.com", name: "n" },
	});
	write(join(configDir, "failed-uploads.json"), "[]");
	write(join(home, ".claude", "settings.json"), {
		hooks: {
			SessionStart: [
				{
					matcher: "",
					hooks: [
						{
							type: "command",
							command: persistentClaudeHook(configDir, "session-start"),
							async: true,
						},
					],
				},
			],
			SessionEnd: [
				{
					matcher: "",
					hooks: [
						{
							type: "command",
							command: persistentClaudeHook(configDir, "session-end"),
							async: true,
							timeout: 60,
						},
					],
				},
			],
		},
	});
	write(
		join(home, ".codex", "config.toml"),
		`notify = ${JSON.stringify(["node", runtime, "hooks", "codex", "turn-complete"])}\n`,
	);
	return runtime;
}

test("released updaters can read the bundle's version", () => {
	const { version } = JSON.parse(
		read(join(import.meta.dir, "..", "..", "package.json")),
	);
	// The exact pattern 0.17.x uses before replacing a hook runtime.
	const marker = /\bname:\s*"@opalinehq\/cli",\s*version:\s*"([^"]+)"/u.exec(
		read(bundle),
	);
	expect(marker?.[1]).toBe(version);
});

test("the bundle imports nothing that can reach the network", () => {
	const imports = [...read(bundle).matchAll(/from\s+"([^"]+)"/gu)].map(
		(match) => match[1],
	);
	expect(
		imports.filter(
			(name) =>
				!/^node:(child_process|crypto|fs|os|path|url)$/u.test(name ?? ""),
		),
	).toEqual([]);
	expect(read(bundle)).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket/u);
});

test("a SessionStart hook prints nothing, exits 0, and removes the installation", () => {
	const configDir = join(home, ".rudel");
	const runtime = seedInstall(configDir);
	const result = runNode(["hooks", "claude", "session-start"], {
		entry: runtime,
		input: JSON.stringify({
			session_id: "s",
			transcript_path: "/t.jsonl",
			hook_event_name: "SessionStart",
		}),
	});
	expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
	expect(existsSync(join(configDir, CREDENTIALS_FILE))).toBe(false);
	expect(readJson(join(home, ".claude", "settings.json"))).toEqual({});
	expect(read(join(home, ".codex", "config.toml"))).toBe("");
	expect(existsSync(join(configDir, "failed-uploads.json"))).toBe(false);
	// The runtime that ran is still there for any hook that comes back.
	expect(existsSync(runtime)).toBe(true);
});

test("updates an installed 0.17.1 runtime in place when run through npx", () => {
	const configDir = join(home, ".rudel");
	const runtime = seedInstall(configDir);
	const result = runNode([]);
	expect(result.status).toBe(0);
	expect(read(runtime)).toBe(read(bundle));
});

test("makes no network connection, whatever the command", () => {
	const marker = join(cwd, "network-attempts.log");
	const preload = join(cwd, "no-network.mjs");
	write(
		preload,
		`import { appendFileSync } from "node:fs";
import net from "node:net";
import dns from "node:dns";
const record = (what) => { appendFileSync(${JSON.stringify(marker)}, what + "\\n"); throw new Error("network blocked: " + what); };
net.Socket.prototype.connect = function () { record("socket"); };
dns.lookup = () => record("dns");
globalThis.fetch = () => record("fetch");
`,
	);
	const commands = [
		[],
		["upload"],
		["login"],
		["update"],
		["whoami"],
		["--help"],
		["--version"],
		["hooks", "claude", "session-end"],
		[
			"hooks",
			"codex",
			"turn-complete",
			JSON.stringify({ type: "agent-turn-complete", "thread-id": "t", cwd }),
		],
		["hooks", "live-follow"],
	];
	for (const args of commands) {
		seedInstall(join(home, ".rudel"));
		const result = runNode(args, {
			preload,
			env: testEnv(home, {
				DO_NOT_TRACK: "",
				POSTHOG_KEY: "phc_test",
				OPALINE_API_BASE: "https://opaline.so",
			}),
		});
		expect({ args, status: result.status, stderr: result.stderr }).toEqual({
			args,
			status: 0,
			stderr: "",
		});
	}
	expect(existsSync(marker)).toBe(false);

	// The guard itself works: a connection attempt is recorded.
	spawnSync(
		"node",
		[
			"--import",
			preload,
			"-e",
			"try { fetch('https://example.com') } catch {}; try { require('node:net').connect(443, 'example.com') } catch {}",
		],
		{ cwd, env: testEnv(home) },
	);
	expect(read(marker)).toBe("fetch\nsocket\n");
});
