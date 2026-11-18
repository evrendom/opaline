// Renders the usage digest's icons to PNGs in public/email: email clients do
// not render inline SVG. They follow the app's own look: section icons are
// the sidebar's chip (the Opaline pebble in an opal tint, its glyph in the
// opal colour), metric icons are Tabler glyphs in the opal colours, and the
// agent marks are the dashboard's Claude and Codex logos. Each is drawn at
// four times its email size, so it stays sharp on high-density screens.
//
//   bun apps/web/tools/email-icons.tsx   (needs Google Chrome installed)

import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { AGENT_COLORS } from "@rudel/api-routes/skill-icon";
import {
	type Icon,
	IconAlertTriangleFilled,
	IconArrowDownRight,
	IconArrowUpRight,
	IconBolt,
	IconBook,
	IconChartAreaLine,
	IconClockFilled,
	IconCloudX,
	IconCoinFilled,
	IconCpu,
	IconFolder,
	IconGhost,
	IconHandStop,
	IconMessagesFilled,
	IconMoodAngry,
	IconMoodNervous,
	IconMoodSad,
	IconRobot,
	IconStackFilled,
	IconStopwatch,
	IconUser,
	IconUserFilled,
	IconUsers,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TraceTerminalIcon } from "../src/components/conversation/conversation-trace-glyphs";

// apps/web/src/app/preset-extensions.css (opal-1…opal-5 and their tints),
// in sRGB hex because email clients do not read oklch().
const OPAL = {
	1: { color: "#2e70ff", tint: "#e2efff" },
	2: { color: "#6d58ff", tint: "#eaecff" },
	3: { color: "#a847ff", tint: "#f3e9ff" },
	4: { color: "#e03bf0", tint: "#fbe7fc" },
	5: { color: "#ff3dc0", tint: "#ffe6f4" },
	// The dashboard's danger red, for what went wrong.
	red: { color: "#dc2626", tint: "#fee2e2" },
} as const;
const GREEN = "#16a34a";
const RED = "#dc2626";
const GREY = "#737373";

// The Opaline pebble (apps/web/src/features/shell/components/shell-nav-icon.tsx).
const OPALINE_OUTLINE =
	"M524.532 0C661.725 4.52425 793.956 20.3892 890.19 103.494C986.746 183.313 1047.24 330.329 1049 520.65C1047.24 710.913 986.746 857.99 890.19 937.817C793.956 1020.92 661.79 1036.79 524.532 1041.3C387.274 1036.79 255.1 1020.92 158.866 937.817C62.3182 857.99 1.76716 711.006 0 520.684C1.75876 330.245 62.3185 183.245 158.866 103.494C255.1 20.3892 387.274 4.52426 524.532 0Z";

const glyph = (Component: Icon, size: number, color: string) =>
	renderToStaticMarkup(<Component size={size} color={color} stroke={2} />);

/** The sidebar's active chip: pebble in the tint, a faint ring, the glyph in the colour. */
function chip(Component: Icon, tone: keyof typeof OPAL, size: number): string {
	const { color } = OPAL[tone];
	// The colour at 15%, not its opaque tint, as the app's OpalChip: it reads on
	// a light card and on one a client darkened (the Gmail apps invert the
	// email's colours but not its images).
	return `<div style="position:relative;width:${size}px;height:${size}px">
<svg viewBox="0 0 1049 1042" width="${size}" height="${size}" style="position:absolute;inset:0">
<clipPath id="c"><path d="${OPALINE_OUTLINE}"/></clipPath>
<path d="${OPALINE_OUTLINE}" fill="${color}" fill-opacity="0.15"/>
<path d="${OPALINE_OUTLINE}" clip-path="url(#c)" fill="none" stroke="${color}" stroke-opacity="0.2" stroke-width="${(1049 / size) * 2}"/>
</svg>
<div style="position:absolute;inset:0;display:grid;place-items:center">${glyph(Component, Math.round(size * 0.6), color)}</div>
</div>`;
}

