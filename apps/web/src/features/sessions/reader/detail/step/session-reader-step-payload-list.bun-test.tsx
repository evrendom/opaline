import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
	SessionReaderStep,
	SessionReaderWaterfall,
} from "../../model/session-reader-model";
import { stepPayloads } from "./session-reader-step-payload-list";

function step(overrides: Partial<SessionReaderStep>): SessionReaderStep {
	return {
		children: [],
		detail: null,
		endMs: 2_000,
		icon: null,
		id: "s1",
		isError: false,
		kind: "tool",
		name: "Bash",
		nativeId: null,
		result: null,
		startMs: 1_000,
		text: null,
		toolEvent: null,
		...overrides,
	};
}

function toolEvent(
	toolName: string,
	input: Record<string, unknown>,
	extra: Record<string, unknown> = {},
) {
	return {
		id: "e1",
		input,
		kind: "tool" as const,
		result: undefined,
		timestamp: "2026-10-10T10:00:00.000Z",
		toolName,
		...extra,
	} as unknown as NonNullable<SessionReaderStep["toolEvent"]>;
}

const waterfall = {
	allSteps: [],
	steps: [],
} as unknown as SessionReaderWaterfall;

function shown(payloads: ReturnType<typeof stepPayloads>) {
	return payloads.map((payload) => {
		const { body, ...rest } = payload as typeof payload & { body?: ReactNode };
		return {
			...rest,
			...(body !== undefined
				? {
						body: isValidElement(body)
							? renderToStaticMarkup(body).replace(/<[^>]+>/gu, "")
							: body,
					}
				: {}),
		};
	});
}

describe("stepPayloads", () => {
	test("thinking: its text as prose, unless its card shows it", () => {
		const thinking = step({ kind: "thinking", text: "Hmm, the build." });
		expect(shown(stepPayloads(thinking, false, waterfall))).toEqual([
			{
				label: "Thinking",
				prose: true,
				show: "text",
				value: "Hmm, the build.",
			},
		]);
		expect(stepPayloads(thinking, true, waterfall)).toEqual([]);
		expect(stepPayloads(step({ kind: "thinking" }), false, waterfall)).toEqual(
			[],
		);
	});

	test("a message, a member's redirect and a compaction's summary: markdown", () => {
		expect(
			shown(
				stepPayloads(
					step({ kind: "message", text: "Done." }),
					false,
					waterfall,
				),
			),
		).toMatchObject([{ body: "Done.", label: "Output", value: "Done." }]);
		expect(
			shown(
				stepPayloads(
					step({ harness: "member", kind: "tool", text: "stop that" }),
					false,
					waterfall,
				),
			),
		).toMatchObject([
			{ body: "stop that", label: "Message", value: "stop that" },
		]);
		expect(
			shown(
				stepPayloads(
					step({
						compaction: {
							summary: "Kept the plan.",
						} as SessionReaderStep["compaction"],
						harness: "compaction",
					}),
					false,
					waterfall,
				),
			),
		).toMatchObject([
			{ body: "Kept the plan.", label: "Summary", value: "Kept the plan." },
		]);
	});

	test("a tool call: its arguments and its result", () => {
		const call = step({
			result: '{"ok":true}',
			toolEvent: toolEvent("Grep", { pattern: "foo" }),
		});
		expect(shown(stepPayloads(call, false, waterfall))).toEqual([
			{
				body: "Patternfoo",
				label: "Arguments",
				show: "body",
				value: '{\n  "pattern": "foo"\n}',
			},
			{
				label: "Result",
				language: "json",
				show: "code",
				startLine: undefined,
				value: '{\n  "ok": true\n}',
			},
		]);
		expect(stepPayloads(call, true, waterfall)).toEqual([]);
	});

	test("a subagent's launch: its prompt, how long it took to write", () => {
		const launch = step({
			kind: "agent",
			promptUntilMs: 3_500,
			toolEvent: toolEvent("Task", { prompt: "Find the bug." }),
		});
		expect(shown(stepPayloads(launch, false, waterfall))).toEqual([
			{
				label: "Prompt · written in 2.50s",
				prose: true,
				show: "text",
				value: "Find the bug.",
			},
		]);
		const codex = step({
			kind: "agent",
			toolEvent: toolEvent("spawn_agent", { message: "Look." }),
		});
		expect(shown(stepPayloads(codex, false, waterfall))).toEqual([
			{ label: "Prompt", prose: true, show: "text", value: "Look." },
		]);
	});

	test("a background call's report, before the rest", () => {
		const call = step({
			toolEvent: toolEvent(
				"Bash",
				{},
				{ background: { result: "All green." } },
			),
		});
		expect(shown(stepPayloads(call, true, waterfall))).toEqual([
			{ label: "Report", prose: true, show: "text", value: "All green." },
		]);
	});

	test("a skill: what it was asked, then its SKILL.md with its words counted", () => {
		const call = step({
			toolEvent: toolEvent(
				"Skill",
				{ args: "the PR", skill: "review" },
				{ skillContent: { content: "Read the diff. Then comment." } },
			),
		});
		expect(shown(stepPayloads(call, false, waterfall))).toEqual([
			{ label: "Args", prose: true, show: "text", value: "the PR" },
			{
				body: "Read the diff. Then comment.",
				hint: "5 words",
				label: "Skill",
				show: "body",
				value: "Read the diff. Then comment.",
			},
		]);
	});

	test("the model writing a call: the call it wrote", () => {
		const written = step({
			id: "w",
			name: "Grep",
			toolEvent: toolEvent("Grep", { pattern: "x" }),
		});
		const writing = step({ kind: "thinking", writes: "w" });
		expect(shown(stepPayloads(writing, false, waterfall, written))).toEqual([
			{
				body: "Patternx",
				label: "The Grep call it wrote",
				show: "body",
				value: '{\n  "pattern": "x"\n}',
			},
		]);
		expect(stepPayloads(writing, false, waterfall)).toEqual([]);
	});
});
