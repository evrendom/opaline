import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IngestSessionInput } from "@rudel/api-routes";
import {
	collectSessionPathSignals,
	withInferredSessionRepository,
} from "../lib/session-repository.js";

let root: string;
let launcher: string;
let app: string;
let lib: string;
let localOnly: string;

function git(cwd: string, ...args: string[]) {
	execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function createRepository(path: string, remote: string | null) {
	mkdirSync(join(path, "src"), { recursive: true });
	writeFileSync(join(path, "src", "index.ts"), "export {};\n");
	git(path, "init", "-q", "-b", "main");
	git(path, "add", ".");
	git(
		path,
		"-c",
		"user.name=t",
		"-c",
		"user.email=t@t",
		"commit",
		"-qm",
		"init",
	);
	if (remote) git(path, "remote", "add", "origin", remote);
}

function claudeToolUse(name: string, input: Record<string, unknown>) {
	return JSON.stringify({
		type: "assistant",
		cwd: launcher,
		message: { content: [{ type: "tool_use", name, input }] },
	});
}

function codexCall(payload: Record<string, unknown>) {
	return JSON.stringify({ type: "response_item", payload });
}

function request(
	content: string[],
	overrides: Partial<IngestSessionInput> = {},
): IngestSessionInput {
	return {
		source: "claude_code",
		sessionId: "session-1",
		projectPath: launcher,
		content: content.join("\n"),
		...overrides,
	} as IngestSessionInput;
}

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "session-repository-")));
	launcher = join(root, "launcher");
	app = join(root, "projects", "app");
	lib = join(root, "projects", "lib");
	localOnly = join(root, "projects", "local-only");
	createRepository(app, "git@github.com:acme/app.git");
	createRepository(lib, "https://github.com/acme/lib.git");
	createRepository(localOnly, null);
	// An empty repository whose only content links to a project.
	mkdirSync(launcher);
	git(launcher, "init", "-q");
	symlinkSync(app, join(launcher, "app"));
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("collectSessionPathSignals", () => {
	test("reads Claude Code edits, reads and absolute shell paths", () => {
		const signals = collectSessionPathSignals(
			[
				claudeToolUse("Edit", { file_path: "/w/app/src/a.ts" }),
				claudeToolUse("Grep", { path: "/w/lib", pattern: "x" }),
				claudeToolUse("Bash", {
					command: 'cd "/w/one two" && git -C /w/lib status; cd src',
				}),
				claudeToolUse("Bash", { command: "cd ~/w/home" }),
			].join("\n"),
			"/launcher",
		);
		expect(signals).toEqual([
			{ path: "/w/app/src/a.ts", weight: 3 },
			{ path: "/w/lib", weight: 1 },
			{ path: "/w/one two", weight: 1 },
			{ path: "/w/lib", weight: 1 },
			{ path: join(process.env.HOME ?? "", "w/home"), weight: 1 },
		]);
	});

	test("reads Codex workdirs, commands and patch files", () => {
		const signals = collectSessionPathSignals(
			[
				codexCall({
					type: "function_call",
					name: "exec_command",
					arguments: JSON.stringify({ cmd: "ls", workdir: "/w/lib" }),
				}),
				codexCall({
					type: "custom_tool_call",
					name: "apply_patch",
					input:
						"*** Begin Patch\n*** Update File: src/a.ts\n@@\n*** Add File: /w/app/b.ts\n*** End Patch",
				}),
				codexCall({
					type: "custom_tool_call",
					name: "exec",
					input:
						'await tools.exec_command({cmd:"git -C /w/app log",workdir:"/w/x"})',
				}),
			].join("\n"),
			"/launcher",
		);
		expect(signals).toEqual([
			{ path: "/w/lib", weight: 1 },
			{ path: "/launcher/src/a.ts", weight: 3 },
			{ path: "/w/app/b.ts", weight: 3 },
			{ path: "/w/x", weight: 1 },
			{ path: "/w/app", weight: 1 },
		]);
	});
});

describe("withInferredSessionRepository", () => {
	test("attributes a launcher session to the repository it edited, through a link", async () => {
		const inferred = await withInferredSessionRepository(
			request([
				claudeToolUse("Edit", {
					file_path: join(launcher, "app/src/index.ts"),
				}),
				claudeToolUse("Read", { file_path: join(lib, "src/index.ts") }),
				claudeToolUse("Read", { file_path: join(lib, "src/index.ts") }),
			]),
		);
		expect(inferred.gitRemote).toBe("github.com/acme/app");
		expect(inferred.gitBranch).toBe("main");
		expect(inferred.projectPath).toBe(launcher);
	});

	test("counts Codex patches against the call's working directory", async () => {
		const inferred = await withInferredSessionRepository(
			request([
				codexCall({
					type: "function_call",
					name: "apply_patch",
					arguments: JSON.stringify({
						input:
							"*** Begin Patch\n*** Update File: src/index.ts\n*** End Patch",
						workdir: lib,
					}),
				}),
			]),
		);
		expect(inferred.gitRemote).toBe("github.com/acme/lib");
	});

	test("keeps a repository the working directory already has", async () => {
		const original = request(
			[claudeToolUse("Edit", { file_path: join(app, "src/index.ts") })],
			{ gitRemote: "github.com/acme/other", projectPath: lib },
		);
		expect(await withInferredSessionRepository(original)).toBe(original);
	});

	test("does not credit a repository the session only glanced at", async () => {
		const original = request([
			claudeToolUse("Read", { file_path: join(app, "src/index.ts") }),
		]);
		expect(await withInferredSessionRepository(original)).toBe(original);
	});

	test("does not move work in a local-only repository to one it read", async () => {
		const original = request([
			claudeToolUse("Edit", { file_path: join(localOnly, "src/index.ts") }),
			claudeToolUse("Read", { file_path: join(app, "src/index.ts") }),
			claudeToolUse("Read", { file_path: join(app, "src/index.ts") }),
		]);
		expect(await withInferredSessionRepository(original)).toBe(original);
	});

	test("reads subagent transcripts too", async () => {
		const inferred = await withInferredSessionRepository(
			request([], {
				subagents: [
					{
						agentId: "agent-1",
						content: claudeToolUse("Write", {
							file_path: join(lib, "src/new.ts"),
						}),
					},
				],
			}),
		);
		expect(inferred.gitRemote).toBe("github.com/acme/lib");
	});
});
