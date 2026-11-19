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
	/**
	 * Whether the caller opens every member's sessions: always, unless the
	 * workspace is limited to own sessions and the caller is not an admin.
	 */
	readsEverySession: boolean;
}

export interface WorkspaceContextValue {
	state: WorkspaceState;
	actions: WorkspaceActions;
	meta: WorkspaceMeta;
}
