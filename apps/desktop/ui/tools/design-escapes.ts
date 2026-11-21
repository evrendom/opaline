/**
 * Design-system escape check for the Mac app UI.
 *
 * Flags code that steps outside the Opaline scales and roles
 * (see .claude/skills/opaline-design/SKILL.md). The rules:
 *
 *   type     Classes: Tailwind's text-xs…9xl, an arbitrary text size
 *            (text-[11px]), leading-*, Tailwind's tracking-tight…widest or
 *            arbitrary tracking. CSS: font-size, line-height, letter-spacing
 *            with a literal value (allowed: var(…), a calc(…) of vars and
 *            unitless numbers, inherit, normal, initial, unset, 0, 1, 100%,
 *            1em), and a font-family that doesn't start with var( or inherit.
 *   space    Numeric or off-scale padding, margin, gap and space-x/y classes
 *            (p-3, -ml-1.5, gap-[10px]); Tailwind's scale stays for w-*, h-*.
 *   radius   Every rounded-* class (use corner-{zero,xs…xl,full}).
 *   colour   Tailwind palette colour classes (bg-rose-500, text-white,
 *            border-black/10, with or without a modifier) and colour literals
 *            in a class (bg-[#fff], [--x:rgb(…)]). CSS: a colour literal
 *            (#hex, rgb(, rgba(, hsl(, oklch(, oklab(, lab(, lch(, color()
 *            anywhere in a declaration value, custom-property definitions
 *            included (feature CSS keeping its own variable family);
 *            mask* / -webkit-mask* values are skipped (their colour is alpha).
 *   shadow   Tailwind's shadow-xs…2xl, the theme's shadow-s/m/l and literal
 *            shadow-[…] / drop-shadow-[…] (use a role: shadow-card …).
 *   opacity  A theme colour with an opacity modifier (text-ink-3/50,
 *            bg-error/10, ring-focus/50, bg-[var(--x)]/40): pick a role that
 *            holds the tint. Theme colours are every `--color-<name>`
 *            registered in an @theme block of src/app/tokens.css, the Layer 1
 *            names (neutral-N, color-N, success, warning, error and their
 *            -transparent / -translucent), opal-N(-tint), chart-N, sidebar-*
 *            and the shadcn names (background, foreground, muted …).
 *            current/transparent/inherit pass; a palette colour with a
 *            modifier stays `colour`, a Layer 1 class with one stays `base`.
 *   motion   Classes: duration-<n> and duration-[…] under 1000ms (≥1000ms
 *            is a loop period; duration-0 and duration-(--motion-…) pass),
 *            delay-<n> / delay-[…], ease-in, ease-out, ease-in-out, ease-[…].
 *            ease-linear/strong/drawer/wave/base/large and ease-(--…) pass.
 *            CSS, in transition* / animation* values: a literal duration
 *            over 1ms and under 1000ms, the keywords ease, ease-in, ease-out,
 *            ease-in-out, and cubic-bezier(…). linear, steps(…),
 *            var(--motion-…) pass.
 *   base     A direct Layer 1 read: classes (bg|text|border…)-(neutral|color)-N
 *            [-transparent|-translucent], arbitrary …-(--neutral-N) /
 *            [var(--neutral-N)]; in CSS var(--neutral-N…) / var(--color-N…).
 *            Screens read Layer 2 roles. ROLE_FILES (role definitions) are
 *            exempt from it.
 *   marker   A legacy `design-escape-ok: …` (exempts nothing now), a marker
 *            naming an unknown rule, or a stale marker (none of its rules has
 *            an escape on its line or the next).
 *
 * What it reads, under src (skipping site/, dev/, test dirs, fixtures, tests,
 * stories, .d.ts, and src/app/theme.css and src/app/tokens.css, which define
 * the primitives and the roles): the string literals of every .ts/.tsx file (class names
 * live in strings), the `@apply` lines of every .css file, and every
 * declaration of every .css file (comments skipped, line numbers kept).
 *
 * Exemptions: a whole file in DATA_PAINT (with the reason and the rules it
 * lifts), or a per-rule marker in any comment (`//`, `/* *\/`, `{/* *\/}`):
 *   design-escape-ok(<rule>[,<rule>…]): <reason>
 * It exempts only the named rules, on its own line and the line below.
 *
 * Ratchet, not a wall: tools/design-escapes.baseline.json holds the most
 * escapes each rule may have in the ENFORCED scope, plus `markers`, the most
 * per-rule markers in use. The check fails when any count is above its entry
 * (a missing entry counts as 0). When a count is below, it says so: run
 * `bun run check:design --update-baseline` to lower the entries to the
 * current counts (an existing entry is never raised; a missing one is written
 * at its current count).
 *
 * Output groups the escapes by rule (`file:line  rule  token`). `--rule <name>`
 * and `--path <prefix>` narrow what is PRINTED for sweeping one area; pass or
 * fail is always computed over the whole enforced scope.
 *
 * Run it with `bun run check:design` (from the repo root or apps/desktop/ui);
 * src/app/design-escapes.bun-test.ts runs it in the web tests, and CI runs it.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const RULES = [
	"type",
	"space",
	"radius",
	"colour",
	"shadow",
	"opacity",
	"motion",
	"base",
	"marker",
] as const;
export type Rule = (typeof RULES)[number];
/** Rules a per-rule marker may name. */
const MARKABLE: Rule[] = RULES.filter((r) => r !== "marker");

