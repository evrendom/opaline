import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextBar } from "./session-reader-context-bar";
import type { ContextMap } from "./session-reader-context-map";

const WARN_TINT = "bg-warning-tint";
const FULL_TINT = "bg-error-tint";

function shareBadge(used: number) {
	const map: ContextMap = {
		compacted: false,
		estimate: { scale: 1, text: 0 },
		model: null,
		parts: [],
		trail: [],
		until: null,
		used,
		window: 100,
	};
	const html = renderToStaticMarkup(
		<ContextBar caption="Context" map={map} titleId={undefined} />,
	);
	const badge = html.match(/<span class="([^"]*)">\d+%<\/span>/u);
	return badge?.[1] ?? "";
}

test("a context under 70% full reads plain", () => {
	expect(shareBadge(69)).not.toContain(WARN_TINT);
	expect(shareBadge(69)).not.toContain(FULL_TINT);
});

test("from 70% full it warns, from 90% it reads full", () => {
	expect(shareBadge(70)).toContain(WARN_TINT);
	expect(shareBadge(89)).toContain(WARN_TINT);
	expect(shareBadge(90)).toContain(FULL_TINT);
	expect(shareBadge(100)).toContain(FULL_TINT);
});
