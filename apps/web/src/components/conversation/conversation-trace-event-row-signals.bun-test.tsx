import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ConversationTraceEventRow,
	ToolResultBody,
} from "./conversation-trace-event-row";

describe("ConversationTraceEventRow language signals", () => {
	test("highlights collapsed and expanded reasoning prose", () => {
		const markup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					id: "reasoning-signals",
					kind: "reasoning",
					text: "Sorry, that is a great call.",
					timestamp: "2026-08-18T10:00:00.000Z",
				}}
			/>,
		);

		expect(markup).toContain('data-signal="apology"');
		expect(markup).toContain('data-signal="positive"');
	});

	test("uses display boundaries for assistant previews and bodies", () => {
		const text =
			"Elegant work. `fuck`\n```text\nshit\n```\n<context>sorry</context>";
		const markup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					content: text,
					id: "message-signals",
					kind: "message",
					text,
					timestamp: "2026-08-18T10:00:00.000Z",
				}}
			/>,
		);

		expect(markup).toContain('data-signal="positive"');
		expect(markup).toContain("Elegant");
		expect(markup).not.toContain('data-signal="swear"');
		expect(markup).not.toContain('data-signal="apology"');
	});

	test("preserves collapsed assistant whitespace across display boundaries", () => {
		const text = `First  line\tkeeps spacing before **bold**  prose.\n  Second line stays indented after \`code\`.\n${"Long prose content. ".repeat(90)}`;
		const markup = renderToStaticMarkup(
			<ConversationTraceEventRow
				event={{
					content: text,
					id: "message-whitespace",
					kind: "message",
					text,
					timestamp: "2026-08-18T10:00:00.000Z",
				}}
			/>,
		);

		expect(markup).toContain("data-trace-collapsed-preview");
		expect(markup).toContain("First  line\tkeeps spacing before ");
		expect(markup).toContain(">  prose.\n  Second line stays indented after <");
	});

	test("never highlights tool output", () => {
		const markup = renderToStaticMarkup(
			<ToolResultBody
				result={{ content: "Great, sorry this is shit.", isError: false }}
			/>,
		);

		expect(markup).not.toContain("data-signal");
	});
});