export type Escape = {
	file: string;
	line: number;
	rule: Rule;
	token: string;
};

/**
 * Where escapes count against the baseline, as path prefixes relative to
 * apps/desktop/ui. Everything else is reported but passes.
 */
export const ENFORCED: string[] = ["src/"];

/**
 * Files whose literal colours and shadows are data paint or artwork: they carry
 * meaning (a chart series, a model's brand, a syntax colour, the opal sheen)
 * and stay as authored. Only the rules listed for a file are lifted.
 */
export const DATA_PAINT: Record<string, { rules: Rule[]; why: string }> = {
	"src/features/shell/components/star-card/sidebar-star-card.css": {
		rules: ["colour", "motion"],
		why: "the star card's split-flap counter, knob, gold star, shimmer and celebration are artwork; its lifted shadow is main's, which no role holds",
	},
	"src/app/ui/context-utilization-gradients.tsx": {
		rules: ["colour"],
		why: "the context-use gradient's stops: green to red heat",
	},
	"src/features/shell/config/shell-routes.tsx": {
		rules: ["shadow"],
		why: "each nav icon's glow is tinted from its own opal colour",
	},
	"src/features/shell/components/shell-nav-icon.tsx": {
		rules: ["colour", "shadow"],
		why: "the opal nav icon's fill, ring and drop are artwork",
	},
	"src/features/shell/components/repo-nav-icon.tsx": {
		rules: ["colour", "shadow"],
		why: "a repository's icon is painted from its hue",
	},
	"src/features/shell/components/AppSidebar.tsx": {
		rules: ["colour"],
		why: "the opal nav icon's dark fill and ring are artwork",
	},
	"src/components/conversation/code-highlight-worker.ts": {
		rules: ["colour"],
		why: "syntax colours",
	},
	"src/features/sessions/reader/files/session-reader-file-tag.tsx": {
		rules: ["colour"],
		why: "a file type's brand colour",
	},
	"src/features/dashboard/components/dashboard-model-brand.ts": {
		rules: ["colour"],
		why: "model and vendor brand colours",
	},
	"src/features/costs/chart-colors.ts": {
		rules: ["colour"],
		why: "chart series",
	},
	"src/features/sessions/reader/model/session-reader-step-lanes.ts": {
		rules: ["colour"],
		why: "activity lanes",
	},
	"src/features/compass/run-lanes-model.ts": {
		rules: ["colour"],
		why: "activity lanes",
	},
	"src/features/sessions/reader/detail/waterfall/session-reader-waterfall-chips.tsx":
		{
			rules: ["colour", "shadow"],
			why: "step bars and chips take their lane, CI or model colour; the opal chip's drop is artwork",
		},
	"src/features/sessions/reader/model/session-reader-model.ts": {
		rules: ["colour"],
		why: "cost heat: green for the cheapest turn to red for the priciest",
	},
	"src/features/sessions/reader/summary/session-reader-summary-figures-model.ts":
		{
			rules: ["colour"],
			why: "each summary figure's category mark",
		},
	"src/features/sessions/components/session-thread-overview-event-dots.tsx": {
		rules: ["colour"],
		why: "event dots: one colour per event kind",
	},
	"src/components/pierre/diff-view.tsx": {
		rules: ["colour"],
		why: "diff paint: added and removed lines and words",
	},
};

