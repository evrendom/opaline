import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceMembersTable } from "@/features/settings/workspace/components/WorkspaceMembersTable";
import { PasswordCard } from "./PasswordCard";

const recovery = vi.hoisted(() => ({
	readPasswordStatus: vi.fn(),
	changePassword: vi.fn(),
}));

vi.mock("./account-recovery", async (importOriginal) => ({
	...(await importOriginal<typeof import("./account-recovery")>()),
	readPasswordStatus: recovery.readPasswordStatus,
	changePassword: recovery.changePassword,
}));

vi.mock("@/lib/auth-client", () => ({ refreshAuthClientState: vi.fn() }));

afterEach(() => {
	vi.clearAllMocks();
});

function fill(label: string, value: string) {
	fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("PasswordCard", () => {
	it("asks for the current password and sends it with the new one", async () => {
		recovery.readPasswordStatus.mockResolvedValue({
			currentPasswordRequired: true,
		});
		recovery.changePassword.mockResolvedValue(null);
		render(<PasswordCard />);

		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Change password" }),
			).toBeEnabled(),
		);
		fill("Current password", "old password");
		fill("New password", "new password");
		fill("Repeat new password", "new passwort");
		fireEvent.click(screen.getByRole("button", { name: "Change password" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"The two new passwords are not the same.",
		);
		expect(recovery.changePassword).not.toHaveBeenCalled();

		fill("Repeat new password", "new password");
		fireEvent.click(screen.getByRole("button", { name: "Change password" }));
		await waitFor(() =>
			expect(recovery.changePassword).toHaveBeenCalledWith({
				newPassword: "new password",
				currentPassword: "old password",
			}),
		);
	});

	it("lets a session opened by a sign-in link set a password without the old one", async () => {
		recovery.readPasswordStatus.mockResolvedValue({
			currentPasswordRequired: false,
		});
		recovery.changePassword.mockResolvedValue(
			"Your current password is wrong.",
		);
		render(<PasswordCard />);

		await waitFor(() =>
			expect(screen.queryByLabelText("Current password")).toBeNull(),
		);
		expect(screen.getByText(/without the old one for an hour/)).toBeVisible();
		fill("New password", "new password");
		fill("Repeat new password", "new password");
		fireEvent.click(screen.getByRole("button", { name: "Change password" }));
		await waitFor(() =>
			expect(recovery.changePassword).toHaveBeenCalledWith({
				newPassword: "new password",
				currentPassword: "",
			}),
		);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Your current password is wrong.",
		);
	});
});

describe("WorkspaceMembersTable sign-in links", () => {
	const members = [
		{
			id: "m1",
			role: "owner",
			user: { id: "u1", name: "Owner", email: "owner@x.io", image: null },
		},
		{
			id: "m2",
			role: "member",
			user: { id: "u2", name: "Bob", email: "bob@x.io", image: null },
		},
	];

	it("offers the copy action only where the viewer may use it", () => {
		const onCopy = vi.fn();
		render(
			<WorkspaceMembersTable
				members={members}
				canEdit
				pendingKey={null}
				onRoleChange={vi.fn()}
				onRemove={vi.fn()}
				signInLink={{
					canCopy: (member) => member.user.id !== "u1",
					onCopy,
				}}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: "Copy a sign-in link for Owner" }),
		).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "Copy a sign-in link for Bob" }),
		);
		expect(onCopy).toHaveBeenCalledWith(members[1]);
	});

	it("shows no copy action off a self-hosted server", () => {
		render(
			<WorkspaceMembersTable
				members={members}
				canEdit
				pendingKey={null}
				onRoleChange={vi.fn()}
				onRemove={vi.fn()}
			/>,
		);
		expect(screen.queryByTitle("Copy sign-in link")).toBeNull();
	});
});
