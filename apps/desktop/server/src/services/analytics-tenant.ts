// Workspace analytics bind {orgId:String}. Admin analytics span every tenant
// and never bind it, so a missed organization filter fails the query loudly
// instead of silently scoping (or leaking) the wrong rows.
export type AnalyticsTenant = "organization" | "allOrganizations";

export function organizationMatchSql(
	column: string,
	tenant: AnalyticsTenant = "organization",
): string {
	return tenant === "allOrganizations" ? "1" : `${column} = {orgId:String}`;
}
