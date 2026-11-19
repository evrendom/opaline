import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TraceResultBody } from "./conversation-trace-result-body";

const SCREENSHOT_MARKER =
	"opaline-image-omitted:v1;sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef;bytes=87119;type=image/png";

describe("TraceResultBody images", () => {
	test("a marked Claude screenshot says it was taken but not stored", () => {
		const markup = renderToStaticMarkup(
			<TraceResultBody
				result={{
					content: [
						{ text: "captured", type: "text" },
						{
							source: {
								data: SCREENSHOT_MARKER,
								media_type: "image/png",
								type: "base64",
							},
							type: "image",
						},
					],
					isError: false,
				}}
			/>,
		);

		expect(markup).toContain("data-trace-result-image-omitted");
		expect(markup).toContain(
			"Screenshot taken (image not stored) · image/png · 85.1 KB",
		);
		expect(markup).not.toContain("<img");
		expect(markup).not.toContain("Image result unavailable");
	});

	test("a marked Codex screenshot renders the same notice", () => {
		const markup = renderToStaticMarkup(
			<TraceResultBody
				result={{
					content: [
						{
							rawType: "input_image",
							source: { type: "url", url: SCREENSHOT_MARKER },
							type: "image",
						},
					],
					isError: false,
				}}
			/>,
		);

		expect(markup).toContain(
			"Screenshot taken (image not stored) · image/png · 85.1 KB",
		);
		expect(markup).not.toContain("<img");
	});

	test("stored pixels still render as an image", () => {
		const markup = renderToStaticMarkup(
			<TraceResultBody
				result={{
					content: [
						{
							rawType: "input_image",
							source: { type: "url", url: "data:image/png;base64,AAAA" },
							type: "image",
						},
					],
					isError: false,
				}}
			/>,
		);

		expect(markup).toContain('src="data:image/png;base64,AAAA"');
		expect(markup).not.toContain("data-trace-result-image-omitted");
	});
});
