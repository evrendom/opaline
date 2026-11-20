import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Item,
	itemKey,
	junitSuiteTimes,
	type PlanRecord,
	pickTimingsCache,
	planHash,
	planShards,
	reach,
	reaches,
	scriptItems,
	suiteItems,
	verifyShards,
} from "./ci-tests";

const ROOT = `${import.meta.dirname}/..`;

const file = (pkg: string, name: string): Item => ({
	kind: "file",
	pkg,
	file: name,
	run: "test#0",
	flags: [],
	env: {},
});

describe("planShards", () => {
	test("fills the least-loaded shard longest first, so shards finish together", () => {
		const items = ["a", "b", "c", "d"].map((n) => file("p", n));
		const timings = { "p/a": 4, "p/b": 3, "p/c": 3, "p/d": 2 };
		const loads = planShards(items, 2, timings, ROOT).map((s) =>
			s.reduce(
				(sum, i) => sum + timings[itemKey(i) as keyof typeof timings],
				0,
			),
		);
		expect(loads).toEqual([6, 6]);
	});
});

describe("reach", () => {
	const graph = {
		dirs: ["apps/server", "apps/ui", "packages/routes"],
		reads: new Map([
			["apps/server", new Set(["packages/routes"])],
			["apps/ui", new Set(["packages/routes"])],
			["packages/routes", new Set<string>()],
		]),
		testReads: new Map([
			["apps/server/src/links.test.ts", new Set(["apps/ui"])],
			["apps/ui/src/server-links.test.ts", new Set(["apps/server", "/docs"])],
		]),
	};
	const reached = (changed: string[]) => {
		const scope = reach(changed, graph);
		return scope && [...scope.packages].sort();
	};
	const command: Item = {
		kind: "command",
		pkg: "apps/ui",
		command: "vitest run",
		env: {},
	};

	test("a package change reaches the package and everything that depends on it", () => {
		expect(reached(["packages/routes/src/a.ts"])).toEqual([
			"apps/server",
			"apps/ui",
			"packages/routes",
		]);
	});

	test("a test file's own reference reaches that test, or the command that runs it", () => {
		const ui = reach(["apps/ui/src/a.tsx"], graph);
		expect(ui?.packages).toEqual(new Set(["apps/ui"]));
		expect(reaches(file("apps/server", "src/links.test.ts"), ui, graph)).toBe(
			true,
		);
		expect(reaches(file("apps/server", "src/other.test.ts"), ui, graph)).toBe(
			false,
		);
		expect(
			reaches(command, reach(["apps/server/src/a.ts"], graph), graph),
		).toBe(true);
	});

	test("outside the workspaces only agent setup and unnamed Markdown are free", () => {
		expect(reached(["README.md", ".claude/x.json", "notes/x.md"])).toEqual([]);
		expect(reached(["docs/facts.md"])).toBeNull();
		expect(reached(["plugin/.claude-plugin/plugin.json"])).toBeNull();
		expect(reached(["bun.lock"])).toBeNull();
		expect(reached([".github/workflows/ci.yml"])).toBeNull();
	});
});

test("the CLI's test script expands into its files plus the two scripts it chains", () => {
	const items = scriptItems(ROOT, "apps/cli", "test");
	const runs = new Set(
		items.map((i) => (i.kind === "file" ? i.run : i.command)),
	);
	expect(runs).toEqual(
		new Set(["test#0", "test:r2-memory#0", "test:sidecar-faults#0"]),
	);
	expect(items.map(itemKey)).toContain(
		"apps/cli/src/__tests__/r2-multipart-memory.integration.ts",
	);
	expect(suiteItems("integration", ROOT).every((i) => i.kind === "file")).toBe(
		true,
	);
});

test("a vitest run becomes slices that vitest itself splits, so each lands on any shard", () => {
	const root = mkdtempSync(join(tmpdir(), "ci-tests-"));
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({ workspaces: ["ui"] }),
	);
	mkdirSync(join(root, "ui"));
	writeFileSync(
		join(root, "ui", "package.json"),
		JSON.stringify({
			name: "ui",
			scripts: { test: "vitest run && vitest run --shard=1/2" },
		}),
	);
	expect(suiteItems("unit", root).map(itemKey)).toEqual([
		"ui: vitest run --shard=1/4",
		"ui: vitest run --shard=2/4",
		"ui: vitest run --shard=3/4",
		"ui: vitest run --shard=4/4",
		"ui: vitest run --shard=1/2",
	]);
});

