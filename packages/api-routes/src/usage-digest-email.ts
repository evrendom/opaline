/**
 * The usage digest emails (daily, weekly, quiet week), rendered from numbers
 * the API computes. Pure string building, so the API sends it and the web
 * app's email lab (`bun run --cwd apps/web dev:email-lab`) renders the same
 * thing from fixtures. Email clients ignore stylesheets and most layout CSS:
 * everything is nested tables with inline styles, and a plain-text part says
 * the same.
 */

import { agentColor } from "./skill-icon.js";

export type UsageDigestKind = "daily" | "weekly";

/** The sums a digest compares against the period before. */
export interface DigestNumbers {
	sessions: number;
	prompts: number;
	activeMinutes: number;
	costUsd: number;
	runs: number;
	toolCalls: number;
	failedCalls: number;
	/** Times a person stopped the agent mid-run. */
	interrupts: number;
	/** Times the context filled up and was compacted. */
	compactions: number;
	/** Null when no run of the period records API errors. */
	apiErrors: number | null;
	/** Input tokens read from the prompt cache, and all input tokens. */
	cacheReadTokens: number;
	/** Active minutes of the period's longest run (one prompt and all the agent did for it). */
	longestRunMinutes: number;
	/** Runs that ended in an error, tool calls that timed out, and refusals. */
	turnErrors: number;
	timeouts: number;
	refusals: number;
	inputTokens: number;
}

export interface DigestShare {
	label: string;
	/** Whose model it is, for models: coloured and marked like the dashboard. */
	provider?: "anthropic" | "openai" | null;
	/** Active minutes for repositories, runs for agents and models. */
	value: number;
	/** Of the period's total, 0 to 1. */
	share: number;
}

export interface DigestSection {
	current: DigestNumbers;
	previous: DigestNumbers | null;
	/** Weekly only: cost in USD per day, Monday first. */
	days: number[] | null;
	repositories: DigestShare[];
	agents: DigestShare[];
	models: DigestShare[];
	/** Skills and slash commands, most used first. */
	toolbox: { name: string; uses: number; kind: "skill" | "command" }[];
	/** The subagents runs launched, what their own runs took, and their types. */
	subagents: {
		current: DigestSubagents;
		previous: DigestSubagents | null;
		types: { name: string; uses: number }[];
	};
	/** What the member's own words said went wrong; null for the team. */
	frustration: DigestFrustration | null;
}

export interface DigestSubagents {
	launches: number;
	/** Active minutes, runs, cost and tool calls of the subagents' own runs. */
	minutes: number;
	runs: number;
	costUsd: number;
	toolCalls: number;
	failedCalls: number;
}

export interface DigestFrustration {
	/** Messages with a negative phrase or a swear, and the period before's. */
	moments: number;
	previousMoments: number;
	swears: number;
	/** Times the agent apologized. */
	apologies: number;
	/** The negative phrases said, most said first. */
	phrases: { text: string; count: number }[];
	/** The sessions with the most of them. */
	sessions: { title: string; day: string; moments: number }[];
}

export interface DigestTeamSection extends DigestSection {
	activeMembers: number;
	previousActiveMembers: number | null;
}

export interface UsageDigestEmailData {
	kind: UsageDigestKind;
	workspaceName: string;
	/** "Oct 5 to Oct 11", or "Monday, Oct 12". */
	periodLabel: string;
	/** "the week before", or "the Monday before". */
	comparisonLabel: string;
	/** The member's own numbers; null when they had no session in the period. */
	you: DigestSection | null;
	/** The workspace's numbers; null when the member may not see them or works alone. */
	team: DigestTeamSection | null;
	/** Where to invite teammates, when the member is alone in the workspace; null otherwise. */
	inviteUrl: string | null;
	workspaceUrl: string;
	settingsUrl: string;
	unsubscribeUrl: string;
	/** Origin serving `/email/opaline-icon.png`. */
	assetOrigin: string;
}

export interface EmailContent {
	subject: string;
	html: string;
	text: string;
}

const FONT =
	"Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const C = {
	canvas: "#f4f4f5",
	card: "#ffffff",
	border: "#ebebeb",
	text: "#171717",
	body: "#404040",
	muted: "#737373",
	faint: "#a3a3a3",
	track: "#f1f1f1",
	bar: "#d4d4d4",
	ink: "#171717",
	good: "#16a34a",
	bad: "#dc2626",
	button: "#171717",
	buttonText: "#fafafa",
	box: "#fafafa",
	boxBorder: "#efefef",
	// The app's --custom-outline-shadow ring, as a border.
	pillBorder: "#ececec",
};
/**
 * The dashboard's opal palette (apps/web/src/app/preset-extensions.css,
 * opal-1…opal-5 and their tints) in sRGB hex: email clients do not read
 * oklch(). Blue, indigo, purple, magenta, pink.
 */
const OPAL = {
	blue: { name: "blue", color: "#2e70ff", tint: "#e2efff" },
	indigo: { name: "indigo", color: "#6d58ff", tint: "#eaecff" },
	purple: { name: "purple", color: "#a847ff", tint: "#f3e9ff" },
	magenta: { name: "magenta", color: "#e03bf0", tint: "#fbe7fc" },
	pink: { name: "pink", color: "#ff3dc0", tint: "#ffe6f4" },
};
/** The dashboard's danger red (dashboard-theme.css), for what went wrong. */
const RED = { color: "#b42318", tint: "#fee2e2" };
/** The dashboard's agent colours and marks (dashboard-model-brand.ts). */
const AGENTS: Record<
	string,
	{ color: string; icon: string; className: string }
