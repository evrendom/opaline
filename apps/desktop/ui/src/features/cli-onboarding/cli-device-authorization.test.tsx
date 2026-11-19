import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CliDeviceAuthorization } from "./cli-device-authorization";

const { mockSubmitCliDeviceDecision, mockTrackAuthenticationAction } =
	vi.hoisted(() => ({
		mockSubmitCliDeviceDecision: vi.fn(),
		mockTrackAuthenticationAction: vi.fn(),
	}));

vi.mock("./cli-onboarding-auth", () => ({
	submitCliDeviceDecision: mockSubmitCliDeviceDecision,
}));

vi.mock("@/features/analytics/tracking/useAnalyticsTracking", () => ({
	useAnalyticsTracking: () => ({
		trackAuthenticationAction: mockTrackAuthenticationAction,
	}),
}));

describe("CliDeviceAuthorization", () => {
	beforeEach(() => {
		mockSubmitCliDeviceDecision.mockReset();
		mockTrackAuthenticationAction.mockReset();
	});

	it("approves the CLI request and tells the user to return to the terminal", async () => {
		mockSubmitCliDeviceDecision.mockResolvedValue(undefined);
		const user = userEvent.setup();
		const { container } = render(
			<CliDeviceAuthorization userCode="ABCD-1234" userId="user-1" />,
		);

		expect(screen.getByText("CLI code ABCD-1234")).toHaveClass("sr-only");
		expect(
			container.querySelectorAll(".cli-device-code-character"),
		).toHaveLength(8);
		expect(
			container.querySelector(".cli-device-code-separator"),
		).toHaveTextContent("–");
		await user.click(
			screen.getByRole("button", { name: "Approve and continue" }),
		);

		await waitFor(() => {
			expect(screen.getByText("Terminal connected")).toBeInTheDocument();
		});
		expect(mockSubmitCliDeviceDecision).toHaveBeenCalledWith(
			"ABCD-1234",
			"approve",
		);
		expect(mockTrackAuthenticationAction).toHaveBeenCalledWith({
			actionName: "approve_device_login",
			sourceComponent: "device_login",
			authMethod: "device_code",
			targetId: "ABCD-1234",
			userId: "user-1",
		});
	});
});
