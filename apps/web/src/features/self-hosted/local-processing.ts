import { useQuery } from "@tanstack/react-query";
import { useSelfHost } from "@/features/self-hosted/self-host-info";

const BUSY_POLL_MS = 2_000;
const IDLE_POLL_MS = 15_000;

type IngestStatus = {
	state?: string;
	sessionsQueued?: number;
	derivedQueued?: number;
};

export function isProcessing(status: IngestStatus | null | undefined) {
	return Boolean(
		status &&
			(status.state === "importing" ||
				(status.sessionsQueued ?? 0) > 0 ||
				(status.derivedQueued ?? 0) > 0),
	);
}

async function readIngestStatus(): Promise<IngestStatus | null> {
	const response = await fetch("/api/selfhost/ingest/status", {
		credentials: "include",
	});
	if (!response.ok) return null;
	return (await response.json()) as IngestStatus;
}

export function useLocalProcessing(): boolean {
	const selfHost = useSelfHost();
	const query = useQuery({
		queryKey: ["selfhost", "ingest-status"],
		queryFn: readIngestStatus,
		enabled: Boolean(selfHost),
		refetchInterval: (current) =>
			isProcessing(current.state.data) ? BUSY_POLL_MS : IDLE_POLL_MS,
	});
	return isProcessing(query.data);
}
