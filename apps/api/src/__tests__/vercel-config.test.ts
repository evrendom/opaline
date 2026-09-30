import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import chSchemaPackage from "../../../../packages/ch-schema/package.json" with {
	type: "json",
};
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
const nativeLineageEntrypointSource = readFileSync(
	resolve(import.meta.dir, "../../../../api/cron/native-lineage.ts"),
	"utf8",
);
const billingEntrypointSource = readFileSync(
	resolve(import.meta.dir, "../../../../api/cron/billing.ts"),
	"utf8",
);

describe("Vercel deployment configuration", () => {
	test("routes session arrival events through a streaming function before the SPA", () => {
		expect(rewriteBySource.get("/api/sessions/arrivals/events")).toBe(
			"/api/session-arrivals?__opaline_path=/api/sessions/arrivals/events",
		);
		expect(
			vercelConfig.functions["api/session-arrivals.ts"].maxDuration,
		).toBeGreaterThan(240);
		expect(
			rewriteSources.indexOf("/api/sessions/arrivals/events"),
		).toBeLessThan(
			rewriteSources.findIndex((source) =>
				source.startsWith("/:path((?!assets"),
			),
		);
	});

	test("runs native lineage in an isolated bounded daily cron function", () => {
		expect(vercelConfig.functions["api/cron/native-lineage.ts"]).toEqual({
			includeFiles: "{apps/api/src/**,packages/*/src/**}",
			memory: 2048,
			maxDuration: 90,
		});
		expect(vercelConfig.crons).toContainEqual({
			path: "/api/cron/native-lineage",
			schedule: "30 3 * * *",
		});
		expect(
			rewriteBySource.get(
				"/api/:routePath((?!cron/repair$)(?!cron/native-lineage$)(?!cron/billing$)(?!cron/github-evidence$)(?!webhooks/github$).*)",
			),
		).toBe("/api/rpc?__opaline_path=/api/:routePath");
		expect(nativeLineageEntrypointSource).toContain(
			'from "../../apps/api/src/handlers/native-session-lineage-maintenance.js"',
		);
		expect(nativeLineageEntrypointSource).not.toContain("api-maintenance");
		expect(nativeLineageEntrypointSource).toContain(
			"publicPathPattern: /^\\/api\\/cron\\/native-lineage$/u",
		);
	});

	test("runs a daily billing recovery pass compatible with Vercel Hobby", () => {
		expect(vercelConfig.functions["api/cron/billing.ts"]).toEqual({
			includeFiles: "{apps/api/src/**,packages/*/src/**}",
			memory: 1024,
			maxDuration: 60,
		});
		expect(vercelConfig.crons).toContainEqual({
			path: "/api/cron/billing",
			schedule: "15 3 * * *",
		});
		for (const cron of vercelConfig.crons) {
			expect(cron.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/u);
		}
		expect(billingEntrypointSource).toContain(
			'from "../../apps/api/src/handlers/billing-reconciliation-maintenance.js"',
		);
		expect(billingEntrypointSource).toContain(
			"publicPathPattern: /^\\/api\\/cron\\/billing$/u",
		);
	});
	test("runs GitHub evidence maintenance in an isolated cron function", () => {
		expect(vercelConfig.functions["api/cron/github-evidence.ts"]).toEqual({
			includeFiles: "{apps/api/src/**,packages/*/src/**}",
			memory: 2048,
			maxDuration: 300,
		});
		expect(vercelConfig.crons).toContainEqual({
			path: "/api/cron/github-evidence",
			schedule: "45 3 * * *",
		});
		const apiCatchAll = vercelConfig.rewrites.find(
			(rewrite) =>
				rewrite.destination === "/api/rpc?__opaline_path=/api/:routePath",
		);
		expect(apiCatchAll?.source).toContain("(?!cron/github-evidence$)");
	});

	test("receives GitHub App webhooks in an isolated function", () => {
		expect(vercelConfig.functions["api/webhooks/github.ts"]).toEqual({
			includeFiles: "{apps/api/src/**,packages/*/src/**}",
			memory: 1024,
			maxDuration: 300,
		});
		const apiCatchAll = vercelConfig.rewrites.find(
			(rewrite) =>
				rewrite.destination === "/api/rpc?__opaline_path=/api/:routePath",
		);
		expect(apiCatchAll?.source).toContain("(?!webhooks/github$)");
	});

	test("runs ClickHouse forward migrations before a production build", () => {
		// Vercel rejects project build commands longer than 256 characters.
		expect(vercelConfig.buildCommand.length).toBeLessThanOrEqual(256);
		expect(vercelConfig.buildCommand).toContain(
			'if [ "$VERCEL_ENV" = "production" ]',
		);
		const productionMigration =
			"bun run --cwd packages/ch-schema ch:migrate:production";
		expect(
			vercelConfig.buildCommand.indexOf(productionMigration),
		).toBeGreaterThan(-1);
		expect(vercelConfig.buildCommand.indexOf(productionMigration)).toBeLessThan(
			vercelConfig.buildCommand.indexOf("bun run check-types:vercel"),
		);

		const productionScript = chSchemaPackage.scripts["ch:migrate:production"];
		const languageSignals = productionScript.indexOf(
			"ch:migrate:language-signals",
		);
		const transcriptRecords = productionScript.indexOf(
			"ch:migrate:transcript-records",
		);
		const repositoryEvidence = productionScript.indexOf(
			"ch:migrate:repository-evidence-index",
		);
		expect(languageSignals).toBeGreaterThan(-1);
		expect(languageSignals).toBeLessThan(transcriptRecords);
		expect(transcriptRecords).toBeLessThan(repositoryEvidence);
	});

	test("permanently redirects legal aliases and does not resurrect pricing", () => {
		for (const { source, destination } of [
			{ source: "/privacy", destination: "/legal/privacy-policy/" },
			{ source: "/terms", destination: "/legal/terms-of-service/" },
		]) {
			expect(
				vercelConfig.redirects.find((rule) => rule.source === source),
			).toEqual({ source, destination, permanent: true });
		}
		expect(
			vercelConfig.redirects.some((rule) => rule.source === "/pricing"),
		).toBe(false);
	});

	test("routes database readiness to the API before the SPA fallback", () => {
		expect(rewriteBySource.get("/health/ready")).toBe(
			"/api/rpc?__opaline_path=/health/ready",
		);
		expect(VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN.test("/health/ready")).toBe(
			true,
		);
		expect(
			VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN.test("/health/ready/extra"),
		).toBe(false);
		expect(rewriteSources.indexOf("/health/ready")).toBeLessThan(
			rewriteSources.findIndex((source) =>
				source.startsWith("/:path((?!assets"),
			),
		);
	});

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
		expect(rootRules.at(-1)?.destination).toBe("/marketing.html");
		expect(VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN.test("/api/home")).toBe(true);
	});

	test("checks the session before serving the homepage at /home", () => {
		expect(vercelConfig.redirects.some((rule) => rule.source === "/home")).toBe(
			false,
		);
		expect(
			vercelConfig.rewrites.find((rule) => rule.source === "/home"),
		).toEqual({
			source: "/home",
			destination: "/api/rpc?__opaline_path=/api/public-home",
		});
		expect(VERCEL_RPC_AUTH_PUBLIC_PATH_PATTERN.test("/api/public-home")).toBe(
			true,
		);
		expect(rewriteSources.indexOf("/home")).toBeLessThan(
			rewriteSources.findIndex((source) =>
				source.startsWith("/:path((?!assets"),
			),
		);
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
			rewriteSources.findIndex((source) =>
				source.startsWith("/:path((?!assets"),
			),
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
			].replace(
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
				rewrite.destination === "/api/page?__opaline_path=/:path" &&
				rewrite.source.startsWith("/:path((?!"),
		);
		expect(spaFallback).toBeDefined();
		const spaFallbackPattern = new RegExp(
			`^${spaFallback?.source.replace(":path", "") ?? ""}$`,
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
