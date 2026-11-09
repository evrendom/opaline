import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import postgres from "postgres";

const USAGE = `bun scripts/selfhost-bench.ts --data-dir <opaline server data dir> [options]

Measures a running local Opaline (started by \`opaline server start\`) against the
desktop budgets: history import time and per-phase timings, the /health gap
during the import, idle CPU of server + ClickHouse + Postgres, session list and
open latency, and find / patterns / digest latency. Prints one table.

  --import cli|local|none  how sessions get in (default none):
                           cli    runs <--cli> import <the N newest transcripts under --home>
                           local  the server ingests on its own (local mode); waits on
                                  GET /api/selfhost/ingest/status
  --cli "<command>"        the CLI to run for --import cli, e.g. "bun ~/opaline-cli/apps/cli/src/bin/cli.ts"
  --home <dir>             HOME whose ~/.claude/projects and ~/.codex/sessions are imported (cli)
  --sessions <n>           newest transcripts to import with --import cli (default all)
  --idle-seconds <s>       idle CPU window after the import (default 60; the budget is over 600)
  --derived-timeout <s>    how long to wait for the run index after the import (default 1800)
  --label <text>           name of this run in the table
  --json <file>            also write the measurements as JSON`;

interface Options {
	readonly dataDir: string;
	readonly importMode: "cli" | "local" | "none";
	readonly cli: string | null;
	readonly home: string | null;
	readonly sessions: number | null;
	readonly idleSeconds: number;
	readonly derivedTimeoutSeconds: number;
	readonly label: string;
	readonly json: string | null;
}

function parseOptions(argv: readonly string[]): Options {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index] ?? "";
		if (arg === "--help" || arg === "-h") {
			console.log(USAGE);
			process.exit(0);
		}
		if (!arg.startsWith("--")) throw new Error(`Unknown argument ${arg}`);
		values.set(arg.slice(2), argv[++index] ?? "");
	}
	const dataDir = values.get("data-dir");
	if (!dataDir) throw new Error(`--data-dir is required\n\n${USAGE}`);
	const importMode = values.get("import") ?? "none";
	if (importMode !== "cli" && importMode !== "local" && importMode !== "none")
		throw new Error("--import is cli, local or none");
	if (importMode === "cli" && (!values.get("cli") || !values.get("home")))
		throw new Error("--import cli needs --cli and --home");
	const number = (name: string, fallback: number | null) => {
		const raw = values.get(name);
		if (raw === undefined) return fallback;
		const parsed = Number(raw);
		if (!Number.isFinite(parsed) || parsed <= 0)
			throw new Error(`--${name} must be a positive number`);
		return parsed;
	};
	return {
		dataDir: resolve(dataDir),
		importMode,
		cli: values.get("cli") ?? null,
		home: values.has("home") ? resolve(values.get("home") ?? "") : null,
		sessions: number("sessions", null),
		idleSeconds: number("idle-seconds", 60) ?? 60,
		derivedTimeoutSeconds: number("derived-timeout", 1800) ?? 1800,
		label: values.get("label") ?? importMode,
		json: values.get("json") ?? null,
	};
}

interface ServerState {
	readonly publicUrl: string;
	readonly port: number;
	readonly secrets: { readonly setupToken: string };
	readonly clickhouse:
		| {
				readonly mode: "local";
				readonly httpPort: number;
				readonly user: string;
				readonly password: string;
		  }
		| {
				readonly mode: "external";
				readonly url: string;
				readonly user: string;
				readonly password: string;
		  };
	readonly postgres: {
		readonly port: number;
		readonly user: string;
		readonly password: string;
		readonly database: string;
	};
	readonly setup?: { readonly apiKey: string };
}

interface Stack {
	readonly url: string;
	readonly origin: string;
	readonly apiKey: string;
	readonly sql: postgres.Sql;
	readonly clickhouse: (query: string) => Promise<string>;
	readonly pids: () => number[];
}

