import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { validateOrgSlug } from "@rudel/api-routes/reserved-slugs";
import {
	buildDefaultOrganizationSlug,
	createDefaultOrganizationWithRetry,
	createOrganizationPlugin,
} from "../auth-organization.js";

const organizationHooks = createOrganizationPlugin(
	{ frontendURL: "http://localhost:4011" },
	{
		enqueueBillingTraitsForUser: async () => {},
		getOrganizationMemberLimit: async () => 3,
		logBillingTraitsError: () => {},
		sendOrganizationInvitationEmail: async () => {},
	},
).options.organizationHooks;

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

describe("createDefaultOrganizationWithRetry", () => {
	test("retries a colliding slug with a fallback and returns the result", async () => {
		const attempts: string[] = [];
		const org = await createDefaultOrganizationWithRetry({
			create: async (data) => {
				attempts.push(data.slug);
				if (attempts.length === 1) {
					throw new Error(
						'duplicate key value violates unique constraint "organization_slug_unique"',
					);
				}
				return { id: data.id, slug: data.slug };
			},
			email: "a.b@example.com",
			name: "Test Workspace",
			userId: "AbCdEf12rest",
		});

		expect(attempts).toHaveLength(2);
		expect(attempts[0]).toBe("a-b-abcdef12");
		expect(attempts[1]).toMatch(/^workspace-[0-9a-f]{8}$/);
		expect(org.slug).toBe(attempts[1] ?? "");
	});

	test("propagates non-collision failures without a second insert", async () => {
		const attempts: string[] = [];
		await expect(
			createDefaultOrganizationWithRetry({
				create: async (data) => {
					attempts.push(data.slug);
					throw new Error("Connection terminated unexpectedly");
				},
				email: "jane@example.com",
				name: "Test Workspace",
				userId: "12345678rest",
			}),
		).rejects.toThrow("Connection terminated unexpectedly");
		expect(attempts).toEqual(["jane-12345678"]);
	});

	test("uses the sanitized slug when the first insert succeeds", async () => {
		const attempts: string[] = [];
		const org = await createDefaultOrganizationWithRetry({
			create: async (data) => {
				attempts.push(data.slug);
				return { id: data.id, slug: data.slug };
			},
			email: "jane@example.com",
			name: "Test Workspace",
			userId: "12345678rest",
		});

		expect(attempts).toEqual(["jane-12345678"]);
		expect(org.slug).toBe("jane-12345678");
	});
});
