import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { build } from "vite";
import { fetchDemoFixtures } from "./fetch-demo-fixtures.mjs";

await fetchDemoFixtures();

await build({ configFile: "vite.demo.config.ts" });
await build({
	configFile: "vite.demo.config.ts",
	publicDir: false,
	build: {
		ssr: "src/features/demo/render-demo.tsx",
		outDir: ".demo-ssr",
		rollupOptions: { input: "src/features/demo/render-demo.tsx" },
	},
});
const { renderDemo } = await import("../.demo-ssr/render-demo.js");
const fixtures = new URL("../demo-public/fixtures/", import.meta.url);
const { html, seed, queries } = renderDemo({
	index: JSON.parse(readFileSync(new URL("index.json", fixtures), "utf8")),
	readFile: (file) => {
		const bytes = readFileSync(new URL(file, fixtures));
		return (
			bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes
		).toString("utf8");
	},
});
const template = await readFile("dist-demo/demo.html", "utf8");
if (!template.includes("<!--demo-html-->"))
	throw new Error("Missing demo render slot");
await writeFile(
	"dist-demo/demo.html",
	template
		.replace("<!--demo-html-->", () => html)
		.replace(
			'<script id="demo-seed" type="application/json">null</script>',
			() => `<script id="demo-seed" type="application/json">${seed}</script>`,
		),
);
console.log(
	`Prerendered the real product DOM with ${queries} recorded answers; interactive chunks are deferred until Explore.`,
);
