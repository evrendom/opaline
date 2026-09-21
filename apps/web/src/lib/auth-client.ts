import { emailOTPClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { waitForDemoActivation } from "@/features/demo/demo-activation";
import { getApiBaseUrl } from "./api-base-url";
import { resetProductAnalytics } from "./product-analytics";
import { queryClient } from "./query-client";

export const authClient = createAuthClient({
	baseURL: getApiBaseUrl(),
	basePath:
		import.meta.env.MODE === "product-demo" ? "/api/demo/auth" : "/api/auth",
	plugins: [organizationClient(), emailOTPClient()],
	fetchOptions: {
		onRequest: (context) => {
			// Shared hooks subscribe during preparation; only Explore may
			// release their auth reads. The real app has no such gate.
			if (import.meta.env.MODE === "product-demo") {
				return waitForDemoActivation(context.signal);
			}
		},
	},
});

export function refreshAuthClientState() {
	// Better Auth exposes its store through a proxy: Object.keys(atoms) is empty.
	// Notify the signals registered by the session and organization plugins.
	for (const signal of [
		"$sessionSignal",
		"$listOrg",
		"$activeOrgSignal",
		"$activeMemberSignal",
		"$activeMemberRoleSignal",
	]) {
		authClient.$store.notify(signal);
	}
}

export async function signOut() {
	resetProductAnalytics();
	await authClient.signOut();
	queryClient.clear();
	localStorage.removeItem("dateRange");
	localStorage.removeItem("globalFilters");
	localStorage.removeItem("rudel:activeOrg");
	refreshAuthClientState();
}
