import {
	type Icon,
	IconBrandGithub,
	IconBrandGithubFilled,
	IconFiles,
	IconFilesFilled,
	IconFileText,
	IconFileTextFilled,
	IconLayoutList,
	IconLayoutListFilled,
	IconMessages,
	IconMessagesFilled,
	IconPlug,
	IconSparkles,
	IconSparklesFilled,
} from "@tabler/icons-react";
import { useMemo } from "react";
import { IconPlugFilled } from "@/components/ui/icon-plug-filled";
import { PillTabs } from "./pill-tabs";

export type RepoReaderTab =
	| "summary"
	| "sessions"
	| "files"
	| "instructions"
	| "skills"
	| "mcp"
	| "ci";

const REPO_VIEWS: readonly {
	activeIcon: Icon;
	icon: Icon;
	id: RepoReaderTab;
	label: string;
}[] = [
	{
		activeIcon: IconLayoutListFilled,
		icon: IconLayoutList,
		id: "summary",
		label: "Summary",
	},
	{
		activeIcon: IconMessagesFilled,
		icon: IconMessages,
		id: "sessions",
		label: "Sessions",
	},
	{
		activeIcon: IconFilesFilled,
		icon: IconFiles,
		id: "files",
		label: "Files",
	},
	{
		activeIcon: IconFileTextFilled,
		icon: IconFileText,
		id: "instructions",
		label: "Instructions",
	},
	{
		activeIcon: IconSparklesFilled,
		icon: IconSparkles,
		id: "skills",
		label: "Skills",
	},
	{
		activeIcon: IconPlugFilled,
		icon: IconPlug,
		id: "mcp",
		label: "MCP",
	},
	{
		activeIcon: IconBrandGithubFilled,
		icon: IconBrandGithub,
		id: "ci",
		label: "CI & PRs",
	},
];

const LEGACY_TABS: Record<string, RepoReaderTab> = {
	chat: "summary",
	compass: "summary",
	health: "summary",
	dashboard: "summary",
	filesystem: "files",
	setup: "instructions",
};

export function repoTabIcon(tab: RepoReaderTab): Icon | null {
	return REPO_VIEWS.find((view) => view.id === tab)?.activeIcon ?? null;
}

export function repoTabLabel(tab: RepoReaderTab): string {
	return REPO_VIEWS.find((view) => view.id === tab)?.label ?? tab;
}

export function readRepoTab(
	value: string | null,
	sessionOpen: boolean,
): RepoReaderTab {
	const tab =
		REPO_VIEWS.find((view) => view.id === value)?.id ??
		(value ? LEGACY_TABS[value] : undefined);
	return tab ?? (sessionOpen ? "sessions" : "summary");
}

export function RepoReaderTabs({
	ci,
	onChange,
	value,
}: {
	ci: boolean;
	onChange: (tab: RepoReaderTab) => void;
	value: RepoReaderTab;
}) {
	const tabs = useMemo(
		() => REPO_VIEWS.filter((view) => ci || view.id !== "ci"),
		[ci],
	);
	return (
		<PillTabs
			className="mr-2 h-8 bg-transparent"
			label="Repo view"
			pillClassName="bg-card shadow-(--custom-shadow) dark:bg-muted-foreground/10"
			onChange={onChange}
			tabs={tabs}
			value={value}
		/>
	);
}
