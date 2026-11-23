/**
 * The Opaline mark at 48px, as the loading screens and the desktop handoff
 * show it. A CSS image resolves from the app's own origin, also in the plugin.
 */
export function OpalineMark48() {
	return (
		<span
			aria-hidden="true"
			// design-escape-ok(dark): artwork; the mark has a light and a dark drawing
			className="size-12 bg-[url(/favicon-light.svg)] bg-contain bg-center bg-no-repeat dark:bg-[url(/favicon-dark.svg)]"
		/>
	);
}
