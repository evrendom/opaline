// Mounts Graphical's editor in development only. No Graphical imports here:
// the loader exists only under Vite's compile-time development flag, so
// production builds leave the editor, its CSS and its imports out.
import { type ComponentType, type ReactNode, useEffect, useState } from "react";

export type GraphicalHostProps = {
	children: ReactNode;
	route: string;
	colorMode: "light" | "dark";
	onColorModeChange: (mode: "light" | "dark") => void;
};

const loadDevelopmentEditor = import.meta.env.DEV
	? () => import("./development-editor")
	: null;

export default function GraphicalEditorRoot(props: GraphicalHostProps) {
	const [Editor, setEditor] =
		useState<ComponentType<GraphicalHostProps> | null>(null);
	useEffect(() => {
		if (!loadDevelopmentEditor) return;
		let active = true;
		void loadDevelopmentEditor().then(
			({ default: editor }) => {
				if (active) setEditor(() => editor);
			},
			(error) => {
				if (active)
					console.error("Graphical shell unavailable; app retained.", error);
			},
		);
		return () => {
			active = false;
		};
	}, []);
	return Editor ? <Editor {...props} /> : props.children;
}
