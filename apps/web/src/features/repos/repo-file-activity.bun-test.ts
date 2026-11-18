import { describe, expect, test } from "bun:test";
import type { RepositoryTreeEntry } from "@rudel/api-routes";
import { matchRepoFileActivity, repoTreeItems } from "./repo-file-activity";

const file = (path: string): RepositoryTreeEntry => ({
	path,
	type: "file",
	size: 1,
});
const entries = [
	{ path: "apps", type: "dir", size: null },
	file("package.json"),
	file("apps/web/package.json"),
	file("apps/web/src/a.tsx"),
	file("apps/web/src/b.tsx"),
	file("apps/api/src/b.tsx"),
] satisfies RepositoryTreeEntry[];
const touch = (
	path: string,
	sessions = 1,
	changes = 0,
	reads = 1,
	added = false,
) => ({
	path,
	reads,
	changes,
	sessions,
	added,
	lastAt: `2026-11-0${sessions}T00:00:00.000Z`,
});

describe("matchRepoFileActivity", () => {
	test("a repo-relative path lands on its file", () => {
		const files = matchRepoFileActivity(entries, [touch("package.json")]);
		expect([...files.keys()]).toEqual(["package.json"]);
	});

	test("an absolute path under another root lands on the tree path it ends with", () => {
		const files = matchRepoFileActivity(entries, [
			touch("/Users/x/opaline/athena/apps/web/src/a.tsx"),
		]);
		expect([...files.keys()]).toEqual(["apps/web/src/a.tsx"]);
	});

	test("a path relative to a subdirectory lands only when one file ends with it", () => {
		const files = matchRepoFileActivity(entries, [
			touch("src/a.tsx"),
			touch("src/b.tsx"),
			touch("web/src/b.tsx"),
		]);
		expect([...files.keys()].sort()).toEqual([
			"apps/web/src/a.tsx",
			"apps/web/src/b.tsx",
		]);
	});

	test("paths outside the tree are left out", () => {
		const files = matchRepoFileActivity(entries, [
			touch("/Users/x/.claude/memory/notes.md"),
			touch("~/notes.md"),
			touch("../other/package.json"),
		]);
		expect(files.size).toBe(0);
	});

	test("two spellings of one file add their calls and keep the larger session count", () => {
		const files = matchRepoFileActivity(entries, [
			touch("apps/web/src/a.tsx", 3, 2, 4),
			touch("/w/apps/web/src/a.tsx", 2, 1, 1),
		]);
		expect(files.get("apps/web/src/a.tsx")).toEqual({
			reads: 5,
			changes: 3,
			sessions: 3,
			added: false,
			lastAt: "2026-11-03T00:00:00.000Z",
			paths: ["apps/web/src/a.tsx", "/w/apps/web/src/a.tsx"],
		});
	});

	test("the tree lists created files as added, other changed ones as modified, read ones as read", () => {
		const files = matchRepoFileActivity(entries, [
			touch("apps/web/src/a.tsx", 1, 3),
			touch("apps/api/src/b.tsx", 4, 1, 0, true),
			touch("package.json", 2, 0),
		]);
		expect(repoTreeItems(files, "all")).toEqual([
			{ path: "apps/web/src/a.tsx", status: "modified" },
			{ path: "apps/api/src/b.tsx", status: "added" },
			{ path: "package.json", status: "read" },
		]);
		expect(repoTreeItems(files, "changed").map((item) => item.path)).toEqual([
			"apps/web/src/a.tsx",
			"apps/api/src/b.tsx",
		]);
		expect(repoTreeItems(files, "read").map((item) => item.path)).toEqual([
			"package.json",
		]);
	});
});
