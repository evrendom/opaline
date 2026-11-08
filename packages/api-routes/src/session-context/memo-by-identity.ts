export function memoByIdentity<Args extends unknown[], Result>(
	build: (...args: Args) => Result,
): (...args: Args) => Result {
	type Level = { weak: WeakMap<object, Level>; strong: Map<unknown, Level> };
	const level = (): Level => ({ weak: new WeakMap(), strong: new Map() });
	const root = level();
	const results = new WeakMap<Level, { result: Result }>();
	return (...args) => {
		let at = root;
		for (const arg of args) {
			const byIdentity = typeof arg === "object" && arg !== null;
			const next = byIdentity ? at.weak.get(arg as object) : at.strong.get(arg);
			if (next) {
				at = next;
				continue;
			}
			const created = level();
			if (byIdentity) at.weak.set(arg as object, created);
			else at.strong.set(arg, created);
			at = created;
		}
		const held = results.get(at);
		if (held) return held.result;
		const result = build(...args);
		results.set(at, { result });
		return result;
	};
}
