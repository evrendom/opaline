import { describe, expect, test } from "bun:test";
import {
	AUTH_BASE_PATH,
	getOAuthProviderCallbackURL,
	normalizeAuthBaseURL,
} from "../auth-url.js";

describe("OAuth callback URLs", () => {
	test("keeps the Better Auth base path unscoped", () => {
		expect(AUTH_BASE_PATH).toBe("/api/auth");
	});

	test("builds the exact Google callback registered with the provider", () => {
		expect(getOAuthProviderCallbackURL("https://opaline.so", "google")).toBe(
			"https://opaline.so/api/auth/callback/google",
		);
	});

	test("builds the exact GitHub callback registered with the provider", () => {
		expect(getOAuthProviderCallbackURL("https://opaline.so/", "github")).toBe(
			"https://opaline.so/api/auth/callback/github",
		);
	});

	test("rejects an organization-scoped auth base URL", () => {
		expect(() => normalizeAuthBaseURL("https://opaline.so/acme")).toThrow(
			"APP_URL must be an origin",
		);
	});
});
