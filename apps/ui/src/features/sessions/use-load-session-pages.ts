import { useEffect } from "react";
import type { SessionListPagination } from "./components/sessions-overview-table";

export function useLoadSessionPages(
	enabled: boolean,
	pagination: SessionListPagination | undefined,
) {
	useEffect(() => {
		if (
			enabled &&
			pagination?.hasNextPage &&
			!pagination.isFetching &&
			!pagination.isError
		) {
			pagination.loadMore();
		}
	}, [enabled, pagination]);
}
