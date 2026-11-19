import type { GitHubRepositoryEvidenceStatus } from "@rudel/api-routes";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsLayout } from "@/features/settings/SettingsLayout";
import { WorkspaceSettingsSection } from "@/features/settings/workspace/WorkspaceSettingsSection";
import { SupportEmailButton } from "@/features/support/SupportEmailButton";
import { McpSettingsView } from "./McpSettingsPage";
import { SelfHostContext, type SelfHostInfo } from "./self-host-info";
import {
	linkableProviders,
	sendsEmail,
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

vi.mock("@/features/settings/workspace/use-workspace-settings-data", () => ({
	useWorkspaceSettingsData: () => ({
		state: { isPending: false, isError: false, hasOrganization: true },
		activeOrg: { id: "org-acme", name: "Acme", slug: "acme" },
		currentUserRole: "owner",
		canManage: true,
		fullOrg: { members: [] },
		pendingInvitations: [],
		invalidate: () => {},
	}),
}));

vi.mock("@/features/analytics/tracking/useTrackProductPageView", () => ({
	useTrackProductPageView: () => {},
}));

vi.mock(
	"@/features/settings/workspace/components/BillingManagementCard",
	() => ({ BillingManagementCard: () => <div>Billing</div> }),
);

vi.mock("@/features/settings/workspace/components/BillingSandboxCard", () => ({
	BillingSandboxCard: () => <div>Billing sandbox</div>,
}));

vi.mock(
	"@/features/settings/workspace/components/WorkspaceIdentityCard",
	() => ({ WorkspaceIdentityCard: () => <div>Workspace identity</div> }),
);

vi.mock(
	"@/features/settings/workspace/components/WorkspaceDangerZoneCard",
	() => ({ WorkspaceDangerZoneCard: () => <div>Danger zone</div> }),
);

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
		expect(sendsEmail(null)).toBe(true);
		expect(linkableProviders(null, ["google", "github"])).toEqual([
			"google",
			"github",
		]);
		expect(showsGitHubSettings(null, connection(false))).toBe(true);
		expect(showsGitHubSettings(null, { visibility: "hidden" })).toBe(false);
	});

	it("follow what a self-hosted server configured", () => {
		expect(workspaceUrlPrefix(info, "opaline.acme.lan")).toBe(
			"opaline.acme.lan/",
		);
		expect(sendsEmail(info)).toBe(false);
		expect(
			sendsEmail({ ...info, auth: { ...info.auth, emailCodes: true } }),
		).toBe(true);
		expect(linkableProviders(info, ["google", "github"])).toEqual([]);
		expect(
			linkableProviders(
				{ ...info, auth: { ...info.auth, social: ["github"] } },
				["google", "github"],
			),
		).toEqual(["github"]);
		expect(showsGitHubSettings(info, connection(false))).toBe(false);
		expect(showsGitHubSettings(info, connection(true))).toBe(true);
	});
});

describe("workspace settings", () => {
	it("show billing to the owner on opaline.so", () => {
		render(withSelfHost(null, <WorkspaceSettingsSection />));
		expect(screen.getByText("Billing")).toBeVisible();
		expect(screen.getByText("Billing sandbox")).toBeVisible();
	});

	it("hide billing on a self-hosted server", () => {
		render(withSelfHost(info, <WorkspaceSettingsSection />));
		expect(screen.getByText("Workspace identity")).toBeVisible();
		expect(screen.queryByText("Billing")).not.toBeInTheDocument();
		expect(screen.queryByText("Billing sandbox")).not.toBeInTheDocument();
	});
});

describe("support email button", () => {
	it("emails Opaline support on opaline.so", () => {
		render(withSelfHost(null, <SupportEmailButton />));
		expect(
			screen.getByRole("link", { name: "Email Opaline support" }),
		).toHaveAttribute("href", expect.stringContaining("mailto:"));
	});

	it("is gone on a self-hosted server", () => {
		render(withSelfHost(info, <SupportEmailButton />));
		expect(
			screen.queryByRole("link", { name: "Email Opaline support" }),
		).not.toBeInTheDocument();
	});
});

describe("settings navigation", () => {
	function tabs() {
		return screen
			.getAllByRole("link")
			.map((link) => link.textContent?.trim() ?? "");
	}

	it("keeps the cloud tabs on opaline.so", () => {
		github.status = connection(true);
		render(withSelfHost(null, <SettingsLayout />));
		expect(tabs()).toEqual([
			"Workspace",
			"GitHub",
			"Sessions",
			"Reports",
			"Members",
			"Account",
		]);
	});

	it("adds MCP and drops an unconfigured GitHub on a self-hosted server", () => {
		github.status = connection(false);
		render(withSelfHost(info, <SettingsLayout />));
		expect(tabs()).toEqual([
			"Workspace",
			"Sessions",
			"Reports",
			"Members",
			"Account",
			"MCP",
		]);
	});
});

describe("MCP settings", () => {
	it("show this server's commands and configs with a placeholder key", () => {
		const { container } = render(
			withSelfHost(info, <McpSettingsView origin="http://localhost:4790" />),
		);
		const text = container.textContent ?? "";
		expect(text).toContain("opaline mcp install");
		expect(text).toContain(
			"npx opaline@latest login --api-base http://localhost:4790",
		);
		expect(text).toContain(
			'claude mcp add --scope user --transport http opaline http://localhost:4790/api/mcp --header "Authorization: Bearer <your CLI API key>"',
		);
		expect(text).toContain("[mcp_servers.opaline]");
		expect(text).toContain('"mcpServers"');
		expect(text).not.toMatch(/Bearer (?!<your CLI API key>)/u);
	});
});
