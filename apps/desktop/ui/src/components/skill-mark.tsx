import { getSkillMarkLook } from "@/components/skill-mark-look";
import { OpalChip } from "@/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips";
import { cn } from "@/lib/utils";

/** A skill's mark: its emoji on the session reader's Opaline chip (tinted
 * fill, inner ring and drop shadow), the tint keyed to the skill's name. An
 * `expandable` mark doubles as its row's disclosure, as the reader's step
 * chips do: the row is a `group/toggle`. */
export function SkillMark({
	skill,
	emoji,
	className,
	expandable = false,
	expanded = false,
}: {
	skill: string;
	emoji?: string;
	/** Size and emoji type scale; the Skills page card's 36px mark by default. */
	className?: string;
	expandable?: boolean;
	expanded?: boolean;
}) {
	const mark = getSkillMarkLook(skill);
	return (
		<span skullet-block="" className="inline-flex shrink-0 corner-full">
			<OpalChip
				tint={mark.tint}
				open={expandable ? expanded : undefined}
				className={cn(
					// design-escape-ok(type): shipped value; main's text-xl set no tracking, so the emoji keeps its context's
					"size-9 text-display-xxs tracking-[inherit] text-ink-3",
					className,
				)}
			>
				<span aria-hidden="true">{emoji ?? mark.emoji}</span>
			</OpalChip>
		</span>
	);
}
