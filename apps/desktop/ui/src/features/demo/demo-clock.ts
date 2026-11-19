export const DEMO_NOW = Date.parse("2026-08-31T18:00:00.000Z");

let installed = false;

export function installDemoClock(now: number = DEMO_NOW): void {
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
