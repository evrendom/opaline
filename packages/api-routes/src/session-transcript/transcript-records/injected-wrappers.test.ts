import { describe, expect, test } from "bun:test";
import {
	classifyUserText,
	stripInjectedWrappers,
} from "./injected-wrappers.js";

describe("stripInjectedWrappers", () => {
	test("removes wrapper elements and keeps the human text", () => {
		expect(
			stripInjectedWrappers(
				"<system_instruction>\nrules\n</system_instruction>\n\nfix it\n<system-reminder>x</system-reminder>",
			),
		).toEqual({
			firstSubtype: "system_instruction",
			injected:
				"<system_instruction>\nrules\n</system_instruction>\n<system-reminder>x</system-reminder>",
			remainder: "fix it",
		});
	});

	test("matches wrappers in text that contains non-Latin-1 characters", () => {
		expect(
			stripInjectedWrappers(
				"<system_instruction>curly ’ quote 日本語</system_instruction>\nübung macht den Meister",
			),
		).toEqual({
			firstSubtype: "system_instruction",
			injected: "<system_instruction>curly ’ quote 日本語</system_instruction>",
			remainder: "übung macht den Meister",
		});
	});

	test("removes Codex AGENTS.md payloads but leaves a human's own instructions tag", () => {
		expect(
			stripInjectedWrappers(
				"# AGENTS.md instructions for /repo\n<INSTRUCTIONS>\nbe nice\n</INSTRUCTIONS>\nreal task",
			),
		).toEqual({
			firstSubtype: "agents_md",
			injected:
				"# AGENTS.md instructions for /repo\n<INSTRUCTIONS>\nbe nice\n</INSTRUCTIONS>",
			remainder: "real task",
		});
		expect(
			stripInjectedWrappers("use <instructions>step one</instructions> please"),
		).toEqual({
			firstSubtype: "",
			injected: "",
			remainder: "use <instructions>step one</instructions> please",
		});
	});
});

describe("classifyUserText", () => {
	test("wrapper-only messages are injected context, never prompts", () => {
		expect(
			classifyUserText("<environment_context>cwd</environment_context>", {}),
		).toEqual({
			kind: "injected_context",
			subtype: "environment_context",
		});
		expect(
			classifyUserText(
				"<task-notification>\n<task-id>1</task-id>\n</task-notification>",
				{},
			),
		).toEqual({ kind: "injected_context", subtype: "task_notification" });
	});

	test("the transcript's own meta flag wins over content", () => {
		expect(
			classifyUserText("Base directory for this skill: /x\nbody", {
				flaggedMeta: true,
			}),
		).toEqual({
			kind: "injected_context",
			subtype: "skill_body",
		});
		expect(classifyUserText("anything", { flaggedMeta: true })).toEqual({
			kind: "injected_context",
			subtype: "meta",
		});
	});

	test("compaction summaries and interruptions are not prompts", () => {
		expect(classifyUserText("summary", { compactSummary: true }).kind).toBe(
			"compaction",
		);
		expect(
			classifyUserText(
				"This session is being continued from a previous conversation that ran out of context.",
				{},
			).kind,
		).toBe("compaction");
		expect(
			classifyUserText("[Request interrupted by user for tool use]", {}),
		).toEqual({
			kind: "meta",
			subtype: "interrupt",
		});
	});

	test("ordinary text is a prompt", () => {
		expect(classifyUserText("  please rename the file  ", {})).toEqual({
			kind: "prompt",
			text: "please rename the file",
			injected: "",
			injectedSubtype: "",
		});
	});

	test("instructions around a prompt are returned so they stay readable", () => {
		expect(
			classifyUserText(
				"<system_instruction>\nYou are working inside Conductor.\n</system_instruction>\n\nfix the login bug",
				{},
			),
		).toEqual({
			kind: "prompt",
			text: "fix the login bug",
			injected:
				"<system_instruction>\nYou are working inside Conductor.\n</system_instruction>",
			injectedSubtype: "system_instruction",
		});
	});
});
