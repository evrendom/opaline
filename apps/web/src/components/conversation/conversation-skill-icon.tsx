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

const SKILL_ICONS: { name: string; icon: Icon }[] = [
	{ name: "wrench", icon: IconTool },
	{ name: "drill", icon: IconHammer },
	{ name: "paintbrush", icon: IconBrush },
	{ name: "compass", icon: IconCompass },
	{ name: "ruler", icon: IconRuler },
	{ name: "scissors", icon: IconScissors },
	{ name: "tape-measure", icon: IconRuler2 },
	{ name: "flashlight", icon: IconBulb },
	{ name: "magnet", icon: IconMagnet },
	{ name: "microscope", icon: IconMicroscope },
	{ name: "telescope", icon: IconTelescope },
	{ name: "drafting-tools", icon: IconPencilCog },
	{ name: "toolbox", icon: IconBox },
	{ name: "tools", icon: IconTools },
	{ name: "experiment", icon: IconTestPipe },
];

export function getSkillIcon(skill: string) {
	const name = skill.trim().toLowerCase();
	// A fixed palette and name hash keep assignments stable without a per-skill registry.
	let hash = 2166136261;
	for (const character of name) {
		hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
	}
	return SKILL_ICONS[(hash >>> 0) % SKILL_ICONS.length] ?? SKILL_ICONS[0];
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
