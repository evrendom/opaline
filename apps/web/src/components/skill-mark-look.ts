import { getSkillIcon } from "@/components/conversation/conversation-skill-icon";

// Tailwind's 500 shades, as hex: OpalChip mixes its fill, ring and drop from
// the tint, so it needs a saturated color rather than a pastel.
const SKILL_MARKS: Record<string, { emoji: string; tint: string }> = {
	wrench: { emoji: "🔧", tint: "#f97316" },
	drill: { emoji: "🛠️", tint: "#3b82f6" },
	paintbrush: { emoji: "🎨", tint: "#a855f7" },
	compass: { emoji: "🧭", tint: "#f59e0b" },
	ruler: { emoji: "📏", tint: "#22c55e" },
	scissors: { emoji: "✂️", tint: "#ef4444" },
	"tape-measure": { emoji: "📐", tint: "#f59e0b" },
	flashlight: { emoji: "🔦", tint: "#f97316" },
	magnet: { emoji: "🧲", tint: "#ef4444" },
	microscope: { emoji: "🔬", tint: "#3b82f6" },
	telescope: { emoji: "🔭", tint: "#a855f7" },
	"drafting-tools": { emoji: "✏️", tint: "#f59e0b" },
	toolbox: { emoji: "🧰", tint: "#f97316" },
	tools: { emoji: "⚙️", tint: "#22c55e" },
	experiment: { emoji: "🧪", tint: "#22c55e" },
};

const FALLBACK_MARK = { emoji: "✨", tint: "#a855f7" };

/** A skill's emoji and tint, keyed to its name: what its mark wears on the
 * Opaline chip, wherever the skill shows. */
export function getSkillMarkLook(skill: string) {
	return SKILL_MARKS[getSkillIcon(skill).name] ?? FALLBACK_MARK;
}
