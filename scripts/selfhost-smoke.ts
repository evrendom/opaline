import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import type { Subprocess } from "bun";

const REPO = resolve(import.meta.dir, "..");
const USAGE = `bun scripts/selfhost-smoke.ts [--clickhouse local|lan] [--lan-ip <ipv4>]
    [--artifact dist-selfhost/opaline-server-<version>.tgz] [--bun <path>] [--keep]

Starts a throwaway self-hosted Opaline in a temp dir with a fake HOME: its own
ClickHouse (local: loopback with the s3 storage policy; lan: no storage policy,
password user, listening on all interfaces and reached through the LAN IP),
Postgres from Homebrew and apps/api/src/selfhost/main.ts. Runs setup, uploads
two fixture transcripts, waits for the scheduler to build the run index, calls
the MCP tools with the API key, checks the login link, then tears everything
down.

--artifact runs the packaged server instead of the checkout: the tarball is
checked against its manifest, unpacked into an empty directory under the work
dir and started with --bun (default: this Bun) and its bundled web app.

Environment: OPALINE_SMOKE_CLICKHOUSE (clickhouse binary),
OPALINE_SMOKE_PG_BIN (directory with initdb, pg_ctl, createdb).`;

const FIXTURES = [
	{
		file: "packages/api-routes/src/session-transcript/__fixtures__/l1-facts/claude-2.1.jsonl",
		source: "claude_code",
		sessionId: "l1-facts",
		firstPrompt: "ship the fix and open a PR",
	},
	{
		file: "packages/api-routes/src/session-transcript/__fixtures__/l1-facts/codex-0.156.jsonl",
		source: "codex",
		sessionId: "l1-facts-codex",
		firstPrompt: "check the build",
	},
] as const;
const DAY = "2026-10-01";

interface Options {
	readonly clickhouse: "local" | "lan";
	readonly lanIp: string | null;
	readonly keep: boolean;
	readonly artifact: string | null;
	readonly bun: string;
}

function parseOptions(argv: readonly string[]): Options {
	let clickhouse: Options["clickhouse"] = "local";
	let lanIp: string | null = null;
	let keep = false;
	let artifact: string | null = null;
	let bun = process.execPath;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") {
			console.log(USAGE);
			process.exit(0);
		} else if (arg === "--keep") keep = true;
		else if (arg === "--clickhouse") {
			const value = argv[++index];
			if (value !== "local" && value !== "lan")
				throw new Error("--clickhouse is local or lan");
			clickhouse = value;
		} else if (arg === "--lan-ip") lanIp = argv[++index] ?? null;
		else if (arg === "--artifact") artifact = resolve(argv[++index] ?? "");
		else if (arg === "--bun") bun = resolve(argv[++index] ?? "");
		else throw new Error(`Unknown argument ${arg}\n\n${USAGE}`);
	}
	return { clickhouse, lanIp, keep, artifact, bun };
}

const started = performance.now();
function step(message: string): void {
	const seconds = ((performance.now() - started) / 1000).toFixed(1);
	console.log(`[${seconds.padStart(6)}s] ${message}`);
}

function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`check failed: ${message}`);
}

async function freePort(): Promise<number> {
	for (;;) {
		const server = Bun.serve({ port: 0, fetch: () => new Response() });
		const port = server.port;
		server.stop(true);
		if (port !== undefined && (port < 4010 || port > 4018) && port !== 4605)
			return port;
	}
}

function lanAddress(preferred: string | null): string {
	if (preferred) return preferred;
	for (const addresses of Object.values(networkInterfaces()))
		for (const address of addresses ?? [])
			if (address.family === "IPv4" && !address.internal)
				return address.address;
	throw new Error("No LAN IPv4 address found; pass --lan-ip");
}

function clickhouseBinary(): string {
	const configured = process.env.OPALINE_SMOKE_CLICKHOUSE;
	if (configured) return configured;
	const versions = join(process.env.HOME ?? "", ".clickhouse", "versions");
	if (existsSync(versions)) {
		const newest = readdirSync(versions)
			.filter((version) => existsSync(join(versions, version, "clickhouse")))
			.sort((left, right) =>
				left.localeCompare(right, undefined, { numeric: true }),
			)
			.at(-1);
		if (newest) return join(versions, newest, "clickhouse");
	}
	const onPath = Bun.which("clickhouse");
	if (onPath) return onPath;
	throw new Error("No ClickHouse binary; set OPALINE_SMOKE_CLICKHOUSE");
}

