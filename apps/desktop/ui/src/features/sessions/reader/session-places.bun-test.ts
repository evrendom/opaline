import { describe, expect, test } from "bun:test";
import { findMcpSetupFile, resolveSessionFile } from "./session-places";

const FILES = [
	"/repo/apps/web/src/main.tsx",
	"/repo/apps/api/src/main.ts",
	"/repo/apps/web/src/lib/utils.ts",
	"/repo/packages/a/utils.ts",
];

describe("resolveSessionFile", () => {
	test("an absolute path, as it is", () => {
		expect(resolveSessionFile(FILES, "/repo/apps/api/src/main.ts")).toBe(
			"/repo/apps/api/src/main.ts",
		);
		expect(resolveSessionFile(FILES, "/elsewhere/notes.md")).toBe(
			"/elsewhere/notes.md",
		);
	});
	test("a relative path, by the one file it ends", () => {
		expect(resolveSessionFile(FILES, "apps/web/src/main.tsx")).toBe(
			"/repo/apps/web/src/main.tsx",
		);
		expect(resolveSessionFile(FILES, "./src/lib/utils.ts")).toBe(
			"/repo/apps/web/src/lib/utils.ts",
		);
	});
	test("none when more than one file ends it, or none does", () => {
		expect(resolveSessionFile(FILES, "utils.ts")).toBeNull();
		expect(resolveSessionFile(FILES, "src/other.ts")).toBeNull();
		expect(resolveSessionFile(FILES, "  ")).toBeNull();
	});
	test("known: an absolute path only if it's one of them", () => {
		const known = { absolute: "known" } as const;
		expect(resolveSessionFile(FILES, "/repo/apps/api/src/main.ts", known)).toBe(
			"/repo/apps/api/src/main.ts",
		);
		expect(resolveSessionFile(FILES, "/elsewhere/notes.md", known)).toBeNull();
		expect(resolveSessionFile(FILES, "apps/api/src/main.ts", known)).toBe(
			"/repo/apps/api/src/main.ts",
		);
	});
	test("not a file whose name only ends the same", () => {
		expect(resolveSessionFile(FILES, "ain.ts")).toBeNull();
	});
});

describe("findMcpSetupFile", () => {
	const setup = [
		{
			kind: "mcp_instructions",
			owner: "plugin:opaline:opaline",
			setupFile: "mcp:plugin:opaline:opaline",
		},
		{
			kind: "mcp_instructions",
			owner: "claude.ai Claude Docs",
			setupFile: "mcp:claude.ai Claude Docs",
		},
		{ kind: "mcp_instructions", owner: "posthog", setupFile: "mcp:posthog" },
		{ kind: "instructions", owner: "posthog", setupFile: "member:x:posthog" },
	];
	test("a server by its owner, a plugin's or claude.ai's prefix aside", () => {
		expect(findMcpSetupFile(setup, "opaline")).toBe(
			"mcp:plugin:opaline:opaline",
		);
		expect(findMcpSetupFile(setup, "Claude Docs")).toBe(
			"mcp:claude.ai Claude Docs",
		);
		expect(findMcpSetupFile(setup, "posthog")).toBe("mcp:posthog");
	});
	test("none for a server the setup doesn't hold", () => {
		expect(findMcpSetupFile(setup, "linear")).toBeNull();
	});
});
