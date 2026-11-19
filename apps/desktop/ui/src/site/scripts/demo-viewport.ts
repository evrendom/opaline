// The demo opens to fill the viewport below its bar. The landing page sends it
// that height, so the demo lays out at its open size from the start and its
// chart doesn't reflow while the window opens.
export const DEMO_VIEWPORT_MESSAGE = "opaline:demo-viewport";

export function readDemoViewportHeight(data: unknown): number | null {
	if (
		typeof data !== "object" ||
		data === null ||
		Reflect.get(data, "type") !== DEMO_VIEWPORT_MESSAGE
	)
		return null;
	const height = Reflect.get(data, "height");
	return typeof height === "number" && Number.isFinite(height) && height > 0
		? height
		: null;
}
