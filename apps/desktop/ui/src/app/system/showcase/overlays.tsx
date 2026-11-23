import { MOMENT_KINDS, type MomentKind } from "@rudel/api-routes";
import { useState } from "react";
import { toast } from "sonner";
import { AppToaster } from "@/app/ui/AppToaster";
import { KindsMenu } from "@/features/compass/compass-moments";
import { DashboardModelIdentity } from "@/features/dashboard/components/DashboardModelBadges";
import type { SessionTurnTableSpeaker } from "@/features/sessions/components/session-turn-table-selection";
import { SessionTurnTableSpeakerVisibilityControls } from "@/features/sessions/components/session-turn-table-view-tabs";
import { DeleteWorkspaceDialog } from "@/features/settings/workspace/components/DeleteWorkspaceDialog";
import "@/features/costs/cost-dashboard.css";
import "@/features/compass/compass.css";
import {
	DateRangeControl,
	SessionFiltersControl,
	SkillsFilterControl,
	SortControl,
} from "./header";
import { Group, Specimen } from "./kit";
import { demoPortraits, seed } from "./providers";
import { MembersTableControl } from "./settings";
import { WorkspaceSwitcherControl } from "./shell";
import { type StageDefinition, StageFrame } from "./stage";

const FLAG_COUNTS = Object.fromEntries(
	MOMENT_KINDS.map((kind, index) => [kind, [12, 9, 7, 4, 3, 2][index] ?? 0]),
) as Record<MomentKind, number>;

function CompassFlagsStage() {
	const [kinds, setKinds] = useState<MomentKind[]>([
		"expensive_run",
		"long_run",
	]);
	return <KindsMenu kinds={kinds} counts={FLAG_COUNTS} onChange={setKinds} />;
}

function VisibleRowsStage() {
	const [visible, setVisible] = useState<ReadonlySet<SessionTurnTableSpeaker>>(
		new Set(["member", "model"]),
	);
	const [primary, setPrimary] = useState<SessionTurnTableSpeaker>("member");
	return (
		<SessionTurnTableSpeakerVisibilityControls
			className={undefined}
			model="gpt-5.5"
			onPrimarySpeakerChange={setPrimary}
			onVisibleSpeakersChange={setVisible}
			primarySpeaker={primary}
			userImageUrl={demoPortraits[0]}
			userLabel="Rafa"
			visibleSpeakers={visible}
		/>
	);
}

function DeleteWorkspaceStage() {
	const [open, setOpen] = useState(true);
	return (
		<DeleteWorkspaceDialog
			open={open}
			onOpenChange={setOpen}
			organization={seed.organization}
			onDeleted={async () => {}}
		/>
	);
}

/** Every stage the Overlays and Feedback groups show, by id. */
export const STAGES: Record<string, StageDefinition> = {
	"workspace-menu": {
		render: () => <WorkspaceSwitcherControl />,
		steps: [{ press: '[data-slot="dropdown-menu-trigger"]' }],
	},
	"date-range": {
		render: () => <DateRangeControl />,
		steps: [{ press: "button" }],
		align: "end",
	},
	"sort-menu": {
		render: () => <SortControl />,
		steps: [{ press: 'button[aria-label^="Sort"]' }],
	},
	"filters-menu": {
		render: () => <SessionFiltersControl />,
		steps: [
			{ press: 'button[aria-label^="Filter"]' },
			{ press: ".menu-parent .menu-row" },
		],
	},
	"skills-filter": {
		render: () => <SkillsFilterControl active />,
		steps: [
			{ press: 'button[aria-label^="Filter"]' },
			{ press: ".menu-parent .menu-row" },
		],
	},
	"role-select": {
		render: () => <MembersTableControl />,
		steps: [{ press: '.settings-list [data-slot="select-trigger"]' }],
		boxClassName: "settings-page w-[40rem] pb-zero",
	},
	"visible-rows": {
		render: () => <VisibleRowsStage />,
		steps: [{ press: '[aria-label^="Choose visible rows"]' }],
	},
	"compass-flags": {
		render: () => <CompassFlagsStage />,
		steps: [{ press: '[aria-label^="Filter runs by flag"]' }],
		align: "end",
	},
	"delete-workspace": {
		render: () => <DeleteWorkspaceStage />,
	},
	tooltip: {
		render: () => (
			<DashboardModelIdentity
				className="flex items-center gap-s"
				model="gpt-5.5"
				messageCount={101}
			/>
		),
		steps: [{ hover: ".cursor-help" }],
		align: "center",
	},
	toasts: {
		render: () => <AppToaster richColors position="bottom-right" />,
		steps: [
			{ run: () => toast.success("Command copied") },
			{
				run: () =>
					toast.error("Could not copy. Select and copy the command below."),
			},
		],
	},
};

