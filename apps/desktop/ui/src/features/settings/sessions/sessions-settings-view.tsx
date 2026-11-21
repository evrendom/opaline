import type { RepositorySettings } from "@rudel/api-routes";
import { IconFolder, IconSearch } from "@tabler/icons-react";
import { Button } from "@/app/ui/button";
import { Skeleton } from "@/app/ui/skeleton";
import "@/features/settings/components/settings-section.css";
import "./sessions-settings.css";

type Repository = RepositorySettings["repositories"][number];

export function SessionsSettingsView({
	error,
	fetching,
	onRefresh,
	onSearch,
	pending,
	repositories,
	search,
	visible,
}: {
	error: boolean;
	fetching: boolean;
	onRefresh: () => void;
	onSearch: (search: string) => void;
	pending: boolean;
	repositories: readonly Repository[] | undefined;
	search: string;
	visible: readonly Repository[];
}) {
	return (
		<div className="sessions-settings">
			<section
				className="sessions-settings-section"
				aria-labelledby="repository-list-heading"
				aria-busy={pending}
			>
				<div className="sessions-settings-heading">
					<div className="sessions-settings-list-heading">
						<h2 id="repository-list-heading">
							Repositories{" "}
							{repositories && (
								<span className="sessions-settings-count">
									{repositories.length}
								</span>
							)}
						</h2>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={fetching}
							onClick={onRefresh}
						>
							{fetching && !pending ? "Refreshing…" : "Refresh"}
						</Button>
					</div>
					<p className="sessions-settings-description">
						Workspace sessions, with the last reported upload settings from your
						computers.
					</p>
				</div>
				<div className="sessions-settings-card settings-section-surface">
					<label className="sessions-settings-search">
						<IconSearch size={16} aria-hidden="true" />
						<input
							type="search"
							name="repository-search"
							aria-label="Find a repository"
							placeholder="Find a repository…"
							value={search}
							onChange={(event) => onSearch(event.target.value)}
						/>
					</label>
					{error ? (
						<div className="sessions-settings-empty" role="alert">
							Could not load repositories.{" "}
							<button type="button" onClick={onRefresh}>
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
									{pending ? (
										<SampleRows />
									) : (
										visible.map((repo) => (
											<tr key={repo.key}>
												<td>
													<div className="sessions-settings-repo">
														<IconFolder size={16} aria-hidden="true" />
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
										))
									)}
								</tbody>
							</table>
						</div>
					)}
					{!pending && !error && !visible.length && (
						<p className="sessions-settings-empty">
							{search
								? "No repositories match your search."
								: "No repositories yet."}
						</p>
					)}
					{repositories?.some((repo) => !repo.reports.length) && (
						<p className="sessions-settings-note sessions-settings-status-note">
							Not reported means no computer has shared an upload setting for
							that repository in this workspace. Older or manually uploaded
							sessions can appear here before a setting is reported.
						</p>
					)}
				</div>
			</section>
		</div>
	);
}

const SAMPLE_REPOSITORIES: [string, number, string][] = [
	["web-app", 505, "Enabled"],
	["api-server", 377, "Enabled"],
	["mobile", 299, "Enabled"],
	["design-system", 196, "Enabled"],
	["docs", 192, "Enabled"],
	["infra", 128, "Enabled"],
	["data-pipeline", 94, "Enabled"],
	["analytics", 57, "Enabled"],
	["marketing-site", 44, "Enabled"],
	["cli", 41, "Enabled"],
];

function SampleRows() {
	return SAMPLE_REPOSITORIES.map(([name, count, status]) => (
		<tr key={name}>
			<td>
				<div className="sessions-settings-repo">
					<Skeleton className="size-4 shrink-0 rounded-sm" />
					<Skeleton
						className="h-3.5 rounded-sm"
						style={{ width: `${name.length * 0.5}rem` }}
					/>
				</div>
			</td>
			<td>
				<Skeleton
					className="ml-auto h-3.5 rounded-sm"
					style={{ width: `${String(count).length * 0.45}rem` }}
				/>
			</td>
			<td>
				<span className="sessions-settings-status">
					<Skeleton className="size-1.5 shrink-0 rounded-full" />
					<Skeleton
						className="h-3.5 rounded-sm"
						style={{ width: `${status.length * 0.4}rem` }}
					/>
				</span>
			</td>
		</tr>
	));
}

export function SessionsSettingsSample() {
	return (
		<SessionsSettingsView
			error={false}
			fetching
			onRefresh={() => {}}
			onSearch={() => {}}
			pending
			repositories={undefined}
			search=""
			visible={[]}
		/>
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

export function getUploadStatus(
	reports: RepositorySettings["repositories"][number]["reports"],
) {
	const first = reports.at(0);
	if (!first) return "unknown";
	const states = new Set(reports.map((report) => report.state));
	return states.size > 1 ? "mixed" : first.state;
}
