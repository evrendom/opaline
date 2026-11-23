import { IconFolder } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { Button } from "@/app/ui/button";
import { Checkbox } from "@/app/ui/checkbox";
import { Pressable } from "@/app/ui/pressable";
import { Skeleton } from "@/app/ui/skeleton";
import { RepositorySearchField } from "@/features/settings/components/repository-search-field";
import type {
	DesktopApplyEvent,
	DesktopRepository,
	DesktopRepositoryList,
	useDesktop,
} from "./desktop-bridge";
import { useDevStage } from "./dev-stages";
import { setWelcomeSelection } from "./welcome-selection";
import "@/features/settings/sessions/sessions-settings.css";
import "./desktop-repository-picker.css";

type Status =
	| { kind: "idle" }
	| { kind: "working"; text: string }
	| { kind: "done"; text: string }
	| { kind: "error"; text: string };

const SOURCE_LABELS: Record<string, string> = {
	claude_code: "Claude Code",
	codex: "Codex",
	gemini: "Gemini",
};

export function DesktopRepositoryPicker({
	bridge,
	mode,
	getCode,
}: {
	bridge: NonNullable<ReturnType<typeof useDesktop>>;
	mode: "setup" | "settings";
	getCode?: () => Promise<string | null>;
}) {
	const [loadedList, setList] = useState<DesktopRepositoryList | null>(null);
	const [loadedError, setLoadError] = useState<string | null>(null);
	const [desired, setDesired] = useState<Map<string, boolean>>(new Map());
	const [search, setSearch] = useState("");
	const [showAll, setShowAll] = useState(false);
	const [liveStatus, setStatus] = useState<Status>({ kind: "idle" });
	const devStage = useDevStage();
	const list = devStage === "picker-loading" ? null : loadedList;
	const loadError =
		devStage === "picker-load-error"
			? "Could not read your local repositories."
			: loadedError;
	const status: Status =
		devStage === "picker-connecting"
			? { kind: "working", text: "Preparing your upload…" }
			: devStage === "picker-error"
				? { kind: "error", text: "Stopped before finishing." }
				: liveStatus;

	const load = useCallback(() => {
		setLoadError(null);
		bridge.listRepositories().then(
			(next) => {
				setList(next);
				setDesired(new Map());
			},
			(error: unknown) =>
				setLoadError(
					error instanceof Error
						? error.message
						: "Could not read your local repositories.",
				),
		);
	}, [bridge]);
	useMountEffect(load);

	const rows = list?.repositories ?? [];
	const isOn = (key: string, enabled: boolean) => desired.get(key) ?? enabled;
	const selected = rows.filter((repo) => isOn(repo.key, repo.enabled));
	const enable = rows
		.filter(
			(repo) =>
				isOn(repo.key, repo.enabled) && (mode === "setup" || !repo.enabled),
		)
		.map((repo) => repo.key);
	const disable = rows
		.filter((repo) => repo.enabled && !isOn(repo.key, repo.enabled))
		.map((repo) => repo.key);
	const working = status.kind === "working";
	const canSubmit =
		!working &&
		(mode === "setup"
			? selected.length > 0
			: enable.length + disable.length > 0);
	const query = search.trim().toLowerCase();
	const relevant = rows.filter(isRelevant);
	const visible = (
		query
			? rows.filter((repo) =>
					[repo.name, ...repo.paths].some((value) =>
						value.toLowerCase().includes(query),
					),
				)
			: showAll
				? rows
				: relevant
	).sort(
		(a, b) =>
			Number(b.enabled) - Number(a.enabled) ||
			b.sessionCount - a.sessionCount ||
			a.name.localeCompare(b.name),
	);
	const hiddenCount = rows.length - relevant.length;
	const shownSelected = visible.filter((repo) =>
		isOn(repo.key, repo.enabled),
	).length;
	const previewRepositories = selected
		.filter((repo) => repo.sessionCount > 0)
		.sort((a, b) => b.sessionCount - a.sessionCount);
	const previewSelection =
		mode === "setup" && previewRepositories.length
			? JSON.stringify(
					previewRepositories.map(({ key, name, sessionCount, sources }) => ({
						key,
						name,
						sessionCount,
						sources,
					})),
				)
			: "";
	useEffect(() => {
		if (!previewSelection) return;
		setWelcomeSelection(JSON.parse(previewSelection));
		return () => setWelcomeSelection([]);
	}, [previewSelection]);

	function onEvent(event: DesktopApplyEvent) {
		if (event.type === "progress")
			setStatus({ kind: "working", text: progressText(event) });
		else if (event.type === "authorize")
			setStatus({ kind: "working", text: "Approve the sign-in to continue…" });
		else if (event.type === "done")
			setStatus({ kind: "done", text: doneText(event) });
		else setStatus({ kind: "error", text: event.message });
	}

	async function submit() {
		setStatus({ kind: "working", text: "Starting…" });
		try {
			const code = mode === "setup" ? await getCode?.() : undefined;
			if (mode === "setup" && !code) {
				setStatus({
					kind: "error",
					text: "Could not start setup. Try again.",
				});
				return;
			}
			const last = await bridge.applyRepositories(
				{ code: code ?? undefined, enable, disable },
				onEvent,
			);
			if (last?.type === "done" && mode === "settings") load();
		} catch (error) {
			setStatus({
				kind: "error",
				text:
					error instanceof Error ? error.message : "Opaline could not save.",
			});
		}
	}

	return (
		<div className="desktop-repository-picker">
			<RepositorySearchField
				className="mb-m"
				name="local-repository-search"
				label="Find a repository on this Mac"
				value={search}
				onChange={setSearch}
			/>
			{loadError ? (
				<div className="sessions-settings-empty" role="alert">
					{loadError}{" "}
					<Button variant="link" size="inline" onClick={load}>
						Try again
					</Button>
				</div>
			) : (
				<div className="sessions-settings-table-wrap">
					<table className="sessions-settings-table">
						<thead>
							<tr>
								<th scope="col">Repository</th>
								<th scope="col">On this Mac</th>
								<th scope="col">Uploaded</th>
								<th scope="col">Auto-upload</th>
							</tr>
						</thead>
						<tbody>
							{!list && <LoadingRows />}
							{visible.map((repo) => (
								<tr key={repo.key}>
									<td>
										<div className="sessions-settings-repo">
											<IconFolder size={16} aria-hidden="true" />
											<span
												className="sessions-settings-repo-name"
												title={repo.paths.join("\n") || repo.name}
											>
												{repo.name}
											</span>
											<span className="desktop-repository-sources">
												{repo.problem ??
													repo.sources
														.map((source) => SOURCE_LABELS[source] ?? source)
														.join(" · ")}
											</span>
										</div>
									</td>
									<td>{repo.sessionCount.toLocaleString()}</td>
									<td>{repo.uploadedCount?.toLocaleString() ?? "–"}</td>
									<td>
										<Checkbox
											className="ml-auto"
											aria-label={`Upload sessions from ${repo.name}`}
											checked={isOn(repo.key, repo.enabled)}
											disabled={working}
											onCheckedChange={(checked) =>
												setDesired((current) =>
													new Map(current).set(repo.key, checked === true),
												)
											}
										/>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{list && !loadError && !visible.length && (
				<p className="sessions-settings-empty">
					{query
						? "No repositories match your search."
						: "No Claude Code or Codex sessions found on this Mac yet."}
				</p>
			)}
			{list && !loadError && !query && hiddenCount > 0 && (
				<Pressable
					className="desktop-repository-more"
					aria-expanded={showAll}
					onClick={() => setShowAll((value) => !value)}
				>
					{showAll
						? "Show fewer"
						: `Show ${hiddenCount.toLocaleString()} more (temporary folders and folders without sessions)`}
				</Pressable>
			)}

			<div className="desktop-repository-footer">
				<p
					className="desktop-repository-status"
					data-status={status.kind}
					role={status.kind === "error" ? "alert" : "status"}
				>
					{status.kind === "idle"
						? mode === "setup"
							? `${shownSelected} selected`
							: enable.length + disable.length
								? `${enable.length + disable.length} unsaved change${enable.length + disable.length === 1 ? "" : "s"}`
								: "Changes apply to this Mac."
						: status.text}
				</p>
				<Button
					variant="primary"
					type="button"
					size="md"
					disabled={!canSubmit}
					onClick={() => void submit()}
				>
					{mode === "setup" ? "Connect" : "Save"}
				</Button>
			</div>
		</div>
	);
}

function LoadingRows() {
	return [118, 92, 76, 64, 52].map((width) => (
		<tr key={width} data-loading-row="">
			<td>
				<div className="sessions-settings-repo">
					<Skeleton className="size-4 shrink-0 corner-xs" />
					<Skeleton className="h-3.5 corner-xs" style={{ width }} />
				</div>
			</td>
			<td>
				<Skeleton className="ml-auto h-3.5 w-6 corner-xs" />
			</td>
			<td>
				<Skeleton className="ml-auto h-3.5 w-6 corner-xs" />
			</td>
			<td>
				<Skeleton className="ml-auto size-4 corner-xs" />
			</td>
		</tr>
	));
}

function isNoisePath(path: string): boolean {
	return (
		/^\/(private\/)?(tmp|var)\//.test(path) ||
		/\/\.[^/]/.test(path) ||
		path.includes("/Library/") ||
		/^\/Users\/[^/]+\/?$/.test(path)
	);
}

function isRelevant(repo: DesktopRepository): boolean {
	if (repo.sessionCount === 0) return false;
	return repo.enabled || !repo.paths.every(isNoisePath);
}

function progressText(
	event: Extract<DesktopApplyEvent, { type: "progress" }>,
): string {
	if (event.phase === "scan") return "Preparing your upload…";
	if (event.phase === "authorize") return "Approve the sign-in to continue…";
	if (event.phase === "save") return "Saving your choices…";
	return event.total
		? `Uploading sessions ${(event.completed ?? 0).toLocaleString()} of ${event.total.toLocaleString()}…`
		: "Uploading sessions…";
}

function doneText(event: Extract<DesktopApplyEvent, { type: "done" }>): string {
	const parts = [
		event.uploaded
			? `${event.uploaded.toLocaleString()} session${event.uploaded === 1 ? "" : "s"} uploaded`
			: "Saved",
	];
	if (event.failed) parts.push(`${event.failed.toLocaleString()} failed`);
	return parts.join(" · ");
}
