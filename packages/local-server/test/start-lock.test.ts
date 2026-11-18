import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PidRecord } from "../src/processes.js";
import {
	type ServerRunnerContext,
	startServices,
} from "../src/server-runner.js";
import type { ServerState } from "../src/server-state.js";
import {
	acquireStartLock,
	getStartLockPath,
	releaseStartLock,
	withStartLock,
} from "../src/start-lock.js";

let root: string;
const children: { kill: () => void }[] = [];
const closers: (() => void)[] = [];

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "opaline-start-lock-"));
});

afterEach(() => {
	for (const child of children.splice(0)) child.kill();
	for (const close of closers.splice(0)) close();
	rmSync(root, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function deadPid(): number {
	const result = spawnSync("true");
	return result.pid ?? 999_999;
}

function liveProcess(marker: string) {
	const child = spawn("/bin/sh", ["-c", "sleep 30; exit 0", marker], {
		stdio: "ignore",
	});
	children.push({ kill: () => child.kill("SIGKILL") });
	return child;
}

describe("one start at a time per data folder", () => {
	test("a second start in the same process waits for the first to finish", async () => {
		const order: string[] = [];
		const first = withStartLock(
			root,
			async () => {
				order.push("first in");
				await sleep(150);
				order.push("first out");
				return "first";
			},
			{ pollMs: 10 },
		);
		await sleep(20);
		const waited: number[] = [];
		const second = withStartLock(
			root,
			async () => {
				order.push("second in");
				return "second";
			},
			{ pollMs: 10, onWait: (holder) => waited.push(holder.pid) },
		);
		expect(await Promise.all([first, second])).toEqual(["first", "second"]);
		expect(order).toEqual(["first in", "first out", "second in"]);
		expect(waited).toEqual([process.pid]);
		expect(existsSync(getStartLockPath(root))).toBe(false);
	});

	test("starts in separate processes never overlap", async () => {
		const script = join(root, "contender.ts");
		const log = join(root, "log.txt");
		writeFileSync(
			script,
			`import { appendFileSync } from "node:fs";
import { withStartLock } from ${JSON.stringify(join(import.meta.dir, "..", "src", "start-lock.ts"))};
const [dataDir, log, name] = process.argv.slice(2);
await withStartLock(dataDir, async () => {
	appendFileSync(log, name + " in\\n");
	await new Promise((resolve) => setTimeout(resolve, 200));
	appendFileSync(log, name + " out\\n");
}, { pollMs: 20 });
`,
		);
		const run = (name: string) =>
			new Promise<number | null>((resolve) => {
				const child = spawn(process.execPath, [script, root, log, name], {
					stdio: "ignore",
				});
				child.on("exit", resolve);
			});
		expect(await Promise.all(["a", "b", "c"].map(run))).toEqual([0, 0, 0]);
		const lines = readFileSync(log, "utf8").trim().split("\n");
		expect(lines).toHaveLength(6);
		for (let index = 0; index < lines.length; index += 2) {
			const name = lines[index]?.split(" ")[0];
			expect(lines[index]).toBe(`${name} in`);
			expect(lines[index + 1]).toBe(`${name} out`);
		}
	});

	test("a lock left by a start that was killed is taken over", async () => {
		mkdirSync(join(root, "run"), { recursive: true });
		writeFileSync(
			getStartLockPath(root),
			JSON.stringify({
				pid: deadPid(),
				token: "killed",
				startedAt: new Date().toISOString(),
			}),
		);
		const holder = await acquireStartLock(root, { pollMs: 10, waitMs: 1_000 });
		expect(holder).not.toBeInstanceOf(Error);
		if (holder instanceof Error) return;
		expect(JSON.parse(readFileSync(getStartLockPath(root), "utf8")).token).toBe(
			holder.token,
		);
		releaseStartLock(root, holder);
		expect(existsSync(getStartLockPath(root))).toBe(false);
	});

	test("a lock whose process id now belongs to another program is taken over", async () => {
		const other = liveProcess("unrelated-program");
		mkdirSync(join(root, "run"), { recursive: true });
		writeFileSync(
			getStartLockPath(root),
			JSON.stringify({
				pid: other.pid,
				token: "reused",
				startedAt: new Date(Date.now() - 3_600_000).toISOString(),
			}),
		);
		const holder = await acquireStartLock(root, { pollMs: 10, waitMs: 2_000 });
		expect(holder).not.toBeInstanceOf(Error);
	});

	test("a start that holds the lock too long makes the next one give up with a clear error", async () => {
		const holder = liveProcess("opaline-local-start");
		mkdirSync(join(root, "run"), { recursive: true });
		writeFileSync(
			getStartLockPath(root),
			JSON.stringify({
				pid: holder.pid,
				token: "slow",
				startedAt: new Date().toISOString(),
			}),
		);
		const result = await withStartLock(root, async () => "ran", {
			pollMs: 10,
			waitMs: 100,
		});
		expect(result).toBeInstanceOf(Error);
		expect((result as Error).message).toContain(`pid ${holder.pid}`);
	});
});

describe("a start joins services an earlier start left starting", () => {
	function listen(server: Server): Promise<number> {
		return new Promise((resolve) =>
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				resolve(typeof address === "object" && address ? address.port : 0);
			}),
		);
	}

	async function freePort(): Promise<number> {
		const probe = createServer();
		const port = await listen(probe);
		await new Promise((resolve) => probe.close(resolve));
		return port;
	}

	function record(pid: number | undefined, marker: string): PidRecord {
		return { pid: pid ?? 0, marker, startedAt: new Date().toISOString() };
	}

	function context(lines: string[]): ServerRunnerContext {
		return {
			env: {},
			home: root,
			reporter: { info: (line) => lines.push(line), warn: () => {} },
			interactive: false,
			confirm: async () => false,
			openBrowser: () => {},
		};
	}

	function state(serverPort: number, postgresPort: number): ServerState {
		return {
			version: 1,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			port: serverPort,
			host: "127.0.0.1",
			publicUrl: `http://localhost:${serverPort}`,
			secrets: {
				betterAuthSecret: "a".repeat(32),
				cronSecret: "b".repeat(32),
				setupToken: "c".repeat(32),
			},
			clickhouse: {
				mode: "external",
				url: "http://127.0.0.1:1",
				user: "default",
				password: "",
			},
			postgres: {
				port: postgresPort,
				user: "opaline",
				password: "p",
				database: "opaline",
			},
		};
	}

	const distribution = {
		kind: "checkout" as const,
		root,
		entry: "/srv/opaline/main.ts",
		webDir: "/srv/opaline/web",
		hasWebBuild: true,
		source: "test",
	};
	const runtimes = {
		clickhouse: undefined,
		postgres: {
			name: "postgres",
			version: "17",
			source: "explicit",
			path: "/pg",
		},
		bun: { name: "bun", version: "1", source: "explicit", path: "/bun" },
	} as unknown as Parameters<typeof startServices>[0]["runtimes"];

	test("it waits for a server that is still starting instead of going on without it", async () => {
		const serverPort = await freePort();
		const postgres = createServer((socket) => socket.end(Buffer.from("R")));
		const postgresPort = await listen(postgres);
		closers.push(() => postgres.close());
		const server = liveProcess("/srv/opaline/main.ts");
		const lines: string[] = [];
		setTimeout(() => {
			const http = Bun.serve({
				port: serverPort,
				hostname: "127.0.0.1",
				fetch: () => new Response("ok"),
			});
			closers.push(() => http.stop(true));
		}, 700);
		const began = Date.now();
		const startedHere: ("clickhouse" | "postgres" | "server")[] = [];
		const failure = await startServices({
			dataDir: root,
			state: state(serverPort, postgresPort),
			runtimes,
			distribution,
			running: {
				postgres: record(liveProcess("pg").pid, "pg"),
				server: record(server.pid, "/srv/opaline/main.ts"),
			},
			startedHere,
			context: context(lines),
		});
		expect(failure).toBeUndefined();
		expect(Date.now() - began).toBeGreaterThanOrEqual(600);
		expect(startedHere).toEqual([]);
		expect(lines.some((line) => line.includes("already starting"))).toBe(true);
	});

	test("it reports a server that an earlier start left behind and that then exits", async () => {
		const serverPort = await freePort();
		const postgres = createServer((socket) => socket.end(Buffer.from("R")));
		const postgresPort = await listen(postgres);
		closers.push(() => postgres.close());
		const server = liveProcess("/srv/opaline/main.ts");
		setTimeout(() => server.kill("SIGKILL"), 300);
		const failure = await startServices({
			dataDir: root,
			state: state(serverPort, postgresPort),
			runtimes,
			distribution,
			running: {
				postgres: record(liveProcess("pg").pid, "pg"),
				server: record(server.pid, "/srv/opaline/main.ts"),
			},
			startedHere: [],
			context: context([]),
		});
		expect(failure?.message).toContain("Opaline server exited during startup");
	});
});