/** The dashboard's agent marks, read from its component so they stay one source. */
async function agentMark(name: "ClaudeModelIcon" | "CodexModelIcon") {
	const source = await readFile(
		path.join(
			import.meta.dir,
			"../src/features/dashboard/components/DashboardModelBadges.tsx",
		),
		"utf8",
	);
	const body = source.slice(source.indexOf(`function ${name}`));
	const viewBox = /viewBox="([^"]+)"/u.exec(body)?.[1];
	const d = /\sd="([^"]+)"/u.exec(body)?.[1];
	if (!viewBox || !d) throw new Error(`${name} has no path to draw`);
	return (color: string, size: number) =>
		`<svg viewBox="${viewBox}" width="${size}" height="${size}"><path fill="${color}" d="${d}"/></svg>`;
}

/** A dashboard trace glyph (they draw in currentColor) in `color`. */
const traceGlyph = (
	Component: ComponentType<{ className?: string }>,
	size: number,
	color: string,
) =>
	`<div style="width:${size}px;height:${size}px;color:${color}">${renderToStaticMarkup(<Component className="trace-glyph" />).replace("<svg", `<svg width="${size}" height="${size}"`)}</div>`;

/** The app's header wordmark (light and dark), at six times its email size. */
async function wordmark(file: string): Promise<string> {
	const svg = await readFile(
		path.join(import.meta.dir, "../../marketing/src/assets", file),
		"utf8",
	);
	return svg.replace(
		/<svg width="\d+" height="\d+"/u,
		// Six times its 96×24 email size: sharp on 3x phone screens too.
		'<svg width="576" height="144"',
	);
}

/**
 * The wordmark in one flat colour: its shape as a mask over the colour, at the same six times its email size.
 */
async function flatWordmark(file: string, color: string): Promise<string> {
	const svg = Buffer.from(await wordmark(file)).toString("base64");
	const mask = `url(data:image/svg+xml;base64,${svg}) center / contain no-repeat`;
	return `<div style="width:576px;height:144px;background:${color};-webkit-mask:${mask};mask:${mask}"></div>`;
}

/**
 * The session reader's OpalChip (session-reader-waterfall-chips.tsx): the
 * pebble filled with 15% of the tint, a 14% inner ring and a tinted drop, the
 * glyph inside. Transparent, so it reads on light and dark cards.
 */
function opalChip(tint: string, inner: string, size = 64): string {
	return `<div>
<div style="position:relative;width:${size}px;height:${size}px">
<svg viewBox="0 0 1049 1042" width="${size}" height="${size}" style="position:absolute;inset:0">
<clipPath id="c"><path d="${OPALINE_OUTLINE}"/></clipPath>
<path d="${OPALINE_OUTLINE}" fill="${tint}" fill-opacity="0.15"/>
<path d="${OPALINE_OUTLINE}" clip-path="url(#c)" fill="none" stroke="${tint}" stroke-opacity="0.14" stroke-width="${(1049 / size) * 4}"/>
</svg>
<div style="position:absolute;inset:0;display:grid;place-items:center;color:${tint}">${inner}</div>
</div></div>`;
}

const claude = await agentMark("ClaudeModelIcon");
const codex = await agentMark("CodexModelIcon");

