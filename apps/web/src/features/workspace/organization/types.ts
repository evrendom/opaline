export interface Organization {
	id: string;
	name: string;
	slug: string;
	logo?: string | null | undefined;
}

export interface WorkspaceState {
	activeOrg: Organization | null;
	organizations: readonly Organization[];
	isLoading: boolean;
}

export interface WorkspaceActions {
	switchOrganization: (
		orgId: string,
		options?: { destination?: "preserve" | "team" },
	) => Promise<boolean>;
}

export interface WorkspaceMeta {
	isOrgAdmin: boolean;
}

export interface WorkspaceContextValue {
	state: WorkspaceState;
	actions: WorkspaceActions;
	meta: WorkspaceMeta;
}
