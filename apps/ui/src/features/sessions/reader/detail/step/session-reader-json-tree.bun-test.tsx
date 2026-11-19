import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JsonTree } from "./session-reader-json-tree";

const text = (html: string) =>
	html
		.replace(/<[^>]+>/gu, " ")
		.replaceAll("&quot;", '"')
		.replace(/\s+/gu, " ")
		.trim();

describe("JsonTree", () => {
	const value = {
		result: { className: "TypeError", description: "boom\n    at x:1:2" },
		details: { stack: { frames: [{ line: 0 }, { line: 3 }] } },
		empty: "",
		none: null,
	};

	test("keys and values, no braces or quotes, a text's line breaks kept", () => {
		const html = renderToStaticMarkup(<JsonTree value={value} />);
		expect(text(html)).toContain("className TypeError");
		expect(html).toContain("boom\n    at x:1:2");
		expect(text(html)).toContain('empty ""');
		expect(text(html)).toContain("none null");
	});

	test("the first two levels open, deeper ones folded to a count", () => {
		const html = text(renderToStaticMarkup(<JsonTree value={value} />));
		expect(html).toContain("stack");
		expect(html).toContain("frames [2 items]");
		expect(html).not.toContain("line 3");
	});
});
