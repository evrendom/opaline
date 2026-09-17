import type { StoredUploadFailure } from "@rudel/api-routes";

export function SessionUploadFailureDetail({
	failure,
	userLabel,
}: {
	failure: StoredUploadFailure;
	userLabel: string;
}) {
	const fields = Object.entries({
		"Session ID": failure.sessionId,
		"Session date": failure.sessionDate
			? formatDate(failure.sessionDate)
			: "Unavailable",
		Member: userLabel,
		"Member ID": failure.userId,
		Source: failure.source === "codex" ? "Codex" : "Claude Code",
		Repository: failure.repository,
		"Git remote": failure.gitRemote,
		"Project path": failure.projectPath,
		Branch: failure.gitBranch,
		Commit: failure.gitSha,
		Package: failure.packageName,
		"Session size": formatBytes(failure.totalBytes),
		"Uploaded size": formatBytes(failure.uploadedBytes),
		"Size limit": formatBytes(failure.maxBytes),
		"Upload stage": {
			preparing: "Preparing",
			uploading: "Uploading",
			processing: "Processing",
		}[failure.stage],
		Attempts: failure.attempts.toLocaleString(),
		"Failed at": formatDate(failure.failedAt),
		"Error code": failure.errorCode,
		"CLI version": failure.cliVersion,
		"Upload record ID": failure.id,
	}).filter(([, value]) => value !== undefined && value !== "");
	return (
		<article
			className="h-full min-w-0 overflow-y-auto px-5 py-6 text-base text-(--dashboardy-heading) sm:px-8 sm:py-8 sm:text-sm"
			aria-label="Session upload failure"
		>
			<div className="flex min-w-0 max-w-3xl flex-col gap-6">
				<div className="flex min-w-0 flex-col gap-3">
					<h1 className="text-balance text-xl font-medium">Upload failed</h1>
					<p className="whitespace-pre-wrap wrap-anywhere text-pretty text-(--dashboardy-heading)">
						{failure.error}
					</p>
					<p className="text-pretty text-(--dashboardy-muted)">
						{failure.retryable ? (
							<>
								Retry this session with <code>opaline upload</code>.
							</>
						) : failure.totalBytes !== null &&
							failure.maxBytes !== undefined &&
							failure.totalBytes > failure.maxBytes ? (
							"We don’t support sessions of that size yet."
						) : (
							"This session needs attention before retrying. Uploading it unchanged will fail again."
						)}
					</p>
				</div>
				<dl className="min-w-0 divide-y divide-black/6 dark:divide-white/8">
					{fields.map(([label, value]) => (
						<div
							key={label}
							className="grid min-w-0 grid-cols-1 gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-x-6"
						>
							<dt className="font-medium">{label}</dt>
							<dd className="min-w-0 wrap-anywhere text-(--dashboardy-muted) tabular-nums">
								{value}
							</dd>
						</div>
					))}
				</dl>
			</div>
		</article>
	);
}

function formatDate(value: string) {
	return new Date(value).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "long",
	});
}

function formatBytes(value: number | null | undefined) {
	if (value === null || value === undefined) return undefined;
	return value >= 1024 * 1024
		? `${(value / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 2 })} MiB (${value.toLocaleString()} bytes)`
		: `${value.toLocaleString()} bytes`;
}
