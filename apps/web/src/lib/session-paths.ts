import { appRoutes } from "@/app/routes";

export function getSessionDetailPath(
	orgSlug: string,
	sessionId: string,
): string {
	return appRoutes.dashboardSession(orgSlug, sessionId);
}
