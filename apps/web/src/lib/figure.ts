import type { Format } from "@number-flow/react";

export const FIGURE_LOCALE = "en-US";

export const PLAIN_NUMBER: Format = { useGrouping: false };

export const DISPLAY_LOCALE =
	import.meta.env.MODE === "product-demo" ? "en-US" : undefined;

export type FigureNumber = {
	value: number;
	format: Format;
	prefix?: string;
	suffix?: string;
	visitorLocale?: boolean;
};

export type Figure = readonly (string | FigureNumber)[];

export const figureLocale = (part: Pick<FigureNumber, "visitorLocale">) =>
	part.visitorLocale ? DISPLAY_LOCALE : FIGURE_LOCALE;

export function figureText(figure: Figure) {
	return figure
		.map((part) =>
			typeof part === "string"
				? part
				: `${part.prefix ?? ""}${new Intl.NumberFormat(figureLocale(part), part.format).format(part.value)}${part.suffix ?? ""}`,
		)
		.join("");
}

export function textFigure(text: string): Figure {
	return text
		.split(/(\d+)/)
		.filter(Boolean)
		.map((part) =>
			/^\d+$/.test(part)
				? {
						value: Number(part),
						format: { useGrouping: false, minimumIntegerDigits: part.length },
					}
				: part,
		);
}
