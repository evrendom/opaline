import type { HistoricalSkillSummary } from "@rudel/api-routes";
import {
	IconBoltFilled,
	IconFolderFilled,
	IconUsers,
} from "@tabler/icons-react";
import {
	type ComponentType,
	memo,
	type ReactNode,
	useLayoutEffect,
	useRef,
} from "react";
import { SkillMark } from "@/components/skill-mark";
import { getSkillMarkLook } from "@/components/skill-mark-look";
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
			<ul
				aria-label="Skills"
				className="grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-xxl p-xl sm:p-xxl lg:p-xxl"
			>
				{skills.map((skill) => (
					<li key={skill.name} className="min-w-0">
						<SkillCard skill={skill} onSelectSkill={onSelect} />
					</li>
				))}
			</ul>
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
				<p className="pt-s text-body-l text-pretty text-ink/75">
					{description}
				</p>
			) : skill.contentPreview ? (
				<div className="min-h-0 flex-1 overflow-hidden pt-s">
					<RichSkillDocument content={skill.contentPreview} variant="preview" />
				</div>
			) : (
				<p className="pt-s text-body-m text-ink-3">
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
	const body = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => markHiddenRows(body.current));
	useLayoutEffect(() => {
		const element = body.current;
		if (!element) return;
		const observer = new ResizeObserver(() => markHiddenRows(element));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
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
				onClick={() => onSelect(name)}
				className="absolute inset-0 z-20 corner-m corner-squircle squircle:corner-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--dashboard-01-metric-button-focus-ring)]"
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
						// design-escape-ok: the card's emoji watermark is artwork, set solid
						className="absolute -right-3 -bottom-7 rotate-[-14deg] text-display-xxl leading-none opacity-15"
					>
						<span>{emoji}</span>
					</span>
					<div className="absolute inset-x-3 top-3 flex items-center gap-xs">
						{pills}
					</div>
				</div>
				<div className="relative -mt-xxl flex min-w-0 shrink-0 flex-col gap-m px-xl">
					<span className="relative grid size-11 place-items-center">
						<span
							aria-hidden="true"
							skullet-ignore=""
							className="absolute inset-0"
						>
							<OpalineShape className="absolute inset-0 [--opal-fill:var(--card)] [--opal-ring:transparent]" />
						</span>
						<SkillMark
							skill={name}
							className="relative size-10 text-display-xxs"
						/>
					</span>
					<h2
						className="min-w-0 truncate text-body-xxl font-heavy text-ink"
						title={name}
					>
						{name}
					</h2>
				</div>
				<div
					ref={body}
					className="relative mx-xl flex min-h-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_bottom,#000_calc(100%-3rem),transparent)]"
				>
					{children}
				</div>
			</div>
		</article>
	);
}

const HALF_FADE = 24;

function markHiddenRows(body: HTMLElement | null) {
	if (!body) return;
	const limit = body.getBoundingClientRect().bottom - HALF_FADE;
	for (const row of body.querySelectorAll<HTMLElement>("[data-card-row]"))
		row.toggleAttribute(
			"skullet-ignore",
			row.getBoundingClientRect().bottom > limit,
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
			className={cn(
				"inline-flex items-center gap-xs",
				"corner-full px-m py-xxs",
				"text-body-s font-medium tabular-nums",
				// design-escape-ok: a scrim pill over the card's tinted artwork; reads the same in both modes
				"bg-black/30 text-white",
			)}
		>
			<span className="inline-flex opacity-80">
				<Icon aria-hidden className="size-3" />
			</span>
			{label}
		</span>
	);
}