async function waitFor<T>(
	what: string,
	timeoutMs: number,
	probe: () => Promise<T | null | undefined | false>,
	intervalMs = 500,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown = null;
	while (Date.now() < deadline) {
		try {
			const value = await probe();
			if (value) return value;
		} catch (error) {
			lastError = error;
		}
		await Bun.sleep(intervalMs);
	}
	throw new Error(
		`Timed out after ${timeoutMs / 1000}s waiting for ${what}${lastError ? `: ${String(lastError)}` : ""}`,
	);
}

interface ClickHouseServer {
	readonly url: string;
	readonly username: string;
	readonly password: string;
	readonly process: Subprocess;
	query(sql: string): Promise<string>;
}

async function startClickHouse(
	work: string,
	options: Options,
): Promise<ClickHouseServer> {
	const directory = join(work, "clickhouse");
	for (const sub of ["data", "tmp", "user_files", "log"])
		await mkdir(join(directory, sub), { recursive: true });
	const [httpPort, tcpPort] = [await freePort(), await freePort()];
	const lan = options.clickhouse === "lan";
	const password = lan ? randomBytes(12).toString("hex") : "";
	const username = lan ? "opaline" : "default";
	const host = lan ? lanAddress(options.lanIp) : "127.0.0.1";
	const extras = lan
		? ""
		: `<query_log><database>system</database><table>query_log</table><flush_interval_milliseconds>7500</flush_interval_milliseconds></query_log>
  <storage_configuration><policies><s3><volumes><default><disk>default</disk></default></volumes></s3></policies></storage_configuration>`;
	await writeFile(
		join(directory, "config.xml"),
		`<clickhouse>
  <logger><level>warning</level><log>${directory}/log/clickhouse.log</log><errorlog>${directory}/log/clickhouse.err.log</errorlog><console>0</console></logger>
  <http_port>${httpPort}</http_port>
  <tcp_port>${tcpPort}</tcp_port>
  <listen_host>${lan ? "0.0.0.0" : "127.0.0.1"}</listen_host>
  <path>${directory}/data/</path>
  <tmp_path>${directory}/tmp/</tmp_path>
  <user_files_path>${directory}/user_files/</user_files_path>
  <max_server_memory_usage>2147483648</max_server_memory_usage>
  <mark_cache_size>268435456</mark_cache_size>
  <users_config>users.xml</users_config>
  ${extras}
</clickhouse>
`,
	);
	const users = lan
		? `<default><password>${randomBytes(12).toString("hex")}</password><networks><ip>127.0.0.1</ip></networks><profile>default</profile><quota>default</quota></default>
    <opaline><password>${password}</password><networks><ip>::/0</ip></networks><profile>default</profile><quota>default</quota><access_management>1</access_management></opaline>`
		: `<default><password></password><networks><ip>127.0.0.1</ip><ip>::1</ip></networks><profile>default</profile><quota>default</quota><access_management>1</access_management></default>`;
	await writeFile(
		join(directory, "users.xml"),
		`<clickhouse>
  <profiles><default></default></profiles>
  <users>
    ${users}
  </users>
  <quotas><default></default></quotas>
</clickhouse>
`,
	);
	const binary = clickhouseBinary();
	const child = Bun.spawn(
		[binary, "server", `--config-file=${join(directory, "config.xml")}`],
		{
			cwd: directory,
			stdout: Bun.file(join(directory, "log", "stdout.log")),
			stderr: Bun.file(join(directory, "log", "stderr.log")),
		},
	);
	const url = `http://${host}:${httpPort}`;
	const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
	const query = async (sql: string) => {
		const response = await fetch(url, {
			method: "POST",
			body: sql,
			headers: { Authorization: authorization },
		});
		const text = await response.text();
		if (!response.ok) throw new Error(`ClickHouse ${response.status}: ${text}`);
		return text.trim();
	};
	await waitFor(`ClickHouse at ${url}`, 60_000, async () =>
		(await query("SELECT 1")) === "1" ? true : null,
	);
	const version = await query("SELECT version()");
	const policies = await query(
		"SELECT arrayStringConcat(groupArray(policy_name), ',') FROM system.storage_policies",
	);
	step(
		`ClickHouse ${version} (${binary}) at ${url} as ${username}; storage policies: ${policies}`,
	);
	return { url, username, password, process: child, query };
}

