import { describe, expect, test } from "bun:test";
import type {
	SessionReaderStep,
	SessionReaderWaterfall,
} from "@/features/sessions/reader/model/session-reader-run-steps";
import {
	classTint,
	formatPreciseOffset,
	getLanes,
	getSubagentGroups,
} from "./run-lanes-model";

let clock = 0;
function step(
	id: string,
	kind: SessionReaderStep["kind"],
	extra: Partial<SessionReaderStep> = {},
): SessionReaderStep {
	clock += 1000;
	return {
		children: [],
		detail: null,
		endMs: clock + 500,
		icon: null,
		id,
		isError: false,
		kind,
		name: kind,
		nativeId: null,
		result: null,
		startMs: clock,
		text: null,
		toolEvent: null,
		...extra,
	};
}

const tool = (toolName: string, input: Record<string, unknown>) =>
	({
		id: `e-${toolName}`,
		input,
		kind: "tool",
		result: undefined,
		timestamp: "2026-10-10T10:00:00.000Z",
		toolName,
	}) as unknown as NonNullable<SessionReaderStep["toolEvent"]>;

function waterfallOf(steps: SessionReaderStep[]): SessionReaderWaterfall {
	return {
		allSteps: steps,
		model: null,
		startMs: 0,
		steps,
	} as unknown as SessionReaderWaterfall;
}

const laneWords = (waterfall: SessionReaderWaterfall) =>
	getLanes(waterfall)
		.filter((lane) => lane.bars.length > 0)
		.map((lane) => ({
			bars: lane.bars.map(
				(bar) => `${bar.stepId}:${bar.name ?? ""}:${bar.title}`,
			),
			count:
				lane.counts === "bars"
					? undefined
					: lane.counts === "none"
						? null
						: lane.counts,
			id: lane.id,
		}));

describe("the run's lanes", () => {
	test("each step on its lane, a file lane's bars named for their files", () => {
		clock = 0;
		const steps = [
			step("think", "thinking", { text: "hm" }),
			step("read", "tool", {
				files: [{ operation: "read", path: "src/app/main.ts" }],
				name: "Read",
				toolEvent: tool("Read", { file_path: "src/app/main.ts" }),
			}),
			step("edit", "tool", {
				files: [
					{ operation: "edit", path: "src/a.ts" },
					{ operation: "edit", path: "src/b.ts" },
				],
				isError: true,
				name: "Edit",
				toolEvent: tool("Edit", { file_path: "src/a.ts" }),
			}),
			step("say", "message", { text: "done" }),
		] as SessionReaderStep[];
		expect(laneWords(waterfallOf(steps))).toMatchInlineSnapshot(`
		  [
		    {
		      "bars": [
		        "think::thinking · 500ms",
		        "say::message · 500ms",
		      ],
		      "count": undefined,
		      "id": "model",
		    },
		    {
		      "bars": [
		        "read:main.ts:Read main.ts · Read · 500ms",
		      ],
		      "count": undefined,
		      "id": "read",
		    },
		    {
		      "bars": [
		        "edit:a.ts +1:Edited a.ts, b.ts · Edit · 500ms",
		      ],
		      "count": undefined,
		      "id": "edit",
		    },
		  ]
		`);
	});

	test("subagents, a row each that worked at once, counted once", () => {
		clock = 0;
		const first = step("a1", "agent", {
			endMs: 9_000,
			name: "Task",
			toolEvent: tool("Task", { description: "Look round", prompt: "x" }),
		});
		const second = step("a2", "agent", {
			endMs: 9_500,
			name: "Task",
			toolEvent: tool("Task", { description: "Check CI", prompt: "y" }),
		});
		const waterfall = waterfallOf([first, second]);
		expect(laneWords(waterfall)).toMatchInlineSnapshot(`
		  [
		    {
		      "bars": [
		        "a1::Launched Task",
		        "a2::Launched Task",
		      ],
		      "count": 2,
		      "id": "agent:0",
		    },
		  ]
		`);
		expect(
			getSubagentGroups(waterfall).map((group) => ({
				count: group.head.counts,
				failed: group.head.failed,
				id: group.head.id,
				label: group.head.label,
			})),
		).toMatchInlineSnapshot(`
		  [
		    {
		      "count": 1,
		      "failed": 0,
		      "id": "subagent:a1",
		      "label": "Look round",
		    },
		    {
		      "count": 1,
		      "failed": 0,
		      "id": "subagent:a2",
		      "label": "Check CI",
		    },
		  ]
		`);
	});

	test("a selection's ends, to the millisecond", () => {
		expect(formatPreciseOffset(12_345)).toBe("+12.345s");
		expect(formatPreciseOffset(349_123)).toBe("+5m 49.123s");
		expect(formatPreciseOffset(3_723_456)).toBe("+1h 2m 3.456s");
		expect(formatPreciseOffset(-5)).toBe("+0.000s");
	});

	test("a bar's colour, from its fill class", () => {
		expect(classTint("rounded bg-sky-500")).toBe("var(--color-sky-500)");
		expect(classTint("rounded")).toBe("var(--color-slate-500)");
	});
});
