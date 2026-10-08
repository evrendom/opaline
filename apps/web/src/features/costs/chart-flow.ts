// Data for the dashboard chart's loading state. The chart loads as itself:
// Recharts draws the heartbeat below as its series, then morphs it into the
// real data (area-morph.ts) when that lands.

// Normalized from the recorded annual cost profile: clustered daily peaks and
// quiet intervals, with the empty lead-in trimmed. Decorative geometry only;
// loading never waits for a data request or displays historical amounts.
// ChartLoadingWave units: x 10–990 of 1000, y down from 0 to the 56 height.
export const DASHBOARD_LOADING_LINE = [
	"M 10 48 L 15.1 47 L 20.3 46.4 L 25.4 47 L 30.5 48 L 40.8 48 L 45.9 45.7 L 51 44.2",
	"L 56.2 44.2 L 61.3 46.4 L 66.4 48 L 71.6 47.8 L 76.7 47.3 L 81.8 41.2 L 87 45.8 L 92.1 47.1",
	"L 97.2 47.9 L 102.4 46.1 L 107.5 48 L 112.6 44.5 L 117.7 48 L 122.9 40.5 L 128 41.5 L 133.1 46.5",
	"L 138.3 45.2 L 143.4 44.7 L 148.5 44.3 L 153.7 37.7 L 158.8 32.1 L 163.9 46.1 L 169.1 44.7 L 174.2 47.2",
	"L 179.3 48 L 184.5 47.9 L 189.6 45.1 L 194.7 48 L 199.8 47.1 L 205 44.4 L 210.1 43 L 215.2 43.8",
	"L 220.4 41.3 L 225.5 37.2 L 230.6 41.2 L 235.8 33.7 L 240.9 37.4 L 246 24.1 L 251.2 32.7 L 256.3 40.5",
	"L 261.4 9.5 L 266.5 32.9 L 271.7 44.4 L 276.8 47.6 L 281.9 31.2 L 287.1 27.4 L 292.2 28.9 L 297.3 41.6",
	"L 302.5 45.3 L 307.6 40.2 L 312.7 47.2 L 317.9 36.5 L 323 40.8 L 328.1 43 L 333.2 43 L 338.4 48",
	"L 343.5 47.9 L 348.6 47.8 L 353.8 47.1 L 358.9 47.9 L 364 47.3 L 369.2 48 L 374.3 47.9 L 379.4 47.4",
	"L 384.6 48 L 425.6 48 L 430.7 47.1 L 435.9 48 L 466.6 48 L 471.8 47.9 L 476.9 48 L 482 48",
	"L 487.2 47.9 L 492.3 48 L 507.7 48 L 512.8 47 L 518 48 L 697.5 48 L 702.7 39 L 707.8 42",
	"L 712.9 44.9 L 718.1 43.1 L 723.2 44.9 L 728.3 33.4 L 733.5 31.8 L 738.6 29 L 743.7 22.7 L 748.8 35.6",
	"L 754 38.1 L 759.1 35.2 L 764.2 34 L 769.4 31.2 L 774.5 39.9 L 779.6 28.1 L 784.8 48 L 789.9 47.2",
	"L 795 27.6 L 800.2 37.2 L 805.3 29 L 810.4 30.4 L 815.5 31 L 820.7 31.3 L 825.8 20.4 L 830.9 18.9",
	"L 836.1 24.5 L 841.2 16 L 846.3 6 L 851.5 15.2 L 856.6 37.9 L 861.7 48 L 866.9 30.4 L 872 8",
	"L 877.1 10.2 L 882.3 33 L 887.4 14.3 L 892.5 31.5 L 897.6 48 L 928.4 48 L 933.6 43.5 L 938.7 48",
	"L 954.1 48 L 959.2 39.8 L 964.3 14.9 L 969.5 10.1 L 974.6 35.7 L 979.7 19 L 984.9 39.2 L 990 48",
].join(" ");

/** The loading waves' viewBox height (chart and stat cards). */
export const LOADING_WAVE_HEIGHT = 56;
/** The heartbeat's value axis while loading: the wave's height, bottom up. */
export const HEARTBEAT_DOMAIN: [number, number] = [0, LOADING_WAVE_HEIGHT];
/** Where the heartbeat's fill closes (y=50 in wave units), as a value. */
export const HEARTBEAT_BASE_VALUE = LOADING_WAVE_HEIGHT - 50;

export type FlowRow = { x: number } & Record<string, number | null>;

/** Each series' value at row `index`, keyed for the chart's areas. */
export function seriesKey(index: number) {
	return `s${index}`;
}

// The heartbeat as [position 0–1, value] pairs.
const HEARTBEAT: readonly (readonly [number, number])[] = (() => {
	const numbers =
		DASHBOARD_LOADING_LINE.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
	const points: [number, number][] = [];
	for (let index = 0; index + 1 < numbers.length; index += 2) {
		const x = numbers[index] ?? 0;
		const y = numbers[index + 1] ?? 0;
		points.push([(x - 10) / 980, LOADING_WAVE_HEIGHT - y]);
	}
	return points;
})();

/** The heartbeat on its own vertices, x 0–1: the loading state's data. */
export const LOADING_ROWS: readonly FlowRow[] = HEARTBEAT.map(([x, value]) => ({
	x,
	[seriesKey(0)]: value,
}));