interface PostgresServer {
	readonly url: string;
	stop(): Promise<void>;
}

async function run(command: string[], what: string): Promise<string> {
	const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (code !== 0)
		throw new Error(`${what} failed (${code}): ${stderr || stdout}`);
	return stdout;
}

async function startPostgres(work: string): Promise<PostgresServer> {
	const bin =
		process.env.OPALINE_SMOKE_PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
	const directory = join(work, "postgres");
	await mkdir(directory, { recursive: true });
	const port = await freePort();
	const data = join(directory, "data");
	await run(
		[
			join(bin, "initdb"),
			"-D",
			data,
			"-U",
			"opaline",
			"--auth=trust",
			"-E",
			"UTF8",
			"--no-locale",
		],
		"initdb",
	);
	await run(
		[
			join(bin, "pg_ctl"),
			"-D",
			data,
			"-o",
			`-p ${port} -k ${directory} -c listen_addresses=127.0.0.1`,
			"-l",
			join(directory, "postgres.log"),
			"-w",
			"start",
		],
		"pg_ctl start",
	);
	await run(
		[
			join(bin, "createdb"),
			"-h",
			"127.0.0.1",
			"-p",
			String(port),
			"-U",
			"opaline",
			"opaline",
		],
		"createdb",
	);
	const version = (
		await run([join(bin, "postgres"), "--version"], "postgres --version")
	).trim();
	step(`${version} on 127.0.0.1:${port}`);
	return {
		url: `postgres://opaline@127.0.0.1:${port}/opaline`,
		stop: async () => {
			await run(
				[join(bin, "pg_ctl"), "-D", data, "-m", "fast", "-w", "stop"],
				"pg_ctl stop",
			);
		},
	};
}

interface OpalineServer {
	readonly url: string;
	readonly process: Subprocess;
	readonly output: () => string;
}

interface UnpackedArtifact {
	readonly directory: string;
	readonly entry: string;
	readonly version: string;
}

async function unpackArtifact(
	work: string,
	tarball: string,
): Promise<UnpackedArtifact> {
	const manifest = JSON.parse(
		await readFile(tarball.replace(/\.tgz$/u, ".json"), "utf8"),
	) as { version: string; sha256: string };
	const sha256 = createHash("sha256")
		.update(await readFile(tarball))
		.digest("hex");
	check(sha256 === manifest.sha256, `${tarball} does not match its manifest`);
	const directory = join(work, "server");
	await mkdir(directory, { recursive: true });
	await run(["tar", "-xzf", tarball, "-C", directory], "tar -x");
	const entry = join(directory, "package", "server", "main.js");
	check(existsSync(entry), "the artifact has package/server/main.js");
	for (let parent = directory; parent !== "/"; parent = resolve(parent, ".."))
		check(
			!existsSync(join(parent, "node_modules")),
			`${parent} has node_modules`,
		);
	step(
		`artifact ${manifest.version} (sha256 ${sha256.slice(0, 12)}) unpacked into ${directory}`,
	);
	return { directory, entry, version: manifest.version };
}

