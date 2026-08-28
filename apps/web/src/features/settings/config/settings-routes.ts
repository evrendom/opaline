import { appRoutes } from "@/app/routes";

export type SettingsRouteId =
	| "workspace"
	| "members"
	| "invitations"
	| "account"
	| "create-workspace";

export type SettingsRouteDefinition = {
	id: SettingsRouteId;
	label: string;
	segment: string;
	path: string;
};

export type PrimarySettingsRouteId = "workspace" | "members" | "account";

export const settingsRouteSegments = {
	workspace: "workspace",
	members: "members",
	invitations: "invitations",
	account: "account",
	"create-workspace": "create-workspace",
} as const satisfies Record<SettingsRouteId, string>;

export function getSettingsRouteMap(
	orgSlug: string,
): Record<SettingsRouteId, SettingsRouteDefinition> {
	return {
		workspace: {
			id: "workspace",
			label: "Workspace",
			segment: settingsRouteSegments.workspace,
			path: appRoutes.settingsWorkspace(orgSlug),
		},
		members: {
			id: "members",
			label: "Members",
			segment: settingsRouteSegments.members,
			path: appRoutes.settingsMembers(orgSlug),
		},
		invitations: {
			id: "invitations",
			label: "Invitations",
			segment: settingsRouteSegments.invitations,
			path: appRoutes.settingsInvitations(orgSlug),
		},
		account: {
			id: "account",
			label: "Account",
			segment: settingsRouteSegments.account,
			path: appRoutes.settingsAccount(orgSlug),
		},
		"create-workspace": {
			id: "create-workspace",
			label: "Create workspace",
			segment: settingsRouteSegments["create-workspace"],
			path: appRoutes.settingsCreateWorkspace(orgSlug),
		},
	};
}

export function getPrimarySettingsRoutes(orgSlug: string) {
	const settingsRouteMap = getSettingsRouteMap(orgSlug);

	return [
		settingsRouteMap.workspace,
		settingsRouteMap.members,
		settingsRouteMap.account,
	] as const satisfies readonly SettingsRouteDefinition[];
}

export function getActiveSettingsRouteId(
	pathname: string,
	orgSlug: string,
): PrimarySettingsRouteId {
	const settingsRoutes = Object.values(getSettingsRouteMap(orgSlug));
	const matchedRoute =
		settingsRoutes.find(
			(route) =>
				pathname === route.path || pathname.startsWith(`${route.path}/`),
		)?.id ?? "workspace";

	if (matchedRoute === "account" || matchedRoute === "invitations") {
		return "account";
	}

	if (matchedRoute === "members") {
		return "members";
	}

	return "workspace";
}

export function getSettingsPathFromLegacyTab(
	tab: string | null,
	orgSlug: string,
): string {
	const settingsRouteMap = getSettingsRouteMap(orgSlug);

	if (tab === "account" || tab === "profile") {
		return settingsRouteMap.account.path;
	}

	if (tab === "members" || tab === "team") {
		return settingsRouteMap.members.path;
	}

	if (tab === "invitations") {
		return `${settingsRouteMap.account.path}#workspace-invitations`;
	}

	return settingsRouteMap.workspace.path;
}
