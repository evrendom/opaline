import { describe, expect, test } from "bun:test";
import {
	ORG_SLUG_MAX_LENGTH,
	ORG_SLUG_MIN_LENGTH,
	RESERVED_ORG_SLUGS,
	validateOrgSlug,
} from "../reserved-slugs.js";

describe("validateOrgSlug", () => {
	test("accepts lowercase slugs within the length bounds", () => {
		const validSlugs = [
			"ac",
			"acme",
			"acme-co",
			"a1",
			"1a",
			"alpha-2",
			"z".repeat(ORG_SLUG_MAX_LENGTH),
		];

		for (const slug of validSlugs) {
			expect(validateOrgSlug(slug)).toBe(true);
		}
	});

	test("rejects slugs outside the length bounds", () => {
		expect(validateOrgSlug("a".repeat(ORG_SLUG_MIN_LENGTH - 1))).toBe(false);
		expect(validateOrgSlug("a".repeat(ORG_SLUG_MAX_LENGTH + 1))).toBe(false);
	});

	test("rejects uppercase, non-ASCII, and non-slug characters", () => {
		const invalidSlugs = [
			"Acme",
			"ACME",
			"acme_inc",
			"acme.inc",
			"acme/team",
			"acme team",
			"café",
		];

		for (const slug of invalidSlugs) {
			expect(validateOrgSlug(slug)).toBe(false);
		}
	});

	test("rejects leading and trailing hyphens", () => {
		for (const slug of ["-acme", "acme-", "-"]) {
			expect(validateOrgSlug(slug)).toBe(false);
		}
	});

	test("rejects every reserved platform and marketing route", () => {
		expect(RESERVED_ORG_SLUGS.length).toBeGreaterThanOrEqual(50);

		for (const slug of RESERVED_ORG_SLUGS) {
			expect(validateOrgSlug(slug)).toBe(false);
		}
	});

	test("reserves confusable and filename-style route names explicitly", () => {
		for (const slug of [
			"admln",
			"robots.txt",
			"sitemap.xml",
			"favicon.ico",
			".well-known",
		]) {
			expect(RESERVED_ORG_SLUGS).toContain(slug);
			expect(validateOrgSlug(slug)).toBe(false);
		}
	});
});
