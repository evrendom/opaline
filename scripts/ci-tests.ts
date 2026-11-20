/**
 * Splits the repository's tests across CI shards by their recorded run time,
 * and on pull requests keeps only the tests the diff can reach.
 *
 *   bun scripts/ci-tests.ts shard --suite unit --shards 3 --index 0 [--timings t.json] [--base <sha>]
 *   bun scripts/ci-tests.ts run --suite unit --items '<json>'
 *   bun scripts/ci-tests.ts verify-shards --suite unit --shards 3
 *   bun scripts/ci-tests.ts recorded --timings .github/test-timings.json --out t.json [--run <id>]
 *   bun scripts/ci-tests.ts pick-timings
 *
 * The suites come from each workspace's own package.json: `unit` from its
 * `test` script and `integration` from its `test:integration` script, so a
 * test added there is sharded without touching CI.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";

export type Suite = "unit" | "integration";

/** One file bun runs, or one command we cannot split (vitest, wrappers). */
export type Item =
	| {
			kind: "file";
			pkg: string;
			file: string;
			/** The script command it came from; files of one command share a process. */
			run: string;
			flags: string[];
			env: Record<string, string>;
	  }
	| {
			kind: "command";
			pkg: string;
			command: string;
			env: Record<string, string>;
	  };

export type Timings = Record<string, number>;

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT_FOR: Record<Suite, string> = {
	unit: "test",
	integration: "test:integration",
};
const TEST_FILE =
	/(\.test|_test|\.spec|_spec)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".turbo", ".git"]);
const FLAGS_WITH_VALUE = new Set([
	"--preload",
	"--timeout",
	"--tsconfig-override",
	"--rerun-each",
	"--max-concurrency",
	"--test-name-pattern",
	"-t",
]);
// The order these packages ran in when integration was one job; a shard keeps
// it so a migration test never runs ahead of the API tests that shared its
// database before.
const INTEGRATION_ORDER = [
	"packages/repo-intelligence-source-github",
	"packages/sql-schema",
	"packages/cli-harness",
	"apps/desktop/server",
	"apps/cli",
	"packages/ch-schema",
];
// Agent setup outside the workspaces, which no test reads.
const AGENT_SETUP = /^\.(claude|agents)\//;

export function itemKey(item: Item): string {
	return item.kind === "file"
		? `${item.pkg}/${item.file}`
		: `${item.pkg}: ${item.command}`;
}

export function workspaceDirs(root = ROOT): string[] {
	const patterns: string[] = JSON.parse(
		readFileSync(join(root, "package.json"), "utf8"),
	).workspaces;
	const dirs: string[] = [];
	for (const pattern of patterns) {
		if (pattern.endsWith("/*")) {
			const parent = pattern.slice(0, -2);
			for (const entry of readdirSync(join(root, parent)).sort()) {
				if (existsSync(join(root, parent, entry, "package.json")))
					dirs.push(`${parent}/${entry}`);
			}
		} else if (existsSync(join(root, pattern, "package.json"))) {
			dirs.push(pattern);
		}
	}
	return dirs.sort();
}

function readPackage(root: string, dir: string) {
	return JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as {
		name: string;
		scripts?: Record<string, string>;
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
}

function walk(dir: string, visit: (path: string) => void) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIPPED_DIRS.has(entry.name)) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walk(path, visit);
		else visit(path);
	}
}

/** The files `bun test [filters]` discovers in a package, as bun matches them. */
function discoverTestFiles(pkgPath: string, filters: string[]): string[] {
	const files: string[] = [];
	walk(pkgPath, (path) => {
		const file = relative(pkgPath, path).split(sep).join("/");
		if (!TEST_FILE.test(file)) return;
		if (
			filters.length &&
			!filters.some((f) => file.includes(normalizeFilter(f)))
		)
			return;
		files.push(file);
	});
	return files.sort();
}

