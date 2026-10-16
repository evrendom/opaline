// Keep product preparation out of the landing page's load and first paint.
// An explicit Explore click can always start the app without waiting for idle.
// Any idle period will do: one is never longer than a frame while the landing
// page animates, so waiting for a long one never prepares at 120Hz.
export function scheduleProductDemoPreparation(prepare: () => void) {
	let cancelled = false;
	let prepared = false;
	let idle: number | undefined;
	let fallback: number | undefined;
	let paint: number | undefined;
	const scheduleIdle = () => {
		if (cancelled || prepared || document.hidden) return;
		if (typeof window.requestIdleCallback === "function") {
			idle = window.requestIdleCallback(() => {
				idle = undefined;
				if (cancelled || prepared || document.hidden) return;
				prepared = true;
				prepare();
			});
		} else {
			fallback = window.setTimeout(() => {
				if (!cancelled && !prepared && !document.hidden) {
					prepared = true;
					prepare();
				}
			}, 1_500);
		}
	};
	const afterLoad = () => {
		paint = requestAnimationFrame(() => {
			paint = requestAnimationFrame(scheduleIdle);
		});
	};
	const onVisible = () => {
		if (document.readyState === "complete" && !document.hidden) afterLoad();
	};
	if (document.readyState === "complete") afterLoad();
	else window.addEventListener("load", afterLoad, { once: true });
	document.addEventListener("visibilitychange", onVisible);
	return () => {
		cancelled = true;
		window.removeEventListener("load", afterLoad);
		document.removeEventListener("visibilitychange", onVisible);
		if (paint !== undefined) cancelAnimationFrame(paint);
		if (idle !== undefined) window.cancelIdleCallback(idle);
		if (fallback !== undefined) window.clearTimeout(fallback);
	};
}
