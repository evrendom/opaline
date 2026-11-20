import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CliSignIn } from "./cli-sign-in";

const {
	mockAuthFetch,
	mockReadCliSession,
	mockSendCliEmailCode,
	mockSignInCliWithPassword,
} = vi.hoisted(() => ({
	mockAuthFetch: vi.fn(),
	mockReadCliSession: vi.fn(),
	mockSendCliEmailCode: vi.fn(),
	mockSignInCliWithPassword: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		$fetch: mockAuthFetch,
		useSession: () => ({ refetch: vi.fn() }),
	},
}));

vi.mock("./cli-onboarding-auth", () => ({
	readCliSession: mockReadCliSession,
	sendCliEmailCode: mockSendCliEmailCode,
	signInCliWithEmail: vi.fn(),
	signInCliWithPassword: mockSignInCliWithPassword,
	signInCliWithProvider: vi.fn(),
	signOutCliSession: vi.fn(),
}));

vi.mock("./cli-device-authorization", () => ({
	CliDeviceAuthorization: ({ userCode }: { userCode: string }) => (
		<div>Authorize CLI code {userCode}</div>
	),
}));

describe("CLI device sign-in", () => {
	beforeEach(() => {
		mockAuthFetch.mockReset();
		mockReadCliSession.mockReset();
		mockReadCliSession.mockResolvedValue(null);
		mockSendCliEmailCode.mockReset();
		mockSendCliEmailCode.mockResolvedValue(undefined);
		mockSignInCliWithPassword.mockReset();
	});

	it("signs an allowed email in with a password and keeps the fields on focus", async () => {
		mockAuthFetch.mockResolvedValue({ data: { available: true } });
		mockSignInCliWithPassword.mockResolvedValue({
			user: { id: "reviewer-1", email: "openai-review@opaline.so", name: "R" },
		});
		const user = userEvent.setup();
		render(<CliSignIn mode="device" userCode="ABCD-1234" />);

		await user.click(
			await screen.findByRole("button", { name: "Continue with Email" }),
		);
		await user.type(
			screen.getByLabelText("Email address"),
			"openai-review@opaline.so",
		);
		await user.type(
			await screen.findByLabelText("Password"),
			"reviewer-password",
		);
		await act(async () => {
			window.dispatchEvent(new Event("focus"));
		});
		await waitFor(() => {
			expect(mockReadCliSession).toHaveBeenCalledTimes(2);
		});

		expect(screen.getByLabelText("Email address")).toHaveValue(
			"openai-review@opaline.so",
		);
		expect(screen.getByLabelText("Password")).toHaveValue("reviewer-password");
		await user.click(screen.getByRole("button", { name: "Sign in" }));

		expect(
			await screen.findByText("Authorize CLI code ABCD-1234"),
		).toBeInTheDocument();
		expect(mockSignInCliWithPassword).toHaveBeenCalledWith(
			"openai-review@opaline.so",
			"reviewer-password",
		);
		expect(mockSendCliEmailCode).not.toHaveBeenCalled();
	});

	it("lets an allowed email choose an email code", async () => {
		mockAuthFetch.mockResolvedValue({ data: { available: true } });
		const user = userEvent.setup();
		render(<CliSignIn mode="device" userCode="ABCD-1234" />);

		await user.click(
			await screen.findByRole("button", { name: "Continue with Email" }),
		);
		await user.type(
			screen.getByLabelText("Email address"),
			"openai-review@opaline.so",
		);
		await screen.findByLabelText("Password");
		await user.click(
			screen.getByRole("button", { name: "Use an email code instead" }),
		);
		await user.click(screen.getByRole("button", { name: "Send sign-in code" }));

		expect(await screen.findByLabelText("Sign-in code")).toBeInTheDocument();
		expect(mockSendCliEmailCode).toHaveBeenCalledWith(
			"openai-review@opaline.so",
		);
		expect(mockSignInCliWithPassword).not.toHaveBeenCalled();
	});

	it("sends an email code to any other email", async () => {
		mockAuthFetch.mockResolvedValue({ data: { available: false } });
		const user = userEvent.setup();
		render(<CliSignIn mode="device" userCode="ABCD-1234" />);

		await user.click(
			await screen.findByRole("button", { name: "Continue with Email" }),
		);
		await user.type(screen.getByLabelText("Email address"), "ada@example.com");
		await waitFor(() => {
			expect(mockAuthFetch).toHaveBeenCalledTimes(1);
		});

		expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Send sign-in code" }));
		expect(await screen.findByLabelText("Sign-in code")).toBeInTheDocument();
		expect(mockSendCliEmailCode).toHaveBeenCalledWith("ada@example.com");
		expect(mockSignInCliWithPassword).not.toHaveBeenCalled();
	});
});
