/** The last day of the demo's data: today, in every visitor's own calendar. */
export const DEMO_TODAY = "2026-11-27";

/** When the demo's data ends. */
export const DEMO_NOW = Date.parse(`${DEMO_TODAY}T18:00:00.000Z`);

/** The latest local time the clock starts at, two hours before midnight. */
const LATEST_LOCAL_HOUR = 22;

/**
 * Where the demo's clock starts: DEMO_NOW, unless that is already past
 * 22:00 on DEMO_TODAY (or tomorrow) where the visitor is; then 22:00 their
 * time on DEMO_TODAY. Date presets ("Today", "Last 30 days", "This week" …)
 * count from the visitor's local date, so every visitor gets the same dates,
 * the ones the demo recorded, and has two hours before the day turns.
 */
export function demoClockStart(): number {
	const [year = 0, month = 1, day = 1] = DEMO_TODAY.split("-").map(Number);
	return Math.min(
		DEMO_NOW,
		new Date(year, month - 1, day, LATEST_LOCAL_HOUR).getTime(),
	);
}

let installed = false;

export function installDemoClock(now: number = demoClockStart()): void {
	if (installed) return;
	installed = true;
	const RealDate = Date;
	const offset = now - RealDate.now();
	const current = () => RealDate.now() + offset;
	const DemoDate = new Proxy(RealDate, {
		construct(target, args, newTarget) {
			return Reflect.construct(
				target,
				args.length > 0 ? args : [current()],
				newTarget,
			);
		},
		apply() {
			return new RealDate(current()).toString();
		},
		get(target, property, receiver) {
			if (property === "now") return current;
			return Reflect.get(target, property, receiver);
		},
	});
	Object.defineProperty(globalThis, "Date", {
		configurable: true,
		writable: true,
		value: DemoDate,
	});
}
