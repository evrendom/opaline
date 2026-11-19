import type { RepositorySettings } from "@rudel/api-routes";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { useAnalyticsQuery } from "@/features/analytics/queries/useAnalyticsQuery";
import { useDesktop } from "@/features/desktop/desktop-bridge";
import { DesktopRepositoryPicker } from "@/features/desktop/desktop-repository-picker";
import { cliLoginCommand } from "@/features/self-hosted/cli-commands";
import { useSelfHost } from "@/features/self-hosted/self-host-info";
import { copyTextToClipboard } from "@/lib/clipboard";
import { orpc } from "@/lib/orpc";
import {
	getUploadStatus,
	MANAGE_COMMAND,
	SessionsSettingsView,
} from "./sessions-settings-view";

export function SessionsSettingsPage() {
	const selfHost = useSelfHost();
	const [search, setSearch] = useState("");
	const [copied, setCopied] = useState(false);
	const desktop = useDesktop();
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
		<SessionsSettingsView
			copied={copied}
			fetching={query.isFetching}
			localManager={
				desktop ? (
					<DesktopRepositoryPicker bridge={desktop} mode="settings" />
				) : undefined
			}
			onCopy={copyCommand}
			onRefresh={() => void query.refetch()}
			onSearch={setSearch}
			pending={query.isPending}
			error={query.isError}
			repositories={query.data ? repositories : undefined}
			search={search}
			signInCommand={
				selfHost ? cliLoginCommand(window.location.origin) : undefined
			}
			visible={visible}
		/>
	);
}

function getUploadStatusOrder(
	reports: RepositorySettings["repositories"][number]["reports"],
) {
	const state = getUploadStatus(reports);
	if (state === "enabled") return 0;
	if (state === "unknown") return 2;
	return 1;
}
