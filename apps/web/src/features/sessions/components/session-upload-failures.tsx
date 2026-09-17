import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { client } from "@/lib/orpc";

const PAGE_SIZE = 20;

export function SessionUploadFailures({
	organizationId,
}: {
	organizationId: string | undefined;
}) {
	const [offset, setOffset] = useState(0);
	const query = useQuery({
		queryKey: ["session-upload-failures", organizationId, offset],
		enabled: Boolean(organizationId),
		queryFn: () =>
			client.analytics.sessions.uploadFailures({ offset, limit: PAGE_SIZE }),
		refetchInterval: 10_000,
	});
	if (query.isError)
		return (
			<p className="px-4 py-3 text-base text-(--dashboardy-muted) sm:text-sm">
				Couldn’t load upload errors.{" "}
				<button
					type="button"
					className="underline"
					onClick={() => void query.refetch()}
				>
					Retry
				</button>
			</p>
		);
	if (!query.data?.failures.length && offset === 0) return null;
	return (
		<section
			aria-label="Sessions with upload errors"
			className="max-h-[40svh] shrink-0 overflow-y-auto border-b border-black/6 px-4 py-3 text-base text-(--dashboardy-heading) sm:text-sm dark:border-white/8"
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2 pb-2">
				<h2 className="text-balance font-medium">Uploads needing attention</h2>
				<p className="text-pretty text-(--dashboardy-muted)">
					Retry these sessions from <code>opaline upload</code>.
				</p>
			</div>
			{query.data?.failures.map((failure) => (
				<details
					key={failure.id}
					className="border-t border-black/6 py-2 dark:border-white/8"
				>
					<summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2">
						<span className="font-medium">
							{failure.repository ||
								failure.gitRemote ||
								failure.projectPath ||
								failure.sessionId}
						</span>
						<span className="text-(--dashboardy-muted)">
							{" "}
							·{" "}
							{failure.sessionDate
								? new Date(failure.sessionDate).toLocaleDateString()
								: "Unknown date"}{" "}
							· Upload failed
						</span>
					</summary>
					<div className="flex min-w-0 flex-col gap-3 pt-3">
						<p className="text-pretty break-words text-(--dashboardy-muted)">
							{failure.error}
						</p>
						<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 tabular-nums">
							{Object.entries({
								"Session ID": failure.sessionId,
								Source: failure.source === "codex" ? "Codex" : "Claude Code",
								"Session date": failure.sessionDate,
								"Upload stage": failure.stage,
								"Uploaded bytes": failure.uploadedBytes?.toLocaleString(),
								"Session bytes": failure.totalBytes?.toLocaleString(),
								"Limit in bytes": failure.maxBytes?.toLocaleString(),
								Repository: failure.gitRemote,
								Path: failure.projectPath,
								Branch: failure.gitBranch,
								Commit: failure.gitSha,
								Package: failure.packageName,
								"CLI version": failure.cliVersion,
								Attempts: failure.attempts.toLocaleString(),
								"Failed at": failure.failedAt,
							})
								.filter(
									([, value]) =>
										value !== undefined && value !== null && value !== "",
								)
								.map(([label, value]) => (
									<div key={label} className="contents">
										<dt className="text-(--dashboardy-muted)">{label}</dt>
										<dd className="min-w-0 break-all">{value}</dd>
									</div>
								))}
						</dl>
						{!failure.retryable && (
							<p className="text-pretty text-(--dashboardy-muted)">
								This session needs attention before retrying. Uploading it
								unchanged will fail again.
							</p>
						)}
					</div>
				</details>
			))}
			{(offset > 0 || query.data?.hasMore) && (
				<div className="flex items-center gap-4 pt-2">
					<button
						type="button"
						disabled={offset === 0 || query.isFetching}
						onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
						className="rounded-sm px-3 py-2 disabled:opacity-40 hover:underline focus-visible:outline-2"
					>
						Previous
					</button>
					<p className="tabular-nums text-(--dashboardy-muted)">
						Page {offset / PAGE_SIZE + 1}
					</p>
					<button
						type="button"
						disabled={!query.data?.hasMore || query.isFetching}
						onClick={() => setOffset(offset + PAGE_SIZE)}
						className="rounded-sm px-3 py-2 disabled:opacity-40 hover:underline focus-visible:outline-2"
					>
						Next
					</button>
				</div>
			)}
		</section>
	);
}
