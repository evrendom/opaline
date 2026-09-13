import { resolve, extname } from "node:path";
import { createDemoHandler } from "../apps/api/src/handlers/demo-http.js";
import config from "../vercel.json";

const root = resolve(import.meta.dir, "../dist-site");
const api = process.env.PREVIEW_API_URL ?? "http://localhost:4031";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(api).hostname)) throw new Error("Use a local API for the product preview.");
const port = Number(process.env.PREVIEW_PORT ?? 4602);
async function proxy(request: Request) {
 const url = new URL(request.url);
 return fetch(new URL(url.pathname + url.search, api).href, {method: request.method, headers: request.headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(), redirect: "manual"});
}
const demo = createDemoHandler(proxy);
const server = Bun.serve({ hostname: "localhost", port, idleTimeout: 255, async fetch(request) {
 const url = new URL(request.url);
 if (url.pathname.startsWith("/api/demo/")) return demo(request);
 if (/^\/(?:api|rpc)(?:\/|$)/u.test(url.pathname) || url.pathname === "/health" || /^\/(?:[^/]+\/join|team\/invite)\/[^/]+\/og.png$/u.test(url.pathname)) return proxy(request);
 const redirect = config.redirects.find((entry) => entry.source === url.pathname);
 if (redirect) return Response.redirect(new URL(redirect.destination + url.search, url.origin).href, 308);
 let filePath = resolve(root, `.${decodeURIComponent(url.pathname)}`);
 if (!filePath.startsWith(`${root}/`) && filePath !== root) return new Response(null, {status:403});
 if (url.pathname === "/" || url.pathname === "/home") filePath = resolve(root, url.pathname === "/" && ["redirect", "user_code", "error"].some((key) => url.searchParams.has(key)) ? "app.html" : "home/index.html");
 let file = Bun.file(filePath);
 if (!(await file.exists()) || !extname(filePath)) {
  const index = Bun.file(resolve(filePath, "index.html"));
  file = await index.exists() ? index : Bun.file(resolve(root, "app.html"));
  if (/^\/(?:assets|_astro|product-demo|site-scripts|vendor|fonts)(?:\/|$)/u.test(url.pathname) && !(await index.exists())) return new Response(null,{status:404});
 }
 const headers = new Headers();
 for (const rule of config.headers) if (new RegExp(`^${rule.source}$`, "u").test(url.pathname)) for (const header of rule.headers) headers.set(header.key, header.value);
 return new Response(file, {headers});
}});
console.log(`Product preview listening on ${server.url}`);
