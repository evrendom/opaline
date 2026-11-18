import { Agentation } from "agentation";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { copyTextToClipboardWithResult } from "../src/lib/clipboard";

// Loaded only by the loopback preview server, never by a shipped app bundle.
const host = document.createElement("div");
host.dataset.previewAgentation = "";
document.body.append(host);
const root = createRoot(host);
const embedded = window.parent !== window;
const stageDocument = embedded ? window.parent.document : document;
let visible: boolean | undefined;

function syncToolbar() {
	const demoOpen = stageDocument.documentElement.hasAttribute(
		"data-instant-v2-demo",
	);
	const nextVisible = embedded ? demoOpen : !demoOpen;
	if (visible === nextVisible) return;
	visible = nextVisible;
	root.render(
		visible
			? createElement(Agentation, {
					copyToClipboard: false,
					onCopy: (markdown: string) => {
						void copyTextToClipboardWithResult(markdown, {
							preferSelectionCopy: true,
							allowPromptFallback: true,
						});
					},
				})
			: null,
	);
}

new MutationObserver(syncToolbar).observe(stageDocument.documentElement, {
	attributes: true,
	attributeFilter: ["data-instant-v2-demo"],
});
syncToolbar();
