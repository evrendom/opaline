import { describe, expect, test } from "bun:test";
import type { IngestSessionInput } from "@rudel/api-routes";
import {
	SESSION_INGEST_FILTER_VERSION,
	TRANSCRIPT_SLIM_VERSION,
} from "@rudel/api-routes/transcript-slim";
import { FILTER_VERSION } from "@rudel/secret-filter";
import {
	getIngestContentShape,
	INGEST_SHRINK_MIN_BYTE_TOLERANCE,
	INGEST_SHRINK_MIN_LINE_TOLERANCE,
	isComparableIngestShapeVersion,
	isUnexpectedIngestShrink,
	resolvePreviousIngestContentShape,
} from "./ingest-content-shape.js";

describe("getIngestContentShape", () => {
	test("counts Claude assistant lines in the main transcript and subagents", () => {
		const input = makeInput({
			content: [
				'{"type":"user"}',
				'{"type":"assistant"}',
				"not json",
				'{"type":"assistant"}',
			].join("\n"),
			subagents: [
				{
					agentId: "agent-1",
					content: '{"type":"assistant","message":{"role":"assistant"}}',
				},
			],
		});

		expect(getIngestContentShape(input)).toEqual({
			assistantLineCount: 3,
			contentBytes:
				Buffer.byteLength(input.content, "utf8") +
				Buffer.byteLength(input.subagents?.[0]?.content ?? "", "utf8"),
			main: {
				assistantLineCount: 2,
				contentBytes: Buffer.byteLength(input.content, "utf8"),
			},
			subagents: {
				"agent-1": {
					assistantLineCount: 1,
					contentBytes: Buffer.byteLength(
						input.subagents?.[0]?.content ?? "",
						"utf8",
					),
				},
			},
			version: 1,
		});
	});

	test("counts Codex assistant response items and ignores unpersisted subagents", () => {
		const input = makeInput({
			source: "codex",
			content: [
				'{"type":"response_item","payload":{"type":"message","role":"assistant"}}',
				'{"type":"response_item","payload":{"type":"message","role":"user"}}',
			].join("\n"),
			subagents: [{ agentId: "ignored", content: '{"type":"assistant"}' }],
		});

		expect(getIngestContentShape(input)).toEqual({
			assistantLineCount: 1,
			contentBytes: Buffer.byteLength(input.content, "utf8"),
			main: {
				assistantLineCount: 1,
				contentBytes: Buffer.byteLength(input.content, "utf8"),
			},
			subagents: {},
			version: 1,
		});
	});
});

describe("isUnexpectedIngestShrink", () => {
	test("rejects a truncated re-upload when assistant lines disappear", () => {
		expect(isUnexpectedIngestShrink(shape(4, 3_000), shape(2, 2_900))).toBe(
			true,
		);
	});

	test("allows small byte drift when assistant coverage is intact", () => {
		expect(isUnexpectedIngestShrink(shape(3, 100_000), shape(3, 96_000))).toBe(
			false,
		);
	});

	test("rejects byte loss beyond the larger absolute/relative tolerance", () => {
		expect(isUnexpectedIngestShrink(shape(3, 100_000), shape(3, 94_999))).toBe(
			true,
		);
		expect(
			isUnexpectedIngestShrink(
				shape(0, 10_000),
				shape(0, 10_000 - INGEST_SHRINK_MIN_BYTE_TOLERANCE),
			),
		).toBe(false);
	});

	test("allows line-count drift within the same tolerance policy", () => {
		expect(
			isUnexpectedIngestShrink(
				shape(10, 10_000),
				shape(10 - INGEST_SHRINK_MIN_LINE_TOLERANCE, 10_000),
			),
		).toBe(false);
	});

	test("checks the main transcript and every existing subagent independently", () => {
		const previous = shape(10, 10_000, {
			worker: { assistantLineCount: 5, contentBytes: 5_000 },
		});
		const missingWorker = shape(20, 20_000);

		expect(isUnexpectedIngestShrink(previous, missingWorker)).toBe(true);
	});

	test("compares aggregate totals for a legacy ownership fallback", () => {
		const legacyTotal = shape(6, 12_000);
		const sameTotalWithSubagent = shape(1, 2_000, {
			worker: { assistantLineCount: 5, contentBytes: 10_000 },
		});
		const smallerTotal = shape(1, 2_000);

		expect(
			isUnexpectedIngestShrink(legacyTotal, sameTotalWithSubagent, {
				compareTotalsOnly: true,
			}),
		).toBe(false);
		expect(
			isUnexpectedIngestShrink(legacyTotal, smallerTotal, {
				compareTotalsOnly: true,
			}),
		).toBe(true);
	});
});