function openStack(dataDir: string): Stack {
	const state = JSON.parse(
		readFileSync(join(dataDir, "server.json"), "utf8"),
	) as ServerState;
	if (!state.setup?.apiKey)
		throw new Error("The server has no setup yet; run opaline server start");
	const url = `http://127.0.0.1:${state.port}`;
	const clickhouseUrl =
		state.clickhouse.mode === "local"
			? `http://127.0.0.1:${state.clickhouse.httpPort}`
			: state.clickhouse.url;
	const authorization = `Basic ${btoa(`${state.clickhouse.user}:${state.clickhouse.password}`)}`;
	return {
		url,
		origin: new URL(state.publicUrl).origin,
		apiKey: state.setup.apiKey,
		sql: postgres({
			host: "127.0.0.1",
			port: state.postgres.port,
			user: state.postgres.user,
			password: state.postgres.password,
			database: state.postgres.database,
			max: 2,
			onnotice: () => {},
		}),
		clickhouse: async (query) => {
			const response = await fetch(clickhouseUrl, {
				method: "POST",
				body: query,
				headers: { Authorization: authorization },
			});
			const text = await response.text();
			if (!response.ok) throw new Error(text.slice(0, 400));
			return text.trim();
		},
		pids: () =>
			["server", "clickhouse", "postgres"].flatMap((name) => {
				const file = join(dataDir, "run", `${name}.pid`);
				if (!existsSync(file)) return [];
				const record = JSON.parse(readFileSync(file, "utf8")) as {
					pid: number;
				};
				return [record.pid];
			}),
	};
}

function transcripts(home: string): { path: string; mtimeMs: number }[] {
	const found: { path: string; mtimeMs: number }[] = [];
	const projects = join(home, ".claude", "projects");
	if (existsSync(projects))
		for (const project of readdirSync(projects)) {
			const dir = join(projects, project);
			if (!statSync(dir).isDirectory()) continue;
			for (const name of readdirSync(dir)) {
				if (!name.endsWith(".jsonl") || name.startsWith("agent-")) continue;
				const path = join(dir, name);
				found.push({ path, mtimeMs: statSync(path).mtimeMs });
			}
		}
	const walk = (dir: string) => {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".jsonl"))
				found.push({ path, mtimeMs: statSync(path).mtimeMs });
		}
	};
	walk(join(home, ".codex", "sessions"));
	return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function startHealthProbe(url: string, everyMs = 250) {
	let stopped = false;
	let maxGapMs = 0;
	let samples = 0;
	let slow = 0;
	let last = performance.now();
	const loop = (async () => {
		while (!stopped) {
			const sent = performance.now();
			try {
				const response = await fetch(`${url}/health`, {
					signal: AbortSignal.timeout(30_000),
				});
				await response.arrayBuffer();
			} catch {}
			const now = performance.now();
			if (now - sent > 1_000) slow += 1;
			maxGapMs = Math.max(maxGapMs, now - last);
			last = now;
			samples += 1;
			await Bun.sleep(Math.max(0, everyMs - (performance.now() - sent)));
		}
	})();
	return async () => {
		stopped = true;
		await loop;
		return { maxGapMs: Math.round(maxGapMs), samples, over1s: slow };
	};
}

async function cpuSeconds(pids: readonly number[]): Promise<number> {
	if (pids.length === 0) return 0;
	const out = execFileSync("ps", ["-o", "time=", "-p", pids.join(",")], {
		encoding: "utf8",
	});
	let seconds = 0;
	for (const line of out.split("\n")) {
		const value = line.trim();
		if (!value) continue;
		const [clock, fraction = "0"] = value.split(".");
		const parts = (clock ?? "0").split(":").map(Number);
		let total = 0;
		for (const part of parts) total = total * 60 + part;
		seconds += total + Number(`0.${fraction}`);
	}
	return seconds;
}

async function pendingRunIndexScopes(sql: postgres.Sql): Promise<number> {
	const [row] = await sql<{ pending: number }[]>`
		SELECT count(*)::int AS pending FROM l1_edge_scope
		WHERE request_count > built_request_count AND attempt_count < 8
	`;
	return row?.pending ?? 0;
}

async function counts(stack: Stack) {
	const [raw, records, runIndex, snapshots] = await Promise.all([
		stack.clickhouse(
			"SELECT (SELECT uniqExact(session_id) FROM rudel.claude_sessions) + (SELECT uniqExact(session_id) FROM rudel.codex_sessions)",
		),
		stack.clickhouse(
			"SELECT uniqExact(session_id) FROM rudel.transcript_records WHERE kind = 'receipt'",
		),
		stack.clickhouse(
			"SELECT uniqExact(session_id) FROM rudel.run_index WHERE row_kind = 'receipt'",
		),
		stack.clickhouse(
			"SELECT uniqExact(session_id) FROM rudel.session_context_snapshots",
		),
	]);
	return {
		rawSessions: Number(raw),
		recordSessions: Number(records),
		runIndexSessions: Number(runIndex),
		contextSnapshots: Number(snapshots),
	};
}

