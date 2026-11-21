import { describe, expect, it } from "vitest";
import { appRoutes } from "@/app/routes";
import {
	getEmailLoginSuccessDestination,
	getEmailSignupSuccessDestination,
	getSocialSignupRedirectOptions,
	getValidRedirect,
	isGetStartedPath,
} from "./auth-route-utils";

describe("auth route destinations", () => {
	it("routes homepage email signups to setup", () => {
		expect(getEmailSignupSuccessDestination("/", "")).toBe("/welcome");
	});

	it("matches both canonical and legacy get-started paths", () => {
		expect(isGetStartedPath(appRoutes.getStarted())).toBe(true);
		expect(isGetStartedPath(appRoutes.dashboardGetStartedLegacy())).toBe(true);
		expect(isGetStartedPath(appRoutes.dashboard())).toBe(false);
	});

	it("preserves an explicit redirect for email signup success", () => {
		expect(
			getEmailSignupSuccessDestination(
				"/",
				"?redirect=%2Fdashboard%2Fsessions",
			),
		).toBe("/dashboard/sessions");
	});

	it("preserves device flow destinations for email signup", () => {
		expect(getEmailSignupSuccessDestination("/", "?user_code=ABCD")).toBe(
			"/welcome?user_code=ABCD",
		);
	});

	it("preserves direct non-root destinations for email signup", () => {
		expect(getEmailSignupSuccessDestination("/settings/account", "")).toBe(
			"/settings/account",
		);
	});

	it("routes homepage email logins back to the app root", () => {
		expect(getEmailLoginSuccessDestination("/", "")).toBe("/");
	});

	it("preserves explicit redirect destinations for email login", () => {
		expect(
			getEmailLoginSuccessDestination("/", "?redirect=%2Fdashboard%2Fsessions"),
		).toBe("/dashboard/sessions");
	});

	it.each([
		["a scheme-relative URL", "?redirect=%2F%2Fattacker.example"],
		["a raw backslash", "?redirect=%2F%5Cattacker.example"],
		["an encoded backslash", "?redirect=%2F%255Cattacker.example"],
		["an encoded slash", "?redirect=%2F%252Fattacker.example"],
		["a raw control character", "?redirect=%2F%00attacker.example"],
		["an encoded control character", "?redirect=%2F%250Aattacker.example"],
	])("rejects %s as a post-auth redirect", (_label, search) => {
		expect(getValidRedirect(search)).toBeNull();
		expect(getEmailLoginSuccessDestination("/", search)).toBe("/");
	});

	it("uses a separate new-user social signup destination on the homepage", () => {
		expect(getSocialSignupRedirectOptions("/", "")).toEqual({
			callbackURL: "/",
			newUserCallbackURL: "/welcome",
		});
	});

	it("preserves redirect destinations for social signup flows", () => {
		expect(
			getSocialSignupRedirectOptions("/", "?redirect=%2Fsettings%2Faccount"),
		).toEqual({
			callbackURL: "/settings/account",
			newUserCallbackURL: "/settings/account",
		});
	});

	it("preserves device destinations for social signup flows", () => {
		expect(getSocialSignupRedirectOptions("/", "?user_code=ABCD")).toEqual({
			callbackURL: "/welcome?user_code=ABCD",
			newUserCallbackURL: "/welcome?user_code=ABCD",
		});
	});
});
