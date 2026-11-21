// Writes graphical/install/import.json: Opaline's tokens mapped onto
// Graphical's roles. Run from apps/desktop/ui:
//   node graphical/install/import.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extendRoleMap, shadcnProfile } from "@graphical/editor/install";

// ---------------------------------------------------------------------------
// Colors: Opaline's own values. Neutrals are the ten greys the app paints
// with (shadcn's neutral ramp); the palette is the opal sheen plus the two
// accents the UI uses beside it; statuses are the app's status icons.
// ---------------------------------------------------------------------------

/** oklch(L C H) → #rrggbb, for the document's slots. */
function oklchHex(l, c, h) {
	const a = c * Math.cos((h * Math.PI) / 180);
	const b = c * Math.sin((h * Math.PI) / 180);
	const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = l - 0.0894841775 * a - 1.291485548 * b;
	const [L, M, S] = [l_ ** 3, m_ ** 3, s_ ** 3];
	const lin = [
		4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
		-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
		-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
	];
	return `#${lin
		.map((v) => {
			const x = Math.min(1, Math.max(0, v));
			const g = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
			return Math.round(g * 255)
				.toString(16)
				.padStart(2, "0");
		})
		.join("")}`;
}
const grey = (l) => oklchHex(l, 0, 0);

const opal = [
	[0.59, 0.223, 262.833],
	[0.583, 0.239, 281.458],
	[0.621, 0.262, 302.391],
	[0.668, 0.273, 323.991],
	[0.691, 0.256, 344.619],
].map(([l, c, h]) => oklchHex(l, c, h));

const lightGreys = [1, 0.985, 0.97, 0.922, 0.87, 0.708, 0.556, 0.439, 0.269, 0.145];
const darkGreys = [0.17, 0.205, 0.269, 0.371, 0.439, 0.556, 0.708, 0.87, 0.922, 0.985];
const neutrals = (ramp) =>
	Object.fromEntries(ramp.map((l, i) => [`neutral-${i + 1}`, grey(l)]));

const colors = {
	light: {
		"color-1": opal[0],
		// Install orders the palette by use: opal-3 leads opal-2.
		"color-2": opal[2],
		"color-3": opal[1],
		"color-4": opal[3],
		"color-5": opal[4],
		// Orange: owner badges and the orange data tone.
		"color-6": oklchHex(0.705, 0.213, 47.604),
		// Teal: the chat user segment and the teal tone.
		"color-7": "#25b5aa",
		...neutrals(lightGreys),
		success: "#16a34a",
		warning: oklchHex(0.646, 0.222, 41.116),
		error: oklchHex(0.577, 0.245, 27.325),
	},
	dark: {
		"color-1": opal[0],
		// Install orders the palette by use: opal-3 leads opal-2.
		"color-2": opal[2],
		"color-3": opal[1],
		"color-4": opal[3],
		"color-5": opal[4],
		"color-6": "#f6b34d",
		"color-7": "#4fd3c9",
		...neutrals(darkGreys),
		success: oklchHex(0.696, 0.17, 162.48),
		warning: oklchHex(0.769, 0.188, 70.08),
		error: oklchHex(0.704, 0.191, 22.216),
	},
};

const document = {
	name: "Opaline",
	theme: {
		primaryActionColor: "neutral-10",
		colors,
		// Opaline's soft fills and hovers are 2–5% black (light) and 3–7% white
		// (dark); its lines are 6–15% and 7–16%: neutral-10's two levels. Status
		// chips are pastel fills, about 11–14% of their colour.
		colorTranslucency: {
			light: { "neutral-10": 4, success: 14, warning: 14, error: 11 },
			dark: { "neutral-10": 5 },
		},
		colorTranslucent: { light: { "neutral-10": 8 }, dark: { "neutral-10": 11 } },
		fonts: {
			body: {
				family: '"Inter Variable", sans-serif',
				weights: { regular: 400, medium: 500, heavy: 600 },
			},
			display: {
				family: '"Inter Variable", sans-serif',
				weights: { regular: 400, medium: 500, heavy: 600 },
			},
			data: {
				family: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
				weights: { regular: 400, medium: 500, heavy: 600 },
			},
		},
	},
};

// ---------------------------------------------------------------------------
// Role map: shadcn's tokens, then Opaline's own by meaning.
// ---------------------------------------------------------------------------

// neutral-10's two levels: lines (borders, dividers, rails, outlines) take
// the stronger one, soft fills and hovers the lighter one.
const LINE = "neutral-10-translucent";
const SOFT = "neutral-10-transparent";

/** [variable, token] for Opaline's Layer 2 roles (src/app/tokens.css). Screens
 *  read only these; the shadcn names in tokens.css alias them for code we
 *  don't own, so they're not mapped here. */
const opalineColors = [
	["--canvas", "neutral-1"],
	["--surface", { light: "neutral-1", dark: "neutral-2" }],
	["--inset", "neutral-2"],
	["--field", "neutral-3"],
	["--hover", SOFT],
	["--hover-strong", LINE],
	["--wash", SOFT],
	["--ink", "neutral-10"],
	["--ink-2", "neutral-8"],
	["--ink-3", "neutral-7"],
	["--ink-disabled", "neutral-6"],
	["--ink-inverse", "neutral-1"],
	["--line", LINE],
	["--line-strong", { light: "neutral-4", dark: LINE }],
	["--line-soft", SOFT],
	["--primary", { light: "neutral-9", dark: "neutral-10" }],
	["--primary-fg", "neutral-1"],
	["--focus", "neutral-6"],
	["--accent", "color-1"],
	["--accent-tint", "color-1-transparent"],
	["--accent-line", "color-1-translucent"],
	["--success-tint", "success-transparent"],
	["--success-line", "success-translucent"],
	["--warning-tint", "warning-transparent"],
	["--warning-line", "warning-translucent"],
	["--error-tint", "error-transparent"],
	["--error-line", "error-translucent"],
	["--color-opal-1", "color-1"],
	["--color-opal-2", "color-3"],
	["--color-opal-3", "color-2"],
	["--color-opal-4", "color-4"],
	["--color-opal-5", "color-5"],
	["--opal-1-tint", "color-1-transparent"],
	["--opal-2-tint", "color-3-transparent"],
	["--opal-3-tint", "color-2-transparent"],
	["--opal-4-tint", "color-4-transparent"],
	["--opal-5-tint", "color-5-transparent"],
];

