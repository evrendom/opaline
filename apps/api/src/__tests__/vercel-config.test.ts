import { describe, expect, test } from "bun:test";
import vercelConfig from "../../../../vercel.json" with { type: "json" };
import { PRODUCTION_SECURITY_HEADERS } from "../lib/http-response-policy.js";
import {
	VERCEL_INGEST_PUBLIC_PATH_PATTERN,
	VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN,
} from "../lib/vercel-route-patterns.js";

const rewriteBySource = new Map(
	vercelConfig.rewrites.map((rewrite) => [rewrite.source, rewrite.destination]),
);
const rewriteSources = vercelConfig.rewrites.map((rewrite) => rewrite.source);
const headerRuleBySource = new Map(
	vercelConfig.headers.map((rule) => [rule.source, rule.headers]),
);

describe("Vercel deployment configuration", () => {
	test("checks signed-in root visits before marketing while preserving explicit auth flows", () => {
		const rootRules = vercelConfig.rewrites.filter(
			(rule) => rule.source === "/",
		);
		const cookies = rootRules.filter((rule) =>
			rule.has?.some((condition) => condition.type === "cookie"),
		);
		expect(cookies.map((rule) => rule.has?.[0]?.key)).toEqual([
			"__Secure-better-auth.session_token",
			"better-auth.session_token",
		]);
		for (const rule of cookies) {
			expect(rule.destination).toBe("/api/rpc?__opaline_path=/api/home");
		}
		expect(
			rootRules.slice(0, 3).every((rule) => rule.destination === "/app.html"),
		).toBe(true);
		expect(rootRules.at(-1)?.destination).toBe("/home/index.html");
		expect(rewriteBySource.get("/home")).toBe("/home/index.html");
		expect(VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN.test("/api/home")).toBe(true);
	});

	test("routes legacy ingest through the Vercel RPC function", () => {
		expect(rewriteBySource.has("/rpc/ingestSession")).toBe(false);
		expect(headerRuleBySource.has("/rpc/ingestSession")).toBe(false);
		expect(VERCEL_INGEST_PUBLIC_PATH_PATTERN.test("/rpc/ingestSession")).toBe(
			false,
		);
		expect(VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN.test("/rpc/ingestSession")).toBe(
			true,
		);
		expect(rewriteBySource.get("/rpc/:routePath*")).toBe(
			"/api/rpc?__opaline_path=/rpc/:routePath*",
		);
		expect(rewriteSources.indexOf("/rpc/:routePath*")).toBeLessThan(
			rewriteSources.findIndex((source) => source.startsWith("/((?!assets")),
		);
	});

	test("routes only the small R2 protocol endpoints to the ingest function", () => {
		for (const endpoint of ["init", "commit", "status"]) {
			const publicPath = `/rpc/ingest/${endpoint}`;
			expect(rewriteBySource.get(publicPath)).toBe(
				`/api/ingest?__opaline_path=${publicPath}`,
			);
			expect(VERCEL_INGEST_PUBLIC_PATH_PATTERN.test(publicPath)).toBe(true);
			expect(VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN.test(publicPath)).toBe(false);
			expect(rewriteSources.indexOf(publicPath)).toBeLessThan(
				rewriteSources.indexOf("/rpc/:routePath*"),
			);
		}
		expect(rewriteBySource.has("/rpc/ingest/:routePath*")).toBe(false);
		expect(VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN.test("/rpc/health")).toBe(true);
	});

	test("retains production security headers while allowing the same-origin demo", () => {
		const vercelSecurityHeaders = Object.fromEntries(
			configuredHeadersForPath("/workspace/sessions").map((header) => [
				header.key,
				header.value,
			]),
		);

		expect(vercelSecurityHeaders).toEqual({
			...PRODUCTION_SECURITY_HEADERS,
			"Content-Security-Policy": PRODUCTION_SECURITY_HEADERS[
				"Content-Security-Policy"
			]
				.replace("frame-src ", "frame-src 'self' ")
				.replace(
					"connect-src 'self'",
					"connect-src 'self' https://api.github.com",
				),
		});
		const demoHeaders = Object.fromEntries(
			configuredHeadersForPath("/product-demo/index.html").map((header) => [
				header.key,
				header.value,
			]),
		);
		expect(demoHeaders["X-Frame-Options"]).toBe("SAMEORIGIN");
		expect(demoHeaders["Content-Security-Policy"]).toBe(
			(vercelSecurityHeaders["Content-Security-Policy"] ?? "").replace(
				"frame-ancestors 'none'",
				"frame-ancestors 'self'",
			),
		);
	});

	test("keeps missing built assets out of the SPA and immutable cache policy", () => {
		const spaFallback = vercelConfig.rewrites.find(
			(rewrite) =>
				rewrite.destination === "/app.html" &&
				rewrite.source.startsWith("/((?!"),
		);
		expect(spaFallback).toBeDefined();
		const spaFallbackPattern = new RegExp(
			`^${spaFallback?.source ?? ""}$`,
			"u",
		);
		for (const missingAssetPath of [
			"/assets",
			"/assets/app-missing-hash.js",
			"/_astro/missing.js",
			"/product-demo/missing.js",
			"/site-scripts/missing.js",
		]) {
			expect(spaFallbackPattern.test(missingAssetPath)).toBe(false);
		}
		expect(spaFallbackPattern.test("/dashboard")).toBe(true);
		expect(
			configuredHeadersForPath("/assets/app-missing-hash.js").filter(
				(header) =>
					header.key === "Cache-Control" && header.value.includes("immutable"),
			),
		).toEqual([]);
	});
});

function configuredHeadersForPath(pathname: string) {
	return vercelConfig.headers
		.filter((rule) => headerSourceMatchesPath(rule.source, pathname))
		.flatMap((rule) => rule.headers);
}

function headerSourceMatchesPath(source: string, pathname: string): boolean {
	if (source === "/(.*)") return true;
	if (source.endsWith(":path*")) {
		return pathname.startsWith(source.slice(0, -":path*".length));
	}
	return new RegExp(`^${source}$`, "u").test(pathname);
}
