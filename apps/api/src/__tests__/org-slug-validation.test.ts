import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { validateOrgSlug } from "@rudel/api-routes/reserved-slugs";
import {
	buildDefaultOrganizationSlug,
	createOrganizationPlugin,
} from "../auth.js";

const organizationHooks = createOrganizationPlugin({
	appURL: "http://localhost:4010",
	frontendURL: "http://localhost:4011",
	secret: "test-secret-that-is-at-least-32-chars",
}).options.organizationHooks;

assert(organizationHooks);

const beforeCreateOrganization = organizationHooks.beforeCreateOrganization;
const beforeUpdateOrganization = organizationHooks.beforeUpdateOrganization;

assert(beforeCreateOrganization);
assert(beforeUpdateOrganization);

const user = {
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	email: "user@example.com",
	emailVerified: true,
	id: "user-1",
	name: "Test User",
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("organization slug validation hooks", () => {
	test("rejects a reserved slug at organization creation", async () => {
		await expect(
			beforeCreateOrganization({
				organization: { name: "Dashboard", slug: "dashboard" },
				user,
			}),
		).rejects.toMatchObject({
			message: "Organization slug is invalid or reserved",
			status: "BAD_REQUEST",
		});
	});

	test("allows a valid slug at organization creation", async () => {
		await expect(
			beforeCreateOrganization({
				organization: { name: "Farmerville", slug: "farmerville" },
				user,
			}),
		).resolves.toBeUndefined();
	});

	test("rejects uppercase slugs at organization creation", async () => {
		await expect(
			beforeCreateOrganization({
				organization: { name: "Farmerville", slug: "Farmerville" },
				user,
			}),
		).rejects.toMatchObject({
			message: "Organization slug is invalid or reserved",
			status: "BAD_REQUEST",
		});
	});

	test("validates slug updates and permits updates without a slug", async () => {
		const member = {
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			id: "member-1",
			organizationId: "org-1",
			role: "owner",
			userId: user.id,
		};

		await expect(
			beforeUpdateOrganization({
				member,
				organization: { slug: "wrapped" },
				user,
			}),
		).rejects.toMatchObject({
			message: "Organization slug is invalid or reserved",
			status: "BAD_REQUEST",
		});

		await expect(
			beforeUpdateOrganization({
				member,
				organization: { name: "Renamed workspace" },
				user,
			}),
		).resolves.toBeUndefined();
	});
});

describe("buildDefaultOrganizationSlug", () => {
	test("sanitizes email local parts into valid slugs", () => {
		const slug = buildDefaultOrganizationSlug(
			"Jane.Doe+work@example.com",
			"AbCdEf12rest",
		);
		expect(slug).toBe("jane-doe-work-abcdef12");
		expect(validateOrgSlug(slug)).toBe(true);
	});

	test("falls back to a generated slug when nothing is salvageable", () => {
		const slug = buildDefaultOrganizationSlug("..@example.com", "________");
		expect(slug).toMatch(/^workspace-[0-9a-f-]{8}$/);
		expect(validateOrgSlug(slug)).toBe(true);
	});

	test("never produces a reserved slug", () => {
		const slug = buildDefaultOrganizationSlug(
			"dashboard@example.com",
			"12345678rest",
		);
		expect(slug).toBe("dashboard-12345678");
		expect(validateOrgSlug(slug)).toBe(true);
	});
});
