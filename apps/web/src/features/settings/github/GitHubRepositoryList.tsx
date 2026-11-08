import type { GitHubRepositoryConnectionStatus } from "@rudel/api-routes";
import { IconFolder, IconSearch } from "@tabler/icons-react";
import { useState } from "react";
import "@/features/settings/sessions/sessions-settings.css";

type GitHubRepository =
	GitHubRepositoryConnectionStatus["repositories"][number];

/** Same layout as Settings → Sessions → Automatic uploads. */
export function GitHubRepositoryList({
	status,
}: {
	status: GitHubRepositoryConnectionStatus;
}) {
	const [search, setSearch] = useState("");
	const repositories = [...status.repositories].sort((left, right) =>
		`${left.owner}/${left.name}`.localeCompare(`${right.owner}/${right.name}`),
	);
	const query = search.trim().toLowerCase();
	const visible = repositories.filter((repository) =>
		`${repository.owner}/${repository.name}`.toLowerCase().includes(query),
	);
	const selection =
		status.repositorySelection === "all"
			? "All repositories"
			: "Selected repositories";

	return (
		<div className="sessions-settings">
			<section
				className="sessions-settings-section"
				aria-labelledby="github-repository-list-heading"
			>
				<div className="sessions-settings-heading">
					<div className="sessions-settings-list-heading">
						<h2 id="github-repository-list-heading">
							Repositories{" "}
							<span className="sessions-settings-count">
								{repositories.length}
							</span>
						</h2>
					</div>
					<p className="sessions-settings-description">
						{selection} on {status.accountLogin ?? "GitHub"}.
						{status.canManage
							? " Added repositories on GitHub? Reconnect to include them."
							: null}
					</p>
				</div>
				<div className="sessions-settings-card settings-section-surface">
					<label className="sessions-settings-search">
						<IconSearch size={16} aria-hidden="true" />
						<input
							type="search"
							name="github-repository-search"
							aria-label="Find a repository"
							placeholder="Find a repository…"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					</label>
					<div className="sessions-settings-table-wrap">
						<table className="sessions-settings-table">
							<thead>
								<tr>
									<th scope="col">Repository</th>
									<th scope="col">Visibility</th>
									<th scope="col">Sync</th>
								</tr>
							</thead>
							<tbody>
								{visible.map((repository) => (
									<tr key={repository.repositoryId}>
										<td>
											<div className="sessions-settings-repo">
												<IconFolder size={16} aria-hidden="true" />
												<span
													className="sessions-settings-repo-name"
													title={`${repository.owner}/${repository.name}`}
												>
													{repository.owner}/{repository.name}
												</span>
											</div>
										</td>
										<td>{repository.isPrivate ? "Private" : "Public"}</td>
										<td>
											<SyncStatus
												repository={repository}
												suspended={status.suspended === true}
											/>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{visible.length === 0 ? (
						<p className="sessions-settings-empty">
							{search
								? "No repositories match your search."
								: "No repositories are available to this connection."}
						</p>
					) : null}
				</div>
			</section>
		</div>
	);
}

function SyncStatus({
	repository,
	suspended,
}: {
	repository: GitHubRepository;
	suspended: boolean;
}) {
	const sync = repository.sync;
	// Reuses the Automatic uploads status dots: green, hollow, amber, muted.
	const [state, label] = suspended
		? (["disabled", "Paused"] as const)
		: !sync || sync.state === "syncing"
			? ([
					"unknown",
					sync?.progress === undefined
						? "Syncing"
						: `Syncing ${Math.floor(sync.progress * 100)}%`,
				] as const)
			: sync.state === "ready"
				? (["enabled", "Synced"] as const)
				: ([
						"needs_attention",
						sync.reason === "no-access" ? "No access" : "Not found",
					] as const);
	return (
		<span className="sessions-settings-status" data-state={state}>
			<span className="sessions-settings-status-dot" aria-hidden="true" />
			{label}
		</span>
	);
}