/** Role definitions: they map Layer 1 onto Layer 2, so `base` doesn't apply. */
export const ROLE_FILES = new Set(["src/app/preset-extensions.css"]);

const UI_ROOT = path.resolve(import.meta.dirname, "..");
export const BASELINE_FILE = path.join(
	import.meta.dirname,
	"design-escapes.baseline.json",
);

const SKIP_DIRS = new Set(["site", "dev", "test", "__tests__", "fixtures"]);
const SKIP_FILE =
	/\.(test|bun-test|spec|stories)\.[cm]?tsx?$|fixtures?\.[cm]?tsx?$|\.d\.ts$/;
const SKIP_PATH = new Set([
	"src/app/theme.css",
	"src/app/tokens.css",
	// tailwind-merge's class lists name every utility, rounded-* included
	"src/lib/tailwind-merge-config.ts",
]);

const SPACE_PREFIX =
	/^(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y)-(.+)$/;
const SPACE_STEP = /^(zero|xxs|xs|s|m|l|xl|xxl|auto|reverse)$/;
const LENGTH_LITERAL = /\d(px|rem|em)\b|^-?\d+(\.\d+)?$/;
const COLOUR_PREFIXES = [
	"bg",
	"text",
	"border",
	"border-x",
	"border-y",
	"border-t",
	"border-r",
	"border-b",
	"border-l",
	"border-s",
	"border-e",
	"ring-offset",
	"ring",
	"outline",
	"fill",
	"stroke",
	"from",
	"via",
	"to",
	"divide",
	"decoration",
	"placeholder",
	"caret",
	"accent",
	"inset-shadow",
	"inset-ring",
	"drop-shadow",
	"shadow",
];
const COLOUR_PREFIX = `(?:${COLOUR_PREFIXES.map((p) => p.replace(/-/g, "\\-")).join("|")})`;
const PALETTE = new RegExp(
	`^${COLOUR_PREFIX}-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)|white|black)(?:/.+)?$`,
);
// `_` separates words inside an arbitrary value, so no \b before the function.
const COLOUR_LITERAL =
	/#[0-9a-fA-F]{3,8}\b|(?<![a-zA-Z-])(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/;