async function startServer(
	work: string,
	clickhouse: ClickHouseServer,
	postgres: PostgresServer,
	setupToken: string,
	bun: string,
	artifact: UnpackedArtifact | null,
): Promise<OpalineServer> {
	const home = join(work, "home");
	const web = join(work, "web");
	await mkdir(join(home, ".opaline"), { recursive: true });
	await mkdir(web, { recursive: true });
	await writeFile(
		join(web, "index.html"),
		"<!doctype html><title>Opaline smoke</title>",
	);
	const port = await freePort();
	const child = Bun.spawn(
		artifact
			? [bun, "--no-install", artifact.entry]
			: [bun, join(REPO, "apps/api/src/selfhost/main.ts")],
		{
			cwd: artifact ? artifact.directory : REPO,
			env: {
				PATH: artifact ? "/usr/bin:/bin" : (process.env.PATH ?? "/usr/bin:/bin"),
				HOME: home,
				OPALINE_CONFIG_DIR: join(home, ".opaline"),
				OPALINE_SELF_HOSTED: "1",
				PORT: String(port),
				HOST: "127.0.0.1",
				PG_CONNECTION_STRING: postgres.url,
				CLICKHOUSE_URL: clickhouse.url,
				CLICKHOUSE_USERNAME: clickhouse.username,
				CLICKHOUSE_PASSWORD: clickhouse.password,
				CLICKHOUSE_FLAVOR: "auto",
				BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
				CRON_SECRET: randomBytes(24).toString("hex"),
				OPALINE_SETUP_TOKEN: setupToken,
				OPALINE_DATA_DIR: join(work, "data"),
				...(artifact ? {} : { OPALINE_WEB_DIR: web }),
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	let output = "";
	let ready: string | null = null;
	const drain = async (
		stream: ReadableStream<Uint8Array>,
		isStdout: boolean,
	) => {
		const decoder = new TextDecoder();
		for await (const chunk of stream) {
			const text = decoder.decode(chunk);
			output += text;
			if (isStdout && ready === null) {
				const match = /^ready (\S+)$/mu.exec(output);
				if (match?.[1]) ready = match[1];
			}
		}
	};
	void drain(child.stdout, true);
	void drain(child.stderr, false);
	await waitFor("the ready line", 180_000, async () => {
		if (child.exitCode !== null)
			throw new Error(`server exited ${child.exitCode}:\n${output}`);
		return ready;
	});
	for (const line of output.split("\n"))
		if (line.startsWith("opaline: ")) step(line);
	step(`server says ${output.match(/^ready \S+$/mu)?.[0]} (pid ${child.pid})`);
	return {
		url: `http://127.0.0.1:${port}`,
		process: child,
		output: () => output,
	};
}

function logMessage(line: string): string {
	try {
		return String((JSON.parse(line) as { message?: unknown }).message).slice(
			0,
			240,
		);
	} catch {
		return line.slice(0, 240);
	}
}

async function json(response: Response): Promise<Record<string, unknown>> {
	const text = await response.text();
	try {
		return JSON.parse(text) as Record<string, unknown>;
	} catch {
		throw new Error(`Not JSON (${response.status}): ${text.slice(0, 400)}`);
	}
}

async function mcp(
	server: OpalineServer,
	key: string,
	name: string,
	args: Record<string, unknown>,
	header: "bearer" | "x-api-key" = "bearer",
): Promise<{ text: string; structured: unknown }> {
	const response = await fetch(`${server.url}/api/mcp`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(header === "bearer"
				? { Authorization: `Bearer ${key}` }
				: { "x-api-key": key }),
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name, arguments: args },
		}),
	});
	check(response.status === 200, `MCP ${name} answered ${response.status}`);
	const body = (await json(response)) as {
		result?: {
			content?: { text: string }[];
			structuredContent?: unknown;
			isError?: boolean;
		};
		error?: unknown;
	};
	const text = (body.result?.content ?? []).map((part) => part.text).join("\n");
	check(
		body.result && !body.result.isError,
		`MCP ${name} failed: ${text || JSON.stringify(body.error)}`,
	);
	return { text, structured: body.result.structuredContent };
}

function firstLine(text: string): string {
	return (
		text
			.split("\n")
			.find((line) => line.trim() !== "" && !line.startsWith("url: ")) ?? ""
	);
}

async function checkBundledWeb(
	server: OpalineServer,
	version: string,
): Promise<void> {
	const info = await json(await fetch(`${server.url}/api/selfhost/info`));
	check(info.version === version, `info.version ${String(info.version)}`);
	const index = await fetch(`${server.url}/smoke-team/sessions`);
	const html = await index.text();
	check(
		index.status === 200 && html.includes('id="root"'),
		`web index: ${index.status} ${html.slice(0, 200)}`,
	);
	const assets = [
		...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/gu),
	].map((match) => match[1] ?? "");
	check(assets.length > 0, "index.html references assets");
	for (const asset of [...assets, "/theme-boot.js", "/plugin/entry.js"]) {
		const response = await fetch(`${server.url}${asset}`);
		check(response.status === 200, `${asset} answered ${response.status}`);
		await response.arrayBuffer();
	}
	const csp = index.headers.get("content-security-policy") ?? "";
	step(
		`web: bundled app at /smoke-team/sessions, ${assets.length} assets, /theme-boot.js and /plugin/entry.js load (CSP ${csp ? "on" : "off"}); info.version ${version}`,
	);
}

