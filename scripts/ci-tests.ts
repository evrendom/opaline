/**
 * Splits the repository's tests across CI shards by their recorded run time,
 * and on pull requests keeps only the tests the diff can reach.
 *
 *   bun scripts/ci-tests.ts plan --suite unit --shards 3 [--timings t.json] [--base <sha>]
 *   bun scripts/ci-tests.ts run --suite unit --items '<json>'
 *   bun scripts/ci-tests.ts recorded --timings .github/test-timings.json --out t.json
 *
 * The suites come from each workspace's own package.json: `unit` from its
 * `test` script and `integration` from its `test:integration` script, so a
 * test added there is sharded without touching CI.
 */
import { spawnSync } from "node:child_process";
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
// Files outside every workspace that no test reads: changing only these runs
// no tests. Every other file outside a workspace runs everything.
const INERT_OUTSIDE_WORKSPACES = [/\.md$/, /^\.claude\//, /^\.agents\//];

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
			const explicit =
				positional.length > 0 &&
				positional.every(
					(p) => TEST_FILE.test(p) || /\.(ts|tsx|js)$/.test(p),
				) &&
				positional.every((p) => existsSync(join(root, pkg, p)));
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
			for (const match of source.matchAll(literal)) {
				const target = normalize(join(dirname(path), match[1] as string));
				if (target === absDir || target.startsWith(absDir + sep)) continue;
				const rel = relative(root, target).split(sep).join("/");
				if (!rel || rel.startsWith("..") || BUILD_OUTPUT.test(rel)) continue;
				const read = ownerOf(rel, dirs) ?? `/${rel.split("/")[0]}`;
				if (TEST_SOURCE.test(relFile)) {
					const key = `${dir}/${relFile}`;
					testReads.set(key, (testReads.get(key) ?? new Set()).add(read));
				} else reads.get(dir)?.add(read);
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
 * reaches it and every workspace that depends on it or reads it; a change to
 * a top-level folder reaches the workspaces that read that folder; anything
 * else (root config, the lockfile, CI, scripts) reaches everything.
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
		const folder = file.includes("/") ? `/${file.split("/")[0]}` : null;
		if (owner) changed.add(owner);
		else if (folder && read.has(folder)) changed.add(folder);
		else if (INERT_OUTSIDE_WORKSPACES.some((re) => re.test(file))) continue;
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
	if (item.kind !== "file") return false;
	const testReads = graph.testReads.get(itemKey(item));
	return [...(testReads ?? [])].some((t) => scope.changed.has(t));
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
	const result = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], {
		cwd: ROOT,
		encoding: "utf8",
	});
	if (result.status !== 0) throw new Error(`git diff failed: ${result.stderr}`);
	return result.stdout.split("\n").filter(Boolean);
}

const TIMINGS_MARKER = "ci-tests timings: ";

function gh(args: string[]): string | null {
	const result = spawnSync("gh", args, {
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
	});
	return result.status === 0 ? result.stdout : null;
}

/**
 * The times recorded by the last passing runs of CI on main, read back from
 * the shard job logs, laid over the committed snapshot (newest wins). Any API
 * failure leaves the snapshot: a worse split, never a failed plan.
 */
export function recordedTimings(fallback: Timings, runs = 3): Timings {
	const repo = process.env.GITHUB_REPOSITORY;
	if (!repo) return fallback;
	const ids =
		gh([
			"api",
			`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=${runs}`,
			"--jq",
			".workflow_runs[].id",
		])
			?.split("\n")
			.filter(Boolean) ?? [];
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
			const log = gh(["api", `repos/${repo}/actions/jobs/${jobId}/logs`]);
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

	if (command === "plan") {
		const shards = Number(options.shards);
		const graph = readGraph();
		const scope = options.base
			? reach(changedFiles(options.base), graph)
			: null;
		const all = suiteItems(suite);
		const items = all.filter((i) => reaches(i, scope, graph));
		const plan = planShards(items, shards, readTimings(options.timings))
			.map((s) => s.map(itemKey))
			.filter((s) => s.length);
		console.error(
			scope === null
				? `${suite}: all ${items.length} tests in ${plan.length} shards`
				: `${suite}: ${items.length} of ${all.length} tests reachable from ${[...scope.changed].join(", ") || "nothing"}, in ${plan.length} shards`,
		);
		output(`${suite}_plan`, JSON.stringify(plan));
		output(`${suite}_shards`, JSON.stringify(plan.map((_, i) => i)));
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
			Object.entries(recordedTimings(readTimings(options.timings)))
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
		if (failed.length) {
			console.error(`\n${failed.length} failed:\n  ${failed.join("\n  ")}`);
			process.exit(1);
		}
		return;
	}

	throw new Error(`Unknown command: ${command}`);
}

if (import.meta.main) main();
