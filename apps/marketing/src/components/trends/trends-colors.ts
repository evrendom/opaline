import type {
	TrendsHarness,
	TrendsProvider,
} from "../../trends/trends-snapshot";

export const PROVIDER_LABELS: Record<TrendsProvider, string> = {
	anthropic: "Anthropic",
	openai: "OpenAI",
	google: "Google",
	xai: "xAI",
	deepseek: "DeepSeek",
	meta: "Meta",
	kimi: "Kimi",
	zai: "Z AI",
	alibaba: "Alibaba",
	xiaomi: "Xiaomi",
	stepfun: "StepFun",
	minimax: "MiniMax",
	mistral: "Mistral",
	nvidia: "NVIDIA",
	inception: "Inception",
	other: "Other labs",
};

export const HARNESS_LABELS: Record<TrendsHarness, string> = {
	"claude-code": "Claude Code",
	codex: "Codex",
};

/*
 * Benchmark series carry no hue: identity comes from the provider mark and
 * the direct label, emphasis from hover, focus and the opal signature. Hues
 * below are reserved for the few charts where color does a defined job, each
 * validated with the dataviz palette checks against the white surface.
 */

export const TRENDS_SERIES_COLORS = [
	"#3978f6",
	"#eb6834",
	"#1baf7a",
	"#7c5cff",
	"#c98a1f",
	"#cf5192",
	"#218d9c",
	"#7a8843",
] as const;

export const TRENDS_OTHER_COLOR = "#a1a2a6";

// Ordinal ramp for p50, p90 and p99 markers. The tail is the strongest
// contrast on either surface, so the ramp runs the other way in dark mode.
export const TRENDS_QUANTILE_COLORS = {
	p50: "light-dark(#86b2fa, #2f5fc4)",
	p90: "light-dark(#3978f6, #5b93f8)",
	p99: "light-dark(#1d4fb8, #b0cdfd)",
} as const;

// Diverging poles for developer reactions; the neutral middle is not drawn.
export const TRENDS_REACTION_COLORS = {
	negative: "#e34948",
	mixed: "#f0a19f",
	positive: "#3978f6",
} as const;

// Diverging pair for the harness balance: warm Claude Code, cool Codex,
// neutral line at even.
export const TRENDS_HARNESS_COLORS: Record<TrendsHarness, string> = {
	"claude-code": "#d97757",
	codex: "#3978f6",
};

/*
 * Benchmark identity: one hue per lab, lightness by model size within the lab
 * (darkest is biggest), with size from modelSize.
 * Models in use take evenly spaced steps that clear the dataviz all-pairs
 * checks; every other model is placed between them by price and muted, so a
 * model keeps its color whatever else is selected.
 */
const LAB_HUES: Record<TrendsProvider, readonly [hue: number, chroma: number]> =
	{
		anthropic: [42, 0.15],
		openai: [255, 0.03],
		google: [150, 0.15],
		xai: [292, 0.16],
		meta: [250, 0.16],
		kimi: [350, 0.15],
		zai: [92, 0.13],
		deepseek: [205, 0.12],
		alibaba: [322, 0.15],
		xiaomi: [22, 0.16],
		stepfun: [175, 0.12],
		minimax: [8, 0.16],
		mistral: [68, 0.15],
		nvidia: [128, 0.15],
		inception: [230, 0.12],
		other: [255, 0],
	};

const IN_USE_LIGHTNESS = { darkest: 0.3, lightest: 0.81 } as const;
const OTHER_LIGHTNESS = { darkest: 0.24, lightest: 0.88 } as const;
const OTHER_CHROMA_SCALE = 0.6;

/*
 * Dark mode keeps contrast, not lightness: the biggest model stays the
 * strongest mark, so the light-mode lightness range mirrors onto the dark
 * surface (0.3 becomes 0.9, 0.81 becomes 0.52). Chroma eases off near
 * white, where these hues fall out of gamut.
 */
const DARK_LIGHTNESS = { from: 0.9, to: 0.52 } as const;

/** Whether an oklch colour is inside sRGB (via oklab and linear sRGB). */
function inSrgb(lightness: number, chroma: number, hue: number) {
	const angle = (hue * Math.PI) / 180;
	const a = chroma * Math.cos(angle);
	const b = chroma * Math.sin(angle);
	const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const channels = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
	return channels.every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4);
}

/**
 * The most chroma, up to the asked-for amount, that stays inside sRGB at
 * this lightness and hue. Out-of-gamut colours clip when painted still, but
 * Chrome wraps them mid-transition (a pale orange flashes cyan), so every
 * model colour is kept inside.
 */
function gamutChroma(lightness: number, chroma: number, hue: number) {
	if (inSrgb(lightness, chroma, hue)) return chroma;
	let low = 0;
	let high = chroma;
	for (let step = 0; step < 20; step++) {
		const middle = (low + high) / 2;
		if (inSrgb(lightness, middle, hue)) low = middle;
		else high = middle;
	}
	return low;
}

function modelColor(lightness: number, chroma: number, hue: number) {
	const t =
		(lightness - IN_USE_LIGHTNESS.darkest) /
		(IN_USE_LIGHTNESS.lightest - IN_USE_LIGHTNESS.darkest);
	const darkLightness = Math.min(
		0.95,
		Math.max(
			0.46,
			DARK_LIGHTNESS.from + (DARK_LIGHTNESS.to - DARK_LIGHTNESS.from) * t,
		),
	);
	const lightChroma = gamutChroma(lightness, chroma, hue);
	const darkChroma = gamutChroma(
		darkLightness,
		chroma * Math.min(1, (1 - darkLightness) / 0.2),
		hue,
	);
	return `light-dark(oklch(${lightness.toFixed(3)} ${lightChroma.toFixed(3)} ${hue}), oklch(${darkLightness.toFixed(3)} ${darkChroma.toFixed(3)} ${hue}))`;
}

