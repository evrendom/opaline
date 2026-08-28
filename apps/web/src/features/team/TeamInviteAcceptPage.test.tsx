import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptTeamInvite } from "@/features/team/TeamInviteAcceptPage";

const { mockAccept } = vi.hoisted(() => ({
	mockAccept: vi.fn(),
}));

vi.mock("@/lib/orpc", () => ({
	client: { teamInviteLink: { accept: mockAccept } },
}));

describe("acceptTeamInvite", () => {
	beforeEach(() => {
		mockAccept.mockReset();
	});

	it("opens the accepted workspace on its canonical team route", async () => {
		mockAccept.mockResolvedValue({ organization_id: "org-2" });
		const setState = vi.fn();
		const switchOrganization = vi.fn().mockResolvedValue(true);

		await acceptTeamInvite({
			setState,
			switchOrganization,
			token: "invite-token",
		});

		expect(switchOrganization).toHaveBeenCalledWith("org-2", {
			destination: "team",
		});
		expect(setState).toHaveBeenLastCalledWith({ status: "ready" });
	});

	it("shows an error when the accepted workspace cannot become active", async () => {
		mockAccept.mockResolvedValue({ organization_id: "org-2" });
		const setState = vi.fn();

		await acceptTeamInvite({
			setState,
			switchOrganization: vi.fn().mockResolvedValue(false),
			token: "invite-token",
		});

		expect(setState).toHaveBeenLastCalledWith({
			message:
				"You joined the workspace, but it could not be opened. Refresh and try again.",
			status: "error",
		});
	});
});
