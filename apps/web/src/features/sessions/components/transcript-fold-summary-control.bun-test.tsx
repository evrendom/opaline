import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { TranscriptFoldSummaryControl } from "./use-transcript-sticky-header-wrappers";

describe("TranscriptFoldSummaryControl", () => {
	test("renders counts inside extended node-icon fills", () => {
		const markup = renderToStaticMarkup(
			<TranscriptFoldSummaryControl
				expanded={false}
				hidden={{
					events: 64,
					filesEdited: 0,
					filesRead: 1,
					filesViewed: 1,
					filesWritten: 0,
					messages: 13,
					reasoning: 47,
					skills: 2,
					subagents: 0,
					toolCalls: 4,
				}}
				onToggle={() => undefined}
				turnId="turn-35"
			/>,
		);

		expect(markup).toContain(">4 tool calls, 13 messages</span>");
		expect(markup).toContain("data-transcript-fold-summary-metrics");
		expect(markup.match(/data-transcript-fold-summary-metric=/g)).toHaveLength(
			5,
		);
		expect(markup.match(/data-trace-hugeicon/g)).toHaveLength(6);
		expect(markup).toContain('title="47 Reasoning"');
		expect(markup).toContain('title="1 Images Viewed"');
		expect(markup).toContain('data-trace-icon-tone="violet"');
		expect(markup).toContain('data-trace-icon-tone="blue"');
		expect(markup).toContain('data-trace-tool-icon="sparkle"');
		expect(markup).not.toContain('data-trace-tool-icon="bot"');
		expect(markup).toContain('data-trace-tool-icon="image"');
		expect(markup).not.toContain('data-trace-tool-icon="file-add"');
		expect(markup).not.toContain('data-trace-tool-icon="pencil"');
		expect(markup).not.toContain(
			'data-transcript-fold-summary-metric="files-written"',
		);
		expect(markup).not.toContain(
			'data-transcript-fold-summary-metric="files-edited"',
		);
		expect(markup).not.toContain("data-transcript-fold-summary-tag");
		expect(markup).not.toContain(">Reasoning<");
	});

	test.each([
		{ toolCalls: 1, messages: 0, label: "1 tool call" },
		{ toolCalls: 0, messages: 1, label: "1 message" },
		{ toolCalls: 0, messages: 0, label: "" },
	])("omits zero counts: $toolCalls tools, $messages messages", ({
		toolCalls,
		messages,
		label,
	}) => {
		const markup = renderToStaticMarkup(
			<TranscriptFoldSummaryControl
				expanded={false}
				hidden={{
					events: 1,
					reasoning: 1,
					filesEdited: 0,
					filesRead: 0,
					filesViewed: 0,
					filesWritten: 0,
					skills: 0,
					subagents: 0,
					toolCalls,
					messages,
				}}
				onToggle={() => undefined}
				turnId="empty-counts"
			/>,
		);
		if (label) expect(markup).toContain(`>${label}</span>`);
		else expect(markup).toBe("");
	});

	test("extends the Opaline SVG fill without distorting its end caps", () => {
		const css = readFileSync(
			new URL("./session-constellation-tree.css", import.meta.url),
			"utf8",
		);

		expect(css).toContain("[data-transcript-fold-summary-metric]");
		expect(css).toContain(
			'url("/opaline-trace-fill.svg") left center / 20px 20px no-repeat',
		);
		expect(css).toContain(
			'url("/opaline-trace-fill.svg") right center / 20px 20px no-repeat',
		);
		expect(css).toContain("calc(100% - 20px) 100% no-repeat");
		expect(css).not.toContain("center / 100% 100% no-repeat");
	});
});
