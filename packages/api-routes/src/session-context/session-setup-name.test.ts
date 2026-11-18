import { describe, expect, test } from "bun:test";
import type { SessionSetupFile } from "../session-summary-links.js";
import { runSetupFiles } from "./session-reader-context-runs.js";
import { setupName } from "./session-setup-name.js";

const codex = (kind: string, path: string) =>
	({
		kind,
		owner: "codex",
		path,
		scope: "harness",
		setupFile: `harness:codex:${path}`,
	}) as unknown as SessionSetupFile;

describe("a Codex harness text's name", () => {
	test("a developer message is named by its leading tag", () => {
		expect(
			[
				"collaboration_mode",
				"permissions instructions",
				"multi_agent_mode",
				"multi_agent_role",
				"turn_aborted",
				"apps_instructions",
				"",
			].map((tag) => setupName(codex("developer", tag))),
		).toEqual([
			"Collaboration mode",
			"Permissions",
			"Multi-agent mode",
			"Multi-agent role",
			"Interrupted turn notice",
			"Apps instructions",
			"Developer message",
		]);
	});

	test("the system prompt keeps its kind's name", () => {
		expect(setupName(codex("system_prompt", "base_instructions"))).toBe(
			"System prompt",
		);
	});
});

describe("the setup a run received", () => {
	const files = [
		codex("developer", "collaboration_mode"),
		codex("developer", "permissions instructions"),
		codex("system_prompt", "base_instructions"),
	];
	const received = (setupFile: string, agentId = "") => ({
		agentId,
		carried: false,
		compacted: false,
		setupFile,
		startedAt: "2026-09-12T11:31:23.746Z",
		version: "1",
		versionName: "",
	});
	test("a reader run inside an indexed run gets that run's setup", () => {
		expect(
			runSetupFiles(files, [received("harness:codex:collaboration_mode")], {
				agent: null,
				startedAt: "2026-09-12T11:31:40.000Z",
			}).map((file) => file.path),
		).toEqual(["collaboration_mode"]);
	});

	test("is only what that run received, by its start or its subagent", () => {
		const runs = [
			received("harness:codex:collaboration_mode"),
			received("harness:codex:base_instructions", "a1"),
		];
		expect(
			runSetupFiles(files, runs, {
				agent: null,
				startedAt: "2026-09-12T11:31:23.746Z",
			}).map((file) => file.path),
		).toEqual(["collaboration_mode"]);
		expect(
			runSetupFiles(files, runs, { agent: "a1", startedAt: null }).map(
				(file) => file.path,
			),
		).toEqual(["base_instructions"]);
		expect(
			runSetupFiles(files, runs, {
				agent: null,
				startedAt: "2026-09-12T11:31:14.810Z",
			}),
		).toEqual([]);
	});
});
