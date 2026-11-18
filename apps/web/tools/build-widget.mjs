import { readFile, writeFile } from "node:fs/promises";
import { build } from "vite";

// The web app in plugin mode for ChatGPT and Codex (MCP Apps). The resource
// HTML loads `/plugin/entry.js` from our origin; that file is short-lived and
// imports the hashed, immutable chunks, because hosts cache the HTML for hours.
await build({
	mode: "plugin",
	base: "./",
	build: {
		outDir: "dist-plugin",
		emptyOutDir: true,
		manifest: true,
		modulePreload: false,
		rollupOptions: { input: "widget.html" },
	},
});

const manifest = JSON.parse(
	await readFile("dist-plugin/.vite/manifest.json", "utf8"),
);
const { file, css = [] } = manifest["widget.html"];
await writeFile(
	"dist-plugin/entry.js",
	`for (const href of ${JSON.stringify(css)}) document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: new URL(href, import.meta.url).href }));\nimport("./${file}");\n`,
);
