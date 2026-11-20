import { describe, expect, test } from "bun:test";
import {
	type Item,
	itemKey,
	junitSuiteTimes,
	planShards,
	reach,
	reaches,
	scriptItems,
	suiteItems,
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
			["apps/server", new Set(["packages/routes", "/plugin"])],
			["apps/ui", new Set(["packages/routes"])],
			["packages/routes", new Set(["/docs"])],
		]),
		testReads: new Map([
			["apps/server/src/links.test.ts", new Set(["apps/ui"])],
		]),
	};
	const reached = (changed: string[]) => {
		const scope = reach(changed, graph);
		return scope && [...scope.packages].sort();
	};

	test("a package change reaches the package and everything that reads it", () => {
		expect(reached(["packages/routes/src/a.ts"])).toEqual([
			"apps/server",
			"apps/ui",
			"packages/routes",
		]);
		expect(reached(["docs/facts.md"])).toEqual([
			"apps/server",
			"apps/ui",
			"packages/routes",
		]);
	});

	test("a test file's own reference reaches that test, not its package", () => {
		const scope = reach(["apps/ui/src/a.tsx"], graph);
		expect(scope?.packages).toEqual(new Set(["apps/ui"]));
		expect(
			reaches(file("apps/server", "src/links.test.ts"), scope, graph),
		).toBe(true);
		expect(
			reaches(file("apps/server", "src/other.test.ts"), scope, graph),
		).toBe(false);
	});

	test("Markdown and agent setup reach nothing; root files and unread folders reach everything", () => {
		expect(reached(["README.md", ".claude/x.json"])).toEqual([]);
		expect(reached(["bun.lock"])).toBeNull();
		expect(reached([".github/workflows/ci.yml"])).toBeNull();
		expect(reached(["scripts/build.ts"])).toBeNull();
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

test("JUnit suite times are keyed by the file bun ran", () => {
	const xml = `<testsuites><testsuite name="a.test.ts" file="src/a.test.ts" time="1.5"><testcase time="1.5"/></testsuite><testsuite name="b" file="src/b.test.ts" time="0.25"/></testsuites>`;
	expect(junitSuiteTimes(xml)).toEqual({
		"src/a.test.ts": 1.5,
		"src/b.test.ts": 0.25,
	});
});
