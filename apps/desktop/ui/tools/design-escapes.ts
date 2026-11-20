/**
 * Design-system escape check for the Mac app UI.
 *
 * Flags classes that step outside the Opaline scales and roles
 * (see .claude/skills/opaline-design/SKILL.md):
 *   type    Tailwind's text-xs…9xl, an arbitrary text size (text-[11px]),
 *           leading-*, and Tailwind's tracking-tight…widest or arbitrary tracking
 *   space   numeric or off-scale padding, margin, gap and space-x/y
 *           (p-3, -ml-1.5, gap-[10px]); Tailwind's scale stays for w-*, h-*, size-*
 *   radius  every rounded-* (use corner-{zero,xs…xl,full})
 *   colour  Tailwind palette colours (bg-rose-500, text-white, border-black/10)
 *           and literal colours in a class (bg-[#fff], [--x:rgb(…)], oklch(…))
 *   shadow  Tailwind's shadow-xs…2xl, the theme's shadow-s/m/l and literal
 *           shadow-[…] / drop-shadow-[…] (use a role: shadow-card, shadow-control …)
 *
 * It reads the string literals of every .ts/.tsx file under src (class names
 * live in strings) and the `@apply` lines of every .css file, skipping tests,
 * fixtures, src/site and src/dev.
 *
 * It reports every escape in the tree, and fails only on escapes inside
 * ENFORCED below. Widen ENFORCED as each area is cleaned; `["src/"]` enforces
 * the whole UI.
 *
 * Data paint and artwork are allowed in two ways: a whole file in DATA_PAINT
 * (with the reason and the rules it lifts), or one line that carries a
 * `design-escape-ok: <reason>` comment (on the line itself or the line above).
 *
 * Run it with `bun run check:design` (from the repo root or apps/desktop/ui);
 * src/design-escapes.bun-test.ts runs it in the web tests, and CI runs it.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type Rule = "type" | "space" | "radius" | "colour" | "shadow";

export type Escape = {
	file: string;
	line: number;
	rule: Rule;
	token: string;
};

/**
 * Where an escape fails the check, as path prefixes relative to apps/desktop/ui.
 * Everything else is reported but passes. After the reader and product areas
 * are cleaned, this becomes `["src/"]`.
 */
export const ENFORCED: string[] = [
	"src/app/",
	"src/widget/",
	"src/index.css",
	"src/features/settings/",
	"src/features/auth/",
	"src/features/cli-onboarding/",
	"src/features/invitations/",
	"src/features/shell/",
	"src/features/support/",
	"src/features/demo/",
];

const ALL: Rule[] = ["type", "space", "radius", "colour", "shadow"];

/**
 * Files whose literal colours and shadows are data paint or artwork: they carry
 * meaning (a chart series, a model's brand, a syntax colour, the opal sheen)
 * and stay as authored. Only the rules listed for a file are lifted.
 */
export const DATA_PAINT: Record<string, { rules: Rule[]; why: string }> = {
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
};

const UI_ROOT = path.resolve(import.meta.dirname, "..");

const SKIP_DIRS = new Set(["site", "dev", "test", "__tests__", "fixtures"]);
const SKIP_FILE =
	/\.(test|bun-test|spec|stories)\.[cm]?tsx?$|fixtures?\.[cm]?tsx?$|\.d\.ts$/;

const ALLOW_MARK = "design-escape-ok:";

const SPACE_PREFIX =
	/^(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y)-(.+)$/;
const SPACE_STEP = /^(zero|xxs|xs|s|m|l|xl|xxl|auto|reverse)$/;
const LENGTH_LITERAL = /\d(px|rem|em)\b|^-?\d+(\.\d+)?$/;
const COLOUR_PREFIX =
	"(?:bg|text|border(?:-[xytrblse])?|ring|ring-offset|outline|fill|stroke|from|via|to|divide|decoration|placeholder|caret|accent|shadow|inset-shadow|inset-ring|drop-shadow)";
const PALETTE = new RegExp(
	`^${COLOUR_PREFIX}-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)|white|black)(?:/.+)?$`,
);
// `_` separates words inside an arbitrary value, so no \b before the function.
const COLOUR_LITERAL =
	/#[0-9a-fA-F]{3,8}\b|(?<![a-zA-Z-])(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/;
const TEXT_SIZE_ARBITRARY =
	/^(?:length:)?(?:-?\d|\.\d|calc\(|clamp\(|min\(|max\(|var\(--(?:size|display-size|line|text)-)/;

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

export function scanSource(file: string, source: string): Escape[] {
	const lift = DATA_PAINT[file]?.rules ?? [];
	const lines = source.split("\n");
	const allowed = (line: number) =>
		lines[line - 1]?.includes(ALLOW_MARK) ||
		lines[line - 2]?.includes(ALLOW_MARK);
	const pieces: [number, string][] = file.endsWith(".css")
		? lines.flatMap((text, i): [number, string][] => {
				const apply = /@apply\s+([^;]+)/.exec(text);
				return apply ? [[i + 1, apply[1]]] : [];
			})
		: stringPieces(source);
	const out: Escape[] = [];
	for (const [line, text] of pieces) {
		if (allowed(line)) continue;
		for (const word of wordsOf(text)) {
			const rule = classifyClass(word);
			if (rule && !lift.includes(rule))
				out.push({ file, line, rule, token: word });
		}
	}
	return out;
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

export function findEscapes(root = UI_ROOT): Escape[] {
	const out: Escape[] = [];
	for (const full of sourceFiles(path.join(root, "src"))) {
		const file = path.relative(root, full).split(path.sep).join("/");
		out.push(...scanSource(file, readFileSync(full, "utf8")));
	}
	return out;
}

export function isEnforced(file: string): boolean {
	return ENFORCED.some((prefix) => file.startsWith(prefix));
}

function summary(list: Escape[]): string {
	return ALL.map((r) => [r, list.filter((e) => e.rule === r).length] as const)
		.filter(([, n]) => n > 0)
		.map(([r, n]) => `${r} ${n}`)
		.join(", ");
}

if (import.meta.main) {
	const escapes = findEscapes();
	const failing = escapes.filter((e) => isEnforced(e.file));
	const reported = escapes.filter((e) => !isEnforced(e.file));
	const print = (e: Escape) =>
		console.log(`${e.file}:${e.line}  ${e.rule}  ${e.token}`);
	if (reported.length) {
		console.log(
			`Reported, outside the enforced scope (${reported.length}: ${summary(reported)}):`,
		);
		reported.forEach(print);
	}
	if (failing.length) {
		console.log(`\nFailing, inside the enforced scope:`);
		failing.forEach(print);
		console.error(
			`\n${failing.length} design-system escapes in enforced files (${summary(failing)}). Use the Opaline steps and roles (.claude/skills/opaline-design/SKILL.md), or mark data paint with \`design-escape-ok: <reason>\`.`,
		);
		process.exit(1);
	}
	console.log(
		`\nNo design-system escapes in the enforced scope (${ENFORCED.length} paths); ${reported.length} reported elsewhere.`,
	);
}
