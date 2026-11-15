import type { HistoricalSkillSummary } from "@rudel/api-routes";
import {
	IconBoltFilled,
	IconFolderFilled,
	IconUsers,
} from "@tabler/icons-react";
import { type ComponentType, memo, type ReactNode } from "react";
import { SkillMark } from "@/components/skill-mark";
import { getSkillMarkLook } from "@/components/skill-mark-look";
import { FluidMenuHover } from "@/components/ui/fluid-menu-hover";
import {
	CARD,
	ScrollColumn,
} from "@/features/sessions/reader/files/session-reader-files-parts";
import { OpalineShape } from "@/features/shell/components/shell-nav-icon";
import { RichSkillDocument } from "@/features/skills/components/rich-skill-document";
import { cn } from "@/lib/utils";
import { skillDescription } from "./skill-description";

export function SkillCardsGrid({
	skills,
	onSelect,
}: {
	skills: readonly HistoricalSkillSummary[];
	onSelect: (name: string) => void;
}) {
	return (
		<ScrollColumn className="min-w-0 overscroll-contain">
			<div data-fluid-menu-root="">
				<FluidMenuHover
					items="[data-overview-card-open]"
					bridgeGap={20}
					over
					fillClassName="corner-squircle"
				/>
				<ul
					aria-label="Skills"
					className="grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,13.5rem),1fr))] gap-5 p-4 sm:p-5 lg:p-6"
				>
					{skills.map((skill) => (
						<li key={skill.name} className="min-w-0">
							<SkillCard skill={skill} onSelectSkill={onSelect} />
						</li>
					))}
				</ul>
			</div>
		</ScrollColumn>
	);
}

const SkillCard = memo(function SkillCard({
	skill,
	onSelectSkill,
}: {
	skill: HistoricalSkillSummary;
	onSelectSkill: (name: string) => void;
}) {
	const description = skillDescription(skill);
	const repos = skill.attribution?.repoCount ?? 0;
	const members = skill.attribution?.userCount ?? 0;
	return (
		<OverviewCard
			name={skill.name}
			onSelect={onSelectSkill}
			pills={
				<>
					<StripPill
						icon={IconBoltFilled}
						label={`${skill.sessionCount.toLocaleString()} ${skill.sessionCount === 1 ? "use" : "uses"}`}
					/>
					{repos > 0 ? (
						<StripPill
							icon={IconFolderFilled}
							label={repos.toLocaleString()}
							title={`${repos.toLocaleString()} ${repos === 1 ? "repo" : "repos"}`}
						/>
					) : null}
					{members > 0 ? (
						<StripPill
							icon={IconUsers}
							label={members.toLocaleString()}
							title={`${members.toLocaleString()} ${members === 1 ? "member" : "members"}`}
						/>
					) : null}
				</>
			}
		>
			{description ? (
				<p className="pt-1.5 text-[13px] leading-5 text-pretty text-[color:var(--dashboardy-heading)]/75">
					{description}
				</p>
			) : skill.contentPreview ? (
				<div className="min-h-0 flex-1 overflow-hidden pt-1.5">
					<RichSkillDocument content={skill.contentPreview} variant="preview" />
				</div>
			) : (
				<p className="pt-1.5 text-xs leading-5 text-[color:var(--dashboardy-subtle)]">
					No description was recovered for this skill.
				</p>
			)}
		</OverviewCard>
	);
});

export function OverviewCard({
	children,
	name,
	onSelect,
	pills,
}: {
	children: ReactNode;
	name: string;
	onSelect: (name: string) => void;
	pills: ReactNode;
}) {
	const { emoji, tint } = getSkillMarkLook(name);
	return (
		<article
			className={cn(
				"group relative flex aspect-[4/5] w-full min-w-0 flex-col overflow-hidden text-left",
				CARD,
			)}
		>
			<button
				type="button"
				aria-label={`Open ${name}`}
				data-overview-card-open=""
				onClick={() => onSelect(name)}
				className="absolute inset-0 z-20 rounded-lg corner-squircle squircle:rounded-3xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--dashboard-01-metric-button-focus-ring)]"
			/>
			<div className="pointer-events-none flex min-h-0 flex-1 flex-col">
				<div
					skullet-block=""
					className="relative h-20 shrink-0 overflow-hidden"
					style={{
						background: `radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, ${tint} 70%, white 12%) 0%, transparent 60%), linear-gradient(135deg, color-mix(in oklab, ${tint} 62%, var(--card)), color-mix(in oklab, ${tint} 26%, var(--card)))`,
					}}
				>
					<span
						aria-hidden="true"
						skullet-ignore=""
						className="absolute -right-3 -bottom-7 rotate-[-14deg] text-[88px] leading-none opacity-15"
					>
						<span>{emoji}</span>
					</span>
					<div className="absolute inset-x-3 top-3 flex items-center gap-1">
						{pills}
					</div>
				</div>
				<div className="relative -mt-5 flex min-w-0 shrink-0 flex-col gap-2 px-4">
					<span className="relative grid size-11 place-items-center">
						<span
							aria-hidden="true"
							skullet-ignore=""
							className="absolute inset-0"
						>
							<OpalineShape className="absolute inset-0 [--opal-fill:var(--card)] [--opal-ring:transparent]" />
						</span>
						<SkillMark skill={name} className="relative size-10 text-xl" />
					</span>
					<h2
						className="min-w-0 truncate text-[17px] leading-6 font-semibold tracking-[-0.015em] text-[color:var(--dashboardy-heading)]"
						title={name}
					>
						{name}
					</h2>
				</div>
				<div className="relative mx-4 flex min-h-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_bottom,#000_calc(100%-3rem),transparent)]">
					{children}
				</div>
			</div>
		</article>
	);
}

export function StripPill({
	icon: Icon,
	label,
	title,
}: {
	icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
	label: string;
	title?: string;
}) {
	return (
		<span
			title={title}
			className="inline-flex items-center gap-1 rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums"
		>
			<span className="inline-flex opacity-80">
				<Icon aria-hidden className="size-3" />
			</span>
			{label}
		</span>
	);
}