async function smoke(options: Options, work: string): Promise<void> {
	const stops: (() => Promise<void>)[] = [];
	const teardown = async () => {
		for (const stop of stops.reverse())
			await stop().catch((error: unknown) =>
				step(
					`teardown: ${error instanceof Error ? error.message : String(error)}`,
				),
			);
	};
	try {
		const clickhouse = await startClickHouse(work, options);
		stops.push(async () => {
			clickhouse.process.kill("SIGTERM");
			const exited = await Promise.race([
				clickhouse.process.exited.then(() => true),
				Bun.sleep(15_000).then(() => false),
			]);
			if (!exited) clickhouse.process.kill("SIGKILL");
			step("ClickHouse stopped");
		});
		const postgres = await startPostgres(work);
		stops.push(async () => {
			await postgres.stop();
			step("Postgres stopped");
		});
		const setupToken = randomBytes(24).toString("hex");
		const artifact = options.artifact
			? await unpackArtifact(work, options.artifact)
			: null;
		const server = await startServer(
			work,
			clickhouse,
			postgres,
			setupToken,
			options.bun,
			artifact,
		);
		stops.push(async () => {
			server.process.kill("SIGTERM");
			const code = await Promise.race([
				server.process.exited,
				Bun.sleep(20_000).then(() => null),
			]);
			if (code === null) server.process.kill("SIGKILL");
			step(
				`server stopped (exit ${code ?? "killed"}; ${server.output().includes("opaline: stopped") ? "clean shutdown" : "no clean shutdown line"})`,
			);
		});

		const info = await json(await fetch(`${server.url}/api/selfhost/info`));
		check(
			info.selfHosted === true && info.setupComplete === false,
			"info before setup",
		);
		const setupResponse = await fetch(`${server.url}/api/selfhost/setup`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Opaline-Setup-Token": setupToken,
			},
			body: JSON.stringify({
				email: "owner@example.test",
				name: "Smoke Owner",
				workspaceName: "Smoke Team",
			}),
		});
		check(
			setupResponse.status === 200,
			`setup answered ${setupResponse.status}`,
		);
		const setup = (await json(setupResponse)) as {
			user: { id: string; email: string };
			organization: { id: string; slug: string; name: string };
			apiKey: string;
			apiKeyId: string;
			loginUrl: string;
		};
		check(
			setup.apiKey && setup.organization.slug === "smoke-team",
			"setup result",
		);
		step(
			`setup: user ${setup.user.email}, workspace ${setup.organization.slug} (${setup.organization.name}), API key ${setup.apiKeyId}`,
		);

		const status = (await json(
			await fetch(`${server.url}/rpc/cli/authStatus`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": setup.apiKey,
				},
				body: "{}",
			}),
		)) as { json?: { capabilities?: Record<string, unknown> } };
		check(
			status.json?.capabilities?.selfHosted === true,
			"authStatus selfHosted",
		);
		step(
			`cli.authStatus capabilities: ${Object.keys(status.json?.capabilities ?? {}).join(", ")}`,
		);

		for (const fixture of FIXTURES) {
			const content = await readFile(join(REPO, fixture.file), "utf8");
			const response = await fetch(`${server.url}/rpc/ingestSession`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": setup.apiKey,
				},
				body: JSON.stringify({
					json: {
						source: fixture.source,
						sessionId: fixture.sessionId,
						projectPath: "/repo",
						gitRemote: "github.com/acme/widget",
						content,
						upload_mode: "manual",
					},
				}),
			});
			const body = await json(response);
			check(
				response.status === 200 &&
					(body.json as { success?: boolean } | undefined)?.success === true,
				`ingest ${fixture.sessionId}: ${response.status} ${JSON.stringify(body).slice(0, 300)}`,
			);
			step(
				`uploaded ${fixture.sessionId} (${fixture.source}, ${content.length} chars) through rpc/ingestSession`,
			);
		}

		const uploadedAt = performance.now();
		const indexed = await waitFor(
			"run_index rows for both sessions",
			420_000,
			async () => {
				const sessions = Number(
					await clickhouse.query(
						"SELECT uniqExact(session_id) FROM rudel.run_index",
					),
				);
				return sessions >= FIXTURES.length ? sessions : null;
			},
			2_000,
		);
		const runRows = await clickhouse.query(
			"SELECT count() FROM rudel.run_index",
		);
		step(
			`run_index: ${indexed} sessions, ${runRows} rows, built by the scheduler ${((performance.now() - uploadedAt) / 1000).toFixed(0)}s after upload`,
		);

		const workspaces = await mcp(server, setup.apiKey, "list_workspaces", {});
		const items =
			(
				workspaces.structured as {
					items?: { slug: string; sessionsLast365Days: number }[];
				}
			)?.items ?? [];
		check(
			items.some(
				(item) =>
					item.slug === setup.organization.slug &&
					item.sessionsLast365Days >= 2,
			),
			`list_workspaces: ${workspaces.text}`,
		);
		step(`MCP list_workspaces: ${workspaces.text}`);

		const range = { from: DAY, to: DAY, workspace: setup.organization.slug };
		const find = await mcp(
			server,
			setup.apiKey,
			"find",
			{ source: "runs", ...range },
			"x-api-key",
		);
		const header = /sessions=(\d+) indexed=(\d+) runs=(\d+)/u.exec(find.text);
		check(
			header &&
				Number(header[1]) === 2 &&
				Number(header[2]) === 2 &&
				Number(header[3]) > 0,
			`find header: ${find.text.slice(0, 400)}`,
		);
		step(`MCP find: ${header[0]}`);

		const sql = await mcp(server, setup.apiKey, "sql", {
			query:
				"SELECT count() AS runs, uniqExact(session_id) AS sessions, round(sum(duration_ms) / 1000) AS seconds FROM runs",
			title: "Runs in the smoke workspace",
			workspace: setup.organization.slug,
		});
		const sqlRow = /^(\d+) \| (\d+) \| \d+$/mu.exec(sql.text);
		check(
			sqlRow && Number(sqlRow[1]) > 0 && Number(sqlRow[2]) === 2,
			`sql rows: ${sql.text.slice(0, 400)}`,
		);
		step(`MCP sql: runs=${sqlRow[1]} sessions=${sqlRow[2]}`);

		const measureList = await mcp(server, setup.apiKey, "measures", {
			action: "list",
		});
		check(measureList.text.includes("time_lost_by_cause"), "measures list");
		const measure = await mcp(server, setup.apiKey, "measures", {
			action: "run",
			name: "time_lost_by_cause",
			...range,
		});
		check(measure.text.length > 0, "measures run text");
		step(
			`MCP measures: list has ${(measureList.text.match(/^\S+/gmu) ?? []).length} lines; run: ${firstLine(measure.text)}`,
		);

		const read = await mcp(server, setup.apiKey, "read", {
			refs: [{ sessionId: FIXTURES[0].sessionId, agentId: "", turn: 1 }],
			workspace: setup.organization.slug,
		});
		check(
			read.text.includes(FIXTURES[0].firstPrompt),
			`read: ${read.text.slice(0, 300)}`,
		);
		step(
			`MCP read: ${FIXTURES[0].sessionId}#1 shows "${FIXTURES[0].firstPrompt}" (${read.text.length} chars)`,
		);

		const dashboard = await mcp(server, setup.apiKey, "get_dashboard", {
			startDate: DAY,
			endDate: DAY,
			metric: "sessions",
		});
		const total = dashboard.structured as {
			result?: { total?: number };
			total?: number;
		};
		const dashboardTotal = total?.result?.total ?? total?.total;
		check(
			typeof dashboardTotal === "number" && dashboardTotal >= 2,
			`get_dashboard: ${JSON.stringify(dashboard.structured).slice(0, 400)}`,
		);
		step(`MCP get_dashboard: sessions total ${dashboardTotal}`);

		const patterns = await mcp(server, setup.apiKey, "patterns", {
			action: "digest",
			...range,
		});
		check(
			patterns.text.length > 200,
			`patterns digest: ${patterns.text.slice(0, 300)}`,
		);
		step(
			`MCP patterns digest: ${patterns.text.length} chars, ${firstLine(patterns.text).slice(0, 120)}`,
		);

		const search = await mcp(server, setup.apiKey, "search", {
			text: FIXTURES[0].firstPrompt,
			mode: "exact",
			filters: { since: DAY, until: DAY },
			workspace: setup.organization.slug,
		});
		check(
			search.text.includes(FIXTURES[0].sessionId),
			`search: ${search.text.slice(0, 300)}`,
		);
		step(
			`MCP search (exact, no OpenAI key): ${firstLine(search.text).slice(0, 120)}`,
		);

		const stats = await mcp(server, setup.apiKey, "mcp_stats", {
			action: "stats",
		});
		check(
			stats.text.includes("mcp_stats action=stats"),
			"mcp_stats for the owner",
		);
		step(
			`MCP mcp_stats (owner of the first workspace): ${firstLine(stats.text)}`,
		);

		const link = (await json(
			await fetch(`${server.url}/api/selfhost/login-link`, {
				method: "POST",
				headers: { "x-api-key": setup.apiKey },
			}),
		)) as { loginUrl: string };
		const loginPath = new URL(link.loginUrl);
		const login = await fetch(
			`${server.url}${loginPath.pathname}${loginPath.search}`,
			{
				redirect: "manual",
			},
		);
		const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
		check(
			login.status === 302 &&
				login.headers.get("location") === "/" &&
				cookie.includes("session_token="),
			`login link: ${login.status} ${login.headers.get("location")}`,
		);
		const me = (await json(
			await fetch(`${server.url}/rpc/me`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: cookie,
					Origin: new URL(link.loginUrl).origin,
				},
				body: "{}",
			}),
		)) as { json?: { email?: string } };
		check(
			me.json?.email === setup.user.email,
			`rpc/me with the cookie: ${JSON.stringify(me)}`,
		);
		const reused = await fetch(
			`${server.url}${loginPath.pathname}${loginPath.search}`,
			{
				redirect: "manual",
			},
		);
		check(
			reused.headers.get("location")?.includes("LOGIN_LINK_INVALID"),
			"a used login link is refused",
		);
		step(
			`login link: 302 to / with ${cookie.split("=")[0]}; rpc/me answers ${me.json?.email}; reusing the link is refused`,
		);
		const inviteResponse = await fetch(
			`${server.url}/rpc/teamInviteLink/create`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: cookie,
					Origin: new URL(link.loginUrl).origin,
				},
				body: JSON.stringify({ json: { organizationId: setup.organization.id } }),
			},
		);
		const invite = new URL(
			((await json(inviteResponse)) as { json: { invite_url: string } }).json
				.invite_url,
		);
		const invitePage = await (
			await fetch(`${server.url}${invite.pathname}`)
		).text();
		const inviteImage = await fetch(`${server.url}${invite.pathname}/og.png`);
		const advertised = invitePage.includes('property="og:image"');
		check(
			invitePage.includes("Join Smoke Team") &&
				advertised === !artifact &&
				inviteImage.status === (artifact ? 404 : 200),
			`invite page: og:image ${advertised}, og.png ${inviteImage.status}`,
		);
		step(
			`invite page: ${advertised ? "advertises" : "omits"} og:image; og.png answers ${inviteImage.status}${artifact ? " (no SVG renderer in the artifact)" : ""}`,
		);
		if (artifact) await checkBundledWeb(server, artifact.version);
		else {
			const spa = await fetch(`${server.url}/smoke-team/sessions`);
			check(
				spa.status === 200 && (await spa.text()).includes("Opaline smoke"),
				"SPA fallback",
			);
			step("web: /smoke-team/sessions serves index.html from OPALINE_WEB_DIR");
		}
		const problems = server
			.output()
			.split("\n")
			.filter((line) => /"level":"(?:ERROR|FATAL)"/u.test(line));
		const warnings = server
			.output()
			.split("\n")
			.filter((line) => /"level":"WARN(?:ING)?"/u.test(line));
		for (const line of [...new Set(problems.map(logMessage))].slice(0, 10))
			step(`server error: ${line}`);
		for (const line of [...new Set(warnings.map(logMessage))].slice(0, 10))
			step(`server warning: ${line}`);
		step(
			`server log: ${problems.length} error lines, ${warnings.length} warning lines`,
		);
		check(problems.length === 0, "the server logged errors");
	} finally {
		await teardown();
	}
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	await mkdir("/tmp/opaline-e2e", { recursive: true });
	const work = await mkdtemp(`/tmp/opaline-e2e/smoke-${options.clickhouse}-`);
	step(
		`work dir ${work} (fake HOME ${join(work, "home")}), ClickHouse mode ${options.clickhouse}`,
	);
	try {
		await smoke(options, work);
		step(`SMOKE PASS (${options.clickhouse})`);
	} finally {
		if (!options.keep) await rm(work, { recursive: true, force: true });
	}
}

main().catch((error: unknown) => {
	step(`SMOKE FAIL: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