describe("isUnexpectedIngestShrink while re-baselining byte sizes", () => {
	const component = (assistantLineCount: number, contentBytes: number) => ({
		assistantLineCount,
		contentBytes,
	});
	const shape = (
		main: ReturnType<typeof component>,
		subagents: Record<string, ReturnType<typeof component>> = {},
	) => ({
		assistantLineCount: Object.values(subagents).reduce(
			(total, value) => total + value.assistantLineCount,
			main.assistantLineCount,
		),
		contentBytes: Object.values(subagents).reduce(
			(total, value) => total + value.contentBytes,
			main.contentBytes,
		),
		main,
		subagents,
		version: 1 as const,
	});

	test("accepts smaller bytes with the same records", () => {
		expect(
			isUnexpectedIngestShrink(
				shape(component(12, 1_000_000)),
				shape(component(12, 100_000)),
				{ compareBytes: false },
			),
		).toBe(false);
	});

	test("still refuses lost assistant records", () => {
		expect(
			isUnexpectedIngestShrink(
				shape(component(12, 1_000_000)),
				shape(component(2, 1_000_000)),
				{ compareBytes: false },
			),
		).toBe(true);
		expect(
			isUnexpectedIngestShrink(
				shape(component(12, 1_000_000)),
				shape(component(2, 1_000_000)),
				{ compareBytes: false, compareTotalsOnly: true },
			),
		).toBe(true);
	});

	test("still refuses a dropped or truncated subagent stream", () => {
		const previous = shape(component(4, 10_000), {
			worker: component(8, 50_000),
		});
		expect(
			isUnexpectedIngestShrink(previous, shape(component(4, 10_000)), {
				compareBytes: false,
			}),
		).toBe(true);
		expect(
			isUnexpectedIngestShrink(
				previous,
				shape(component(4, 10_000), { worker: component(1, 50_000) }),
				{ compareBytes: false },
			),
		).toBe(true);
	});
});

describe("isComparableIngestShapeVersion", () => {
	test("re-baselines once after the session filter version advances", () => {
		expect(
			isComparableIngestShapeVersion(
				SESSION_INGEST_FILTER_VERSION - 1,
				SESSION_INGEST_FILTER_VERSION,
			),
		).toBe(false);
		expect(
			isComparableIngestShapeVersion(
				SESSION_INGEST_FILTER_VERSION,
				SESSION_INGEST_FILTER_VERSION,
			),
		).toBe(true);
	});

	test("keeps checking legacy rows and rows stored by a newer version", () => {
		expect(
			isComparableIngestShapeVersion(null, SESSION_INGEST_FILTER_VERSION),
		).toBe(true);
		expect(
			isComparableIngestShapeVersion(
				SESSION_INGEST_FILTER_VERSION + 1,
				SESSION_INGEST_FILTER_VERSION,
			),
		).toBe(true);
	});

	test("the session filter version covers the current secret filter and slimming", () => {
		// Bump SESSION_INGEST_FILTER_VERSION whenever either component changes
		// the stored bytes, then update this pin.
		expect({
			FILTER_VERSION,
			SESSION_INGEST_FILTER_VERSION,
			TRANSCRIPT_SLIM_VERSION,
		}).toEqual({
			FILTER_VERSION: 6,
			SESSION_INGEST_FILTER_VERSION: 7,
			TRANSCRIPT_SLIM_VERSION: 1,
		});
	});
});

describe("resolvePreviousIngestContentShape", () => {
	test("synthesizes a main-only shape for legacy ownership rows", () => {
		expect(
			resolvePreviousIngestContentShape({
				lastAssistantLineCount: 42,
				lastContentBytes: 12_345,
				lastContentShape: null,
			}),
		).toEqual({
			assistantLineCount: 42,
			contentBytes: 12_345,
			main: { assistantLineCount: 42, contentBytes: 12_345 },
			subagents: {},
			version: 1,
		});
	});

	test("keeps the component shape when the ownership row has one", () => {
		const previous = shape(4, 20_000, {
			worker: { assistantLineCount: 2, contentBytes: 10_000 },
		});

		expect(
			resolvePreviousIngestContentShape({
				lastAssistantLineCount: 99,
				lastContentBytes: 99_999,
				lastContentShape: previous,
			}),
		).toBe(previous);
	});
});

function shape(
	assistantLineCount: number,
	contentBytes: number,
	subagents: Record<
		string,
		{ assistantLineCount: number; contentBytes: number }
	> = {},
) {
	const subagentShapes = Object.values(subagents);
	return {
		assistantLineCount: subagentShapes.reduce(
			(total, item) => total + item.assistantLineCount,
			assistantLineCount,
		),
		contentBytes: subagentShapes.reduce(
			(total, item) => total + item.contentBytes,
			contentBytes,
		),
		main: { assistantLineCount, contentBytes },
		subagents,
		version: 1 as const,
	};
}

function makeInput(overrides: Partial<IngestSessionInput>): IngestSessionInput {
	return {
		content: '{"type":"assistant"}',
		projectPath: "/project",
		sessionId: "session-1",
		source: "claude_code",
		...overrides,
	};
}
