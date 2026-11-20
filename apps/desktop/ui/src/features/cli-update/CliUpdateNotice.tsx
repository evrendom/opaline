import {
	CLI_UPDATE_COMMAND,
	type CliUpdateStatus,
	getCliReleaseUrl,
} from "@rudel/api-routes";
import {
	IconArrowUpRight,
	IconCheck,
	IconCopy,
	IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "@/lib/clipboard";
import { orpc } from "@/lib/orpc";
import "./cli-update-notice.css";

const STATUS_STALE_MS = 60 * 60 * 1_000;
const COPIED_FEEDBACK_MS = 2_000;
// Dismissal is remembered per latest version, so a newer release shows again.
export const CLI_UPDATE_DISMISSED_STORAGE_KEY = "opaline:cli-update-dismissed";

function readDismissedVersion(): string | null {
	try {
		return window.localStorage.getItem(CLI_UPDATE_DISMISSED_STORAGE_KEY);
	} catch {
		return null; // Blocked storage: show the notice.
	}
}

function writeDismissedVersion(version: string): void {
	try {
		window.localStorage.setItem(CLI_UPDATE_DISMISSED_STORAGE_KEY, version);
	} catch {
		// Blocked storage: the dismissal lasts for this page load.
	}
}

export function CliUpdateNotice() {
	const { data: status } = useQuery({
		...orpc.cli.updateStatus.queryOptions({}),
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: STATUS_STALE_MS,
	});
	return <CliUpdateNoticeContent status={status} />;
}

export function CliUpdateNoticeContent({
	status,
}: {
	status: CliUpdateStatus | undefined;
}) {
	const [dismissedVersion, setDismissedVersion] =
		useState(readDismissedVersion);
	const { installedVersion, latestVersion } = status ?? {};
	if (
		!status?.outdated ||
		!installedVersion ||
		!latestVersion ||
		dismissedVersion === latestVersion
	)
		return null;
	return (
		<CliUpdateNoticeView
			installedVersion={installedVersion}
			latestVersion={latestVersion}
			onDismiss={() => {
				writeDismissedVersion(latestVersion);
				setDismissedVersion(latestVersion);
			}}
		/>
	);
}

function CliUpdateNoticeView({
	installedVersion,
	latestVersion,
	onDismiss,
}: {
	installedVersion: string;
	latestVersion: string;
	onDismiss: () => void;
}) {
	const [copied, setCopied] = useState(false);
	const copyTimer = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(copyTimer.current), []);

	async function copyCommand() {
		if (!(await copyTextToClipboard(CLI_UPDATE_COMMAND))) return;
		window.clearTimeout(copyTimer.current);
		setCopied(true);
		copyTimer.current = window.setTimeout(
			() => setCopied(false),
			COPIED_FEEDBACK_MS,
		);
	}

	return (
		<section
			aria-label="Opaline CLI update"
			data-cli-update-notice=""
			className="cli-update-notice menu-surface"
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				event.stopPropagation();
				onDismiss();
			}}
		>
			<div className="menu-heading">
				<p className="cli-update-notice-title">
					CLI update
					<span className="cli-update-notice-versions">
						{installedVersion} → {latestVersion}
					</span>
				</p>
				<button
					type="button"
					className="cli-update-notice-dismiss"
					aria-label="Dismiss CLI update notice"
					onClick={onDismiss}
				>
					<IconX aria-hidden="true" className="size-3.5" stroke={1.8} />
				</button>
			</div>
			<div className="menu-list">
				<button
					type="button"
					className="menu-row"
					title={CLI_UPDATE_COMMAND}
					onClick={() => void copyCommand()}
				>
					{copied ? (
						<IconCheck
							aria-hidden="true"
							className="menu-icon size-4"
							stroke={1.6}
						/>
					) : (
						<IconCopy aria-hidden="true" className="menu-icon size-4" />
					)}
					<span className="min-w-0 flex-1 truncate">
						{copied ? "Copied" : "Copy update command"}
					</span>
				</button>
				<a
					href={getCliReleaseUrl(latestVersion)}
					target="_blank"
					rel="noreferrer"
					className="menu-row"
				>
					<IconArrowUpRight
						aria-hidden="true"
						className="menu-icon size-4"
						stroke={1.6}
					/>
					<span className="min-w-0 flex-1 truncate">What's new</span>
					<span className="sr-only"> (opens in a new tab)</span>
				</a>
			</div>
			<output className="sr-only">
				{copied ? "Update command copied" : ""}
			</output>
		</section>
	);
}
