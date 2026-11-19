import { describe, expect, test } from "bun:test";
import {
	getInvitedWorkspaceId,
	getInvitedWorkspaceOnboardingPath,
} from "./invited-workspace-onboarding";

describe("invited workspace onboarding", () => {
	test("carries the accepted workspace into welcome", () => {
		const path = getInvitedWorkspaceOnboardingPath("org/with spaces");

		expect(path).toBe("/welcome?workspace=org%2Fwith+spaces");
		expect(getInvitedWorkspaceId("?workspace=org%2Fwith+spaces")).toBe(
			"org/with spaces",
		);
	});

	test("ignores missing, blank, and oversized workspace ids", () => {
		expect(getInvitedWorkspaceId("")).toBeNull();
		expect(getInvitedWorkspaceId("?workspace=%20%20")).toBeNull();
		expect(getInvitedWorkspaceId(`?workspace=${"a".repeat(201)}`)).toBeNull();
	});
});