test("JUnit suite times are keyed by the file bun ran", () => {
	const xml = `<testsuites><testsuite name="a.test.ts" file="src/a.test.ts" time="1.5"><testcase time="1.5"/></testsuite><testsuite name="b" file="src/b.test.ts" time="0.25"/></testsuites>`;
	expect(junitSuiteTimes(xml)).toEqual({
		"src/a.test.ts": 1.5,
		"src/b.test.ts": 0.25,
	});
});

test("a test script naming a missing file fails the plan instead of skipping it", () => {
	const root = mkdtempSync(join(tmpdir(), "ci-tests-"));
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({ workspaces: ["pkg"] }),
	);
	mkdirSync(join(root, "pkg"));
	writeFileSync(join(root, "pkg", "a.integration.ts"), "");
	writeFileSync(
		join(root, "pkg", "package.json"),
		JSON.stringify({
			name: "pkg",
			scripts: {
				"test:integration": "bun test ./a.integration.ts ./gone.integration.ts",
			},
		}),
	);
	expect(() => suiteItems("integration", root)).toThrow("gone.integration.ts");
});

describe("pickTimingsCache", () => {
	const caches = [
		{ key: "ci-test-timings-3", created_at: "2026-11-20T12:58:00Z" },
		{ key: "ci-test-timings-2", created_at: "2026-11-20T12:50:00Z" },
		{ key: "ci-test-timings-1", created_at: "2026-11-20T12:00:00Z" },
		{ key: "Linux-bun-store-x", created_at: "2026-11-20T12:59:00Z" },
	];

	test("takes the newest timings saved at least five minutes before the run", () => {
		expect(pickTimingsCache(caches, "2026-11-20T13:00:00Z")).toBe(
			"ci-test-timings-2",
		);
	});

	test("a run before any settled timings plans from the snapshot", () => {
		expect(pickTimingsCache(caches, "2026-11-20T12:04:59Z")).toBeNull();
	});
});

describe("verifyShards", () => {
	const plan = [["a", "b"], ["c"], []];
	const log = (index: number, ran: string[] | null, p = plan) => {
		const record: PlanRecord = {
			suite: "unit",
			index,
			hash: planHash(p),
			timings: null,
			plan: p,
		};
		return {
			name: `unit (${index})`,
			log: [
				`2026-11-20T13:00:00Z ci-tests plan: ${JSON.stringify(record)}`,
				ran ? `2026-11-20T13:00:09Z ci-tests ran: ${JSON.stringify(ran)}` : "",
			].join("\n"),
		};
	};

	test("passes when every shard planned the same and ran its slice", () => {
		expect(
			verifyShards("unit", 3, [log(0, ["b", "a"]), log(1, ["c"]), log(2, null)]),
		).toContain("ran all 3 planned tests");
	});

	test("fails when shards planned differently, even if each ran its own slice", () => {
		const other = [["a"], ["b", "c"], []];
		expect(() =>
			verifyShards("unit", 3, [
				log(0, ["a", "b"]),
				log(1, ["b", "c"], other),
				log(2, null),
			]),
		).toThrow("planned differently");
	});

	test("fails when a shard skipped, added or never ran its tests", () => {
		expect(() =>
			verifyShards("unit", 3, [log(0, ["a"]), log(1, ["c"]), log(2, null)]),
		).toThrow("missing b");
		expect(() =>
			verifyShards("unit", 3, [log(0, ["a", "b", "d"]), log(1, ["c"]), log(2, null)]),
		).toThrow("extra d");
		expect(() =>
			verifyShards("unit", 3, [log(0, ["a", "b"]), log(1, null), log(2, null)]),
		).toThrow("planned 1 tests and ran none");
		expect(() =>
			verifyShards("unit", 3, [log(0, ["a", "b"]), log(1, ["c"])]),
		).toThrow("unit (2) did not run");
	});
});
