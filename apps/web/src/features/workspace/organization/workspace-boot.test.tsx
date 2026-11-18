import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, expect, it, vi } from "vitest";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import {
	readBootOrganization,
	resolveActiveOrganization,
} from "./boot-workspace";
import { OrganizationProvider, useOrganization } from "./OrganizationProvider";

const {
	mockSetActive,
	mockUseActiveMember,
	mockUseActiveOrganization,
	mockUseListOrganizations,
	mockUseSession,
} = vi.hoisted(() => ({
	mockSetActive: vi.fn(),
	mockUseActiveMember: vi.fn(),
	mockUseActiveOrganization: vi.fn(),
	mockUseListOrganizations: vi.fn(),
	mockUseSession: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		organization: { setActive: mockSetActive },
		useActiveMember: mockUseActiveMember,
		useActiveOrganization: mockUseActiveOrganization,
		useListOrganizations: mockUseListOrganizations,
		useSession: mockUseSession,
	},
}));

const acme = { id: "org-acme", slug: "acme", name: "Acme", logo: null };
const beta = { id: "org-beta", slug: "beta", name: "Beta", logo: null };
const boot = { id: "org-acme", slug: "acme", name: "", logo: null };

beforeAll(() => {
	const meta = document.createElement("meta");
	meta.name = "opaline-workspace";
	meta.content = "acme";
	meta.dataset.id = "org-acme";
	document.head.append(meta);
});

it("reads the page's workspace once and only when both values are there", () => {
	expect(readBootOrganization(document)).toEqual(boot);
	const empty = document.implementation.createHTMLDocument();
	expect(readBootOrganization(empty)).toBeNull();
	expect(readBootOrganization(undefined)).toBeNull();
});

it("the URL's workspace wins over the session's, from the page before the list arrives", () => {
	const input = {
		urlSlug: "acme",
		activeOrganizationId: beta.id,
		optimisticActiveOrganizationId: null,
		bootOrganization: boot,
	};
	expect(
		resolveActiveOrganization({ ...input, organizations: undefined }),
	).toBe(boot);
	expect(
		resolveActiveOrganization({ ...input, organizations: [acme, beta] }),
	).toBe(acme);
	expect(
		resolveActiveOrganization({ ...input, organizations: [beta] }),
	).toBeNull();
	expect(
		resolveActiveOrganization({
			...input,
			urlSlug: "beta",
			organizations: undefined,
		}),
	).toBeNull();
	expect(
		resolveActiveOrganization({
			...input,
			urlSlug: null,
			organizations: [acme, beta],
		}),
	).toBe(beta);
});

function AnalyticsProbe({ queryFn }: { queryFn: () => Promise<string> }) {
	const { state } = useOrganization();
	const query = useAnalyticsQuery({ queryKey: ["probe"], queryFn });
	return (
		<output>
			{state.activeOrg?.id ?? "none"}:{query.data ?? "waiting"}
		</output>
	);
}

it("analytics queries start before the workspace list resolves, and the session follows the URL in the background", async () => {
	mockUseSession.mockReturnValue({
		data: {
			user: { id: "user-1" },
			session: { activeOrganizationId: beta.id },
		},
		isPending: false,
	});
	mockUseActiveOrganization.mockReturnValue({ data: null, isPending: true });
	mockUseListOrganizations.mockReturnValue({ data: null, isPending: true });
	mockUseActiveMember.mockReturnValue({ data: null });
	let finishSetActive: () => void = () => undefined;
	mockSetActive.mockReturnValue(
		new Promise((resolve) => {
			finishSetActive = () => resolve({ data: acme, error: null });
		}),
	);
	const queryFn = vi.fn(async () => "rows");

	render(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter initialEntries={["/acme/sessions"]}>
				<OrganizationProvider>
					<AnalyticsProbe queryFn={queryFn} />
				</OrganizationProvider>
			</MemoryRouter>
		</QueryClientProvider>,
	);

	await waitFor(() =>
		expect(screen.getByText("org-acme:rows")).toBeInTheDocument(),
	);
	expect(queryFn).toHaveBeenCalledTimes(1);
	expect(mockSetActive).toHaveBeenCalledTimes(1);
	expect(mockSetActive).toHaveBeenCalledWith({ organizationId: "org-acme" });
	finishSetActive();
});
