import { useQuery } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { useLocation } from "react-router-dom";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { getWorkspaceSlugFromPath } from "@/app/routes";
import type { WorkspaceContextValue } from "@/features/workspace/organization/types";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc";

const OrganizationContext = createContext<WorkspaceContextValue | undefined>(
	undefined,
);

export function WorkspaceStateProvider({
	children,
	value,
}: {
	children: ReactNode;
	value: WorkspaceContextValue;
}) {
	return (
		<OrganizationContext.Provider value={value}>
			{children}
		</OrganizationContext.Provider>
	);
}

function OrganizationAutoSelectMount({
	onAttempted,
	onSucceeded,
	onSettled,
	organizationId,
}: {
	onAttempted: (organizationId: string) => void;
	onSucceeded: (organizationId: string) => void;
	onSettled: () => void;
	organizationId: string;
}) {
	useMountEffect(() => {
		onAttempted(organizationId);
		void authClient.organization
			.setActive({ organizationId })
			.then((result) => {
				if (!result.error) {
					onSucceeded(organizationId);
				}
			})
			.finally(() => {
				onSettled();
			});
	});

	return null;
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
	const { data: session, isPending } = authClient.useSession();

	if (isPending) {
		return (
			<OrganizationProviderFallback isLoading={true}>
				{children}
			</OrganizationProviderFallback>
		);
	}

	if (!session) {
		return (
			<OrganizationProviderFallback isLoading={false}>
				{children}
			</OrganizationProviderFallback>
		);
	}

	return (
		<AuthenticatedOrganizationProvider>
			{children}
		</AuthenticatedOrganizationProvider>
	);
}

function OrganizationProviderFallback({
	children,
	isLoading,
}: {
	children: ReactNode;
	isLoading: boolean;
}) {
	const contextValue: WorkspaceContextValue = {
		state: {
			activeOrg: null,
			organizations: [],
			isLoading,
		},
		actions: {
			switchOrganization: () => Promise.resolve(),
		},
		meta: {
			isOrgAdmin: false,
			readsEverySession: false,
		},
	};

	return (
		<OrganizationContext.Provider value={contextValue}>
			{children}
		</OrganizationContext.Provider>
	);
}

function AuthenticatedOrganizationProvider({
	children,
}: {
	children: ReactNode;
}) {
	const { pathname } = useLocation();
	const { data: activeOrg, isPending: activeLoading } =
		authClient.useActiveOrganization();
	const { data: orgs, isPending: listLoading } =
		authClient.useListOrganizations();
	const { data: activeMember } = authClient.useActiveMember();
	const [switching, setSwitching] = useState(false);
	const [attemptedAutoSelectOrgId, setAttemptedAutoSelectOrgId] = useState<
		string | null
	>(null);
	const [optimisticActiveOrgId, setOptimisticActiveOrgId] = useState<
		string | null
	>(null);

	const activeMembers = useMemo(
		() =>
			activeOrg?.members.map((member) => ({
				...member,
				user: { ...member.user, image: member.user.image ?? null },
			})),
		[activeOrg?.members],
	);
	const firstOrganizationId = orgs?.[0]?.id ?? null;
	const optimisticActiveOrg =
		orgs?.find((organization) => organization.id === optimisticActiveOrgId) ??
		null;
	const resolvedActiveOrg =
		orgs?.find((organization) => organization.id === activeOrg?.id) ??
		optimisticActiveOrg;
	// Whose sessions the caller opens is the server's decision, per workspace.
	const { data: sessionAccess } = useQuery({
		...orpc.sessionAccess.queryOptions(),
		queryKey: [...orpc.sessionAccess.queryKey(), resolvedActiveOrg?.id ?? null],
		enabled: Boolean(resolvedActiveOrg),
	});
	const shouldAutoSelect =
		!getWorkspaceSlugFromPath(pathname) &&
		!activeLoading &&
		!listLoading &&
		!resolvedActiveOrg &&
		!switching &&
		firstOrganizationId !== null &&
		attemptedAutoSelectOrgId !== firstOrganizationId;

	const switchOrganization = useCallback(async (orgId: string) => {
		setSwitching(true);
		try {
			const result = await authClient.organization.setActive({
				organizationId: orgId,
			});
			if (!result.error) {
				setOptimisticActiveOrgId(orgId);
			}
		} finally {
			setSwitching(false);
		}
	}, []);

	const memberRole = activeMember?.role;
	const members =
		activeOrg?.id === resolvedActiveOrg?.id ? activeMembers : undefined;
	const isLoading = activeLoading || listLoading || switching;
	const isOrgAdmin =
		!activeOrg || memberRole === "owner" || memberRole === "admin";
	const readsEverySession = sessionAccess?.readsEverySession ?? true;
	const contextValue = useMemo<WorkspaceContextValue>(
		() => ({
			state: {
				activeOrg: resolvedActiveOrg,
				members,
				organizations: orgs ?? [],
				isLoading,
			},
			actions: { switchOrganization },
			meta: { isOrgAdmin, readsEverySession },
		}),
		[
			resolvedActiveOrg,
			members,
			orgs,
			isLoading,
			switchOrganization,
			isOrgAdmin,
			readsEverySession,
		],
	);

	return (
		<>
			{shouldAutoSelect ? (
				<OrganizationAutoSelectMount
					key={firstOrganizationId}
					organizationId={firstOrganizationId}
					onAttempted={(organizationId) => {
						setAttemptedAutoSelectOrgId(organizationId);
						setSwitching(true);
					}}
					onSucceeded={(organizationId) =>
						setOptimisticActiveOrgId(organizationId)
					}
					onSettled={() => setSwitching(false)}
				/>
			) : null}
			<OrganizationContext.Provider value={contextValue}>
				{children}
			</OrganizationContext.Provider>
		</>
	);
}

export function useOrganization() {
	const context = useOptionalOrganization();
	if (context === undefined) {
		throw new Error(
			"useOrganization must be used within an OrganizationProvider",
		);
	}
	return context;
}

export function useOptionalOrganization() {
	return useContext(OrganizationContext);
}