/**
 * Legible text on a model's colour: white on the darker shades, the page's
 * ink on the lighter ones, for light and dark mode alike (a model colour's
 * two lightnesses). Anything else gets white.
 */
export function inkOn(color: string) {
	const [light, dark] = [...color.matchAll(/oklch\(([\d.]+)/g)].map((match) =>
		Number(match[1]),
	);
	const ink = (lightness: number | undefined) =>
		lightness !== undefined && lightness > 0.7 ? "#15181fe6" : "#ffffff";
	return `light-dark(${ink(light)}, ${ink(dark ?? light)})`;
}

/**
 * Model size within a lab, from data rather than names. Checked against the
 * labs' own tiers (Haiku < Sonnet < Opus < Fable, Luna < Terra < Sol < Astra)
 * on the AA release of Oct 1 2026, input list price agrees on 44 of 46 tier
 * pairs with no reversals; the two ties (GPT-5.6 Terra and GPT-6 Sol at $2)
 * fall to cost per output token, the next-best field. Output price (44/46,
 * two reversals), cost per task and intelligence rank worse.
 */
export function modelSize(model: {
	readonly inputPricePerMTok?: number | null;
	readonly points?: readonly {
		readonly costPerTaskUsd: number | null;
		readonly outputTokensPerTask: number | null;
	}[];
}) {
	const median = (values: readonly number[]) =>
		[...values].sort((first, second) => first - second)[
			Math.floor(values.length / 2)
		];
	const costs = (model.points ?? []).flatMap((point) =>
		point.costPerTaskUsd === null ? [] : [point.costPerTaskUsd],
	);
	const tokens = (model.points ?? []).flatMap((point) =>
		point.outputTokensPerTask === null ? [] : [point.outputTokensPerTask],
	);
	const cost = median(costs);
	const outputTokens = median(tokens);
	const costPerToken = cost && outputTokens ? cost / outputTokens : 0;
	return (model.inputPricePerMTok ?? 0) + costPerToken;
}

export interface ColoredModel {
	readonly id: string;
	readonly provider: TrendsProvider;
	readonly group: string;
	readonly releasedAt: string | null;
	/** Size proxy, larger is bigger; missing sizes sort as smallest. */
	readonly size?: number | null;
}

export function bySizeDescending(
	first: Pick<ColoredModel, "id" | "size" | "releasedAt">,
	second: Pick<ColoredModel, "id" | "size" | "releasedAt">,
) {
	return (
		(second.size ?? 0) - (first.size ?? 0) ||
		(second.releasedAt ?? "").localeCompare(first.releasedAt ?? "") ||
		first.id.localeCompare(second.id)
	);
}

function spread(
	index: number,
	count: number,
	range: { darkest: number; lightest: number },
) {
	return count <= 1
		? (range.darkest + range.lightest) / 2
		: range.darkest + ((range.lightest - range.darkest) * index) / (count - 1);
}

/** Lightness for a model outside In use, interpolated between in-use anchors in log price. */
function placeBetween(
	size: number,
	anchors: readonly { size: number; lightness: number }[],
) {
	const logSize = Math.log(Math.max(size, 1e-6));
	const first = anchors[0];
	const last = anchors.at(-1);
	if (!first || !last) return 0.56;
	if (logSize >= Math.log(first.size))
		return Math.max(OTHER_LIGHTNESS.darkest, first.lightness - 0.06);
	if (logSize <= Math.log(last.size))
		return Math.min(OTHER_LIGHTNESS.lightest, last.lightness + 0.06);
	for (let index = 0; index < anchors.length - 1; index++) {
		const bigger = anchors[index];
		const smaller = anchors[index + 1];
		if (!bigger || !smaller) continue;
		const high = Math.log(bigger.size);
		const low = Math.log(smaller.size);
		if (logSize <= high && logSize >= low) {
			const t = high === low ? 0.5 : (high - logSize) / (high - low);
			return bigger.lightness + (smaller.lightness - bigger.lightness) * t;
		}
	}
	return 0.56;
}

export function modelColors(models: readonly ColoredModel[]) {
	const byLab = new Map<TrendsProvider, ColoredModel[]>();
	for (const model of models)
		byLab.set(model.provider, [...(byLab.get(model.provider) ?? []), model]);
	const colors = new Map<string, string>();
	for (const [lab, labModels] of byLab) {
		const [hue, chroma] = LAB_HUES[lab];
		const ordered = [...labModels].sort(bySizeDescending);
		const inUse = ordered.filter((model) => model.group === "in_use");
		const anchors = inUse.map((model, index) => ({
			size: model.size ?? 0,
			lightness: spread(index, inUse.length, IN_USE_LIGHTNESS),
		}));
		inUse.forEach((model, index) => {
			colors.set(
				model.id,
				modelColor(anchors[index]?.lightness ?? 0.56, chroma, hue),
			);
		});
		const others = ordered.filter((model) => model.group !== "in_use");
		others.forEach((model, index) => {
			const lightness =
				model.size &&
				anchors.length > 0 &&
				anchors.every((anchor) => anchor.size > 0)
					? placeBetween(model.size, anchors)
					: spread(index, others.length, OTHER_LIGHTNESS);
			colors.set(
				model.id,
				modelColor(lightness, chroma * OTHER_CHROMA_SCALE, hue),
			);
		});
	}
	return colors;
}
