import type { AdminWorkspaceFeatures } from "@rudel/api-routes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { WorkspaceFeaturesAdminPage } from "./WorkspaceFeaturesAdminPage";

/**
 * The features page against a stand-in API that keeps one workspace's switch
 * in memory like the server: a switch wins over the environment list, and
 * removing it hands the decision back.
 */
const api = vi.hoisted(() => {
	let override: boolean | null = null;
	const environment = false;
	const listing = (): AdminWorkspaceFeatures => ({
		features: [
			{
				key: "agent_traces",
				label: "Agent traces",
				description: "The Agent traces page.",
				env: "AGENT_TRACES_WORKSPACES",
			},
		],
		workspaces: [
			{
				id: "ws-1",
				name: "Acme",
				slug: "acme",
				members: 3,
				features: [
					{
						key: "agent_traces",
						override,
						environment,
						enabled: override ?? environment,
						updatedAt: override === null ? null : "2026-10-14T12:00:00.000Z",
					},
				],
			},
		],
		total: 1,
	});
	const sets: (boolean | null)[] = [];
	return {
		sets,
		workspaceFeatures: {
			list: async () => listing(),
			set: async (input: { enabled: boolean | null }) => {
				sets.push(input.enabled);
				override = input.enabled;
				return listing().workspaces[0];
			},
		},
	};
});

vi.mock("@/lib/orpc", () => ({
	client: { admin: { workspaceFeatures: api.workspaceFeatures } },
}));

it("turns a feature on for a workspace and hands it back to the environment", async () => {
	const user = userEvent.setup();
	render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<WorkspaceFeaturesAdminPage />
		</QueryClientProvider>,
	);

	const control = await screen.findByRole("group", {
		name: "agent_traces for Acme",
	});
	expect(
		within(control).getByRole("button", { name: "Default (off)" }),
	).toHaveAttribute("aria-pressed", "true");
	expect(screen.getByText("Disabled")).toBeInTheDocument();

	await user.click(within(control).getByRole("button", { name: "On" }));
	expect(await screen.findByText(/^Enabled · set/)).toBeInTheDocument();

	await user.click(
		within(control).getByRole("button", { name: "Default (off)" }),
	);
	expect(await screen.findByText("Disabled")).toBeInTheDocument();
	expect(api.sets).toEqual([true, null]);
});
