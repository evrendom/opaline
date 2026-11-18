import { describe, expect, test } from "bun:test";
import {
	buildOrganizationPath,
	getOrganizationSlugFromPath,
	resolveOrganizationPostAuthPath,
} from "./organization-paths.js";

describe("organization paths", () => {
	test("builds a canonical organization-scoped path", () => {
		expect(buildOrganizationPath("acme-labs")).toBe("/acme-labs");
		expect(buildOrganizationPath("acme-labs", "sessions/123?tab=log")).toBe(
			"/acme-labs/sessions/123?tab=log",
		);
		expect(buildOrganizationPath("acme-labs", "?from=login")).toBe(
			"/acme-labs?from=login",
		);
	});

	test("rejects reserved and malformed organization slugs", () => {
		expect(() => buildOrganizationPath("api", "settings")).toThrow();
		expect(() => buildOrganizationPath("Acme", "settings")).toThrow();
	});

	test("rejects ambiguous organization-relative paths", () => {
		expect(() => buildOrganizationPath("acme", "/settings")).toThrow();
		expect(() => buildOrganizationPath("acme", "../settings")).toThrow();
		expect(() => buildOrganizationPath("acme", "settings%2faccount")).toThrow();
		expect(() =>
			buildOrganizationPath("acme", "settings/%2e%2e/team"),
		).toThrow();
	});

	test("reads only valid, non-reserved first path segments", () => {
		expect(getOrganizationSlugFromPath("/acme-labs/settings/account")).toBe(
			"acme-labs",
		);
		expect(getOrganizationSlugFromPath("/api/auth/callback/google")).toBeNull();
		expect(getOrganizationSlugFromPath("/wrapped/share-id")).toBeNull();
		expect(getOrganizationSlugFromPath("/%2Fbad/dashboard")).toBeNull();
		expect(getOrganizationSlugFromPath("/%61cme/settings")).toBeNull();
	});

	test("maps generic and legacy post-auth shell destinations", () => {
		expect(resolveOrganizationPostAuthPath("acme", "/")).toBe("/acme");
		expect(
			resolveOrganizationPostAuthPath("acme", "/dashboard?from=login"),
		).toBe("/acme?from=login");
		expect(
			resolveOrganizationPostAuthPath(
				"acme",
				"/dashboard/sessions/session-1#events",
			),
		).toBe("/acme/sessions/session-1#events");
		expect(resolveOrganizationPostAuthPath("acme", "/team")).toBe("/acme/team");
		expect(resolveOrganizationPostAuthPath("acme", "/settings/account")).toBe(
			"/acme/settings/account",
		);
		expect(
			resolveOrganizationPostAuthPath("acme", "/dashboard/sessions-malicious"),
		).toBe("/dashboard/sessions-malicious");
	});

	test("preserves scoped shell and global system destinations", () => {
		expect(resolveOrganizationPostAuthPath("acme", "/other-org/team")).toBe(
			"/other-org/team",
		);
		expect(resolveOrganizationPostAuthPath("acme", "/wrapped/share-id")).toBe(
			"/wrapped/share-id",
		);
		expect(
			resolveOrganizationPostAuthPath("acme", "/invitation/invite-1"),
		).toBe("/invitation/invite-1");
		expect(resolveOrganizationPostAuthPath("acme", "/reset-password")).toBe(
			"/reset-password",
		);
	});

	test("rejects unsafe post-auth destinations", () => {
		expect(
			resolveOrganizationPostAuthPath("acme", "https://evil.example"),
		).toBeNull();
		expect(
			resolveOrganizationPostAuthPath("acme", "//evil.example"),
		).toBeNull();
		expect(
			resolveOrganizationPostAuthPath("acme", "/%2f%2fevil.example"),
		).toBeNull();
		expect(
			resolveOrganizationPostAuthPath("acme", "/%0aevil.example"),
		).toBeNull();
	});
});