const roleMap = extendRoleMap(shadcnProfile(), {
	// Tailwind's defaults the app doesn't define: the analysis reads them
	// itself. `--spacing` stays, so sizes keep Tailwind's scale.
	remove: [
		"--spacing",
		"--font-serif",
		"--font-weight-normal",
		"--font-weight-medium",
		"--font-weight-semibold",
		"--tracking-tighter",
		"--tracking-tight",
		"--tracking-normal",
		"--tracking-wide",
		"--tracking-wider",
		...["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"].flatMap(
			(s) => [`--text-${s}`, `--text-${s}--line-height`],
		),
		// Data paint: the chart series are greys that carry data.
		"--chart-1",
		"--chart-2",
		"--chart-3",
		"--chart-4",
		"--chart-5",
		// The sidebar is translucent so macOS vibrancy shows through it.
		"--sidebar",
		// shadcn's names alias Layer 2 in tokens.css.
		...["--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
			"--primary", "--primary-foreground", "--secondary", "--secondary-foreground", "--muted",
			"--muted-foreground", "--accent", "--accent-foreground", "--destructive", "--destructive-foreground",
			"--border", "--input", "--ring", "--sidebar-primary", "--sidebar-primary-foreground",
			"--sidebar-accent", "--sidebar-accent-foreground", "--sidebar-foreground", "--sidebar-border", "--sidebar-ring"],
	],
	tokens: [
		{ variable: "--font-heading", token: "font.body" },
		{ variable: "--app-font-heading", token: "font.display" },
		...opalineColors.map(([variable, token]) => ({
			variable,
			token,
			format: "css",
		})),
	],
	// No Appearance regions: the editor paints mapped regions with its own
	// recipes on mount (!important), which replaced Opaline's card edges and
	// would repaint the vibrancy sidebar. Opaline's surfaces stay as authored.
	fixed: [
		"--sidebar",
		"--dashboard-01-chrome-surface",
		"--dashboard-01-chrome-backdrop-fill",
		"--dashboard-01-rail-active",
		"--chart-1",
		"--chart-2",
		"--chart-3",
		"--chart-4",
		"--chart-5",
		"--active-turn-rail",
		"--bone-shine",
	],
});

delete roleMap.appearance;

// ---------------------------------------------------------------------------
// Source: each mapped variable's authored value per mode, read from the
// app's stylesheets (first literal definition in a light and a dark rule).
// ---------------------------------------------------------------------------

const stylesheets = [
	"src/app/tokens.css",
	"src/index.css",
	"src/app/preset-extensions.css",
	"src/app/app-surface.css",
	"src/app/ui/bones.css",
	"src/components/conversation/code-block.css",
	"src/features/auth/guest-app.css",
	"src/features/cli-onboarding/welcome.css",
	"src/features/costs/cost-dashboard.css",
	"src/features/dashboard/dashboard-theme.css",
	"src/features/sessions/components/session-constellation-tree.css",
	"src/features/sessions/components/session-menu.css",
	"src/features/settings/workspace/components/workspace-settings.css",
	"src/features/skills/components/rich-skill-document.css",
	"src/features/shell/website-button.css",
	"src/widget/plugin.css",
];
// Install rewrites these definitions as aliases, so the authored values are
// read once, before install, and kept: a later run reuses the recorded ones.
// ORIGINAL_SOURCE=git reads them from the git index instead of the files.
const importFile = new URL("./import.json", import.meta.url);
const recorded = existsSync(importFile)
	? JSON.parse(readFileSync(importFile, "utf8")).source
	: undefined;
const readStylesheet = (file) =>
	process.env.ORIGINAL_SOURCE === "git"
		? execFileSync("git", ["show", `:apps/desktop/ui/${file}`], {
				encoding: "utf8",
			})
		: readFileSync(file, "utf8");
const mapped = new Set(roleMap.tokens.map((t) => t.variable));
const source = { light: {}, dark: {} };
for (const file of stylesheets) {
	const css = readStylesheet(file).replace(/\/\*[\s\S]*?\*\//g, "");
	for (const block of css.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
		const mode = /\.dark\b/.test(block[1]) ? "dark" : "light";
		for (const [, name, value] of block[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
			const v = value.trim().replace(/\s+/g, " ");
			if (!mapped.has(name) || v.startsWith("var(") || name in source[mode]) continue;
			source[mode][name] = v;
		}
	}
}

const keptSource =
	process.env.ORIGINAL_SOURCE !== "git" &&
	recorded &&
	Object.keys(recorded.light ?? {}).length > Object.keys(source.light).length
		? recorded
		: source;
writeFileSync(
	importFile,
	`${JSON.stringify({ document, roleMap, source: keptSource }, null, 2)}\n`,
);
console.log(
	`roles: ${roleMap.tokens.length}; source values: ${Object.keys(keptSource.light).length} light, ${Object.keys(keptSource.dark).length} dark`,
);
