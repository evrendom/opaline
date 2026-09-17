import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { checkSiteArchive } from "./check-site-archive";

const root = resolve(import.meta.dir, "..");
const output = join(root, "dist-site");
for (const [cwd, command] of [["apps/web", "build"], ["apps/web", "build:demo"], ["apps/marketing", "build"]]) {
	const child = Bun.spawn(["bun", "run", command], { cwd: join(root, cwd), stdout: "inherit", stderr: "inherit", env: { ...process.env, PUBLIC_POSTHOG_KEY: process.env.PUBLIC_POSTHOG_KEY || process.env.VITE_POSTHOG_KEY, PUBLIC_POSTHOG_HOST: process.env.PUBLIC_POSTHOG_HOST || process.env.VITE_POSTHOG_HOST, PUBLIC_POSTHOG_ENABLED: process.env.PUBLIC_POSTHOG_ENABLED || process.env.VITE_POSTHOG_ENABLED } });
	if (await child.exited !== 0) throw new Error(`Site build failed: ${cwd} ${command}`);
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, "apps/web/dist"), output, { recursive: true });
await cp(join(output, "index.html"), join(output, "app.html"));
await cp(join(root, "apps/marketing/dist"), output, { recursive: true });
// Static files take precedence over Vercel rewrites. Keep the marketing
// document behind a rewrite so signed-in root visits can open the app.
await cp(join(output, "index.html"), join(output, "marketing.html"));
await rm(join(output, "index.html"));
await cp(join(root, "apps/web/dist-demo"), join(output, "product-demo"), { recursive: true });
await mkdir(join(output, "site-scripts"), { recursive: true });

// Astro's island bootstrap and the demo activation listener are emitted inline.
// Externalize executable scripts so production keeps script-src 'self'.
async function externalize(directory: string): Promise<void> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) { await externalize(path); continue; }
		if (!entry.name.endsWith(".html")) continue;
		let html = await readFile(path, "utf8");
		for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)) {
			const attributes = match[1] ?? "";
			const source = match[2] ?? "";
			if (!source.trim() || /\bsrc\s*=/iu.test(attributes) || /\btype\s*=\s*["']application\//iu.test(attributes)) continue;
			const hash = createHash("sha256").update(source).digest("hex").slice(0, 24);
			await writeFile(join(output, "site-scripts", `${hash}.js`), source);
			html = html.replace(match[0], `<script${attributes} src="/site-scripts/${hash}.js"></script>`);
		}
		await writeFile(path, html);
	}
}
await externalize(output);
await checkSiteArchive(output);
console.log("Built marketing, live demo, and product into dist-site.");
