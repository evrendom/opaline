/**
 * Quadrant wording for the scatter charts. The plot is split at the visual
 * middle of each axis; each quadrant is named by its two sides, joined with
 * "&": "Smart & cheap", "Weak & pricey".
 */
export interface QuadrantGuide {
	/** Corner where both axes are at their best. */
	readonly better: "top-left" | "bottom-left";
	/** Words for the better and worse end of each axis. */
	readonly vertical: readonly [better: string, worse: string];
	readonly horizontal: readonly [better: string, worse: string];
	/** What each axis measures, naming the rows ("By intelligence") and
	 * columns ("By cost") views. */
	readonly axes: { readonly vertical: string; readonly horizontal: string };
	/** Superlatives for the rows and columns views, best end first. */
	readonly ranks: {
		readonly vertical: readonly [best: string, worst: string];
		readonly horizontal: readonly [best: string, worst: string];
	};
}

export const QUADRANT_GUIDES: Readonly<Record<string, QuadrantGuide>> = {
	"cost-intelligence": {
		axes: { vertical: "intelligence", horizontal: "cost" },
		better: "top-left",
		vertical: ["Smart", "Weak"],
		horizontal: ["cheap", "pricey"],
		ranks: {
			vertical: ["Smartest", "Dumbest"],
			horizontal: ["Cheapest", "Priciest"],
		},
	},
	"time-intelligence": {
		axes: { vertical: "intelligence", horizontal: "time" },
		better: "top-left",
		vertical: ["Smart", "Weak"],
		horizontal: ["fast", "slow"],
		ranks: {
			vertical: ["Smartest", "Dumbest"],
			horizontal: ["Fastest", "Slowest"],
		},
	},
};
