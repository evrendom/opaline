import { readFile, writeFile } from "node:fs/promises";
import { build } from "vite";

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
const { html, seed } = renderDemo();
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
	"Prerendered the real product DOM; interactive chunks are deferred until Explore.",
);
