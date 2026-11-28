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
		Source:
			failure.source === "codex"
				? "Codex"
				: failure.source === "gemini"
					? "Gemini"
					: "Claude",
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
			className="h-full min-w-0 overflow-y-auto px-xxl py-xxl text-body-xxl text-ink sm:px-xxxl sm:py-xxxl sm:text-body-xl"
			aria-label="Session upload failure"
		>
			<div className="flex min-w-0 max-w-3xl flex-col gap-xxl">
				<div className="flex min-w-0 flex-col gap-l">
					<h1 className="text-balance text-display-xxs tracking-s font-medium">
						Upload failed
					</h1>
					<p className="whitespace-pre-wrap wrap-anywhere text-pretty text-ink">
						{failure.error}
					</p>
					{failure.retryable ? null : (
						<p className="text-pretty text-ink-3">
							{failure.totalBytes !== null &&
							failure.maxBytes !== undefined &&
							failure.totalBytes > failure.maxBytes
								? "We don’t support sessions of that size yet."
								: "This session needs attention before retrying. Uploading it unchanged will fail again."}
						</p>
					)}
				</div>
				<dl className="min-w-0 divide-y divide-line">
					{fields.map(([label, value]) => (
						<div
							key={label}
							className="grid min-w-0 grid-cols-1 gap-xs py-l sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-x-xxl"
						>
							<dt className="font-medium">{label}</dt>
							<dd className="min-w-0 wrap-anywhere text-ink-3 tabular-nums">
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
