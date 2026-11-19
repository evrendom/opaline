import type { SessionListFilters } from "@rudel/api-routes";
import { useEffect } from "react";
import type {
	SessionOverviewExcludedFilterValues,
	SessionOverviewRangeFilterValues,
} from "./components/sessions-overview-table-utils";

// Keep rapid checkbox and range changes to one query, and cancel on scope change
// or unmount so an old workspace cannot replace the current workspace's filters.
export function useSessionListFilters(
	excluded: SessionOverviewExcludedFilterValues,
	ranges: SessionOverviewRangeFilterValues,
	onChange: ((filters: SessionListFilters) => void) | undefined,
) {
	useEffect(() => {
		if (!onChange) return;
		const timer = setTimeout(
			() =>
				onChange({
					excluded: {
						model: [...excluded.model],
						repository: [...excluded.repository],
						skills: [...excluded.skills],
						user: [...excluded.user],
					},
					ranges,
				}),
			150,
		);
		return () => clearTimeout(timer);
	}, [excluded, ranges, onChange]);
}
