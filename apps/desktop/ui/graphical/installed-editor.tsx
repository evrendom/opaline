// Graphical's editor, loaded only in development (see editor-root.tsx).
import {
	GraphicalInstalledEditor,
	readGraphicalProject,
} from "@graphical/editor/native";
import "./editor-styles.css";
import type { GraphicalHostProps } from "./editor-root";
import project from "./project.json";
import roleMap from "./role-map.json";
import theme from "./themes/opaline.json";

// Read once, outside render. Keep the registry in step with project.json.
const current = readGraphicalProject(
	project,
	{ "themes/opaline.json": theme },
	roleMap,
);

export default function InstalledEditor({
	children,
	route,
	colorMode,
	onColorModeChange,
}: GraphicalHostProps) {
	return (
		<GraphicalInstalledEditor
			document={current.document}
			roleMap={current.roleMap}
			handoffContext={current.handoffContext}
			route={route}
			// Opaline's ThemeProvider owns light and dark.
			colorMode={colorMode}
			onColorModeChange={onColorModeChange}
			initialPanelOpen
		>
			{children}
		</GraphicalInstalledEditor>
	);
}
