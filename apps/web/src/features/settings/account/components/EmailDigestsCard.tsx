import type { UsageDigestPreferences } from "@rudel/api-routes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/app/ui/checkbox";
import { Skeleton } from "@/app/ui/skeleton";
import {
	WorkspaceSettingsGroup,
	WorkspaceSettingsRow,
} from "@/features/settings/workspace/components/workspace-settings-group";
import { client } from "@/lib/orpc";

const QUERY_KEY = ["usage-digest-preferences"];
const KINDS = [
	{ kind: "daily", label: "Daily" },
	{ kind: "weekly", label: "Weekly" },
] as const;

export function EmailDigestsCard() {
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: QUERY_KEY,
		queryFn: () => client.usageDigest.preferences(),
	});

	async function setPreference(
		organizationId: string,
		kind: "daily" | "weekly",
		enabled: boolean,
	) {
		const previous =
			queryClient.getQueryData<UsageDigestPreferences>(QUERY_KEY);
		queryClient.setQueryData<UsageDigestPreferences>(QUERY_KEY, (current) =>
			current
				? {
						workspaces: current.workspaces.map((workspace) =>
							workspace.organizationId === organizationId
								? { ...workspace, [kind]: enabled }
								: workspace,
						),
					}
				: current,
		);
		try {
			await client.usageDigest.setPreference({ organizationId, kind, enabled });
		} catch {
			queryClient.setQueryData(QUERY_KEY, previous);
			toast.error("Your email choice could not be saved. Please try again.");
		}
	}

	return (
		<WorkspaceSettingsGroup
			title="Email digests"
			description="A summary of your sessions, time and cost with your agents. The weekly one arrives on Monday at 9 am, the daily one at 7 pm on weekdays you used your agents."
		>
			{query.isPending ? (
				<WorkspaceSettingsRow label={<Skeleton className="h-4 w-32" />}>
					<Skeleton className="h-4 w-36" />
				</WorkspaceSettingsRow>
			) : query.isError ? (
				<WorkspaceSettingsRow label="Could not load your email choices.">
					<button
						type="button"
						className="text-sm underline"
						onClick={() => void query.refetch()}
					>
						Try again
					</button>
				</WorkspaceSettingsRow>
			) : (
				query.data.workspaces.map((workspace) => (
					<WorkspaceSettingsRow
						key={workspace.organizationId}
						label={workspace.organizationName}
					>
						<div className="flex items-center gap-5">
							{KINDS.map(({ kind, label }) => (
								<DigestCheckbox
									key={kind}
									label={label}
									checked={workspace[kind]}
									onCheckedChange={(checked) =>
										void setPreference(workspace.organizationId, kind, checked)
									}
								/>
							))}
						</div>
					</WorkspaceSettingsRow>
				))
			)}
		</WorkspaceSettingsGroup>
	);
}

function DigestCheckbox({
	label,
	checked,
	onCheckedChange,
}: {
	label: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}) {
	const id = useId();
	return (
		<div className="flex items-center gap-2 text-sm">
			<Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} />
			<label htmlFor={id} className="cursor-pointer">
				{label}
			</label>
		</div>
	);
}