export function OverlaysGroup() {
	return (
		<Group title="Overlays">
			<Specimen
				name="SidebarWorkspaceSwitcher (DropdownMenu)"
				source="features/shell/components/SidebarWorkspaceSwitcher.tsx"
				where="Sidebar top: the workspace menu, opening to the right. The current workspace is checked."
			>
				<StageFrame
					id="workspace-menu"
					height={200}
					width={520}
					title="Workspace menu, open"
				/>
			</Specimen>
			<Specimen
				name="AnalyticsDateRangePicker (Popover, Calendar)"
				source="features/analytics/date-range/components/AnalyticsDateRangePicker.tsx · features/costs/chart-interval-picker.tsx"
				where="Dashboard header, the Sessions and repo rails, Compass: presets, the chart interval (menu-list) and a two-month calendar."
			>
				<StageFrame
					id="date-range"
					height={480}
					width={1000}
					title="Date range picker, open"
				/>
			</Specimen>
			<Specimen
				name="ToolbarSortMenu (SessionMenuPopup, menu-sort)"
				source="features/sessions/components/sessions-overview-sort-menu.tsx"
				where="Sorted by on Sessions, Skills, Repos and MCP: one checked field, one checked direction."
			>
				<StageFrame
					id="sort-menu"
					height={420}
					width={420}
					title="Sort menu, open"
				/>
			</Specimen>
			<Specimen
				name="SessionsOverviewFiltersMenu (menu-popover, menu-parent, menu-flyout)"
				source="features/sessions/components/sessions-overview-filters-menu.tsx"
				where="Sessions toolbar → Filter: dimensions on the left, the picked one's options (menu-checkbox) in a flyout."
			>
				<StageFrame
					id="filters-menu"
					height={400}
					width={560}
					title="Session filters, open"
				/>
			</Specimen>
			<Specimen
				name="OverviewRangeFiltersMenu (SliderRangeInput)"
				source="components/overview-list.tsx · app/ui/slider-range-input.tsx"
				where="Skills and Repos toolbar → Filter: a range per measure, the applied one marked (menu-active-dot)."
			>
				<StageFrame
					id="skills-filter"
					height={260}
					width={560}
					title="Skills filter, open"
				/>
			</Specimen>
			<Specimen
				name="KindsMenu (FlagKindsPopup, menu-picks)"
				source="features/compass/compass-moments.tsx"
				where="Compass toolbar → Flags: a checkbox menu of flag kinds with counts; picked rows join into one band."
			>
				<StageFrame
					id="compass-flags"
					height={520}
					width={420}
					title="Flags menu, open"
				/>
			</Specimen>
			<Specimen
				name="SessionTurnTableSpeakerVisibilityControls (DropdownMenuCheckboxItem)"
				source="features/sessions/components/session-turn-table-view-tabs.tsx"
				where="The turn table on /newsesh: which speakers' rows show."
			>
				<StageFrame
					id="visible-rows"
					height={260}
					width={420}
					title="Visible rows menu, open"
				/>
			</Specimen>
			<Specimen
				name="WorkspaceMembersTable role Select (Select)"
				source="features/settings/workspace/components/WorkspaceMembersTable.tsx · app/ui/select.tsx"
				where="Settings → Members: a member's role, checked item on the current one."
			>
				<StageFrame
					id="role-select"
					height={560}
					width={760}
					title="Role select, open"
				/>
			</Specimen>
			<Specimen
				name="DeleteWorkspaceDialog (Dialog)"
				source="features/settings/workspace/components/DeleteWorkspaceDialog.tsx"
				where="Settings → Workspace → Danger zone → Delete workspace. The confirm stays disabled until the name is typed."
			>
				<StageFrame
					id="delete-workspace"
					height={460}
					width={720}
					title="Delete workspace dialog"
				/>
			</Specimen>
			<Specimen
				name="Tooltip (DashboardModelIdentity)"
				source="app/ui/tooltip.tsx · features/dashboard/components/DashboardModelBadges.tsx"
				where="Every tooltip is this one surface; here the session interaction counts' model tooltip."
			>
				<StageFrame
					id="tooltip"
					height={140}
					width={420}
					title="Tooltip, open"
				/>
			</Specimen>
			<Specimen
				name="AppToaster (sonner)"
				source="app/ui/AppToaster.tsx"
				where="Bottom right of every screen: copy confirmations, failed saves."
			>
				<StageFrame id="toasts" height={220} width={520} title="Toasts" />
			</Specimen>
		</Group>
	);
}
