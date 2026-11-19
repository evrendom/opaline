import {
	type SkillIconName,
	skillIconName,
} from "@rudel/api-routes/skill-icon";
import type { Icon } from "@tabler/icons-react";
import {
	IconBox,
	IconBrush,
	IconBulb,
	IconCompass,
	IconHammer,
	IconMagnet,
	IconMicroscope,
	IconPencilCog,
	IconRuler,
	IconRuler2,
	IconScissors,
	IconTelescope,
	IconTestPipe,
	IconTool,
	IconTools,
} from "@tabler/icons-react";

export const SKILL_ICONS: Record<SkillIconName, Icon> = {
	wrench: IconTool,
	drill: IconHammer,
	paintbrush: IconBrush,
	compass: IconCompass,
	ruler: IconRuler,
	scissors: IconScissors,
	"tape-measure": IconRuler2,
	flashlight: IconBulb,
	magnet: IconMagnet,
	microscope: IconMicroscope,
	telescope: IconTelescope,
	"drafting-tools": IconPencilCog,
	toolbox: IconBox,
	tools: IconTools,
	experiment: IconTestPipe,
};

/** The skill's icon; the choice is shared with the usage digest emails. */
export function getSkillIcon(skill: string) {
	const name = skillIconName(skill);
	return { name, icon: SKILL_ICONS[name] };
}

export function ConversationSkillIcon({
	skill,
	className,
}: {
	skill: string;
	className: string;
}) {
	const choice = getSkillIcon(skill);
	const Glyph = choice.icon;
	return (
		<Glyph
			aria-hidden="true"
			className={className}
			data-skill-icon={choice.name}
			data-trace-glyph
			stroke={1.5}
		/>
	);
}
