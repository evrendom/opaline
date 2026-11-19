import { expect, test } from "bun:test";
import type { GitHubRepositoryEvidenceStatus } from "@rudel/api-routes";
import { renderToStaticMarkup } from "react-dom/server";
import {
	isGitHubOnboardingAvailable,
	WelcomeGitHubStep,
} from "./welcome-github-step";

const NOT_CONNECTED: GitHubRepositoryEvidenceStatus = {
	visibility: "visible",
	dashboard: "notConnected",
	connection: {
		accountLogin: null,
		canManage: true,
		configurationError: null,
		configured: true,
		connected: false,
		installationId: null,
		manageUrl: null,
		repositories: [],
		repositorySelection: null,
	},
};

function renderStep(
	status: GitHubRepositoryEvidenceStatus,
	result: Parameters<typeof WelcomeGitHubStep>[0]["result"] = null,
) {
	return renderToStaticMarkup(
		<WelcomeGitHubStep
			status={status}
			result={result}
			connected={false}
			busy={false}
			error={null}
			onConnect={() => {}}
			onSkip={() => {}}
			onContinue={() => {}}
		/>,
	);
}

test("offers the GitHub step only to admins on a configured deployment", () => {
	expect(isGitHubOnboardingAvailable(NOT_CONNECTED)).toBe(true);
	expect(isGitHubOnboardingAvailable({ visibility: "hidden" })).toBe(false);
	expect(isGitHubOnboardingAvailable(undefined)).toBe(false);
	expect(
		isGitHubOnboardingAvailable({
			...NOT_CONNECTED,
			connection: { ...NOT_CONNECTED.connection, canManage: false },
		}),
	).toBe(false);
	expect(
		isGitHubOnboardingAvailable({
			...NOT_CONNECTED,
			connection: { ...NOT_CONNECTED.connection, configured: false },
		}),
	).toBe(false);
});

test("lets the admin connect or skip, and explains what is read", () => {
	const markup = renderStep(NOT_CONNECTED);

	expect(markup).toContain("Connect GitHub");
	expect(markup).toContain("Skip for now");
	expect(markup).toContain("never stored.");
});

test("continues once connected and shows a failed connection's reason", () => {
	const connected = renderStep(NOT_CONNECTED, "connected");
	expect(connected).toContain("GitHub is connected.");
	expect(connected).toContain("Continue");
	expect(connected).not.toContain("Skip for now");

	const failed = renderStep(NOT_CONNECTED, "already-connected");
	expect(failed).toContain("already connected to another workspace");
	expect(failed).toContain("Skip for now");
});
