import type { GitHubRepositoryEvidenceStatus } from "@rudel/api-routes";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsLayout } from "@/features/settings/SettingsLayout";
import { SelfHostContext, type SelfHostInfo } from "./self-host-info";
import {
	linkableProviders,
	showsGitHubSettings,
	workspaceUrlPrefix,
} from "./surfaces";

const github = vi.hoisted(() => ({
	status: undefined as GitHubRepositoryEvidenceStatus | undefined,
}));

vi.mock("@/features/workspace/organization/useOrganization", () => {
	const organization = {
		state: {
			activeOrg: { id: "org-acme", name: "Acme", slug: "acme" },
			organizations: [{ id: "org-acme", name: "Acme", slug: "acme" }],
			isLoading: false,
		},
		meta: { isOrgAdmin: true },
	};
	return {
		useOrganization: () => organization,
		useOptionalOrganization: () => organization,
	};
});

vi.mock("@/features/settings/github/use-github-connection", () => ({
	useGitHubConnection: () => ({ query: { data: github.status } }),
}));

const info: SelfHostInfo = {
	selfHosted: true,
	version: "dev",
	appUrl: "http://localhost:4790",
	mcpUrl: "http://localhost:4790/api/mcp",
	setupComplete: true,
	auth: { password: true, emailCodes: false, social: [], openSignup: false },
};

function connection(configured: boolean): GitHubRepositoryEvidenceStatus {
	return {
		visibility: "visible",
		dashboard: "notConnected",
		connection: {
			accountLogin: null,
			canManage: true,
			configurationError: configured ? null : "GitHub App is not configured",
			configured,
			connected: false,
			installationId: null,
			manageUrl: null,
			repositories: [],
			repositorySelection: null,
			dashboard: "notConnected",
		},
	};
}

function withSelfHost(selfHost: SelfHostInfo | null, children: ReactNode) {
	return (
		<SelfHostContext value={selfHost}>
			<MemoryRouter initialEntries={["/acme/settings/workspace"]}>
				{children}
			</MemoryRouter>
		</SelfHostContext>
	);
}

afterEach(() => {
	github.status = undefined;
});

describe("surface rules", () => {
	it("keep every cloud surface on opaline.so", () => {
		expect(workspaceUrlPrefix(null)).toBe("opaline.so/");
		expect(linkableProviders(null, ["google", "github"])).toEqual([
			"google",
			"github",
		]);
	});

	it("follow what a self-hosted server configured", () => {
		expect(workspaceUrlPrefix(info, "opaline.acme.lan")).toBe(
			"opaline.acme.lan/",
		);
		expect(linkableProviders(info, ["google", "github"])).toEqual([]);
		expect(
			linkableProviders(
				{ ...info, auth: { ...info.auth, social: ["github"] } },
				["google", "github"],
			),
		).toEqual(["github"]);
		expect(showsGitHubSettings(connection(false))).toBe(false);
		expect(showsGitHubSettings(connection(true))).toBe(true);
		expect(showsGitHubSettings({ visibility: "hidden" })).toBe(false);
	});
});

describe("settings navigation", () => {
	function tabs() {
		return screen
			.getAllByRole("link")
			.map((link) => link.textContent?.trim() ?? "");
	}

	it("shows GitHub once the server has a token configured", () => {
		github.status = connection(true);
		render(withSelfHost(info, <SettingsLayout />));
		expect(tabs()).toEqual([
			"Workspace",
			"GitHub",
			"Sessions",
			"Reports",
			"Members",
			"Account",
		]);
	});

	it("drops an unconfigured GitHub on a self-hosted server", () => {
		github.status = connection(false);
		render(withSelfHost(info, <SettingsLayout />));
		expect(tabs()).toEqual([
			"Workspace",
			"Sessions",
			"Reports",
			"Members",
			"Account",
		]);
	});
});
