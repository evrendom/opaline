import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceStateProvider } from "@/features/workspace/organization/OrganizationProvider";
import { useCanViewSession } from "./useCanViewSession";

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession: () => ({ data: { user: { id: "me" } } }),
	},
}));

function canOpen(readsEverySession: boolean) {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<WorkspaceStateProvider
			value={{
				state: { activeOrg: null, organizations: [], isLoading: false },
				actions: { switchOrganization: async () => {} },
				meta: { isOrgAdmin: false, readsEverySession },
			}}
		>
			{children}
		</WorkspaceStateProvider>
	);
	return renderHook(() => useCanViewSession(), { wrapper }).result.current;
}

describe("useCanViewSession", () => {
	it("lets a member open a teammate's session", () => {
		expect(canOpen(true)("teammate")).toBe(true);
		expect(canOpen(true)("me")).toBe(true);
	});

	it("keeps a member to their own sessions in a workspace limited to own sessions", () => {
		expect(canOpen(false)("teammate")).toBe(false);
		expect(canOpen(false)("me")).toBe(true);
	});
});
