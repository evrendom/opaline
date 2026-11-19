import { describe, expect, test } from "bun:test";
import { readVercelDeploymentOrigins } from "../lib/env.js";

describe("readVercelDeploymentOrigins", () => {
	test("trusts the exact generated and branch preview origins", () => {
		expect(
			readVercelDeploymentOrigins({
				VERCEL_URL: "opaline-a4ebbxs03-opalinehq.vercel.app",
				VERCEL_BRANCH_URL: "opaline-git-login-opalinehq.vercel.app",
			}),
		).toEqual([
			"https://opaline-a4ebbxs03-opalinehq.vercel.app",
			"https://opaline-git-login-opalinehq.vercel.app",
		]);
	});

	test("deduplicates aliases that resolve to the same origin", () => {
		expect(
			readVercelDeploymentOrigins({
				VERCEL_URL: "opaline-preview.vercel.app",
				VERCEL_BRANCH_URL: "opaline-preview.vercel.app",
			}),
		).toEqual(["https://opaline-preview.vercel.app"]);
	});

	test("ignores malformed or non-Vercel hostnames", () => {
		expect(
			readVercelDeploymentOrigins({
				VERCEL_URL: "attacker.example",
				VERCEL_BRANCH_URL: "opaline.vercel.app/path",
			}),
		).toEqual([]);
	});
});
