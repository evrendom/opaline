import {
	type Icon,
	IconBrandGithub,
	IconBrandGithubFilled,
	IconFileCode,
	IconFileCodeFilled,
	IconLayoutList,
	IconLayoutListFilled,
	IconMessages,
	IconMessagesFilled,
	IconSettings,
	IconSettingsFilled,
} from "@tabler/icons-react";
import { useMemo } from "react";
import { useLatestValueRef } from "@/app/hooks/useLatestValueRef";
import { PillTabs } from "@/features/repos/pill-tabs";
import { cn } from "@/lib/utils";
import {
	AGENT_PARAM,
	CI_PARAM,
	FILE_PARAM,
	NO_PICK,
	PR_PARAM,
	pickedAgentOf,
	pickedRunOf,
	pickOf,
	READ_PARAM,
	RUN_PARAM,
	readPick,
	SESSION_PICK,
	SESSION_TAB_PARAM,
	SETUP_PARAM,
	type SessionReaderTab,
	SUBAGENT_PARAM,
	TURN_PARAM,
	updateReaderParams,
	useReaderSearchParams,
	writeAgent,
	writePick,
	writeView,
} from "./reader-params";

export function useWholeSessionLine() {
	const [searchParams, setSearchParams] = useReaderSearchParams();
	const picked = searchParams.get(RUN_PARAM) === null;
	const setSearchParamsRef = useLatestValueRef(setSearchParams);
	return useMemo(
		() => ({
			onPick: () =>
				updateReaderParams(setSearchParamsRef.current, (params) => {
					writePick(params, SESSION_PICK);
				}),
			picked,
		}),
		[picked, setSearchParamsRef],
	);
}

export function useReaderPick() {
	const [searchParams, setSearchParams] = useReaderSearchParams();
	const address = readPick(searchParams);
	const pick = (turnId: string | null, subagentId: string | null = null) =>
		updateReaderParams(setSearchParams, (params) => {
			writePick(params, pickOf(turnId, subagentId));
		});
	return {
		address,
		agent: pickedAgentOf(address),
		pick,
		run: pickedRunOf(address),
	};
}

const SESSION_VIEWS: readonly {
	activeIcon: Icon;
	icon: Icon;
	id: SessionReaderTab;
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
		id: "detail",
		label: "Detail",
	},
	{
		activeIcon: IconFileCodeFilled,
		icon: IconFileCode,
		id: "files",
		label: "Files",
	},
	{
		activeIcon: IconSettingsFilled,
		icon: IconSettings,
		id: "setup",
		label: "Setup",
	},
	{
		activeIcon: IconBrandGithubFilled,
		icon: IconBrandGithub,
		id: "ci",
		label: "CI & PRs",
	},
];

const isTab = (value: string | null): value is SessionReaderTab =>
	SESSION_VIEWS.some((view) => view.id === value);

function hrefTo(
	current: URLSearchParams,
	view: SessionReaderTab,
	picks: Record<string, string | undefined>,
): string {
	const params = new URLSearchParams(current);
	writeView(params, view);
	for (const [key, value] of Object.entries(picks)) {
		if (value) params.set(key, value);
		else params.delete(key);
	}
	return `?${params.toString()}`;
}

export function sessionViewHrefs(current: URLSearchParams) {
	return {
		ci: (picks: { ci?: string; pr?: string }) =>
			hrefTo(current, "ci", {
				[CI_PARAM]: picks.ci,
				[PR_PARAM]: picks.pr,
				...NO_PICK,
			}),
		file: (picks: { file?: string; run?: string }) =>
			hrefTo(current, "files", {
				...NO_PICK,
				[FILE_PARAM]: picks.file,
				[READ_PARAM]: undefined,
				[RUN_PARAM]: picks.run,
				[TURN_PARAM]: picks.run,
			}),
		setup: (setupFile?: string) =>
			hrefTo(current, "setup", {
				...NO_PICK,
				[SETUP_PARAM]: setupFile,
			}),
		subagent: (subagentId?: string) =>
			hrefTo(current, "detail", {
				...NO_PICK,
				[AGENT_PARAM]: subagentId,
				[SUBAGENT_PARAM]: subagentId,
			}),
	};
}

