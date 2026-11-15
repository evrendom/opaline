const { afterEach, beforeEach, describe, expect, test } = require("bun:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
	createSettingsStore,
	environmentLabel,
	environmentOrigin,
	normalizeServerUrl,
	validateEnvironment,
} = require("../stack/settings");
const {
	createCliRunner,
	parseJsonLine,
	priorityCommand,
} = require("../stack/cli-runner");

let root;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "opaline-desktop-stack-"));
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("environments", () => {
	test("server addresses become origins, with http only for local networks by default", () => {
		expect(normalizeServerUrl("https://opaline.acme.dev/")).toEqual({
			ok: true,
			url: "https://opaline.acme.dev",
			plaintext: false,
		});
		expect(normalizeServerUrl("opaline.acme.dev")).toEqual({
			ok: true,
			url: "https://opaline.acme.dev",
			plaintext: false,
		});
		expect(normalizeServerUrl("nas.local:4100")).toEqual({
			ok: true,
			url: "http://nas.local:4100",
			plaintext: true,
		});
		expect(normalizeServerUrl("192.168.2.74:4100")).toEqual({
			ok: true,
			url: "http://192.168.2.74:4100",
			plaintext: true,
		});
		expect(normalizeServerUrl("localhost:4200")).toEqual({
			ok: true,
			url: "http://localhost:4200",
			plaintext: false,
		});
		expect(normalizeServerUrl("").ok).toBe(false);
		expect(normalizeServerUrl("https://x.dev/team").ok).toBe(false);
		expect(normalizeServerUrl("https://me:pw@x.dev").ok).toBe(false);
		expect(normalizeServerUrl("ftp://x.dev").ok).toBe(false);
	});

	test("labels, origins and validation", () => {
		expect(environmentLabel({ kind: "local" })).toBe("This Mac");
		expect(environmentLabel({ kind: "cloud" })).toBe("Opaline Cloud");
		expect(
			environmentLabel({ kind: "server", url: "http://nas.local:4100" }),
		).toBe("nas.local:4100");
		expect(environmentOrigin({ kind: "local" }, "http://localhost:4100")).toBe(
			"http://localhost:4100",
		);
		expect(environmentOrigin({ kind: "cloud" })).toBe("https://opaline.so");
		expect(
			validateEnvironment({ kind: "server", url: "nas.local:4100/" }),
		).toEqual({
			kind: "server",
			url: "http://nas.local:4100",
			plaintext: true,
		});
		expect(
			validateEnvironment({ kind: "cloud", url: "https://evil.dev" }),
		).toEqual({ kind: "cloud", url: "https://opaline.so" });
		expect(validateEnvironment({ kind: "elsewhere" })).toBeUndefined();
	});

	test("the settings file survives a restart and drops invalid values", () => {
		const store = createSettingsStore(root);
		expect(store.read()).toMatchObject({
			environment: undefined,
			theme: "system",
			uploadsPaused: false,
		});
		store.write({ environment: { kind: "local" }, uploadsPaused: true });
		expect(fs.statSync(store.file).mode & 0o777).toBe(0o600);
		expect(createSettingsStore(root).read()).toMatchObject({
			environment: { kind: "local" },
			uploadsPaused: true,
		});
		fs.writeFileSync(
			store.file,
			JSON.stringify({
				environment: { kind: "server", url: "javascript:alert(1)" },
			}),
		);
		expect(createSettingsStore(root).read().environment).toBeUndefined();
	});
});

describe("the CLI runner", () => {
	test("priorities: taskpolicy -b on macOS for background work, nice elsewhere", () => {
		expect(priorityCommand("background", "/A", ["x"], "darwin")).toEqual({
			command: "/usr/sbin/taskpolicy",
			args: ["-b", "/A", "x"],
		});
		expect(priorityCommand("background", "/A", ["x"], "linux")).toEqual({
			command: "/usr/bin/nice",
			args: ["-n", "15", "/A", "x"],
		});
		expect(priorityCommand("low", "/A", ["x"], "darwin")).toEqual({
			command: "/usr/bin/nice",
			args: ["-n", "10", "/A", "x"],
		});
		expect(priorityCommand(undefined, "/A", ["x"], "darwin")).toEqual({
			command: "/A",
			args: ["x"],
		});
	});

	test("JSON lines become events, other lines stay text", () => {
		expect(parseJsonLine('{"type":"ready"}')).toEqual({ type: "ready" });
		expect(parseJsonLine("Starting ClickHouse")).toBeUndefined();
		expect(parseJsonLine("{broken")).toBeUndefined();
	});

	test("runs the CLI with the bundle environment and streams events", async () => {
		const cli = path.join(root, "cli.js");
		fs.writeFileSync(
			cli,
			`process.stdout.write(JSON.stringify({type:"argv",args:process.argv.slice(2),bin:process.env.OPALINE_CLICKHOUSE_BIN,dnt:process.env.DO_NOT_TRACK,node:process.env.ELECTRON_RUN_AS_NODE})+"\\nplain line\\n");process.stdout.write('{"type":"done"}');process.stderr.write("warn");process.exit(3);`,
		);
		const cacheFile = path.join(root, "shell-path.json");
		fs.writeFileSync(
			cacheFile,
			JSON.stringify({ at: Date.now(), path: "/usr/bin:/bin" }),
		);
		const lines = [];
		const runner = createCliRunner({
			cliPath: cli,
			environment: () => ({ OPALINE_CLICKHOUSE_BIN: "/r/clickhouse" }),
			cacheFile,
		});
		const events = [];
		const result = await runner.run(["server", "start", "--json"], {
			onEvent: (event) => events.push(event),
			onLine: (line) => lines.push(line),
		});
		expect(result.code).toBe(3);
		expect(result.stderr).toBe("warn");
		expect(events).toEqual([
			{
				type: "argv",
				args: ["server", "start", "--json"],
				bin: "/r/clickhouse",
				dnt: "1",
				node: "1",
			},
			{ type: "done" },
		]);
		expect(lines).toEqual(["plain line"]);
		expect(result.last).toEqual({ type: "done" });
	});
});
