import { validateOrgSlug } from "@rudel/api-routes/reserved-slugs";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import {
	appRoutes,
	getWorkspacePathAfterOrganizationSwitch,
} from "@/app/routes";
import type {
	Organization,
	WorkspaceContextValue,
} from "@/features/workspace/organization/types";
import { authClient } from "@/lib/auth-client";

const OrganizationContext = createContext<WorkspaceContextValue | undefined>(
	undefined,
);

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
	const location = useLocation();
	const navigate = useNavigate();
	const { data: activeOrg, isPending: activeLoading } =
		authClient.useActiveOrganization();
	const { data: orgs, isPending: listLoading } =
		authClient.useListOrganizations();
	const { data: activeMember } = authClient.useActiveMember();
	const [switching, setSwitching] = useState(false);
	const [attemptedAutoSelectOrgId, setAttemptedAutoSelectOrgId] = useState<
		string | null
	>(null);
	const [optimisticActiveOrg, setOptimisticActiveOrg] =
		useState<Organization | null>(null);

	const firstOrganizationId = orgs?.[0]?.id ?? null;
	const resolvedActiveOrg = optimisticActiveOrg ?? activeOrg;
	const shouldAutoSelect =
		!activeLoading &&
		!listLoading &&
		!resolvedActiveOrg &&
		!switching &&
		firstOrganizationId !== null &&
		attemptedAutoSelectOrgId !== firstOrganizationId;

	const switchOrganization = useCallback(
		async (orgId: string, options?: { destination?: "preserve" | "team" }) => {
			setSwitching(true);
			try {
				const listedOrganization = orgs?.find(
					(organization) => organization.id === orgId,
				);
				if (listedOrganization && !validateOrgSlug(listedOrganization.slug)) {
					return false;
				}

				const result = await authClient.organization.setActive({
					organizationId: orgId,
				});
				if (result.error) {
					return false;
				}

				const organization =
					listedOrganization ?? (await getOrganizationAfterSwitch(orgId));

				if (organization) {
					if (!validateOrgSlug(organization.slug)) {
						navigate("/", { replace: true });
						return false;
					}

					setOptimisticActiveOrg(organization);
					const nextPath =
						options?.destination === "team"
							? appRoutes.team(organization.slug)
							: (getWorkspacePathAfterOrganizationSwitch(
									location.pathname,
									organization.slug,
								) ?? appRoutes.dashboard(organization.slug));
					navigate(
						{
							pathname: nextPath,
							search: location.search,
							hash: location.hash,
						},
						{ replace: true },
					);
				} else {
					navigate("/", { replace: true });
				}

				return true;
			} finally {
				setSwitching(false);
			}
		},
		[location.hash, location.pathname, location.search, navigate, orgs],
	);

	useEffect(() => {
		if (activeOrg?.id === optimisticActiveOrg?.id) {
			setOptimisticActiveOrg(null);
		}
	}, [activeOrg?.id, optimisticActiveOrg?.id]);

	const memberRole = activeMember?.role;
	const actionsValue = useMemo(
		() => ({ switchOrganization }),
		[switchOrganization],
	);
	const contextValue: WorkspaceContextValue = useMemo(
		() => ({
			state: {
				activeOrg: resolvedActiveOrg,
				organizations: orgs ?? [],
				isLoading: activeLoading || listLoading || switching,
			},
			actions: actionsValue,
			meta: {
				isOrgAdmin:
					!resolvedActiveOrg ||
					memberRole === "owner" ||
					memberRole === "admin",
			},
		}),
		[
			actionsValue,
			activeLoading,
			listLoading,
			memberRole,
			orgs,
			resolvedActiveOrg,
			switching,
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
						setOptimisticActiveOrg(
							orgs?.find(
								(organization) => organization.id === organizationId,
							) ?? null,
						)
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

async function getOrganizationAfterSwitch(
	organizationId: string,
): Promise<Organization | null> {
	try {
		const response = await authClient.organization.getFullOrganization({
			query: { organizationId },
		});
		const organization = response.data as Partial<Organization> | null;
		if (
			!organization ||
			organization.id !== organizationId ||
			typeof organization.name !== "string" ||
			typeof organization.slug !== "string"
		) {
			return null;
		}

		return {
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			logo: organization.logo,
		};
	} catch {
		return null;
	}
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