/** File name (without .png) and its markup at four times the email size. */
const ICONS: [string, string][] = [
	// Section headings, shown at 20px.
	["section-week", chip(IconChartAreaLine, 1, 80)],
	["section-agents", chip(IconCpu, 2, 80)],
	["section-skills", chip(IconBook, 3, 80)],
	["section-repositories", chip(IconFolder, 4, 80)],
	["section-stuck", chip(IconAlertTriangleFilled, 4, 80)],
	["section-frustration", chip(IconMoodSad, "red", 80)],
	["section-subagents", chip(IconRobot, 2, 80)],
	["section-team", chip(IconUser, 1, 80)],
	// Metric labels, shown at 12px.
	["active-time", glyph(IconClockFilled, 48, OPAL[1].color)],
	["longest-run", glyph(IconStopwatch, 48, OPAL[2].color)],
	["sessions", glyph(IconMessagesFilled, 48, OPAL[2].color)],
	["cost", glyph(IconCoinFilled, 48, OPAL[3].color)],
	["members", glyph(IconUserFilled, 48, OPAL[1].color)],
	["failed-calls", glyph(IconAlertTriangleFilled, 48, OPAL.red.color)],
	["interruptions", glyph(IconHandStop, 48, OPAL[4].color)],
	["compactions", glyph(IconStackFilled, 48, OPAL[3].color)],
	["api-errors", glyph(IconCloudX, 48, OPAL.red.color)],
	["frustrated", glyph(IconMoodSad, 48, OPAL.red.color)],
	["swears", glyph(IconMoodAngry, 48, OPAL.red.color)],
	["apologies", glyph(IconMoodNervous, 48, OPAL[3].color)],
	["subagents", glyph(IconRobot, 48, OPAL[2].color)],
	// Changes, shown at 14px.
	["up-good", glyph(IconArrowUpRight, 56, GREEN)],
	["up-bad", glyph(IconArrowUpRight, 56, RED)],
	["up-neutral", glyph(IconArrowUpRight, 56, GREY)],
	["down-good", glyph(IconArrowDownRight, 56, GREEN)],
	["down-bad", glyph(IconArrowDownRight, 56, RED)],
	["down-neutral", glyph(IconArrowDownRight, 56, GREY)],
	// Agent marks, shown at 12px, in the dashboard's colours.
	["agent-claude-code", claude("#CC7D5E", 48)],
	[
		"agent-codex",
		`<div style="filter:drop-shadow(0 0 2px #fff) drop-shadow(0 0 1px #fff)">${codex("#111111", 48)}</div>`,
	],
	["agent-codex-dark", codex("#ededed", 48)],
	// The empty team section's icon, shown at 16px: the app's empty states
	// show theirs at 40% of the text colour.
	["team-empty", glyph(IconUsers, 64, "#a3a3a3")],
	// The header wordmark, shown 80px wide; the dark one where a client goes dark.
	["logo-light", await wordmark("opaline-wordmark-nav-small.svg")],
	["logo-dark", await wordmark("opaline-wordmark-nav-small-dark.svg")],
	// The plain card design's wordmark: one mid grey that reads on light and
	// dark alike, so it needs no dark twin.
	[
		"logo-grey",
		await flatWordmark("opaline-wordmark-nav-small.svg", "#9a98a1"),
	],
	// The session reader's turn-mark chips (session-reader-turn-marks.tsx),
	// shown at 16px in the pill tags: a skill's amber bolt, a command on the
	// tool blue, a subagent's ghost on its name's colour.
	["mark-skill", opalChip("#f59e0b", glyph(IconBolt, 40, "#d97706"))],
	[
		"mark-command",
		opalChip("#3b82f6", traceGlyph(TraceTerminalIcon, 40, "#2563eb")),
	],
	...AGENT_COLORS.map((color): [string, string] => [
		`mark-agent-${color.slice(1)}`,
		opalChip(
			color,
			renderToStaticMarkup(
				<IconGhost
					size={40}
					color={color}
					stroke={2}
					fill={color}
					fillOpacity={0.2}
				/>,
			),
		),
	]),
];

const out = path.join(import.meta.dir, "..", "public", "email");
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
for (const [name, markup] of ICONS) {
	await page.setContent(
		`<html><body style="margin:0;background:transparent"><div id="icon" style="display:inline-block;line-height:0">${markup}</div></body></html>`,
	);
	await page.locator("#icon").screenshot({
		path: path.join(out, `${name}.png`),
		omitBackground: true,
	});
}
await browser.close();
console.log(`Wrote ${ICONS.length} icons to ${out}`);
