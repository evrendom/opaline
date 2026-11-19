import { describe, expect, test } from "bun:test";
import {
	type DemoRepositorySnapshot,
	demoRepositoryFilesDependencies,
} from "./demo-repository-files.js";
import {
	listRepositoryFiles,
	readRepositoryFile,
} from "./repository-files.service.js";

const COMMIT = "a".repeat(40);
const SNAPSHOT: DemoRepositorySnapshot = {
	version: 1,
	repositories: [
		{
			owner: "acme",
			name: "loomrail",
			defaultBranch: "main",
			commitSha: COMMIT,
			files: {
				"README.md": "# Loomrail\n",
				"apps/api/src/bookings.ts": "export const slots = 3;\n",
				".env": "TOKEN=example\n",
			},
		},
	],
};
const deps = () => demoRepositoryFilesDependencies(async () => SNAPSHOT);
const input = {
	organizationId: "demo",
	repoKey: "remote:github.com/acme/loomrail",
};

describe("demo repository files", () => {
	test("lists the snapshot's tree at its commit, directories included", async () => {
		expect(await listRepositoryFiles(input, deps())).toEqual({
			status: "available",
			repository: {
				owner: "acme",
				name: "loomrail",
				branch: "main",
				commitSha: COMMIT,
			},
			entries: [
				{ path: ".env", type: "file", size: 14 },
				{ path: "README.md", type: "file", size: 11 },
				{ path: "apps", type: "dir", size: null },
				{ path: "apps/api", type: "dir", size: null },
				{ path: "apps/api/src", type: "dir", size: null },
				{ path: "apps/api/src/bookings.ts", type: "file", size: 24 },
			],
			truncated: false,
		});
	});

	test("reads a file as text and withholds credential files like GitHub reads", async () => {
		expect(
			await readRepositoryFile(
				{ ...input, path: "apps/api/src/bookings.ts", commitSha: COMMIT },
				deps(),
			),
		).toEqual({
			status: "text",
			path: "apps/api/src/bookings.ts",
			size: 24,
			content: "export const slots = 3;\n",
		});
		expect(
			await readRepositoryFile(
				{ ...input, path: ".env", commitSha: COMMIT },
				deps(),
			),
		).toEqual({ status: "withheld", path: ".env", size: null });
	});

	test("a path or commit outside the snapshot is unreachable, another repo is not connected", async () => {
		expect(
			await readRepositoryFile(
				{ ...input, path: "missing.ts", commitSha: COMMIT },
				deps(),
			),
		).toEqual({ status: "unavailable", reason: "unreachable" });
		expect(
			await readRepositoryFile(
				{ ...input, path: "README.md", commitSha: "b".repeat(40) },
				deps(),
			),
		).toEqual({ status: "unavailable", reason: "unreachable" });
		expect(
			await listRepositoryFiles(
				{ ...input, repoKey: "remote:github.com/acme/other" },
				deps(),
			),
		).toEqual({ status: "unavailable", reason: "not-connected" });
	});
});