async function waitForDerived(stack: Stack, timeoutMs: number) {
	const deadline = Date.now() + timeoutMs;
	let quiet = 0;
	while (Date.now() < deadline) {
		const pending = await pendingRunIndexScopes(stack.sql);
		quiet = pending === 0 ? quiet + 1 : 0;
		if (quiet >= 3) return true;
		await Bun.sleep(2_000);
	}
	return false;
}

interface IngestStatus {
	readonly state: string;
	readonly sessionsSeen: number;
	readonly sessionsIngested: number;
	readonly sessionsQueued: number;
	readonly bytesQueued: number;
	readonly etaSeconds: number | null;
	readonly backgroundPriority: boolean;
}

async function ingestStatus(stack: Stack): Promise<IngestStatus | null> {
	const response = await fetch(`${stack.url}/api/selfhost/ingest/status`, {
		headers: { "x-api-key": stack.apiKey },
	});
	if (response.status === 404) return null;
	if (!response.ok)
		throw new Error(`ingest status answered ${response.status}`);
	return (await response.json()) as IngestStatus;
}

async function runCliImport(
	options: Options,
): Promise<{ files: number; failed: number }> {
	const all = transcripts(options.home ?? "");
	const chosen = all.slice(0, options.sessions ?? all.length);
	const [command, ...prefix] = (options.cli ?? "").split(/\s+/u);
	const args = [...prefix, "import", ...chosen.map((file) => file.path)];
	let failed = 0;
	await new Promise<void>((done, fail) => {
		const child = spawn(command ?? "", args, {
			env: { ...process.env, HOME: options.home ?? "" },
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			failed += text.match(/^Upload of .* failed/gmu)?.length ?? 0;
			stderr = `${stderr}${text}`.slice(-4_000);
		});
		child.on("error", fail);
		child.on("exit", (code) => {
			if (code !== 0)
				console.error(`CLI import exited ${code}: ${stderr.slice(-800)}`);
			done();
		});
	});
	return { files: chosen.length, failed };
}

async function waitForLocalImport(stack: Stack, timeoutMs: number) {
	const deadline = Date.now() + timeoutMs;
	let last: IngestStatus | null = null;
	let quiet = 0;
	while (Date.now() < deadline) {
		last = await ingestStatus(stack);
		if (last === null)
			throw new Error(
				"GET /api/selfhost/ingest/status answered 404: local ingest is off",
			);
		const idle = last.state === "idle" && last.sessionsQueued === 0;
		quiet = idle ? quiet + 1 : 0;
		if (quiet >= 2) return last;
		await Bun.sleep(500);
	}
	return last;
}

async function signIn(stack: Stack): Promise<string> {
	const link = (await (
		await fetch(`${stack.url}/api/selfhost/login-link`, {
			method: "POST",
			headers: {
				"x-api-key": stack.apiKey,
				"content-type": "application/json",
			},
			body: "{}",
		})
	).json()) as { loginUrl: string };
	const login = new URL(link.loginUrl);
	const response = await fetch(`${stack.url}${login.pathname}${login.search}`, {
		redirect: "manual",
	});
	const cookies = response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");
	if (!cookies.includes("session_token"))
		throw new Error("The sign-in link set no session cookie");
	return cookies;
}

async function timed<T>(work: () => Promise<T>): Promise<[T, number]> {
	const started = performance.now();
	const value = await work();
	return [value, Math.round(performance.now() - started)];
}

async function rpc(
	stack: Stack,
	cookie: string,
	path: string,
	input: unknown,
): Promise<unknown> {
	const response = await fetch(`${stack.url}/rpc/${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			cookie,
			origin: stack.origin,
		},
		body: JSON.stringify({ json: input }),
	});
	const body = (await response.json()) as { json?: unknown };
	if (!response.ok)
		throw new Error(
			`rpc ${path} ${response.status}: ${JSON.stringify(body).slice(0, 300)}`,
		);
	return body.json;
}

async function mcp(
	stack: Stack,
	name: string,
	args: Record<string, unknown>,
): Promise<string> {
	const response = await fetch(`${stack.url}/api/mcp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			authorization: `Bearer ${stack.apiKey}`,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name, arguments: args },
		}),
	});
	const body = (await response.json()) as {
		result?: { content?: { text: string }[]; isError?: boolean };
	};
	const text = (body.result?.content ?? []).map((part) => part.text).join("\n");
	if (!response.ok || body.result?.isError)
		throw new Error(`MCP ${name}: ${text.slice(0, 300)}`);
	return text;
}

