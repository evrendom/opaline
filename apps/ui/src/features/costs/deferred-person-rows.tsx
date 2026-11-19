import type { CostDashboard } from "@rudel/api-routes";
import { createContext, useContext } from "react";

/**
 * The plugin app's first dashboard view comes without rows that name people
 * (members, GitHub authors). While the shown data is that first view, the
 * breakdowns offer a button that loads them through the app's costs tool.
 */
export interface DeferredPersonRows {
	isDeferred(data: CostDashboard | undefined): boolean;
	load(): void;
}

export const DeferredPersonRowsContext =
	createContext<DeferredPersonRows | null>(null);

export const PERSON_DIMENSIONS = new Set(["members", "githubAuthors"]);

export function useDeferredPersonRows(data: CostDashboard | undefined) {
	const deferred = useContext(DeferredPersonRowsContext);
	return deferred?.isDeferred(data) ? deferred.load : null;
}
