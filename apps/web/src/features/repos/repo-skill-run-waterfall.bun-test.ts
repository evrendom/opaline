import { expect, test } from "bun:test";
import type { SessionReaderStep } from "@/features/sessions/reader/model/session-reader-run-steps";
import { findSkillSteps } from "./repo-skill-run-waterfall";

const step = (
	id: string,
	toolEvent: SessionReaderStep["toolEvent"],
): SessionReaderStep => ({
	children: [],
	detail: null,
	endMs: 0,
	icon: null,
	id,
	isError: false,
	kind: toolEvent ? "tool" : "thinking",
	name: toolEvent?.toolName ?? "Thinking",
	nativeId: null,
	result: null,
	startMs: 0,
	text: null,
	toolEvent,
});
const tool = (id: string, toolName: string, input: Record<string, unknown>) =>
	step(id, {
		kind: "tool",
		id,
		toolName,
		input,
	} as SessionReaderStep["toolEvent"]);

const ids = (steps: SessionReaderStep[]) => steps.map((step) => step.id);

test("finds every step that called the skill, in order", () => {
	const steps = [
		step("t1", null),
		tool("read", "Read", { file_path: "/a.ts" }),
		tool("deploy", "Skill", { skill: "deploy" }),
		tool("review", "Skill", { skill: "acme:review" }),
		tool("again", "Skill", { skill: "review" }),
	];
	expect(ids(findSkillSteps(steps, "review"))).toEqual(["review", "again"]);
	expect(ids(findSkillSteps(steps, "deploy"))).toEqual(["deploy"]);
	expect(findSkillSteps(steps, "missing")).toEqual([]);
});

test("without a call, falls back to the first step from each use", () => {
	const at = (id: string, startMs: number) => ({ ...step(id, null), startMs });
	const steps = [at("before", 1_000), at("from", 2_000), at("after", 3_000)];
	const skillEvents = [
		{ at: new Date(2_500).toISOString(), skill: "review" },
		{ at: new Date(1_500).toISOString(), skill: "acme:review" },
		{ at: new Date(500).toISOString(), skill: "deploy" },
	];
	expect(ids(findSkillSteps(steps, "review", skillEvents))).toEqual([
		"from",
		"after",
	]);
	expect(findSkillSteps(steps, "missing", skillEvents)).toEqual([]);
});
