import {
	Copy01Icon,
	Folder01Icon,
	Search01Icon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RepositorySettings } from "@rudel/api-routes";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { Button } from "@/app/ui/button";
import { Skeleton } from "@/app/ui/skeleton";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { copyTextToClipboard } from "@/lib/clipboard";
import { orpc } from "@/lib/orpc";
import "./sessions-settings.css";

const MANAGE_COMMAND = "npx opaline@latest upload";

export function SessionsSettingsPage() {
	const [search, setSearch] = useState("");
	const [copied, setCopied] = useState(false);
	const copyTimer = useRef<number | undefined>(undefined);
	useMountEffect(() => () => window.clearTimeout(copyTimer.current));
	const query = useAnalyticsQuery(
		orpc.repositorySettings.list.queryOptions({
			staleTime: 10_000,
			refetchInterval: 10_000,
			refetchOnWindowFocus: "always",
		}),
	);
	const repositories = [...(query.data?.repositories ?? [])].sort(
		(a, b) =>
			getUploadStatusOrder(a.reports) - getUploadStatusOrder(b.reports) ||
			b.sessionCount - a.sessionCount ||
			a.name.localeCompare(b.name),
	);
	const visible = repositories.filter((repo) =>
		repo.name.toLowerCase().includes(search.trim().toLowerCase()),
	);
	async function copyCommand() {
		try {
			if (!(await copyTextToClipboard(MANAGE_COMMAND)))
				throw new Error("Clipboard unavailable");
			window.clearTimeout(copyTimer.current);
			setCopied(true);
			copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
			toast.success("Command copied");
		} catch {
			toast.error("Could not copy. Select and copy the command below.");
		}
	}

	return (
		<div className="sessions-settings">
			<section
				className="sessions-settings-manage"
				aria-labelledby="repository-upload-heading"
			>
				<h2 id="repository-upload-heading">Automatic uploads</h2>
				<p>
					Choose which repositories send new sessions to Opaline. Run this
					command in your terminal to turn uploads on or off.
				</p>
				<div className="sessions-settings-command">
					<code>{MANAGE_COMMAND}</code>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="rounded-md transition-none active:not-aria-[haspopup]:translate-y-0"
						onClick={copyCommand}
						aria-label="Copy repository management command"
					>
						<HugeiconsIcon
							icon={copied ? Tick02Icon : Copy01Icon}
							size={16}
							aria-hidden="true"
						/>
						{copied ? "Copied" : "Copy"}
					</Button>
				</div>
				<p className="sessions-settings-note">
					Changes apply on the computer running the command. Existing sessions
					stay in your workspace.
				</p>
			</section>
			<section
				aria-labelledby="repository-list-heading"
				aria-busy={query.isPending}
			>
				<div className="sessions-settings-list-heading">
					<h2 id="repository-list-heading">
						Repositories{" "}
						{query.data && (
							<span className="sessions-settings-count">
								{repositories.length}
							</span>
						)}
					</h2>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="rounded-md text-muted-foreground transition-none"
						disabled={query.isFetching}
						onClick={() => void query.refetch()}
					>
						{query.isFetching && !query.isPending ? "Refreshing…" : "Refresh"}
					</Button>
				</div>
				<p className="sessions-settings-description">
					Workspace sessions, with the last reported upload settings from your
					computers.
				</p>
				<label className="sessions-settings-search">
					<HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" />
					<input
						type="search"
						name="repository-search"
						aria-label="Find a repository"
						placeholder="Find a repository…"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</label>
				{query.isError ? (
					<div className="sessions-settings-empty" role="alert">
						Could not load repositories.{" "}
						<button type="button" onClick={() => void query.refetch()}>
							Try again
						</button>
					</div>
				) : (
					<div className="sessions-settings-table-wrap">
						<table className="sessions-settings-table">
							<thead>
								<tr>
									<th scope="col">Repository</th>
									<th scope="col">Uploaded sessions</th>
									<th scope="col">Auto-upload</th>
								</tr>
							</thead>
							<tbody>
								{query.isPending
									? [1, 2, 3].map((key) => (
											<tr key={key}>
												<td>
													<Skeleton className="h-4 w-32" />
												</td>
												<td>
													<Skeleton className="ml-auto h-4 w-8" />
												</td>
												<td>
													<Skeleton className="h-4 w-20" />
												</td>
											</tr>
										))
									: visible.map((repo) => (
											<tr key={repo.key}>
												<td>
													<div className="sessions-settings-repo">
														<HugeiconsIcon
															icon={Folder01Icon}
															size={16}
															aria-hidden="true"
														/>
														<span
															className="sessions-settings-repo-name"
															title={repo.name}
														>
															{repo.name}
														</span>
													</div>
												</td>
												<td>{repo.sessionCount.toLocaleString()}</td>
												<td>
													<UploadStatus reports={repo.reports} />
												</td>
											</tr>
										))}
							</tbody>
						</table>
					</div>
				)}
				{!query.isPending && !query.isError && !visible.length && (
					<p className="sessions-settings-empty">
						{search
							? "No repositories match your search."
							: "No repositories yet. Run the command above to upload your first sessions."}
					</p>
				)}
				{repositories.some((repo) => !repo.reports.length) && (
					<p className="sessions-settings-note sessions-settings-status-note">
						Not reported means no computer has shared an upload setting for that
						repository in this workspace. Older or manually uploaded sessions
						can appear here before a setting is reported.
					</p>
				)}
			</section>
		</div>
	);
}

function UploadStatus({
	reports,
}: {
	reports: RepositorySettings["repositories"][number]["reports"];
}) {
	const state = getUploadStatus(reports);
	const label = {
		enabled: "Enabled",
		disabled: "Disabled",
		needs_attention: "Needs attention",
		mixed: "Varies by computer",
		unknown: "Not reported",
	}[state];
	const latest = reports
		.map((report) => report.reportedAt)
		.sort()
		.at(-1);
	const title = latest
		? `${reports.length} computer${reports.length === 1 ? "" : "s"} · Last reported ${new Date(latest).toLocaleString()}`
		: "Sessions exist, but no auto-upload setting has been reported for this repository in this workspace.";
	return (
		<span className="sessions-settings-status" data-state={state} title={title}>
			<span className="sessions-settings-status-dot" aria-hidden="true" />
			{label}
		</span>
	);
}

function getUploadStatus(
	reports: RepositorySettings["repositories"][number]["reports"],
) {
	const first = reports.at(0);
	if (!first) return "unknown";
	const states = new Set(reports.map((report) => report.state));
	return states.size > 1 ? "mixed" : first.state;
}

function getUploadStatusOrder(
	reports: RepositorySettings["repositories"][number]["reports"],
) {
	const state = getUploadStatus(reports);
	if (state === "enabled") return 0;
	if (state === "unknown") return 2;
	return 1;
}
