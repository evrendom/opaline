import { IconAlertTriangle } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { fetchServiceStatus } from "@/features/service-status/service-status";
import {
	pollUnlessPushed,
	useSessionArrivalsLive,
} from "@/features/sessions/session-arrivals-live";
import { getApiBaseUrl } from "@/lib/api-base-url";

const HEALTHY_POLL_MS = 60_000;
const PUSHED_POLL_MS = 5 * 60_000;
const DEGRADED_POLL_MS = 15_000;

export function ServiceStatusBanner() {
	const pushed = useSessionArrivalsLive();
	const { data: status } = useQuery({
		queryKey: ["service-status"],
		queryFn: ({ signal }) => fetchServiceStatus(getApiBaseUrl(), signal),
		refetchInterval: (query) =>
			query.state.data === "analytics-unavailable"
				? DEGRADED_POLL_MS
				: pollUnlessPushed(pushed, HEALTHY_POLL_MS, PUSHED_POLL_MS),
		refetchOnWindowFocus: true,
		retry: false,
		staleTime: DEGRADED_POLL_MS,
	});

	if (status !== "analytics-unavailable") return null;

	return (
		<output className="flex items-start gap-2 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-100">
			<IconAlertTriangle
				aria-hidden="true"
				className="mt-0.5 size-4 shrink-0"
			/>
			<p>
				Analytics are temporarily unavailable because our database provider is
				having an outage. Your session uploads are safe and will appear once the
				service is back.
			</p>
		</output>
	);
}