export function useSessionReaderTab() {
	const [searchParams, setSearchParams] = useReaderSearchParams();
	const param = searchParams.get(SESSION_TAB_PARAM);
	const tab: SessionReaderTab = isTab(param) ? param : "summary";

	function selectTab(next: SessionReaderTab, reading?: string | null) {
		updateReaderParams(setSearchParams, (params) => {
			writeView(params, next);
			if (reading && reading !== params.get(RUN_PARAM))
				writePick(params, { kind: "run", run: reading });
		});
	}

	function openTurn(turnId: string, agent?: string) {
		updateReaderParams(setSearchParams, (params) => {
			writeView(params, "detail");
			writePick(params, pickOf(turnId, agent ?? null));
		});
	}

	function openFiles(picks: { file?: string; run?: string }) {
		updateReaderParams(setSearchParams, (params) => {
			writeView(params, "files");
			if (picks.file) params.set(FILE_PARAM, picks.file);
			else params.delete(FILE_PARAM);
			params.delete(READ_PARAM);
			writePick(params, pickOf(picks.run ?? null, null));
		});
	}

	function openSetup(setupFile?: string) {
		updateReaderParams(setSearchParams, (params) => {
			writeView(params, "setup");
			if (setupFile) params.set(SETUP_PARAM, setupFile);
			else params.delete(SETUP_PARAM);
		});
	}

	function openCi(picks: { ci?: string; pr?: string }) {
		updateReaderParams(setSearchParams, (params) => {
			writeView(params, "ci");
			for (const [key, value] of [
				[PR_PARAM, picks.pr],
				[CI_PARAM, picks.ci],
			] as const) {
				if (value) params.set(key, value);
				else params.delete(key);
			}
			writePick(params, SESSION_PICK);
		});
	}

	function openSubagent(subagentId?: string) {
		updateReaderParams(setSearchParams, (params) => {
			writeView(params, "detail");
			writePick(params, SESSION_PICK);
			if (subagentId) writeAgent(params, subagentId);
		});
	}

	const hrefs = useMemo(() => sessionViewHrefs(searchParams), [searchParams]);
	const setupFile = searchParams.get(SETUP_PARAM);
	const ciPicks = {
		ci: searchParams.get(CI_PARAM),
		pr: searchParams.get(PR_PARAM),
	};

	return {
		ciPicks,
		hrefs,
		openCi,
		openFiles,
		openSetup,
		openSubagent,
		openTurn,
		selectTab,
		setupFile,
		tab,
	};
}

export function SessionReaderTabs({
	ci,
	empty,
	onChange,
	value,
}: {
	ci: boolean;
	empty: ReadonlySet<SessionReaderTab>;
	onChange: (tab: SessionReaderTab) => void;
	value: SessionReaderTab;
}) {
	const tabs = useMemo(
		() =>
			SESSION_VIEWS.filter((view) => ci || view.id !== "ci").map((view) => ({
				...view,
				empty: empty.has(view.id),
			})),
		[ci, empty],
	);
	return (
		<PillTabs
			className="h-8 bg-transparent"
			label="Session view"
			pillClassName="tab-pill"
			onChange={onChange}
			tabs={tabs}
			value={value}
		/>
	);
}

export const READER_RAIL_BACKGROUND =
	"[--dashboard-01-content-background:var(--reader-page)]";

export function TabsBandFade({ className }: { className?: string }) {
	return (
		<div
			aria-hidden="true"
			className={cn(
				"sticky z-40 h-4",
				"-mb-xl",
				"pointer-events-none bg-linear-to-b from-canvas to-transparent opacity-0 transition-opacity duration-(--motion-medium-duration)",
				"in-data-fade-top:opacity-100",
				className,
			)}
		/>
	);
}

export function ViewBottomFade({ className }: { className?: string }) {
	return (
		<div
			aria-hidden="true"
			className={cn(
				"sticky bottom-0 z-30 h-8",
				"-mt-[calc(var(--space-xxl)*4/3)]",
				"pointer-events-none bg-linear-to-t from-canvas to-transparent opacity-0 transition-opacity duration-(--motion-medium-duration)",
				"in-data-fade-bottom:opacity-100",
				className,
			)}
		/>
	);
}