function normalizeFilter(filter: string) {
	return filter.replace(/^\.\//, "");
}

function tokenize(command: string): string[] {
	return (
		command
			.match(/'[^']*'|"[^"]*"|\S+/g)
			?.map((t) => t.replace(/^(['"])(.*)\1$/, "$2")) ?? []
	);
}

/** Expands one package script into the items it runs. */
export function scriptItems(
	root: string,
	pkg: string,
	scriptName: string,
	seen = new Set<string>(),
): Item[] {
	const scripts = readPackage(root, pkg).scripts ?? {};
	const script = scripts[scriptName];
	if (!script || seen.has(scriptName)) return [];
	seen.add(scriptName);
	const items: Item[] = [];
	for (const [index, part] of script
		.split("&&")
		.map((p) => p.trim())
		.entries()) {
		const tokens = tokenize(part);
		const env: Record<string, string> = {};
		while (tokens[0] && /^[A-Z_][A-Z0-9_]*=/.test(tokens[0])) {
			const [key, ...value] = (tokens.shift() as string).split("=");
			env[key as string] = value.join("=");
		}
		if (
			tokens[0] === "bun" &&
			tokens[1] === "run" &&
			tokens[2] &&
			scripts[tokens[2]] &&
			tokens.length === 3
		) {
			items.push(...scriptItems(root, pkg, tokens[2], seen));
			continue;
		}
		if (tokens[0] === "bun" && tokens[1] === "test") {
			const flags: string[] = [];
			const positional: string[] = [];
			for (let i = 2; i < tokens.length; i++) {
				const token = tokens[i] as string;
				if (token.startsWith("-")) {
					flags.push(token);
					if (FLAGS_WITH_VALUE.has(token) && tokens[i + 1] !== undefined)
						flags.push(tokens[++i] as string);
				} else positional.push(token);
			}
			// A path names a file, which must exist: `bun test` skips a missing
			// one quietly, and so would CI. Anything else is a name filter.
			const explicit = positional.some((p) => SOURCE_FILE.test(p));
			for (const p of explicit ? positional : [])
				if (!existsSync(join(root, pkg, p)))
					throw new Error(
						`${pkg}: the "${scriptName}" script names ${p}, which does not exist`,
					);
			const files = explicit
				? positional.map(normalizeFilter)
				: discoverTestFiles(join(root, pkg), positional);
			const run = `${scriptName}#${index}`;
			for (const file of files)
				items.push({ kind: "file", pkg, file, run, flags, env });
			continue;
		}
		items.push({ kind: "command", pkg, command: part, env });
	}
	// A file named by a later command (`bun run test:r2-memory`) runs once.
	const unique = new Map<string, Item>();
	for (const item of items) unique.set(itemKey(item), item);
	return [...unique.values()];
}

export function suiteItems(suite: Suite, root = ROOT): Item[] {
	return workspaceDirs(root).flatMap((pkg) =>
		scriptItems(root, pkg, SCRIPT_FOR[suite]),
	);
}

// A test file's own references reach only that test; any other file's
// references reach every test of its workspace.
const TEST_SOURCE =
	/(\.test|_test|\.spec|_spec|\.bun-test|\.integration)\.[cm]?[jt]sx?$/;
// Build output is never in a diff, so a reference to it reaches nothing.
const BUILD_OUTPUT = /(^|\/)dist(-[\w-]+)?(\/|$)/;

export interface Graph {
	dirs: string[];
	/** What each workspace's code reads: workspaces, or `/folder` at the root. */
	reads: Map<string, Set<string>>;
	/** What one test file reads beyond its workspace's own reads. */
	testReads: Map<string, Set<string>>;
}

export function readGraph(root = ROOT): Graph {
	const dirs = workspaceDirs(root);
	const byName = new Map(dirs.map((d) => [readPackage(root, d).name, d]));
	const reads = new Map<string, Set<string>>(dirs.map((d) => [d, new Set()]));
	const testReads = new Map<string, Set<string>>();
	const literal = /["'`](\.\.?\/[^"'`\s$]*)["'`]/g;
	for (const dir of dirs) {
		const pkg = readPackage(root, dir);
		for (const dep of Object.keys({
			...pkg.dependencies,
			...pkg.devDependencies,
		})) {
			const target = byName.get(dep);
			if (target) reads.get(dir)?.add(target);
		}
		const absDir = join(root, dir);
		walk(absDir, (path) => {
			if (!/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(path)) return;
			const source = readFileSync(path, "utf8");
			const relFile = relative(absDir, path).split(sep).join("/");
			const add = (read: string) => {
				if (read === dir) return;
				if (TEST_SOURCE.test(relFile)) {
					const key = `${dir}/${relFile}`;
					testReads.set(key, (testReads.get(key) ?? new Set()).add(read));
				} else reads.get(dir)?.add(read);
			};
			for (const match of source.matchAll(literal)) {
				const target = normalize(join(dirname(path), match[1] as string));
				if (target === absDir || target.startsWith(absDir + sep)) continue;
				const rel = relative(root, target).split(sep).join("/");
				if (!rel || rel.startsWith("..") || BUILD_OUTPUT.test(rel)) continue;
				add(ownerOf(rel, dirs) ?? `/${rel.split("/")[0]}`);
			}
		});
	}
	return { dirs, reads, testReads };
}

function ownerOf(path: string, dirs: string[]): string | undefined {
	return dirs
		.filter((d) => path === d || path.startsWith(`${d}/`))
		.sort((a, b) => b.length - a.length)[0];
}

export interface Reach {
	/** Workspaces every test of which can see the diff. */
	packages: Set<string>;
	/** Workspaces and `/folders` the diff changes, directly or through them. */
	changed: Set<string>;
}

/**
 * What a diff can reach, or `null` for everything. A change to a workspace
 * reaches it and every workspace that depends on it or reads it. Agent setup,
 * and Markdown in a folder (or a root file) no code names, reach nothing.
 * Every other change outside the workspaces reaches everything: code can
 * build a path to any of it (`join(root, "..", "plugin")`) where no scan
 * would see it.
 */
export function reach(changedFiles: string[], graph: Graph): Reach | null {
	const { dirs, reads } = graph;
	const read = new Set([
		...[...reads.values()].flatMap((r) => [...r]),
		...[...graph.testReads.values()].flatMap((r) => [...r]),
	]);
	const changed = new Set<string>();
	for (const file of changedFiles) {
		const owner = ownerOf(file, dirs);
		if (owner) changed.add(owner);
		else if (AGENT_SETUP.test(file)) continue;
		else if (file.endsWith(".md") && !read.has(`/${file.split("/")[0]}`))
			continue;
		else return null;
	}
	const packages = new Set<string>();
	const queue = [...changed];
	while (queue.length) {
		const target = queue.pop() as string;
		if (packages.has(target)) continue;
		if (!target.startsWith("/")) packages.add(target);
		for (const [reader, targets] of reads)
			if (targets.has(target) && !packages.has(reader)) queue.push(reader);
	}
	for (const p of packages) changed.add(p);
	return { packages, changed };
}

export function reaches(item: Item, scope: Reach | null, graph: Graph) {
	if (scope === null || scope.packages.has(item.pkg)) return true;
	// A command (vitest, a wrapper) runs files we cannot pick out, so it
	// sees what any test file of its workspace reads.
	const testReads = [...graph.testReads].filter(([key]) =>
		item.kind === "file"
			? key === itemKey(item)
			: key.startsWith(`${item.pkg}/`),
	);
	return testReads.some(([, reads]) =>
		[...reads].some((t) => scope.changed.has(t)),
	);
}

/** Longest-first greedy fill: each item goes to the least-loaded shard. */
export function planShards(
	items: Item[],
	shards: number,
	timings: Timings,
	root = ROOT,
): Item[][] {
	const known = items
		.map((i) => timings[itemKey(i)])
		.filter((t) => t !== undefined) as number[];
	const fallback = known.length ? median(known) : undefined;
	const estimate = (item: Item) =>
		timings[itemKey(item)] ??
		fallback ??
		(item.kind === "file"
			? statSync(join(root, item.pkg, item.file)).size / 2000
			: 30);
	const sorted = [...items].sort(
		(a, b) => estimate(b) - estimate(a) || itemKey(a).localeCompare(itemKey(b)),
	);
	const plan: { load: number; items: Item[] }[] = Array.from(
		{ length: shards },
		() => ({ load: 0, items: [] }),
	);
	for (const item of sorted) {
		const target = plan.reduce((min, s) => (s.load < min.load ? s : min));
		target.items.push(item);
		target.load += estimate(item);
	}
	return plan.map((s) => s.items);
}

function median(values: number[]) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] as number;
}

function packageOrder(pkg: string) {
	const index = INTEGRATION_ORDER.indexOf(pkg);
	return index === -1 ? INTEGRATION_ORDER.length : index;
}

function changedFiles(base: string): string[] {
	const result = spawnSync(
		"git",
		["diff", "--name-only", "--no-renames", `${base}...HEAD`],
		{
			cwd: ROOT,
			encoding: "utf8",
		},
	);
	if (result.status !== 0) throw new Error(`git diff failed: ${result.stderr}`);
	return result.stdout.split("\n").filter(Boolean);
}

const TIMINGS_MARKER = "ci-tests timings: ";
const PLAN_MARKER = "ci-tests plan: ";
const RAN_MARKER = "ci-tests ran: ";

/** What one shard planned, as it prints it for the gate. */
export interface PlanRecord {
	suite: Suite;
	index: number;
	hash: string;
	timings: string | null;
	plan: string[][];
}

export function planHash(plan: string[][]): string {
	return createHash("sha256")
		.update(JSON.stringify(plan))
		.digest("hex")
		.slice(0, 16);
}

/** Main saves the timings it recorded under this prefix and its run id. */
export const TIMINGS_CACHE_PREFIX = "ci-test-timings-";
// A cache main saved this long before a run was created is settled: every
// shard of that run lists it, whenever it starts.
const TIMINGS_SETTLE_MS = 5 * 60_000;

export interface CacheEntry {
	key: string;
	created_at: string;
}

export function pickTimingsCache(
	caches: CacheEntry[],
	runCreatedAt: string,
	settleMs = TIMINGS_SETTLE_MS,
): string | null {
	const cutoff = Date.parse(runCreatedAt) - settleMs;
	return (
		caches
			.filter(
				(c) =>
					c.key.startsWith(TIMINGS_CACHE_PREFIX) &&
					Date.parse(c.created_at) <= cutoff,
			)
			.sort(
				(a, b) =>
					Date.parse(b.created_at) - Date.parse(a.created_at) ||
					b.key.localeCompare(a.key),
			)[0]?.key ?? null
	);
}

export function shardIndex(suite: Suite, jobName: string): number | null {
	const match = jobName.match(new RegExp(`^${suite} \\((\\d+)\\)$`));
	return match ? Number(match[1]) : null;
}

function markedJson<T>(log: string, marker: string): T | null {
	const line = log.split("\n").find((l) => l.includes(marker));
	return line
		? (JSON.parse(line.slice(line.indexOf(marker) + marker.length)) as T)
		: null;
}

/**
 * Proves the shards of one suite agreed on a plan and together ran all of
 * it: every shard printed the same plan, and each one that had tests ran
 * exactly its slice. Throws with every disagreement it finds.
 */
export function verifyShards(
	suite: Suite,
	shards: number,
	logs: { name: string; log: string }[],
): string {
	const problems: string[] = [];
	const records = new Map<number, { plan: PlanRecord; ran: string[] | null }>();
	const seen = new Set<number>();
	for (const { name, log } of logs) {
		const index = shardIndex(suite, name) as number;
		seen.add(index);
		const plan = markedJson<PlanRecord>(log, PLAN_MARKER);
		if (!plan) {
			problems.push(`${name} printed no plan`);
			continue;
		}
		records.set(index, { plan, ran: markedJson<string[]>(log, RAN_MARKER) });
	}
	for (let index = 0; index < shards; index++)
		if (!seen.has(index)) problems.push(`${suite} (${index}) did not run`);
	const hashes = new Set([...records.values()].map((r) => r.plan.hash));
	if (hashes.size > 1)
		problems.push(
			`the shards planned differently: ${[...records].map(([i, r]) => `${i}=${r.plan.hash} (timings ${r.plan.timings ?? "snapshot"})`).join(", ")}`,
		);
	let planned = 0;
	for (const [index, { plan, ran }] of records) {
		const slice = plan.plan[index] ?? [];
		planned += slice.length;
		if (!slice.length) continue;
		const ranSet = new Set(ran ?? []);
		const missing = slice.filter((k) => !ranSet.has(k));
		const extra = [...ranSet].filter((k) => !slice.includes(k));
		if (!ran) problems.push(`${suite} (${index}) planned ${slice.length} tests and ran none`);
		else if (missing.length || extra.length)
			problems.push(
				`${suite} (${index}) ran other tests than it planned: missing ${missing.join(", ") || "none"}; extra ${extra.join(", ") || "none"}`,
			);
	}
	if (problems.length) throw new Error(problems.join("\n"));
	return `${suite}: ${shards} shards agreed on plan ${[...hashes][0]} and ran all ${planned} planned tests`;
}

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set`);
	return value;
}

/**
 * A job's log. Not through gh: it refuses a body with terminal escape
 * sequences, which every colored test log has. curl follows the redirect to
 * the log's storage without passing the token on to that host.
 */
function jobLog(repo: string, jobId: string, strict: boolean): string | null {
	const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
	const timeout = strict
		? 60_000
		: Math.min(recordedDeadline - Date.now(), 20_000);
	if (!token || timeout <= 0) {
		if (strict) throw new Error("no token to read job logs with");
		return null;
	}
	const result = spawnSync(
		"curl",
		[
			"--fail",
			"--silent",
			"--show-error",
			"--location",
			"--header",
			`Authorization: Bearer ${token}`,
			"--header",
			"Accept: application/vnd.github+json",
			`https://api.github.com/repos/${repo}/actions/jobs/${jobId}/logs`,
		],
		{ encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout },
	);
	if (result.status === 0) return result.stdout;
	if (strict)
		throw new Error(`reading the log of job ${jobId} failed: ${result.stderr}`);
	return null;
}

/** A GitHub API call the result depends on: a failure fails the job. */
function strictGh(args: string[]): string {
	const result = spawnSync("gh", args, {
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		timeout: 60_000,
	});
	if (result.status !== 0)
		throw new Error(`gh ${args.join(" ")} failed: ${result.stderr}`);
	return result.stdout;
}

// Reading old logs may take this long in all, and one call 20s, before the
// plan settles for the times it has.
const RECORDED_BUDGET_MS = 60_000;
let recordedDeadline = 0;

function gh(args: string[]): string | null {
	const left = recordedDeadline - Date.now();
	if (left <= 0) return null;
	const result = spawnSync("gh", args, {
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		timeout: Math.min(left, 20_000),
	});
	return result.status === 0 ? result.stdout : null;
}

/**
 * The times recorded by the last passing runs of CI on main, read back from
 * the shard job logs, laid over the committed snapshot (newest wins). Any API
 * failure leaves the snapshot: a worse split, never a failed plan.
 */
export function recordedTimings(
	fallback: Timings,
	runs = 3,
	currentRun?: string,
): Timings {
	const repo = process.env.GITHUB_REPOSITORY;
	if (!repo) return fallback;
	recordedDeadline = Date.now() + RECORDED_BUDGET_MS;
	const ids =
		gh([
			"api",
			`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=${runs}`,
			"--jq",
			".workflow_runs[].id",
		])
			?.split("\n")
			.filter(Boolean) ?? [];
	// The run recording them is still going, so it is not among the passing
	// runs yet; its finished shards are the newest times.
	if (currentRun) ids.unshift(currentRun);
	const merged: Timings = { ...fallback };
	for (const runId of ids.reverse()) {
		const jobs =
			gh([
				"api",
				`repos/${repo}/actions/runs/${runId}/jobs?per_page=100`,
				"--jq",
				'.jobs[] | select(.conclusion == "success") | select(.name | test("^(unit|integration) \\(")) | .id',
			])
				?.split("\n")
				.filter(Boolean) ?? [];
		for (const jobId of jobs) {
			const log = jobLog(repo, jobId, false);
			const line = log?.split("\n").find((l) => l.includes(TIMINGS_MARKER));
			if (!line) continue;
			try {
				Object.assign(
					merged,
					JSON.parse(
						line.slice(line.indexOf(TIMINGS_MARKER) + TIMINGS_MARKER.length),
					),
				);
			} catch {}
		}
	}
	return merged;
}

function readTimings(path: string | undefined): Timings {
	if (!path || !existsSync(path)) return {};
	return JSON.parse(readFileSync(path, "utf8"));
}

function bunTestArgs(
	item: Extract<Item, { kind: "file" }>,
	files: string[],
	extra: string[],
) {
	return [
		process.execPath,
		"test",
		...item.flags,
		...extra,
		...files.map((f) => `./${f}`),
	];
}

/** Runs a shard's items; returns per-item seconds and the keys that failed. */
function runItems(suite: Suite, items: Item[]) {
	const timings: Timings = {};
	const failed: string[] = [];
	const ordered =
		suite === "integration"
			? [...items].sort(
					(a, b) =>
						packageOrder(a.pkg) - packageOrder(b.pkg) ||
						itemKey(a).localeCompare(itemKey(b)),
				)
			: items;
	const env = (item: Item) => ({
		...process.env,
		...item.env,
		PATH: [
			join(ROOT, item.pkg, "node_modules", ".bin"),
			join(ROOT, "node_modules", ".bin"),
			process.env.PATH,
		].join(":"),
	});
	const timed = (label: string, run: () => number) => {
		console.log(`\n::group::${label}`);
		const start = performance.now();
		const status = run();
		const seconds = (performance.now() - start) / 1000;
		console.log("::endgroup::");
		if (status !== 0) console.log(`::error::${label} failed (exit ${status})`);
		return { status, seconds };
	};

	// Integration files share one database per shard, so each runs alone in
	// its own process: its wall time is exact and no heap carries over.
	// Unit files of one package run together, as `bun test` would run them.
	const groups = new Map<string, Item[]>();
	for (const item of ordered) {
		const key =
			item.kind === "command" || suite === "integration"
				? itemKey(item)
				: `${item.pkg}\0${item.run}`;
		groups.set(key, [...(groups.get(key) ?? []), item]);
	}

	const junitDir = join(ROOT, ".tmp", "ci-tests-junit");
	for (const group of groups.values()) {
		const first = group[0] as Item;
		const cwd = join(ROOT, first.pkg);
		if (first.kind === "command") {
			const { status, seconds } = timed(
				itemKey(first),
				() =>
					spawnSync("sh", ["-c", first.command], {
						cwd,
						env: env(first),
						stdio: "inherit",
					}).status ?? 1,
			);
			timings[itemKey(first)] = seconds;
			if (status !== 0) failed.push(itemKey(first));
			continue;
		}
		const files = group.map((i) => (i as Extract<Item, { kind: "file" }>).file);
		if (group.length === 1) {
			const { status, seconds } = timed(
				itemKey(first),
				() =>
					spawnSync(
						bunTestArgs(first, files, [])[0] as string,
						bunTestArgs(first, files, []).slice(1),
						{ cwd, env: env(first), stdio: "inherit" },
					).status ?? 1,
			);
			timings[itemKey(first)] = seconds;
			if (status !== 0) failed.push(itemKey(first));
			continue;
		}
		rmSync(junitDir, { recursive: true, force: true });
		mkdirSync(junitDir, { recursive: true });
		const junit = join(junitDir, "report.xml");
		// The JUnit file only carries the times; failures still print in full.
		const args = bunTestArgs(first, files, [
			"--reporter=junit",
			`--reporter-outfile=${junit}`,
		]);
		const label = `${first.pkg} (${files.length} files)`;
		const { status, seconds } = timed(
			label,
			() =>
				spawnSync(args[0] as string, args.slice(1), {
					cwd,
					env: env(first),
					stdio: "inherit",
				}).status ?? 1,
		);
		const perFile = existsSync(junit)
			? junitSuiteTimes(readFileSync(junit, "utf8"))
			: {};
		const measured = files.reduce((sum, f) => sum + (perFile[f] ?? 0), 0);
		// Imports and hooks outside the tests are spread evenly over the files.
		const overhead = Math.max(0, seconds - measured) / files.length;
		for (const file of files)
			timings[`${first.pkg}/${file}`] = (perFile[file] ?? 0) + overhead;
		if (status !== 0) failed.push(label);
	}
	return { timings, failed };
}

export function junitSuiteTimes(xml: string): Timings {
	const times: Timings = {};
	for (const match of xml.matchAll(/<testsuite\b[^>]*>/g)) {
		const file = match[0].match(/\bfile="([^"]*)"/)?.[1];
		const time = match[0].match(/\btime="([^"]*)"/)?.[1];
		if (file && time)
			times[file.replace(/^\.\//, "")] = (times[file] ?? 0) + Number(time);
	}
	return times;
}

function parseArgs(argv: string[]) {
	const options: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] as string;
		if (arg.startsWith("--")) options[arg.slice(2)] = argv[++i] ?? "";
	}
	return options;
}

function output(name: string, value: string) {
	console.log(`${name}=${value}`);
	if (process.env.GITHUB_OUTPUT)
		writeFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, {
			flag: "a",
		});
}

function main() {
	const [command, ...argv] = process.argv.slice(2);
	const options = parseArgs(argv);
	const suite = options.suite as Suite;

	if (command === "shard") {
		// `shard --suite unit --shards 3 --index 0 --timings t.json
		//  [--timings-key k] [--base sha] [--skip true]`
		// Every shard plans the whole suite from the same inputs and keeps
		// its own slice; the plan line lets the gate prove they agreed.
		const shards = Number(options.shards);
		const index = Number(options.index);
		const graph = readGraph();
		const scope = options.base
			? reach(changedFiles(options.base), graph)
			: null;
		const all = suiteItems(suite);
		const items =
			options.skip === "true"
				? []
				: all.filter((i) => reaches(i, scope, graph));
		const plan = planShards(items, shards, readTimings(options.timings)).map(
			(s) => s.map(itemKey),
		);
		console.error(
			options.skip === "true"
				? `${suite}: no changed file reaches this suite`
				: scope === null
					? `${suite}: all ${items.length} tests in ${shards} shards`
					: `${suite}: ${items.length} of ${all.length} tests reachable from ${[...scope.changed].join(", ") || "nothing"}, in ${shards} shards`,
		);
		const record: PlanRecord = {
			suite,
			index,
			hash: planHash(plan),
			timings: options["timings-key"] || null,
			plan,
		};
		console.log(`${PLAN_MARKER}${JSON.stringify(record)}`);
		const mine = plan[index] ?? [];
		output("items", JSON.stringify(mine));
		output("empty", String(mine.length === 0));
		return;
	}

	if (command === "pick-timings") {
		// The newest timings main saved well before this run began, so every
		// shard of the run, and every re-run of it, plans from the same file.
		const repo = requiredEnv("GITHUB_REPOSITORY");
		const created = strictGh([
			"api",
			`repos/${repo}/actions/runs/${requiredEnv("GITHUB_RUN_ID")}`,
			"--jq",
			".created_at",
		]).trim();
		const caches = JSON.parse(
			strictGh([
				"api",
				`repos/${repo}/actions/caches?ref=refs/heads/main&key=${TIMINGS_CACHE_PREFIX}&sort=created_at&direction=desc&per_page=100`,
				"--jq",
				"[.actions_caches[] | {key, created_at}]",
			]),
		) as CacheEntry[];
		const key = pickTimingsCache(caches, created);
		console.error(
			key
				? `planning from ${key}`
				: "no recorded timings yet; planning from the committed snapshot",
		);
		output("key", key ?? "");
		return;
	}

	if (command === "verify-shards") {
		// `verify-shards --suite unit --shards 3`, in the job that gates them.
		const repo = requiredEnv("GITHUB_REPOSITORY");
		const jobs = JSON.parse(
			strictGh([
				"api",
				`repos/${repo}/actions/runs/${requiredEnv("GITHUB_RUN_ID")}/attempts/${requiredEnv("GITHUB_RUN_ATTEMPT")}/jobs?per_page=100`,
				"--jq",
				"[.jobs[] | {id, name}]",
			]),
		) as { id: number; name: string }[];
		const logs = jobs
			.filter((j) => shardIndex(suite, j.name) !== null)
			.map((j) => ({
				name: j.name,
				log: jobLog(repo, String(j.id), true) as string,
			}));
		console.log(verifyShards(suite, Number(options.shards), logs));
		return;
	}

	if (command === "recorded") {
		// `recorded --timings .github/test-timings.json --out .tmp/t.json`
		// Tests that no longer exist are dropped, so this also refreshes the
		// snapshot: `GITHUB_REPOSITORY=owner/repo bun scripts/ci-tests.ts
		// recorded --timings .github/test-timings.json --out .github/test-timings.json`
		const current = new Set(
			[...suiteItems("unit"), ...suiteItems("integration")].map(itemKey),
		);
		const timings = Object.fromEntries(
			Object.entries(
				recordedTimings(readTimings(options.timings), 3, options.run),
			)
				.filter(([key]) => current.has(key))
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, seconds]) => [key, Math.round(seconds * 100) / 100]),
		);
		mkdirSync(dirname(options.out as string), { recursive: true });
		writeFileSync(
			options.out as string,
			`${JSON.stringify(timings, null, "\t")}\n`,
		);
		console.error(`${Object.keys(timings).length} recorded test times`);
		return;
	}

	if (command === "reaches") {
		// `reaches --name cli --packages apps/cli,packages/opaline [--base sha]`
		const scope = options.base
			? reach(changedFiles(options.base), readGraph())
			: null;
		const packages = (options.packages as string).split(",");
		output(
			options.name as string,
			String(scope === null || packages.some((p) => scope.packages.has(p))),
		);
		return;
	}

	if (command === "run") {
		const keys = new Set<string>(JSON.parse(options.items as string));
		const items = suiteItems(suite).filter((i) => keys.has(itemKey(i)));
		const missing = [...keys].filter(
			(k) => !items.some((i) => itemKey(i) === k),
		);
		if (missing.length)
			throw new Error(`Unknown test items: ${missing.join(", ")}`);
		const { timings, failed } = runItems(suite, items);
		// The next plan reads this line back from the job log (`recorded`).
		console.log(`${TIMINGS_MARKER}${JSON.stringify(timings)}`);
		// The gate checks this against the shard's slice of the plan.
		console.log(`${RAN_MARKER}${JSON.stringify(items.map(itemKey))}`);
		if (failed.length) {
			console.error(`\n${failed.length} failed:\n  ${failed.join("\n  ")}`);
			process.exit(1);
		}
		return;
	}

	throw new Error(`Unknown command: ${command}`);
}

if (import.meta.main) main();