> = {
	"Claude Code": {
		color: "#CC7D5E",
		icon: "agent-claude-code",
		className: "",
	},
	Codex: { color: "#111111", icon: "agent-codex", className: "dm-openai" },
};
/** Model providers in the same colours and marks. */
const PROVIDERS = {
	anthropic: { color: "#CC7D5E", mark: "agent-claude-code", className: "" },
	openai: { color: "#111111", mark: "agent-codex", className: "dm-openai" },
};
const CARD_WIDTH = 600;
const ADDRESS = [
	"Opaline Labs, Inc.",
	"2261 Market Street",
	"San Francisco, CA 94114",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_NAMES = [
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"Sunday",
];

// --- Formatting --------------------------------------------------------------

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

const count = (value: number) => Math.round(value).toLocaleString("en-US");

export function formatMinutes(minutes: number): string {
	const total = Math.round(minutes);
	if (total < 60) return `${total}m`;
	const hours = Math.floor(total / 60);
	const rest = total % 60;
	return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function formatCost(usd: number): string {
	if (usd > 0 && usd < 0.01) return "<$0.01";
	if (usd >= 1000) return `$${Math.round(usd).toLocaleString("en-US")}`;
	return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const percent = (share: number) =>
	share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`;

/** "↑ 12%", "↓ 3%", "new", or "" when nothing changed or nothing compares. */
export function formatChange(now: number, before: number | undefined): string {
	if (before === undefined) return "";
	if (before === 0) return now === 0 ? "" : "new";
	const change = ((now - before) / before) * 100;
	if (Math.abs(change) < 0.5) return "";
	const size = Math.abs(change) >= 1000 ? ">999" : Math.abs(change).toFixed(0);
	return `${change > 0 ? "↑" : "↓"} ${size}%`;
}

function failureRate(numbers: DigestNumbers): number | null {
	return numbers.toolCalls ? numbers.failedCalls / numbers.toolCalls : null;
}

// --- Building blocks ---------------------------------------------------------

/** Where the email's PNG icons are served (`${origin}/email/<name>.png`). */
/** What every part needs to render: where the images live. */
interface Assets {
	origin: string;
}

type Tone = "higher-is-better" | "lower-is-better" | "neutral";

/**
 * A full-width layout table's attributes, with its style (one style attribute
 * only: a second is dropped). The width is in the style too: the Gmail apps
 * ignore a percentage `width` attribute on nested tables and shrink each to
 * its content, which collapses bars and squeezes the metric grid.
 */
const tableWith = (style: string) =>
	`role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;${style}"`;
const TABLE = tableWith("border-collapse:collapse;");

/** The dark-mode class of a text colour (see DARK_MODE_CSS). */
function colorClass(color: string): string {
	if (color === C.text) return "dm-text";
	if (color === C.muted) return "dm-muted";
	if (color === C.faint) return "dm-faint";
	if (color === C.body) return "dm-body";
	return "";
}

function text(
	value: string,
	style: { size: number; color?: string; weight?: number; line?: number },
	extra = "",
): string {
	const color = style.color ?? C.text;
	const className = colorClass(color);
	return `<div${className ? ` class="${className}"` : ""} style="font-family:${FONT};font-size:${style.size}px;line-height:${style.line ?? Math.round(style.size * 1.45)}px;color:${color};font-weight:${style.weight ?? 400};${extra}">${value}</div>`;
}

function iconUrl(assets: Assets, name: string): string {
	return escapeHtml(`${assets.origin}/email/${name}.png`);
}

/** Icons drawn in black, with a light twin that dark mode shows instead. */
const DARK_TWINS = new Set(["agent-codex"]);

/** A small icon inline with text; email clients do not render inline SVG. */
function icon(assets: Assets, name: string, size: number, gap = 0): string {
	const image = (file: string, extra: string, className = "") =>
		`<img${className ? ` class="${className}"` : ""} src="${iconUrl(assets, file)}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px;border:0;vertical-align:middle;${gap ? `margin-right:${gap}px;` : ""}${extra}">`;
	return DARK_TWINS.has(name)
		? image(name, "display:inline-block;", "on-light") +
				image(
					`${name}-dark`,
					"display:none;max-height:0;mso-hide:all;",
					"on-dark",
				)
		: image(name, "display:inline-block;");
}

/** An icon and a line of text side by side, centred on each other. */
function iconLine(
	assets: Assets,
	name: string,
	size: number,
	content: string,
	gap = 6,
): string {
	return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>
<td valign="middle" style="padding-right:${gap}px;line-height:0;font-size:0;">${icon(assets, name, size)}</td>
<td valign="middle">${content}</td>
</tr></table>`;
}

/** A change under a number: an arrow, green or red where a direction is better. */
function delta(assets: Assets, label: string, tone: Tone): string {
	if (!label) return text("&nbsp;", { size: 13, line: 18 });
	if (label === "new")
		return text("new", { size: 13, color: C.muted, line: 18 });
	const up = label.startsWith("↑");
	const good = tone === "neutral" ? null : up === (tone === "higher-is-better");
	const color = good === null ? C.muted : good ? C.good : C.bad;
	const arrow = `${up ? "up" : "down"}-${good === null ? "neutral" : good ? "good" : "bad"}`;
	return iconLine(
		assets,
		arrow,
		14,
		text(escapeHtml(label.slice(2)), {
			size: 13,
			color,
			weight: 500,
			line: 18,
		}),
		2,
	);
}

interface Stat {
	/** Names the box in its class (`metric-<id>`), for annotations in the lab. */
	id: string;
	label: string;
	icon: string;
	value: string;
	change: string;
	tone: Tone;
}

/**
 * One number on a hairline: its label, the value and its change, with no box
 * and no icon, the lightest separation that still reads.
 */
function metric(assets: Assets, stat: Stat): string {
	return `<div class="dm-border metric metric-${stat.id}" style="border-top:1px solid ${C.border};padding-top:12px;">
${text(escapeHtml(stat.label), { size: 13, color: C.muted, line: 18 }, "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}
${text(escapeHtml(stat.value), { size: 22, weight: 600, line: 28 }, "margin-top:4px;white-space:nowrap;letter-spacing:-0.02em;")}
<div style="margin-top:2px;">${delta(assets, stat.change, stat.tone)}</div>
</div>`;
}

/** Numbers two to a row, on every screen: four side by side are too cramped to read. */
function metrics(assets: Assets, list: Stat[]): string {
	const gap = 16;
	const rows: string[] = [];
	for (let index = 0; index < list.length; index += 2) {
		const [left, right] = list.slice(index, index + 2);
		const cell = (stat: Stat | undefined, last: boolean) =>
			`<td class="metric-cell" width="50%" valign="top" style="width:50%;padding:0 ${last ? 0 : gap}px ${gap}px 0;">${stat ? metric(assets, stat) : ""}</td>`;
		rows.push(`<tr>${cell(left, false)}${cell(right, true)}</tr>`);
	}
	return `<table ${tableWith("border-collapse:collapse;table-layout:fixed;")}>${rows.join("")}</table>`;
}

/** A section: its title, then its content. `name` ("section-week") names it in its class. */
function section(title: string, name: string, content: string): string {
	const id = name.replace(/^section-/u, "");
	return `<tr><td class="section section-${id}" style="padding:12px 0 20px;">
${text(escapeHtml(title), { size: 17, weight: 600, line: 24 }, "letter-spacing:-0.2px;")}
<div style="padding-top:12px;">${content}</div>
</td></tr>`;
}

/** A thin horizontal bar: `share` of the track filled. */
function bar(
	share: number,
	color: string = C.ink,
	height = 6,
	className = "",
): string {
	const filled = Math.max(0, Math.min(100, Math.round(share * 100)));
	const cell = (width: number, background: string, extra = "") =>
		`<td width="${width}%"${extra ? ` class="${extra}"` : ""} bgcolor="${background}" style="width:${width}%;background:${background};height:${height}px;font-size:0;line-height:0;">&nbsp;</td>`;
	return `<table ${tableWith(`border-collapse:separate;border-radius:${height}px;overflow:hidden;`)}><tr>${
		filled === 0
			? cell(100, C.track, "dm-track")
			: filled === 100
				? cell(100, color, className)
				: cell(filled, color, className) +
					cell(100 - filled, C.track, "dm-track")
	}</tr></table>`;
}

/** Seven rows, Monday to Sunday: the day, a bar of its cost against the costliest, the cost; the costliest in bold. */
function dayChart(days: number[], tone = OPAL.blue): string {
	const max = Math.max(...days) || 1;
	const costliest = days.indexOf(Math.max(...days));
	const rows = days.map((cost, index) => {
		const strong = cost > 0 && index === costliest;
		const label = (value: string) =>
			text(value, {
				size: 13,
				weight: strong ? 600 : 400,
				color: strong ? C.text : C.muted,
				line: 18,
			});
		return `<tr class="day-row">
<td width="44" valign="middle" style="width:44px;padding:4px 0;">${label(WEEKDAYS[index] ?? "")}</td>
<td valign="middle" style="padding:4px 12px 4px 0;">${bar(cost / max, tone.color, 8, "day-bar")}</td>
<td width="72" align="right" valign="middle" style="width:72px;padding:4px 0;white-space:nowrap;">${label(cost > 0 ? escapeHtml(formatCost(cost)) : "&ndash;")}</td>
</tr>`;
	});
	return `<table ${TABLE}>${rows.join("")}</table>`;
}

/** Rows of a label, a value and a bar of its share; `look` colours and marks each. */
function shareRows(
	assets: Assets,
	list: DigestShare[],
	format: (share: DigestShare) => string,
	look: (share: DigestShare) => {
		color: string;
		mark?: string;
		className?: string;
	},
): string {
	return list
		.map((item, index) => {
			const { color, mark, className } = look(item);
			const label = text(escapeHtml(item.label), {
				size: 13,
				weight: 500,
				line: 18,
			});
			return `<table class="share-row" ${TABLE.replace('style="', `style="${index ? "margin-top:12px;" : ""}`)}><tr>
<td style="padding:0 0 6px;">${mark ? iconLine(assets, mark, 12, label, 6) : label}</td>
<td align="right" style="padding:0 0 6px;white-space:nowrap;">${text(escapeHtml(format(item)), { size: 13, color: C.muted, line: 18 })}</td>
</tr><tr><td colspan="2">${bar(item.share, color, 6, className)}</td></tr></table>`;
		})
		.join("");
}

/** The look of a model: its provider's colour and mark, as in the dashboard. */
function modelLook(share: DigestShare) {
	if (share.provider === "anthropic")
		return { ...PROVIDERS.anthropic, className: "bar-model" };
	if (share.provider === "openai")
		return {
			...PROVIDERS.openai,
			className: `bar-model ${PROVIDERS.openai.className}`,
		};
	return { color: OPAL.indigo.color, className: "bar-model" };
}

/** The agents' shares of runs, in the dashboard's agent colours and marks. */
function splitBar(assets: Assets, list: DigestShare[]): string {
	const others = [C.faint, C.bar, C.border];
	const parts = list
		.filter((item) => item.share > 0)
		.map((item, index) => ({
			...item,
			look: AGENTS[item.label] ?? {
				color: others[index] ?? C.border,
				icon: undefined,
				className: "",
			},
		}));
	const cells = parts
		.map((item) => {
			const width = Math.max(1, Math.round(item.share * 100));
			return `<td width="${width}%"${item.look.className ? ` class="${item.look.className}"` : ""} bgcolor="${item.look.color}" style="width:${width}%;background:${item.look.color};height:8px;font-size:0;line-height:0;">&nbsp;</td>`;
		})
		.join("");
	const legend = parts
		.map(
			(item) =>
				`<td valign="middle" style="padding-right:16px;">${iconLine(
					assets,
					item.look.icon ?? "agent-codex",
					12,
					text(
						`${escapeHtml(item.label)} <span class="dm-muted" style="color:${C.muted};">${percent(item.share)}</span>`,
						{ size: 13, line: 18 },
						"white-space:nowrap;",
					),
					6,
				)}</td>`,
		)
		.join("");
	return `<table class="agent-split" ${tableWith("border-collapse:separate;border-radius:8px;overflow:hidden;")}><tr>${cells}</tr></table>
<table class="agent-legend" role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:10px;"><tr>${legend}</tr></table>`;
}

/**
 * Items as the session reader's turn marks show them
 * (session-reader-turn-marks.tsx): a round white pill with a hairline
 * outline, the item's 16px Opaline chip, its name and how often it was used.
 */
function pills(
	assets: Assets,
	list: { name: string; uses: number; mark: string }[],
): string {
	return text(
		list
			.map(
				(item) =>
					`<span style="display:inline-block;margin:0 10px 6px 0;white-space:nowrap;"><span class="dm-pill pill" style="display:inline-block;padding:3px 10px 3px 4px;background:${C.card};border:1px solid ${C.pillBorder};border-radius:999px;box-shadow:0 0.5px 2px rgba(0,0,0,0.06);white-space:nowrap;font-size:13px;line-height:16px;"><img src="${iconUrl(assets, item.mark)}" alt="" width="16" height="16" style="display:inline-block;width:16px;height:16px;border:0;vertical-align:middle;margin-right:6px;"><span class="dm-text" style="vertical-align:middle;font-size:13px;color:${C.text};">${escapeHtml(item.name)}</span></span><span class="dm-muted" style="display:inline-block;margin-left:5px;vertical-align:middle;font-size:13px;line-height:16px;color:${C.muted};">×${count(item.uses)}</span></span>`,
			)
			// A space between pills keeps them apart where margins are dropped.
			.join(" "),
		{ size: 13, line: 30 },
	);
}

// --- Sections ----------------------------------------------------------------

function heroBlock(assets: Assets, section: DigestSection): string {
	const { current, previous } = section;
	return `<tr><td class="hero" style="padding-bottom:20px;">${metrics(assets, [
		{
			id: "cost",
			label: "Cost",
			icon: "cost",
			value: formatCost(current.costUsd),
			change: formatChange(current.costUsd, previous?.costUsd),
			tone: "lower-is-better",
		},
		{
			// Active minutes: the agent at work on your prompts, any pause
			// inside a run counted as 5 minutes at most.
			id: "agent-time",
			label: "Agent time",
			icon: "active-time",
			value: formatMinutes(current.activeMinutes),
			change: formatChange(current.activeMinutes, previous?.activeMinutes),
			tone: "higher-is-better",
		},
		{
			id: "longest-run",
			label: "Longest run",
			icon: "longest-run",
			value: formatMinutes(current.longestRunMinutes),
			change: formatChange(
				current.longestRunMinutes,
				previous?.longestRunMinutes,
			),
			tone: "neutral",
		},
		{
			id: "sessions",
			label: "Sessions",
			icon: "sessions",
			value: count(current.sessions),
			change: formatChange(current.sessions, previous?.sessions),
			tone: "higher-is-better",
		},
	])}</td></tr>`;
}

function frictionMetrics(assets: Assets, section: DigestSection): string {
	const { current, previous } = section;
	const rate = failureRate(current);
	const before = previous ? failureRate(previous) : null;
	const list: Stat[] = [
		{
			id: "failed-tool-calls",
			label: "Failed tool calls",
			icon: "failed-calls",
			value: rate === null ? "–" : percent(rate),
			change:
				rate === null || before === null ? "" : formatChange(rate, before),
			tone: "lower-is-better",
		},
		{
			id: "interruptions",
			label: "Interruptions",
			icon: "interruptions",
			value: count(current.interrupts),
			change: formatChange(current.interrupts, previous?.interrupts),
			tone: "lower-is-better",
		},
		{
			id: "context-filled-up",
			label: "Context filled up",
			icon: "compactions",
			value: count(current.compactions),
			change: formatChange(current.compactions, previous?.compactions),
			tone: "lower-is-better",
		},
	];
	const errors = errorCount(current);
	list.push({
		id: "errors",
		label: "Errors",
		icon: "api-errors",
		value: count(errors),
		change: formatChange(errors, previous ? errorCount(previous) : undefined),
		tone: "lower-is-better",
	});
	return metrics(assets, list);
}

/** Every kind of error the run index records: API errors, runs that ended in an error, timeouts and refusals. */
function errorCount(numbers: DigestNumbers): number {
	return (
		(numbers.apiErrors ?? 0) +
		numbers.turnErrors +
		numbers.timeouts +
		numbers.refusals
	);
}

const SHORT_DAY = new Intl.DateTimeFormat("en-US", {
	weekday: "short",
	timeZone: "UTC",
});

function frustrationBlock(
	assets: Assets,
	frustration: DigestFrustration,
	period: string,
): string {
	if (frustration.moments === 0 && frustration.apologies === 0)
		return text(`Nothing you wrote ${period} read as frustrated.`, {
			size: 13,
			color: C.body,
			line: 20,
		});
	const sessions = frustration.sessions
		.map(
			(session, index) => `<tr>
<td class="dm-border frustration-session" style="padding:8px 12px 8px 0;${index ? `border-top:1px solid ${C.border};` : ""}">${text(escapeHtml(session.title.length > 64 ? `${session.title.slice(0, 63)}…` : session.title), { size: 13, weight: 500, line: 18 })}</td>
<td class="dm-border frustration-session-count" align="right" style="padding:8px 0;white-space:nowrap;${index ? `border-top:1px solid ${C.border};` : ""}">${text(`${count(session.moments)} frustrated ${session.moments === 1 ? "message" : "messages"} · ${escapeHtml(SHORT_DAY.format(new Date(`${session.day}T00:00:00Z`)))}`, { size: 12, color: C.muted, line: 18 })}</td>
</tr>`,
		)
		.join("");
	return [
		metrics(assets, [
			{
				id: "swore",
				label: "Swore",
				icon: "swears",
				value: count(frustration.swears),
				change: "",
				tone: "lower-is-better",
			},
			{
				id: "agent-apologized",
				label: "Agent apologized",
				icon: "apologies",
				value: count(frustration.apologies),
				change: "",
				tone: "neutral",
			},
		]),
		frustration.phrases.length
			? `<div style="margin-top:6px;">${text("What you said", { size: 13, color: C.muted, line: 18 }, "margin-bottom:6px;")}${text(
					frustration.phrases
						.map(
							(phrase) =>
								`<span style="display:inline-block;margin:0 10px 6px 0;white-space:nowrap;"><span class="dm-tag-red phrase" style="display:inline-block;padding:3px 9px;background:${RED.tint};border-radius:999px;font-family:${FONT};font-size:13px;line-height:16px;color:${C.text};white-space:nowrap;">“${escapeHtml(phrase.text)}”</span><span class="dm-muted" style="display:inline-block;margin-left:5px;vertical-align:middle;font-family:${FONT};font-size:13px;line-height:16px;color:${C.muted};">×${count(phrase.count)}</span></span>`,
						)
						.join(" "),
					{ size: 13, line: 20 },
				)}</div>`
			: "",
		sessions
			? `<div style="margin-top:8px;">${text("The sessions you were most frustrated in", { size: 13, color: C.muted, line: 18 })}<table ${TABLE}>${sessions}</table></div>`
			: "",
	].join("");
}

function subagentsBlock(assets: Assets, section: DigestSection): string {
	const { current, previous } = section.subagents;
	const rate = current.toolCalls
		? current.failedCalls / current.toolCalls
		: null;
	const before = previous?.toolCalls
		? previous.failedCalls / previous.toolCalls
		: null;
	return [
		metrics(assets, [
			{
				id: "subagents-launched",
				label: "Launched",
				icon: "subagents",
				value: count(current.launches),
				change: formatChange(current.launches, previous?.launches),
				tone: "neutral",
			},
			{
				id: "subagents-agent-time",
				label: "Agent time",
				icon: "active-time",
				value: formatMinutes(current.minutes),
				change: formatChange(current.minutes, previous?.minutes),
				tone: "neutral",
			},
			{
				id: "subagents-cost",
				label: "Cost",
				icon: "cost",
				value: formatCost(current.costUsd),
				change: formatChange(current.costUsd, previous?.costUsd),
				tone: "lower-is-better",
			},
			{
				id: "subagents-failed-tool-calls",
				label: "Failed calls",
				icon: "failed-calls",
				value: rate === null ? "–" : percent(rate),
				change:
					rate === null || before === null ? "" : formatChange(rate, before),
				tone: "lower-is-better",
			},
		]),
		section.subagents.types.length
			? `<div style="margin-top:6px;">${pills(
					assets,
					section.subagents.types.map((type) => ({
						...type,
						mark: `mark-agent-${agentColor(type.name).slice(1)}`,
					})),
				)}</div>`
			: "",
	].join("");
}

function costliestDay(days: number[]): string {
	const max = Math.max(...days);
	return max > 0
		? `Costliest day: ${WEEKDAY_NAMES[days.indexOf(max)]}, ${formatCost(max)}`
		: "";
}

function youBlocks(
	assets: Assets,
	data: UsageDigestEmailData,
	you: DigestSection,
): string[] {
	const period = data.kind === "weekly" ? "this week" : "that day";
	const blocks = [heroBlock(assets, you)];
	if (you.days)
		blocks.push(
			section("Your week by day", "section-week", dayChart(you.days)),
		);
	if (you.agents.length || you.models.length)
		blocks.push(
			section(
				"Agents and models",
				"section-agents",
				(you.agents.length > 1 ? splitBar(assets, you.agents) : "") +
					(you.models.length
						? `<div style="${you.agents.length > 1 ? "margin-top:18px;" : ""}">${shareRows(
								assets,
								you.models,
								(item) => percent(item.share),
								modelLook,
							)}</div>`
						: ""),
			),
		);
	if (you.subagents.current.launches > 0)
		blocks.push(
			section("Subagents", "section-subagents", subagentsBlock(assets, you)),
		);
	blocks.push(
		section(
			"Where agents got stuck",
			"section-stuck",
			frictionMetrics(assets, you),
		),
	);
	if (you.frustration)
		blocks.push(
			section(
				"Your frustrations",
				"section-frustration",
				frustrationBlock(assets, you.frustration, period),
			),
		);
	if (you.toolbox.length)
		blocks.push(
			section(
				"Skills and commands you used",
				"section-skills",
				pills(
					assets,
					you.toolbox.map((item) => ({
						...item,
						mark: item.kind === "command" ? "mark-command" : "mark-skill",
					})),
				),
			),
		);
	return blocks;
}

function teamBlock(assets: Assets, team: DigestTeamSection): string {
	const { current, previous } = team;
	return section(
		"Your team",
		"section-team",
		metrics(assets, [
			{
				id: "team-members",
				label: "Members",
				icon: "members",
				value: count(team.activeMembers),
				change: formatChange(
					team.activeMembers,
					team.previousActiveMembers ?? undefined,
				),
				tone: "higher-is-better",
			},
			{
				id: "team-sessions",
				label: "Sessions",
				icon: "sessions",
				value: count(current.sessions),
				change: formatChange(current.sessions, previous?.sessions),
				tone: "higher-is-better",
			},
			{
				id: "team-agent-time",
				label: "Agent time",
				icon: "active-time",
				value: formatMinutes(current.activeMinutes),
				change: formatChange(current.activeMinutes, previous?.activeMinutes),
				tone: "higher-is-better",
			},
			{
				id: "team-cost",
				label: "Cost",
				icon: "cost",
				value: formatCost(current.costUsd),
				change: formatChange(current.costUsd, previous?.costUsd),
				tone: "lower-is-better",
			},
		]) +
			(team.days
				? `<div style="margin:12px 0 20px;">${dayChart(team.days)}</div>`
				: "") +
			(team.repositories.length
				? shareRows(
						assets,
						team.repositories,
						(item) => formatMinutes(item.value),
						() => ({ color: OPAL.blue.color, className: "bar-repository" }),
					)
				: ""),
	);
}

/**
 * The team section for a member alone in the workspace, as the app's empty
 * states look (components/dashboard/empty.tsx): a dashed outline, the icon on
 * a small muted tile, a title, a line under it and an outline button.
 */
function inviteBlock(assets: Assets, inviteUrl: string): string {
	return section(
		"Your team",
		"section-team",
		`<table ${tableWith("border-collapse:separate;")}><tr><td class="dm-border team-invite" align="center" style="border:1px dashed ${C.border};border-radius:12px;padding:36px 24px;">
<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 auto;"><tr><td class="dm-box" align="center" valign="middle" width="32" height="32" bgcolor="${C.box}" style="width:32px;height:32px;background:${C.box};border:1px solid ${C.boxBorder};border-radius:8px;line-height:0;font-size:0;"><img src="${iconUrl(assets, "team-empty")}" alt="" width="16" height="16" style="display:inline-block;width:16px;height:16px;border:0;"></td></tr></table>
${text("Invite your team", { size: 14, weight: 500, line: 20 }, "margin-top:14px;text-align:center;")}
${text("When teammates join, their sessions, agent time and cost show up here next to yours.", { size: 13, color: C.muted, line: 20 }, "margin:4px auto 0;max-width:340px;text-align:center;")}
<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:18px auto 0;"><tr><td class="dm-card dm-border" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.border};border-radius:5px;padding:7px 12px;"><a class="dm-text" href="${escapeHtml(inviteUrl)}" style="display:inline-block;font-family:${FONT};font-size:13px;line-height:16px;font-weight:500;color:${C.text};text-decoration:none;">Invite teammates</a></td></tr></table>
</td></tr></table>`,
	);
}

/**
 * Dark mode for the clients that apply an email's own dark styles (Apple
 * Mail, Outlook for Mac and iOS) and Outlook.com's forced dark mode
 * ([data-ogsc]/[data-ogsb]). The Gmail apps invert colours themselves and
 * read none of it.
 */
const DARK_RULES = `.dm-canvas{background:#0a0a0a!important}
.dm-card{background:#141414!important;border-color:#262626!important}
.dm-box{background:#1c1c1c!important;border-color:#2a2a2a!important}
.dm-text{color:#fafafa!important}
.dm-body{color:#d4d4d4!important}
.dm-muted{color:#a3a3a3!important}
.dm-faint{color:#737373!important}
.dm-border{border-color:#262626!important}
.dm-track{background:#262626!important}
.dm-pill{background:#1c1c1c!important;border-color:#2e2e2e!important;box-shadow:none!important}
.dm-tag-red{background:#3b1414!important;color:#fafafa!important}
.dm-red{color:#fca5a5!important}
.dm-openai{background:#e5e5e5!important}
.dm-button{background:#fafafa!important}
.dm-button-text{color:#141414!important}
.on-light{display:none!important}
.on-dark{display:inline-block!important;max-height:none!important}
`;

export const DARK_MODE_CSS = `:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){${DARK_RULES.replaceAll("\n", "")}}
${DARK_RULES.split("\n")
	// The trailing newline leaves an empty rule; a selector with no block is a syntax error, and Gmail drops a whole <style> on one.
	.filter(Boolean)
	.map((rule) => `[data-ogsc] ${rule}`)
	.join("\n")}`;

interface LayoutInput {
	previewText: string;
	title: string;
	body: string;
	/** The closing call to action: a button, headed by a line and a note when given. */
	cta: { label: string; url: string; heading?: string; note?: string };
	footnote: Footnote;
	assets: Assets;
}

/** The document around a card: head, preview text and the page behind it. */
function page(
	input: Pick<LayoutInput, "title" | "previewText">,
	canvas: string,
	card: string,
): string {
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(input.title)}</title>
<style>${DARK_MODE_CSS}</style></head>
<body class="dm-canvas" style="margin:0;padding:0;background:${canvas};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(input.previewText)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table ${tableWith(`background:${canvas};`)} class="dm-canvas"><tr><td align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="${CARD_WIDTH}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
${card}
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
}

/**
 * A plain white card on a pale page, a small grey logo
 * at its top, the title, the content, the call to action, and the footer in
 * two columns below the card.
 */
function layout(input: LayoutInput): string {
	const { cta, footnote } = input;
	return page(
		input,
		C.canvas,
		`<table ${tableWith(`max-width:${CARD_WIDTH}px;border-collapse:separate;`)}>
<tr><td class="dm-card" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.border};border-radius:8px;padding:32px 28px 36px;">
<a href="${escapeHtml(input.assets.origin)}" style="display:block;width:80px;line-height:0;font-size:0;text-decoration:none;"><img class="email-logo" src="${iconUrl(input.assets, "logo-grey")}" width="80" height="20" alt="Opaline" style="display:block;width:80px;height:20px;border:0;"></a>
<h1 class="dm-text email-title" style="margin:48px 0 0;font-family:${FONT};font-size:24px;line-height:32px;font-weight:600;letter-spacing:-0.4px;color:${C.text};">${escapeHtml(input.title)}</h1>
<div style="margin-top:28px;"><table ${TABLE}>${input.body}</table></div>
<div class="email-cta" style="margin-top:20px;">
${cta.heading ? text(escapeHtml(cta.heading), { size: 15, weight: 600, line: 23 }) : ""}
${cta.note ? text(escapeHtml(cta.note), { size: 15, color: C.muted, line: 23 }, "margin-top:6px;") : ""}
<table class="email-button" role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:${cta.heading || cta.note ? "22px" : "0"};"><tr><td class="dm-button" bgcolor="${C.button}" style="border-radius:5px;background:${C.button};padding:9px 14px;"><a class="dm-button-text" href="${escapeHtml(cta.url)}" style="display:inline-block;font-family:${FONT};font-size:14px;line-height:16px;font-weight:500;color:${C.buttonText};text-decoration:none;">${escapeHtml(cta.label)}</a></td></tr></table>
</div>
</td></tr>
<tr><td class="email-footer" style="padding:28px 28px 0;">
<table ${TABLE}><tr>
<td valign="top">
<div class="email-footnote">${text(footnote.reason, { size: 13, color: C.muted, line: 21 })}</div>
<div class="email-address" style="margin-top:12px;">${text(ADDRESS.map(escapeHtml).join("<br>"), { size: 13, color: C.muted, line: 21 })}</div>
</td>
<td valign="top" align="right" style="padding-left:24px;white-space:nowrap;">
${text(`<a class="dm-muted" href="${escapeHtml(footnote.unsubscribeUrl)}" style="color:${C.muted};text-decoration:underline;">Unsubscribe</a>`, { size: 13, color: C.muted, line: 21 })}
</td>
</tr></table>
</td></tr></table>`,
	);
}

interface Footnote {
	/** Why this email came, as escaped HTML. */
	reason: string;
	unsubscribeUrl: string;
	settingsUrl: string;
}

function footnote(data: {
	kind: UsageDigestKind;
	workspaceName: string;
	settingsUrl: string;
	unsubscribeUrl: string;
}): Footnote {
	const when =
		data.kind === "weekly"
			? "every Monday"
			: "on the evening of each weekday you use your agents";
	return {
		reason: `You receive this ${when} because you are a member of ${escapeHtml(data.workspaceName)}.`,
		unsubscribeUrl: data.unsubscribeUrl,
		settingsUrl: data.settingsUrl,
	};
}

// --- Plain text ----------------------------------------------------------------

function textNumbers(
	numbers: DigestNumbers,
	previous: DigestNumbers | null,
): string {
	const line = (
		label: string,
		value: string,
		now: number,
		before: number | undefined,
	) => {
		const delta = formatChange(now, before);
		return `  ${label}: ${value}${delta ? ` (${delta})` : ""}`;
	};
	return [
		line(
			"Agent time",
			formatMinutes(numbers.activeMinutes),
			numbers.activeMinutes,
			previous?.activeMinutes,
		),
		line(
			"Longest run",
			formatMinutes(numbers.longestRunMinutes),
			numbers.longestRunMinutes,
			previous?.longestRunMinutes,
		),
		line(
			"Sessions",
			count(numbers.sessions),
			numbers.sessions,
			previous?.sessions,
		),
		line(
			"Cost",
			formatCost(numbers.costUsd),
			numbers.costUsd,
			previous?.costUsd,
		),
		line("Prompts", count(numbers.prompts), numbers.prompts, previous?.prompts),
	].join("\n");
}

function textSection(section: DigestSection): string {
	const rate = failureRate(section.current);
	return [
		textNumbers(section.current, section.previous),
		section.days ? `  ${costliestDay(section.days)}` : "",
		section.models.length
			? `  Models: ${section.models.map((item) => `${item.label} ${percent(item.share)}`).join(", ")}`
			: "",
		`  Where agents got stuck: ${rate === null ? "no tool calls" : `${percent(rate)} of tool calls failed`}, ${count(section.current.interrupts)} interruptions, context filled up ${count(section.current.compactions)} times`,
		section.subagents.current.launches
			? `  Subagents: ${count(section.subagents.current.launches)} launched, ${formatMinutes(section.subagents.current.minutes)} of agent time, ${formatCost(section.subagents.current.costUsd)}${section.subagents.types.length ? ` (${section.subagents.types.map((type) => `${type.name} ×${type.uses}`).join(", ")})` : ""}`
			: "",
		section.frustration
			? `  Frustration: ${count(section.frustration.moments)} frustrated messages, swore ${count(section.frustration.swears)} times, the agent apologized ${count(section.frustration.apologies)} times${section.frustration.phrases.length ? `; you said ${section.frustration.phrases.map((phrase) => `"${phrase.text}" ×${phrase.count}`).join(", ")}` : ""}`
			: "",
		section.toolbox.length
			? `  Skills and commands: ${section.toolbox.map((item) => `${item.name} ×${item.uses}`).join(", ")}`
			: "",
	]
		.filter(Boolean)
		.join("\n");
}

// --- Emails --------------------------------------------------------------------

export function buildUsageDigestEmail(
	data: UsageDigestEmailData,
): EmailContent {
	const weekly = data.kind === "weekly";
	const [day = data.periodLabel, ...rest] = data.periodLabel.split(", ");
	// "Oct 5 to Oct 11" for a week, "Oct 12" for a day ("Monday, Oct 12").
	const dates = weekly ? data.periodLabel : rest.join(", ") || data.periodLabel;
	// The subject names the workspace for an inbox with several; the email's title needs only the dates.
	const subject = `${weekly ? "Your week" : `Your ${day}`} in ${data.workspaceName} · ${dates}`;
	const title = weekly
		? `Your week from ${data.periodLabel}`
		: `Your ${data.periodLabel}`;
	const none = weekly
		? "You had no sessions this week."
		: "You had no sessions that day.";
	const assets = { origin: data.assetOrigin };
	const body = [
		...(data.you
			? youBlocks(assets, data, data.you)
			: [
					`<tr><td style="padding-bottom:20px;">${text(escapeHtml(none), { size: 14, color: C.body })}</td></tr>`,
				]),
		data.team
			? teamBlock(assets, data.team)
			: data.inviteUrl
				? inviteBlock(assets, data.inviteUrl)
				: "",
	].join("");
	const summary = data.you
		? `${formatMinutes(data.you.current.activeMinutes)} with your agents across ${count(data.you.current.sessions)} sessions`
		: data.team
			? `${count(data.team.current.sessions)} sessions across ${data.workspaceName}`
			: data.periodLabel;
	const html = layout({
		previewText: `${summary}. ${data.periodLabel}.`,
		title,
		body,
		cta: {
			label: "Open Opaline",
			url: data.workspaceUrl,
			heading: "See more in Opaline",
			note: `Open any session from ${weekly ? "this week" : "that day"} to see what your agents did, turn by turn.`,
		},
		footnote: footnote(data),
		assets,
	});
	const textBody = [
		title,
		data.you
			? `You (compared with ${data.comparisonLabel}):\n${textSection(data.you)}`
			: none,
		data.team
			? `Your team:\n  Active members: ${count(data.team.activeMembers)}\n${textNumbers(data.team.current, data.team.previous)}`
			: "",
		data.team || !data.inviteUrl
			? ""
			: `Invite your team to see their sessions next to yours: ${data.inviteUrl}`,
		`Open Opaline: ${data.workspaceUrl}`,
		`Unsubscribe from the ${data.kind} digest: ${data.unsubscribeUrl}\nChoose your emails: ${data.settingsUrl}`,
		ADDRESS.join("\n"),
	]
		.filter(Boolean)
		.join("\n\n");
	return { subject, html, text: textBody };
}

export function buildQuietWeekEmail(data: {
	workspaceName: string;
	periodLabel: string;
	setupUrl: string;
	settingsUrl: string;
	unsubscribeUrl: string;
	assetOrigin: string;
}): EmailContent {
	const subject = `No sessions reached ${data.workspaceName} last week`;
	const html = layout({
		previewText: `Nothing to summarize for ${data.periodLabel}.`,
		title: "A quiet week",
		body: `<tr><td>${text(
			`No sessions reached ${escapeHtml(data.workspaceName)} last week, so there is nothing to summarize. Once sessions upload again, the weekly digest picks back up. Until then this is the only reminder you get.`,
			{ size: 14, color: C.text, line: 22 },
		)}</td></tr>`,
		cta: { label: "Check your uploads", url: data.setupUrl },
		footnote: footnote({ kind: "weekly", ...data }),
		assets: { origin: data.assetOrigin },
	});
	const plain = `No sessions reached ${data.workspaceName} last week (${data.periodLabel}), so there is nothing to summarize. Once sessions upload again, the weekly digest picks back up.\n\nCheck your uploads: ${data.setupUrl}\n\nUnsubscribe from the weekly digest: ${data.unsubscribeUrl}\nChoose your emails: ${data.settingsUrl}\n\n${ADDRESS.join("\n")}`;
	return { subject, html, text: plain };
}
