import { type ComponentType, useLayoutEffect, useRef } from "react";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { CardsGroup } from "./showcase/cards";
import { ControlsGroup } from "./showcase/controls";
import { FeedbackGroup } from "./showcase/feedback";
import { FoundationsGroup } from "./showcase/foundations";
import { HeaderGroup } from "./showcase/header";
import { ListsGroup } from "./showcase/lists";
import { OverlaysGroup, STAGES } from "./showcase/overlays";
import { ShowcaseProviders } from "./showcase/providers";
import { ReaderGroup } from "./showcase/reader";
import { SettingsGroup } from "./showcase/settings";
import { ShellGroup } from "./showcase/shell";
import { StageView } from "./showcase/stage";

/**
 * The system page (dev only, /dev/design-system): the components the app
 * really renders, imported from where the app imports them, in the variants
 * and states the app's reachable code uses, light above dark. Nothing here
 * is drawn for the page; a component the app stops using comes off it.
 * `?only=<group>` shows one group (foundations, controls, shell, header,
 * cards, lists, reader, settings, overlays, feedback); `?stage=<id>` is the
 * small document one open overlay renders in (see showcase/stage.tsx).
 */

const GROUPS: Array<[string, ComponentType]> = [
	["foundations", FoundationsGroup],
	["controls", ControlsGroup],
	["shell", ShellGroup],
	["header", HeaderGroup],
	["cards", CardsGroup],
	["lists", ListsGroup],
	["reader", ReaderGroup],
	["settings", SettingsGroup],
	["overlays", OverlaysGroup],
	["feedback", FeedbackGroup],
];

function Specimens({
	mode,
	only,
}: {
	mode: "light" | "dark";
	only: string | null;
}) {
	// Sizes its frame to its own height, so the parent page scrolls as one.
	const ref = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const node = ref.current;
		const frame = window.frameElement as HTMLIFrameElement | null;
		if (!node || !frame) return;
		const resize = () => {
			frame.style.height = `${node.scrollHeight}px`;
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	return (
		<ShowcaseProviders>
			<div
				ref={ref}
				className="dashboard-01-theme flex min-w-0 flex-col gap-[calc(var(--space-xxl)*4/3)] bg-canvas p-xxl font-body text-body-xl text-ink antialiased"
			>
				<h1 className="text-display-xs font-medium text-ink capitalize">
					{mode}
				</h1>
				{GROUPS.filter(([id]) => !only || id === only).map(([id, Group]) => (
					<Group key={id} />
				))}
			</div>
		</ShowcaseProviders>
	);
}

/** One mode in its own document: roles resolve on the root, so a nested
 *  `.dark` would only flip the few roles `.dark` redeclares. */
function ModeFrame({
	mode,
	only,
}: {
	mode: "light" | "dark";
	only: string | null;
}) {
	const params = new URLSearchParams({ mode });
	if (only) params.set("only", only);
	return (
		<iframe
			title={`Opaline system, ${mode}`}
			src={`/dev/design-system?${params}`}
			className="w-full min-w-0 border-0"
		/>
	);
}

export function DesignSystemPage() {
	const search = new URLSearchParams(window.location.search);
	const mode = search.get("mode");
	const only = search.get("only");
	const stage = STAGES[search.get("stage") ?? ""];
	const frameMode = mode === "light" || mode === "dark" ? mode : null;

	// Inside a frame, the root carries the frame's mode; restore it on leave.
	useLayoutEffect(() => {
		if (!frameMode) return;
		const root = document.documentElement;
		const wasDark = root.classList.contains("dark");
		root.classList.toggle("dark", frameMode === "dark");
		return () => {
			root.classList.toggle("dark", wasDark);
		};
	}, [frameMode]);

	if (frameMode && stage)
		return (
			<ThemeProvider pageTheme={frameMode}>
				<ShowcaseProviders>
					<StageView stage={stage} />
				</ShowcaseProviders>
			</ThemeProvider>
		);
	if (frameMode) return <Specimens mode={frameMode} only={only} />;
	// The app's components keep the widths they have on its screens, so the
	// two modes sit one above the other at the window's full width.
	return (
		<main className="flex min-h-screen flex-col bg-canvas">
			<ModeFrame mode="light" only={only} />
			<ModeFrame mode="dark" only={only} />
		</main>
	);
}
