import type { FullOrganization } from "@/features/workspace/hooks/useFullOrganization";

export interface Organization {
	id: string;
	name: string;
	slug: string;
	logo?: string | null | undefined;
}

export interface WorkspaceState {
	members?: FullOrganization["members"];
	activeOrg: Organization | null;
	organizations: readonly Organization[];
	isLoading: boolean;
}

export interface WorkspaceActions {
	switchOrganization: (orgId: string) => Promise<void>;
}

export interface WorkspaceMeta {
	isOrgAdmin: boolean;
}

export interface WorkspaceContextValue {
	state: WorkspaceState;
	actions: WorkspaceActions;
	meta: WorkspaceMeta;
}