const COLOUR_LITERAL_ALL = new RegExp(COLOUR_LITERAL.source, "g");
const TEXT_SIZE_ARBITRARY =
	/^(?:length:)?(?:-?\d|\.\d|calc\(|clamp\(|min\(|max\(|var\(--(?:size|display-size|line|text)-)/;
const LAYER1_NAME = /^(?:neutral|color)-\d+(?:-transparent|-translucent)?$/;
const LAYER1_VAR = /(?:var\(|\()--(?:neutral|color)-\d/;
const STATIC_THEME_COLOUR =
	/^(?:(?:neutral-\d+|color-\d+|success|warning|error)(?:-transparent|-translucent)?|sidebar(?:-[a-z-]+)?|chart-\d+|opal-\d+(?:-tint)?|(?:background|foreground|popover|secondary|muted|destructive|border|input|ring|primary|accent|card)(?:-foreground)?)$/;

/** The colour names registered in the @theme blocks of a tokens.css. */
export function themeColoursOf(css: string): Set<string> {
	const out = new Set<string>();
	const block = /@theme\b[^{]*\{([^}]*)\}/g;
	for (const m of css.matchAll(block))
		for (const d of m[1].matchAll(/--color-([\w-]+)\s*:/g)) out.add(d[1]);
	return out;
}

const TOKENS_CSS = path.join(UI_ROOT, "src/app/tokens.css");
const THEME_COLOURS = existsSync(TOKENS_CSS)
	? themeColoursOf(readFileSync(TOKENS_CSS, "utf8"))
	: new Set<string>();

function isThemeColour(name: string): boolean {
	return THEME_COLOURS.has(name) || STATIC_THEME_COLOUR.test(name);
}

/** The utility a class applies, without its variants (`dark:hover:` …) and `!`. */
function utilityOf(word: string): string {
	let depth = 0;
	let start = 0;
	for (let i = 0; i < word.length; i++) {
		const c = word[i];
		if (c === "[" || c === "(") depth++;
		else if (c === "]" || c === ")") depth--;
		else if (c === ":" && depth === 0) start = i + 1;
	}
	return word.slice(start).replace(/^!|!$/g, "");
}

/** A utility without its `/opacity` or `/line-height` modifier. */
function withoutModifier(utility: string): string {
	let depth = 0;
	for (let i = utility.length - 1; i >= 0; i--) {
		const c = utility[i];
		if (c === "]" || c === ")") depth++;
		else if (c === "[" || c === "(") depth--;
		else if (c === "/" && depth === 0) return utility.slice(0, i);
	}
	return utility;
}

/** The colour a colour utility names (`bg-ink-3` → `ink-3`), per prefix split. */
function colourNames(base: string): string[] {
	return COLOUR_PREFIXES.filter((p) => base.startsWith(`${p}-`)).map((p) =>
		base.slice(p.length + 1),
	);
}

/** Milliseconds in a duration literal (`150ms`, `.2s`, `300`), if it is one. */
function durationMs(value: string): number | undefined {
	const m = /^(\d*\.?\d+)(ms|s)?$/.exec(value.trim());
	if (!m) return undefined;
	return Number(m[1]) * (m[2] === "s" ? 1000 : 1);
}

function motionOf(u: string): boolean {
	let m = /^duration-(\d+)$/.exec(u);
	if (m) return Number(m[1]) !== 0 && Number(m[1]) < 1000;
	m = /^duration-\[(.+)\]$/.exec(u);
	if (m) {
		if (m[1].includes("--motion-")) return false;
		const ms = durationMs(m[1]);
		return ms === undefined || (ms > 0 && ms < 1000);
	}
	m = /^delay-(\d+)$/.exec(u);
	if (m) return Number(m[1]) !== 0;
	m = /^delay-\[(.+)\]$/.exec(u);
	if (m) return !m[1].includes("--motion-");
	return /^ease-(?:in|out|in-out|\[.+\])$/.test(u);
}

/** Which rule a class breaks, if any. */
export function classifyClass(word: string): Rule | undefined {
	const u = utilityOf(word).replace(/^-/, "");
	if (!u) return undefined;
	const base = withoutModifier(u);

	if (/^rounded(?:-[a-z0-9[(]|$)/.test(u)) return "radius";

	if (
		/^(?:shadow|drop-shadow)(?:-(?:2xs|xs|sm|md|lg|xl|2xl|s|m|l|inner))?$/.test(
			u,
		)
	)
		return "shadow";
	if (/^(?:shadow|drop-shadow|inset-shadow)-\[.+\]$/.test(u)) return "shadow";

	const arbitrary = /-\[(.+)\]$/.exec(base)?.[1];
	if (u.includes("[") && COLOUR_LITERAL.test(u)) return "colour";
	if (PALETTE.test(u)) return "colour";

	if (/^text-(?:xs|sm|base|lg|xl|[2-9]xl)(?:\/.+)?$/.test(u)) return "type";
	if (
		base.startsWith("text-[") &&
		arbitrary &&
		TEXT_SIZE_ARBITRARY.test(arbitrary)
	)
		return "type";
	if (/^leading-.+$/.test(u)) return "type";
	if (
		/^tracking-(?:tighter|tight|normal|wide|wider|widest|\[.+\]|\(.+\))$/.test(
			u,
		)
	)
		return "type";

	const space = SPACE_PREFIX.exec(u);
	if (space) {
		const value = space[2];
		if (SPACE_STEP.test(value) || value.startsWith("(")) return undefined;
		if (value === "px" || /^\d+(\.\d+)?$/.test(value)) return "space";
		const inner = /^\[(.+)\]$/.exec(value)?.[1];
		if (inner && LENGTH_LITERAL.test(inner)) return "space";
		return undefined;
	}

	if (motionOf(u)) return "motion";

	const names = colourNames(base);
	if (names.some((n) => LAYER1_NAME.test(n))) return "base";
	if ((u.includes("[") || u.includes("(")) && LAYER1_VAR.test(u)) return "base";

	if (base !== u && names.length) {
		if (names.some(isThemeColour)) return "opacity";
		const inner = names
			.map((n) => /^(?:\[(.+)\]|\((.+)\))$/.exec(n))
			.find(Boolean);
		const value = inner?.[1] ?? inner?.[2];
		if (value && /^(?:var\(|--|color:)/.test(value)) return "opacity";
	}
	return undefined;
}

/** Class-like words in a piece of text: split on whitespace. */
function wordsOf(text: string): string[] {
	return text
		.split(/\s+/)
		.map((w) => w.replace(/[,;]+$/, ""))
		.filter((w) => /^[!-]?[a-z[]/.test(w));
}

/**
 * The string literals of a TS/TSX source, as [line, text] pieces (a template
 * literal spanning lines yields one piece per line). Comments are skipped;
 * `${…}` inside a template is read as part of it, which is harmless here.
 */
function stringPieces(source: string): [number, string][] {
	const out: [number, string][] = [];
	let line = 1;
	let quote: string | null = null;
	let piece = "";
	let pieceLine = 1;
	for (let i = 0; i < source.length; i++) {
		const c = source[i];
		if (quote) {
			if (c === "\\") {
				piece += source[i + 1] ?? "";
				i++;
				continue;
			}
			if (c === quote) {
				out.push([pieceLine, piece]);
				quote = null;
				continue;
			}
			if (c === "\n") {
				line++;
				if (quote !== "`") {
					// an unterminated quote in JSX text ("don't"): drop it
					quote = null;
					continue;
				}
				out.push([pieceLine, piece]);
				piece = "";
				pieceLine = line;
				continue;
			}
			piece += c;
			continue;
		}
		if (c === "\n") {
			line++;
			continue;
		}
		if (c === "/" && source[i + 1] === "/") {
			while (i < source.length && source[i] !== "\n") i++;
			i--;
			continue;
		}
		if (c === "/" && source[i + 1] === "*") {
			const end = source.indexOf("*/", i + 2);
			const stop = end === -1 ? source.length : end + 2;
			for (let j = i; j < stop; j++) if (source[j] === "\n") line++;
			i = stop - 1;
			continue;
		}
		if (c === '"' || c === "'" || c === "`") {
			quote = c;
			piece = "";
			pieceLine = line;
		}
	}
	return out;
}

/** CSS with its comments blanked out (newlines kept, so lines stay true). */
export function stripCssComments(css: string): string {
	return css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
}

const TYPE_PROPS = new Set(["font-size", "line-height", "letter-spacing"]);
const TYPE_KEYWORD = /^(?:inherit|normal|initial|unset|0|1|100%|1em)$/;

function literalType(value: string): boolean {
	const v = value.replace(/\s*!important$/, "").trim();
	if (TYPE_KEYWORD.test(v)) return false;
	if (/^(?:var|calc)\(/.test(v)) {
		let rest = v;
		for (let prev = ""; prev !== rest; ) {
			prev = rest;
			rest = rest.replace(/var\(--[\w-]+(?:,[^()]*)?\)/g, "");
		}
		return /\d(?:px|rem|em|%|pt|ch|ex|vw|vh)/.test(rest);
	}
	return true;
}

/**
 * Escapes in the declarations of a CSS source (comments skipped). Each hit
 * is reported on the line its token sits on.
 */
export function scanCssDeclarations(
	file: string,
	source: string,
): Omit<Escape, "file">[] {
	const css = stripCssComments(source);
	const out: Omit<Escape, "file">[] = [];
	const lineAt = (offset: number) => {
		let n = 1;
		for (let i = 0; i < offset; i++) if (css[i] === "\n") n++;
		return n;
	};
	const themeDepths: number[] = [];
	let depth = 0;
	let start = 0;
	let paren = 0;
	let pendingTheme = false;
	for (let i = 0; i <= css.length; i++) {
		const c = css[i];
		if (c === "(") paren++;
		else if (c === ")") paren--;
		if (paren > 0 && i < css.length) continue;
		if (c !== "{" && c !== "}" && c !== ";" && i < css.length) continue;
		const segment = css.slice(start, i);
		const lead = segment.length - segment.trimStart().length;
		const segStart = start + lead;
		const text = segment.trim();
		if (c === "{") {
			pendingTheme = /^@theme\b/.test(text);
			depth++;
			if (pendingTheme) themeDepths.push(depth);
		} else if (text && !text.startsWith("@")) {
			const decl = /^(--[\w-]+|[a-z-]+)\s*:([\s\S]*)$/.exec(text);
			if (decl) {
				const prop = decl[1];
				const value = decl[2];
				const valueStart = segStart + text.length - value.length;
				const at = (offset: number) => lineAt(valueStart + offset);
				const inTheme = themeDepths.includes(depth);
				// A mask's colour only carries alpha (`#000 35%`): not paint.
				if (!/^(?:-webkit-)?mask/.test(prop))
					for (const m of value.matchAll(COLOUR_LITERAL_ALL))
						out.push({
							line: at(m.index),
							rule: "colour",
							token: `${prop}: ${m[0]}`,
						});
				if (!inTheme && !ROLE_FILES.has(file))
					for (const m of value.matchAll(/var\(--(?:neutral|color)-\d+[\w-]*/g))
						out.push({
							line: at(m.index),
							rule: "base",
							token: `${prop}: ${m[0]})`,
						});
				if (TYPE_PROPS.has(prop) && literalType(value))
					out.push({
						line: lineAt(segStart),
						rule: "type",
						token: `${prop}: ${value.trim()}`,
					});
				if (prop === "font-family" && !/^\s*(?:var\(|inherit\b)/.test(value))
					out.push({
						line: lineAt(segStart),
						rule: "type",
						token: `${prop}: ${value.trim()}`,
					});
				if (/^(?:transition|animation)(?:-|$)/.test(prop)) {
					for (const m of value.matchAll(/(?<![\w.(-])(\d*\.?\d+)(ms|s)\b/g)) {
						const ms = Number(m[1]) * (m[2] === "s" ? 1000 : 1);
						if (ms > 1 && ms < 1000)
							out.push({
								line: at(m.index),
								rule: "motion",
								token: `${prop}: ${m[0]}`,
							});
					}
					for (const m of value.matchAll(
						/(?<![\w-])(?:ease-in-out|ease-in|ease-out|ease)(?![\w-])|cubic-bezier\(/g,
					))
						out.push({
							line: at(m.index),
							rule: "motion",
							token: `${prop}: ${m[0]}`,
						});
				}
			}
		}
		if (c === "}") {
			if (themeDepths.at(-1) === depth) themeDepths.pop();
			depth--;
		}
		start = i + 1;
	}
	return out;
}

const MARKER = /design-escape-ok(\(([^)]*)\))?\s*:/g;

type Marker = { line: number; rules: string[]; legacy: boolean };

function markersOf(lines: string[]): Marker[] {
	const out: Marker[] = [];
	lines.forEach((text, i) => {
		for (const m of text.matchAll(MARKER))
			out.push({
				line: i + 1,
				legacy: m[1] === undefined,
				rules: (m[2] ?? "")
					.split(",")
					.map((r) => r.trim())
					.filter(Boolean),
			});
	});
	return out;
}

export type Scan = { escapes: Escape[]; markersUsed: number };

/** Every escape in one file, after DATA_PAINT and its per-rule markers. */
export function scanFile(file: string, source: string): Scan {
	const lift = DATA_PAINT[file]?.rules ?? [];
	const lines = source.split("\n");
	const raw: Escape[] = [];
	const pieces: [number, string][] = file.endsWith(".css")
		? lines.flatMap((text, i): [number, string][] => {
				const apply = /@apply\s+([^;]+)/.exec(text);
				return apply ? [[i + 1, apply[1]]] : [];
			})
		: stringPieces(source);
	for (const [line, text] of pieces)
		for (const word of wordsOf(text)) {
			const rule = classifyClass(word);
			if (rule) raw.push({ file, line, rule, token: word });
		}
	if (file.endsWith(".css"))
		for (const e of scanCssDeclarations(file, source)) raw.push({ file, ...e });

	const lifted = raw.filter((e) => !lift.includes(e.rule));
	const markers = markersOf(lines);
	const out: Escape[] = [];
	const exempt = new Set<Escape>();
	let markersUsed = 0;
	for (const m of markers) {
		if (m.legacy) {
			out.push({
				file,
				line: m.line,
				rule: "marker",
				token: "design-escape-ok: (legacy, name its rules)",
			});
			continue;
		}
		const unknown = m.rules.filter((r) => !MARKABLE.includes(r as Rule));
		if (unknown.length || !m.rules.length) {
			out.push({
				file,
				line: m.line,
				rule: "marker",
				token: `design-escape-ok(${m.rules.join(",")}): unknown rule ${unknown.join(",") || "(none)"}`,
			});
			continue;
		}
		const covered = lifted.filter(
			(e) =>
				(e.line === m.line || e.line === m.line + 1) &&
				m.rules.includes(e.rule),
		);
		if (!covered.length) {
			out.push({
				file,
				line: m.line,
				rule: "marker",
				token: `design-escape-ok(${m.rules.join(",")}): stale, exempts nothing`,
			});
			continue;
		}
		markersUsed++;
		for (const e of covered) exempt.add(e);
	}
	out.push(...lifted.filter((e) => !exempt.has(e)));
	out.sort((a, b) => a.line - b.line);
	return { escapes: out, markersUsed };
}

/** Escapes in one file (see scanFile). */
export function scanSource(file: string, source: string): Escape[] {
	return scanFile(file, source).escapes;
}

function* sourceFiles(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) yield* sourceFiles(full);
		} else if (
			/\.(tsx?|css)$/.test(entry.name) &&
			!SKIP_FILE.test(entry.name)
		) {
			yield full;
		}
	}
}

export type Tree = { escapes: Escape[]; markers: { file: string }[] };

export function scanTree(root = UI_ROOT): Tree {
	const escapes: Escape[] = [];
	const markers: { file: string }[] = [];
	for (const full of sourceFiles(path.join(root, "src"))) {
		const file = path.relative(root, full).split(path.sep).join("/");
		if (SKIP_PATH.has(file)) continue;
		const scan = scanFile(file, readFileSync(full, "utf8"));
		escapes.push(...scan.escapes);
		for (let i = 0; i < scan.markersUsed; i++) markers.push({ file });
	}
	return { escapes, markers };
}

export function findEscapes(root = UI_ROOT): Escape[] {
	return scanTree(root).escapes;
}

export function isEnforced(file: string): boolean {
	return ENFORCED.some((prefix) => file.startsWith(prefix));
}

export type Counts = Record<string, number>;

/** Per-rule counts plus `markers`, over the enforced scope. */
export function countsOf(tree: Tree): Counts {
	const counts: Counts = {};
	for (const r of RULES) counts[r] = 0;
	for (const e of tree.escapes) if (isEnforced(e.file)) counts[e.rule]++;
	counts.markers = tree.markers.filter((m) => isEnforced(m.file)).length;
	return counts;
}

export type Comparison = {
	over: { key: string; count: number; max: number }[];
	under: { key: string; count: number; max: number }[];
};

/** Counts against the baseline: a missing entry allows 0. */
export function compareToBaseline(
	counts: Counts,
	baseline: Counts,
): Comparison {
	const over: Comparison["over"] = [];
	const under: Comparison["under"] = [];
	const keys = new Set([...Object.keys(counts), ...Object.keys(baseline)]);
	for (const key of keys) {
		const count = counts[key] ?? 0;
		const max = baseline[key] ?? 0;
		if (count > max) over.push({ key, count, max });
		else if (count < max) under.push({ key, count, max });
	}
	return { over, under };
}

/** The lowered baseline: entries drop to the counts, never rise; new ones are added. */
export function updatedBaseline(counts: Counts, baseline: Counts): Counts {
	const next: Counts = {};
	for (const key of new Set([...Object.keys(baseline), ...Object.keys(counts)]))
		next[key] =
			key in baseline
				? Math.min(baseline[key], counts[key] ?? 0)
				: (counts[key] ?? 0);
	return next;
}

export function readBaseline(file = BASELINE_FILE): Counts {
	return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

function argValue(args: string[], flag: string): string | undefined {
	const i = args.indexOf(flag);
	return i === -1 ? undefined : args[i + 1];
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const onlyRule = argValue(args, "--rule");
	const onlyPath = argValue(args, "--path");
	const tree = scanTree();
	const counts = countsOf(tree);
	const baseline = readBaseline();

	if (args.includes("--update-baseline")) {
		const next = updatedBaseline(counts, baseline);
		writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, "\t")}\n`);
		console.log(`Baseline written: ${JSON.stringify(next)}`);
		process.exit(0);
	}

	const shown = tree.escapes.filter(
		(e) =>
			(!onlyRule || e.rule === onlyRule) &&
			(!onlyPath || e.file.startsWith(onlyPath)),
	);
	for (const rule of RULES) {
		const list = shown.filter((e) => e.rule === rule);
		if (!list.length) continue;
		console.log(`\n${rule} (${list.length})`);
		for (const e of list)
			console.log(
				`${e.file}:${e.line}  ${e.rule}  ${e.token}${isEnforced(e.file) ? "" : "  (not enforced)"}`,
			);
	}
	if (onlyRule || onlyPath)
		console.log(
			`\n(Filtered output: ${shown.length} shown. Pass or fail below is over the whole enforced scope.)`,
		);

	const { over, under } = compareToBaseline(counts, baseline);
	const table = Object.entries(counts)
		.map(([k, n]) => `${k} ${n}/${baseline[k] ?? 0}`)
		.join(", ");
	console.log(`\nCounts / baseline: ${table}`);
	if (under.length)
		console.log(
			`Below baseline (${under.map((u) => `${u.key} ${u.count} < ${u.max}`).join(", ")}): run \`bun run check:design --update-baseline\` to lock the gain in.`,
		);
	if (over.length) {
		console.error(
			`\nAbove baseline: ${over.map((o) => `${o.key} ${o.count} > ${o.max}`).join(", ")}. Use the Opaline steps and roles (.claude/skills/opaline-design/SKILL.md), or mark data paint with \`design-escape-ok(<rule>): <reason>\`.`,
		);
		process.exit(1);
	}
	console.log("Design-system escapes are within the baseline.");
}
