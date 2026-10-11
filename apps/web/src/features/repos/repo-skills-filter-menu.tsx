import { Menu } from "@base-ui/react/menu";
import { IconAdjustmentsHorizontal, IconCheck } from "@tabler/icons-react";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import {
	ClaudeModelIcon,
	CodexModelIcon,
} from "@/features/dashboard/components/DashboardModelBadges";
import "@/features/sessions/components/session-menu.css";
import { SESSION_OVERVIEW_MENU_TRIGGER_CLASS_NAME } from "@/features/sessions/components/sessions-overview-table-utils";
import { cn } from "@/lib/utils";

export const SKILL_AGENTS = [
	{ key: "claude", label: "Claude", Icon: ClaudeModelIcon },
	{ key: "codex", label: "Codex", Icon: CodexModelIcon },
] as const;
export type SkillAgent = (typeof SKILL_AGENTS)[number]["key"];

/** The skills toolbar's Filter button, in the sessions toolbar's style: a menu
 * of agents, and the list keeps the skills used with any checked one. */
export function RepoSkillsFilterMenu({
	agents,
	onAgentsChange,
}: {
	agents: readonly SkillAgent[];
	onAgentsChange: (agents: SkillAgent[]) => void;
}) {
	const activeCount = agents.length;
	const triggerLabel =
		activeCount > 0 ? `Filter skills, ${activeCount} active` : "Filter skills";
	return (
		<Menu.Root>
			<Menu.Trigger
				aria-label={triggerLabel}
				title={triggerLabel}
				className={SESSION_OVERVIEW_MENU_TRIGGER_CLASS_NAME}
				data-active={activeCount > 0 || undefined}
			>
				<IconAdjustmentsHorizontal
					aria-hidden="true"
					className={cn(
						"size-4 h-lh shrink-0",
						activeCount > 0
							? "text-(--session-overview-accent)"
							: "text-[#5d5d5d] dark:text-[#acaeb2]",
					)}
				/>
				<span>Filter</span>
				{activeCount > 0 ? (
					<span className="min-w-4 rounded-full bg-(--session-overview-accent) px-1 text-center text-[10px] leading-4 font-semibold tabular-nums text-white">
						{activeCount}
					</span>
				) : null}
				<span
					aria-hidden="true"
					className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
				/>
			</Menu.Trigger>
			<Menu.Portal>
				<Menu.Positioner align="start" sideOffset={6} className="z-50">
					<Menu.Popup
						aria-label="Filter skills"
						data-fluid-menu-root=""
						className="session-menu-surface session-menu-sort"
					>
						<FluidMenuHover />
						<Menu.Group>
							<Menu.GroupLabel className="session-menu-heading">
								Agent
							</Menu.GroupLabel>
							{SKILL_AGENTS.map(({ key, label, Icon }) => {
								const checked = agents.includes(key);
								return (
									<Menu.CheckboxItem
										key={key}
										checked={checked}
										onCheckedChange={(next) =>
											onAgentsChange(
												SKILL_AGENTS.map((agent) => agent.key).filter(
													(agent) =>
														agent === key ? next : agents.includes(agent),
												),
											)
										}
										className="session-menu-row"
									>
										<span
											className="session-menu-sort-check"
											aria-hidden="true"
										>
											<span
												className="session-menu-checkbox"
												data-checked={checked}
											>
												{checked ? <IconCheck className="size-2.5" /> : null}
											</span>
										</span>
										<Icon className="size-3.5 shrink-0" />
										{label}
									</Menu.CheckboxItem>
								);
							})}
						</Menu.Group>
					</Menu.Popup>
				</Menu.Positioner>
			</Menu.Portal>
		</Menu.Root>
	);
}
