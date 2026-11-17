import { useQuery } from "@tanstack/react-query";
import { useSelfHost } from "@/features/self-hosted/self-host-info";

const BUSY_POLL_MS = 2_000;
const IDLE_POLL_MS = 15_000;

type IngestStatus = {
	state?: string;
	initialImport?: {
		active?: boolean;
		sessionsDone?: number;
		sessionsTotal?: number;
	};
};

export type InitialImport = {
	sessionsDone: number;
	sessionsTotal: number;
};

export function initialImportOf(
	status: IngestStatus | null | undefined,
): InitialImport | null {
	const initial = status?.initialImport;
	if (initial?.active !== true) return null;
	return {
		sessionsDone: initial.sessionsDone ?? 0,
		sessionsTotal: initial.sessionsTotal ?? 0,
	};
}

export function initialImportLabel({
	sessionsDone,
	sessionsTotal,
}: InitialImport): string {
	return sessionsTotal > 0 && sessionsDone < sessionsTotal
		? `Processing ${sessionsDone.toLocaleString("en-US")} of ${sessionsTotal.toLocaleString("en-US")} sessions`
		: "Processing sessions and repos";
}

async function readIngestStatus(): Promise<IngestStatus | null> {
	const response = await fetch("/api/selfhost/ingest/status", {
		credentials: "include",
	});
	if (!response.ok) return null;
	return (await response.json()) as IngestStatus;
}

export function useInitialImport(): InitialImport | null {
	const selfHost = useSelfHost();
	const query = useQuery({
		queryKey: ["selfhost", "ingest-status"],
		queryFn: readIngestStatus,
		enabled: Boolean(selfHost),
		refetchInterval: (current) =>
			initialImportOf(current.state.data) ? BUSY_POLL_MS : IDLE_POLL_MS,
	});
	return initialImportOf(query.data);
}
