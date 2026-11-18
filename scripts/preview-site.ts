import { resolve, extname } from "node:path";
import { createDemoHandler } from "../apps/api/src/handlers/demo-http.js";
import { handleSitePageRequest } from "../apps/api/src/handlers/site-page-http.js";
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
 if (/^\/(?:api|rpc)(?:\/|$)/u.test(url.pathname) || url.pathname === "/health" || /^\/(?:[^/]+\/join|team\/invite)\/[^/]+(?:\/og\.png)?$/u.test(url.pathname)) return proxy(request);
 if (url.pathname === "/home") {
  const headers = {"Cache-Control": "private, no-store", Vary: "Cookie"};
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, {status: 405, headers: {...headers, Allow: "GET, HEAD"}});
  const session = await proxy(new Request(new URL("/api/auth/get-session", url), {headers: request.headers}));
  if (!session.ok) return session;
  if (!(await session.json())) {
   for (const key of ["redirect", "user_code", "error"]) url.searchParams.delete(key);
   return new Response(null, {status: 302, headers: {...headers, Location: `/${url.search}`}});
  }
 }
 const redirect = config.redirects.find((entry) => entry.source === url.pathname.replace(/\/$/u, ""));
 if (url.pathname === "/" && !["redirect", "user_code", "error"].some((key) => url.searchParams.has(key)) && /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/.test(request.headers.get("Cookie") ?? "")) {
  url.pathname = "/api/home";
  const response = await proxy(new Request(url, request));
  if (response.status !== 302 || response.headers.get("Location") !== "/") return response;
  url.pathname = "/";
 }
 if (redirect) return Response.redirect(new URL(redirect.destination + url.search, url.origin).href, 308);
 let filePath = resolve(root, `.${decodeURIComponent(url.pathname)}`);
 if (!filePath.startsWith(`${root}/`) && filePath !== root) return new Response(null, {status:403});
 if (url.pathname === "/" || url.pathname === "/home") filePath = resolve(root, url.pathname === "/" && ["redirect", "user_code", "error"].some((key) => url.searchParams.has(key)) ? "app.html" : "marketing.html");
 let file = Bun.file(filePath);
 if (!(await file.exists()) || !extname(filePath)) {
  const index = Bun.file(resolve(filePath, "index.html"));
  if (!(await index.exists())) return handleSitePageRequest(request, root);
  file = index;
 }
 const headers = new Headers();
 if (url.pathname === "/home") { headers.set("Cache-Control", "private, no-store"); headers.set("Vary", "Cookie"); }
 for (const rule of config.headers) if (new RegExp(`^${rule.source.replace(":path*", ".*")}$`, "u").test(url.pathname)) for (const header of rule.headers) headers.set(header.key, header.value);
 return new Response(file, {headers});
}});
console.log(`Product preview listening on ${server.url}`);
