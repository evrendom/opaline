import {
	Compass01Icon,
	DrillIcon,
	FlashlightIcon,
	MagnetIcon,
	MicroscopeIcon,
	PaintBrush01Icon,
	PencilRulerIcon,
	RulerIcon,
	Scissor01Icon,
	TapeMeasureIcon,
	Telescope01Icon,
	TestTube01Icon,
	ToolboxIcon,
	ToolsIcon,
	Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

const SKILL_ICONS = [
	{ name: "wrench", icon: Wrench01Icon },
	{ name: "drill", icon: DrillIcon },
	{ name: "paintbrush", icon: PaintBrush01Icon },
	{ name: "compass", icon: Compass01Icon },
	{ name: "ruler", icon: RulerIcon },
	{ name: "scissors", icon: Scissor01Icon },
	{ name: "tape-measure", icon: TapeMeasureIcon },
	{ name: "flashlight", icon: FlashlightIcon },
	{ name: "magnet", icon: MagnetIcon },
	{ name: "microscope", icon: MicroscopeIcon },
	{ name: "telescope", icon: Telescope01Icon },
	{ name: "drafting-tools", icon: PencilRulerIcon },
	{ name: "toolbox", icon: ToolboxIcon },
	{ name: "tools", icon: ToolsIcon },
	{ name: "experiment", icon: TestTube01Icon },
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
	return (
		<HugeiconsIcon
			aria-hidden="true"
			className={className}
			data-skill-icon={choice.name}
			data-trace-hugeicon
			icon={choice.icon}
			strokeWidth={1.5}
		/>
	);
}
