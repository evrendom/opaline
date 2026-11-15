import type {
	AdminWorkspaceFeatures,
	AdminWorkspaceFeaturesRow,
	WorkspaceFeatureKey,
	WorkspaceFeatureState,
} from "@rudel/api-routes";
import {
	keepPreviousData,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { useDebouncedValue } from "@/components/dashboard/hooks";
import { client } from "@/lib/orpc";
import { cn } from "@/lib/utils";

const FEATURES_KEY = ["admin", "workspaceFeatures"] as const;

type Choice = "default" | "on" | "off";

// Operator-only page for per-workspace feature switches. Like the other
// admin pages it sits outside the app shell and nothing links to it; the API
// refuses everyone outside the admin organization. A switch overrides the
// feature's environment list for one workspace and takes effect within a
// minute, without a redeploy.
export function WorkspaceFeaturesAdminPage() {
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [error, setError] = useState<string | null>(null);
	const query = useDebouncedValue(search.trim());
	const listing = useQuery({
		queryKey: [...FEATURES_KEY, query],
		queryFn: () =>
			client.admin.workspaceFeatures.list({
				...(query ? { search: query } : {}),
				limit: 50,
			}),
		placeholderData: keepPreviousData,
	});

	const set = async (
		workspaceId: string,
		feature: WorkspaceFeatureKey,
		choice: Choice,
	) => {
		setError(null);
		try {
			await client.admin.workspaceFeatures.set({
				workspaceId,
				feature,
				enabled: choice === "default" ? null : choice === "on",
			});
			await queryClient.invalidateQueries({ queryKey: FEATURES_KEY });
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		}
	};

	return (
		<main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10 text-sm text-foreground">
			<header className="flex flex-col gap-1">
				<h1 className="text-lg font-medium">Workspace features</h1>
				<p className="text-muted-foreground">
					Turn a feature on or off for one workspace. A switch overrides the
					feature's environment list and takes effect within a minute, with no
					redeploy. Default hands the decision back to the environment.
				</p>
			</header>
			<label className="flex flex-col gap-1">
				<span className="text-muted-foreground">
					Find a workspace by name, slug or id
				</span>
				<input
					id="workspace-features-search"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					placeholder="acme"
					className="h-9 max-w-sm rounded-md border bg-background px-3"
				/>
			</label>
			{error ? (
				<p role="alert" className="text-destructive">
					{error}
				</p>
			) : null}
			{listing.isError ? (
				<p role="alert" className="text-destructive">
					Couldn't load workspaces: {listing.error.message}
				</p>
			) : null}
			{listing.data ? (
				<FeatureTable listing={listing.data} onSet={set} />
			) : listing.isPending ? (
				<p className="text-muted-foreground">Loading workspaces…</p>
			) : null}
		</main>
	);
}

function FeatureTable({
	listing,
	onSet,
}: {
	listing: AdminWorkspaceFeatures;
	onSet: (
		workspaceId: string,
		feature: WorkspaceFeatureKey,
		choice: Choice,
	) => Promise<void>;
}) {
	if (listing.workspaces.length === 0)
		return <p className="text-muted-foreground">No matching workspaces.</p>;
	return (
		<div className="overflow-x-auto">
			<table className="w-full border-collapse text-left">
				<thead>
					<tr className="border-b text-muted-foreground">
						<th className="py-2 pr-4 font-medium">Workspace</th>
						{listing.features.map((feature) => (
							<th
								key={feature.key}
								className="py-2 pr-4 font-medium"
								title={`${feature.description} Environment default: ${feature.env}`}
							>
								{feature.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{listing.workspaces.map((workspace) => (
						<WorkspaceRow
							key={workspace.id}
							workspace={workspace}
							onSet={onSet}
						/>
					))}
				</tbody>
			</table>
			{listing.total > listing.workspaces.length ? (
				<p className="mt-2 text-muted-foreground">
					Showing {listing.workspaces.length} of {listing.total}; search to
					narrow it down.
				</p>
			) : null}
		</div>
	);
}

function WorkspaceRow({
	workspace,
	onSet,
}: {
	workspace: AdminWorkspaceFeaturesRow;
	onSet: (
		workspaceId: string,
		feature: WorkspaceFeatureKey,
		choice: Choice,
	) => Promise<void>;
}) {
	return (
		<tr className="border-b align-top">
			<td className="py-3 pr-4">
				<div className="font-medium">{workspace.name}</div>
				<div className="text-muted-foreground">
					{workspace.slug} · {workspace.members}{" "}
					{workspace.members === 1 ? "member" : "members"}
				</div>
				<code className="text-xs text-muted-foreground">{workspace.id}</code>
			</td>
			{workspace.features.map((state) => (
				<td key={state.key} className="py-3 pr-4">
					<FeatureSwitch
						label={`${state.key} for ${workspace.name}`}
						state={state}
						onChoose={(choice) => onSet(workspace.id, state.key, choice)}
					/>
				</td>
			))}
		</tr>
	);
}

function FeatureSwitch({
	label,
	state,
	onChoose,
}: {
	label: string;
	state: WorkspaceFeatureState;
	onChoose: (choice: Choice) => Promise<void>;
}) {
	const [busy, setBusy] = useState(false);
	const current: Choice =
		state.override === null ? "default" : state.override ? "on" : "off";
	const options: { value: Choice; text: string }[] = [
		{
			value: "default",
			text: `Default (${state.environment ? "on" : "off"})`,
		},
		{ value: "on", text: "On" },
		{ value: "off", text: "Off" },
	];
	return (
		<div className="flex flex-col gap-1">
			<fieldset
				aria-label={label}
				disabled={busy}
				className="inline-flex w-fit overflow-hidden rounded-md border"
			>
				{options.map((option) => (
					<button
						key={option.value}
						type="button"
						aria-pressed={current === option.value}
						onClick={async () => {
							if (option.value === current) return;
							setBusy(true);
							await onChoose(option.value);
							setBusy(false);
						}}
						className={cn(
							"h-8 px-2.5 text-xs whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 disabled:cursor-wait",
							current === option.value
								? "bg-foreground text-background"
								: "bg-background text-muted-foreground hover:text-foreground",
						)}
					>
						{option.text}
					</button>
				))}
			</fieldset>
			<span
				className={cn(
					"text-xs",
					state.enabled
						? "text-emerald-700 dark:text-emerald-400"
						: "text-muted-foreground",
				)}
			>
				{state.enabled ? "Enabled" : "Disabled"}
				{state.updatedAt
					? ` · set ${new Date(state.updatedAt).toLocaleDateString()}`
					: ""}
			</span>
		</div>
	);
}