async function median(
	runs: number,
	work: () => Promise<unknown>,
): Promise<number> {
	const times: number[] = [];
	for (let run = 0; run < runs; run++) times.push((await timed(work))[1]);
	times.sort((a, b) => a - b);
	return times[Math.floor(times.length / 2)] ?? 0;
}

interface Row {
	readonly measure: string;
	readonly value: string;
	readonly budget: string;
	readonly ok: boolean | null;
}

function within(value: number, budget: number): boolean {
	return value <= budget;
}

async function main(): Promise<void> {
	const options = parseOptions(Bun.argv.slice(2));
	const stack = openStack(options.dataDir);
	const rows: Row[] = [];
	const results: Record<string, unknown> = { label: options.label };
	const health = await fetch(`${stack.url}/health/ready`);
	if (!health.ok) throw new Error(`/health/ready answered ${health.status}`);

	await fetch(`${stack.url}/api/selfhost/ingest/timings?reset=1`, {
		headers: { "x-api-key": stack.apiKey },
	});
	if (options.importMode !== "none") {
		const stopProbe = startHealthProbe(stack.url);
		const cpuBefore = await cpuSeconds(stack.pids());
		const started = performance.now();
		let imported = 0;
		if (options.importMode === "cli") {
			const cli = await runCliImport(options);
			imported = cli.files - cli.failed;
			results.cliFailures = cli.failed;
		} else {
			await fetch(`${stack.url}/api/selfhost/ingest/notify`, {
				method: "POST",
				headers: {
					"x-api-key": stack.apiKey,
					"content-type": "application/json",
				},
				body: "{}",
			});
			const status = await waitForLocalImport(
				stack,
				options.derivedTimeoutSeconds * 1000,
			);
			imported = status?.sessionsIngested ?? 0;
		}
		const uploadMs = performance.now() - started;
		const derived = await waitForDerived(
			stack,
			options.derivedTimeoutSeconds * 1000,
		);
		const totalMs = performance.now() - started;
		const cpuDuring = (await cpuSeconds(stack.pids())) - cpuBefore;
		const probe = await stopProbe();
		const phases = (await (
			await fetch(`${stack.url}/api/selfhost/ingest/timings`, {
				headers: { "x-api-key": stack.apiKey },
			})
		).json()) as {
			phases: Record<string, { count: number; totalMs: number; maxMs: number }>;
		};
		const stored = await counts(stack);
		Object.assign(results, {
			imported,
			uploadMs: Math.round(uploadMs),
			totalMs: Math.round(totalMs),
			derivedComplete: derived,
			cpuSecondsDuringImport: Math.round(cpuDuring),
			health: probe,
			phases: phases.phases,
			stored,
		});
		rows.push(
			{
				measure: `import ${imported} sessions (ingested)`,
				value: `${(uploadMs / 1000).toFixed(1)} s`,
				budget: "-",
				ok: null,
			},
			{
				measure: "import + run index + snapshots",
				value: `${(totalMs / 1000).toFixed(1)} s${derived ? "" : " (timed out)"}`,
				budget: "< 180 s",
				ok: derived && within(totalMs, 180_000),
			},
			{
				measure: "stored: raw / records / run index / snapshots",
				value: `${stored.rawSessions} / ${stored.recordSessions} / ${stored.runIndexSessions} / ${stored.contextSnapshots}`,
				budget: "-",
				ok: null,
			},
			{
				measure: "/health max gap during import",
				value: `${probe.maxGapMs} ms (${probe.over1s} of ${probe.samples} over 1 s)`,
				budget: "< 1000 ms",
				ok: within(probe.maxGapMs, 1_000),
			},
			{
				measure: "CPU used by server + ClickHouse + Postgres",
				value: `${Math.round(cpuDuring)} s over ${(totalMs / 1000).toFixed(0)} s`,
				budget: "-",
				ok: null,
			},
		);
		for (const [phase, total] of Object.entries(phases.phases))
			rows.push({
				measure: `  phase ${phase}`,
				value: `${(total.totalMs / 1000).toFixed(1)} s total, ${total.count}×, max ${total.maxMs} ms`,
				budget: "-",
				ok: null,
			});
	}

	if (options.idleSeconds > 0) {
		const pids = stack.pids();
		const before = await cpuSeconds(pids);
		await Bun.sleep(options.idleSeconds * 1000);
		const used = (await cpuSeconds(pids)) - before;
		const percent = (100 * used) / options.idleSeconds;
		results.idleCpuPercent = Number(percent.toFixed(2));
		rows.push({
			measure: `idle CPU over ${options.idleSeconds} s (server + ClickHouse + Postgres)`,
			value: `${percent.toFixed(2)} %`,
			budget: "< 1 %",
			ok: within(percent, 1),
		});
	}

	const cookie = await signIn(stack);
	const listInput = { days: 30, limit: 50, offset: 0 };
	const listMs = await median(5, () =>
		rpc(stack, cookie, "analytics/sessions/list", listInput),
	);
	const list = (await rpc(stack, cookie, "analytics/sessions/list", {
		days: 30,
		limit: 500,
		offset: 0,
	})) as { sessionId?: string; session_id?: string }[];
	results.sessionListMs = listMs;
	rows.push({
		measure: "session list (30 days, 50 rows)",
		value: `${listMs} ms`,
		budget: "< 50 ms",
		ok: within(listMs, 50),
	});
	const sizes = (
		await stack.clickhouse(
			"SELECT session_id, length(content) + arraySum(arrayMap(x -> length(x), mapValues(subagents))) AS bytes FROM (SELECT session_id, content, subagents FROM rudel.claude_sessions FINAL UNION ALL SELECT session_id, content, map() AS subagents FROM rudel.codex_sessions FINAL) ORDER BY bytes FORMAT TSV",
		)
	)
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [sessionId = "", bytes = "0"] = line.split("\t");
			return { sessionId, bytes: Number(bytes) };
		});
	const listed = new Set(list.map((row) => row.sessionId ?? row.session_id));
	const openable = sizes.filter((row) => listed.has(row.sessionId));
	const typical = openable[Math.floor(openable.length / 2)];
	const largest = openable.at(-1);
	for (const [name, target] of [
		["typical", typical],
		["largest", largest],
	] as const) {
		if (!target) continue;
		const [, first] = await timed(() =>
			rpc(stack, cookie, "analytics/sessions/detailInitial", {
				sessionId: target.sessionId,
			}),
		);
		const [, again] = await timed(() =>
			rpc(stack, cookie, "analytics/sessions/detailInitial", {
				sessionId: target.sessionId,
			}),
		);
		results[`open_${name}`] = { bytes: target.bytes, first, again };
		rows.push({
			measure: `open ${name} session (${(target.bytes / 1024 / 1024).toFixed(1)} MiB): first / again`,
			value: `${first} / ${again} ms`,
			budget: name === "typical" ? "< 300 ms" : "-",
			ok: name === "typical" ? within(first, 300) : null,
		});
	}

	const today = new Date();
	const from = new Date(today.getTime() - 30 * 86_400_000)
		.toISOString()
		.slice(0, 10);
	const to = today.toISOString().slice(0, 10);
	const scope = { from, to };
	for (const [name, tool, args] of [
		["find source=calls", "find", { source: "calls", ...scope }],
		[
			"find source=calls groupBy=commandFingerprint",
			"find",
			{ source: "calls", groupBy: "commandFingerprint", ...scope },
		],
		["patterns list", "patterns", { action: "list", ...scope }],
		["patterns digest", "patterns", { action: "digest", ...scope }],
	] as const) {
		try {
			const [, first] = await timed(() => mcp(stack, tool, args));
			const [, again] = await timed(() => mcp(stack, tool, args));
			results[`mcp ${name}`] = { first, again };
			rows.push({
				measure: `${name}: first / again`,
				value: `${first} / ${again} ms`,
				budget: "-",
				ok: null,
			});
		} catch (error) {
			rows.push({
				measure: name,
				value: `failed: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`,
				budget: "-",
				ok: false,
			});
		}
	}

	await stack.sql.end({ timeout: 5 });
	const width = Math.max(...rows.map((row) => row.measure.length));
	const valueWidth = Math.max(...rows.map((row) => row.value.length));
	console.log(`\n${options.label}`);
	console.log(
		`| ${"measure".padEnd(width)} | ${"value".padEnd(valueWidth)} | budget     | ok |`,
	);
	console.log(
		`|${"-".repeat(width + 2)}|${"-".repeat(valueWidth + 2)}|------------|----|`,
	);
	for (const row of rows)
		console.log(
			`| ${row.measure.padEnd(width)} | ${row.value.padEnd(valueWidth)} | ${row.budget.padEnd(10)} | ${row.ok === null ? "  " : row.ok ? "✓ " : "✗ "} |`,
		);
	if (options.json)
		await writeFile(options.json, `${JSON.stringify(results, null, 2)}\n`);
}

await main();
