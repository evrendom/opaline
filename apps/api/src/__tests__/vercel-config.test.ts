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
	test("keeps legacy large-body ingest on Fly until the CLI R2 cutover", () => {
		expect(rewriteBySource.get("/rpc/ingestSession")).toBe(
			"https://rudel.fly.dev/rpc/ingestSession",
		);
		expect(
			headerRuleBySource
				.get("/rpc/ingestSession")
				?.find((header) => header.key === "X-Opaline-Ingest-Cutover-Gate")
				?.value,
		).toBe("legacy-fly-until-cli-r2-adoption");
		expect(VERCEL_INGEST_PUBLIC_PATH_PATTERN.test("/rpc/ingestSession")).toBe(
			false,
		);
		expect(VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN.test("/rpc/ingestSession")).toBe(
			false,
		);
		expect(rewriteSources.indexOf("/rpc/ingestSession")).toBeLessThan(
			rewriteSources.indexOf("/rpc/:routePath*"),
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

	test("matches the Fly security headers on SPA responses", () => {
		const vercelSecurityHeaders = Object.fromEntries(
			(headerRuleBySource.get("/(.*)") ?? []).map((header) => [
				header.key,
				header.value,
			]),
		);

		expect(vercelSecurityHeaders).toEqual(PRODUCTION_SECURITY_HEADERS);
	});

	test("keeps missing built assets out of the SPA and immutable cache policy", () => {
		const spaFallback = vercelConfig.rewrites.find(
			(rewrite) => rewrite.destination === "/index.html",
		);
		expect(spaFallback).toBeDefined();
		const spaFallbackPattern = new RegExp(
			`^${spaFallback?.source ?? ""}$`,
			"u",
		);
		for (const missingAssetPath of ["/assets", "/assets/app-missing-hash.js"]) {
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
	return source === pathname;
}
