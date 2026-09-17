import { expect, test } from "bun:test";
import { getSitePageRoute } from "../lib/site-page-route.js";

test("retired products are gone, including deep links", () => {
	for (const path of [
		"/wrapped",
		"/wrapped/report/123",
		"/dev/wrapped/",
		"/resume/123",
	]) {
		expect(getSitePageRoute(path)).toEqual({ kind: "gone" });
	}
});

test("unknown public and workspace paths cannot become successful app pages", () => {
	for (const path of [
		"/pricing",
		"/pricing/",
		"/legal/missing",
		"/welcome/missing",
		"/acme/unknown",
		"/acme/settings/unknown",
		"/%FF",
		"/acme%5Cevil",
	]) {
		expect(getSitePageRoute(path)).toEqual({ kind: "not-found" });
	}
});

test("workspace routes require an existence check", () => {
	for (const path of [
		"/acme",
		"/acme/sessions/",
		"/acme/sessions/session-id/v2",
		"/acme/settings/members",
		"/acme/dashboard",
		"/acme/home",
		"/acme/skills",
		"/acme/repos",
		"/acme/newsesh/session-id",
	]) {
		expect(getSitePageRoute(path)).toEqual({ kind: "workspace", slug: "acme" });
	}
	expect(getSitePageRoute("/nonexistent-company")).toEqual({
		kind: "workspace",
		slug: "nonexistent-company",
	});
});

test("login, pairing, onboarding, and existing app aliases remain available", () => {
	for (const path of [
		"/login",
		"/signup",
		"/reset-password",
		"/device",
		"/welcome",
		"/settings/workspace",
		"/session/123/v2",
		"/session/full/123",
		"/session/split",
		"/dashboard/sessions/123",
		"/invitation/123",
		"/team",
		"/skills",
		"/repos",
	]) {
		expect(getSitePageRoute(path)).toEqual({ kind: "app" });
	}
});
