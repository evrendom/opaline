// Loaded only in development, by editor-root.tsx. The loader keeps the app
// rendering while the editor loads, and restores it if the editor fails.
import { GraphicalEditorLoader } from "@graphical/editor/loader";
import type { GraphicalHostProps } from "./editor-root";

const loadEditor = async () => ({
	GraphicalInstalledEditor: (await import("./installed-editor")).default,
});

export default function DevelopmentEditor(props: GraphicalHostProps) {
	return (
		<GraphicalEditorLoader<GraphicalHostProps>
			loadEditor={loadEditor}
			{...props}
		/>
	);
}
