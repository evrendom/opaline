/**
 * The icon a skill wears wherever Opaline shows it (the dashboard's skill
 * tags, the usage digest's): one of a fixed set, picked by a hash of the name
 * so each skill keeps its icon without a per-skill registry.
 */
export const SKILL_ICON_NAMES = [
	"wrench",
	"drill",
	"paintbrush",
	"compass",
	"ruler",
	"scissors",
	"tape-measure",
	"flashlight",
	"magnet",
	"microscope",
	"telescope",
	"drafting-tools",
	"toolbox",
	"tools",
	"experiment",
] as const;

export type SkillIconName = (typeof SKILL_ICON_NAMES)[number];

export function skillIconName(skill: string): SkillIconName {
	const name = skill.trim().toLowerCase();
	let hash = 2166136261;
	for (const character of name) {
		hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
	}
	return SKILL_ICON_NAMES[(hash >>> 0) % SKILL_ICON_NAMES.length] ?? "wrench";
}

/**
 * Each icon's emoji and tint: what a skill's mark wears on the Opaline chip,
 * wherever the skill shows. Tailwind's 500 shades, as hex: the chip mixes its
 * fill, ring and drop from the tint, so it needs a saturated colour.
 */
export const SKILL_MARKS: Record<
	SkillIconName,
	{ emoji: string; tint: string }
> = {
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

/**
 * A spread of mid-tone hues that read on light and dark surfaces; an agent
 * (a subagent type) always gets the same one, from a djb2 hash of its name.
 */
export const AGENT_COLORS = [
	"#ef4444",
	"#f97316",
	"#f59e0b",
	"#84cc16",
	"#22c55e",
	"#10b981",
	"#14b8a6",
	"#06b6d4",
	"#0ea5e9",
	"#3b82f6",
	"#6366f1",
	"#8b5cf6",
	"#a855f7",
	"#d946ef",
	"#ec4899",
	"#f43f5e",
] as const;

export function agentColor(name: string): string {
	let hash = 5381;
	for (let i = 0; i < name.length; i++) {
		hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
	}
	return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length] ?? "#ef4444";
}
