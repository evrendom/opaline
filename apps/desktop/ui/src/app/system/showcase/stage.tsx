import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/*
 * Overlays (menus, popovers, selects, dialogs, tooltips, toasts) portal to the
 * document and position against the viewport, so an open one can't sit in the
 * page's flow. Each one gets its own small document instead: a frame that
 * loads this page with `?stage=<id>`, renders the real component there and
 * opens it the way a person does (a press on its trigger, a hover).
 */

export type StageStep =
	| { press: string }
	| { hover: string }
	| { run: () => void };

export interface StageDefinition {
	render: () => ReactNode;
	/** What a person does to open it, in order. Selectors run in the stage. */
	steps?: StageStep[];
	/** Where the component sits in its stage. */
	align?: "start" | "end" | "center";
	/** The box the component sits in, when its screen gives it a width. */
	boxClassName?: string;
}

function press(element: Element) {
	const init = { bubbles: true, cancelable: true, button: 0, pointerId: 1 };
	element.dispatchEvent(
		new PointerEvent("pointerdown", { ...init, pointerType: "mouse" }),
	);
	element.dispatchEvent(new MouseEvent("mousedown", init));
	element.dispatchEvent(
		new PointerEvent("pointerup", { ...init, pointerType: "mouse" }),
	);
	element.dispatchEvent(new MouseEvent("mouseup", init));
	element.dispatchEvent(new MouseEvent("click", init));
}

function hover(element: Element) {
	const init = { bubbles: true, cancelable: true };
	for (const type of ["pointerover", "pointerenter", "pointermove"])
		element.dispatchEvent(
			new PointerEvent(type, { ...init, pointerType: "mouse" }),
		);
	for (const type of ["mouseover", "mouseenter", "mousemove"])
		element.dispatchEvent(new MouseEvent(type, init));
}

async function waitFor(selector: string) {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const element = document.querySelector(selector);
		if (element) return element;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return null;
}

/** The stage's own document: the component, opened by its steps. */
export function StageView({ stage }: { stage: StageDefinition }) {
	const ran = useRef(false);
	useEffect(() => {
		if (ran.current) return;
		ran.current = true;
		void (async () => {
			// Let the component settle (fonts, layout) before opening it.
			await new Promise((resolve) => setTimeout(resolve, 400));
			for (const step of stage.steps ?? []) {
				if ("run" in step) step.run();
				else {
					const element = await waitFor(
						"press" in step ? step.press : step.hover,
					);
					if (!element) continue;
					if ("press" in step) press(element);
					else hover(element);
				}
				await new Promise((resolve) => setTimeout(resolve, 350));
			}
		})();
	}, [stage]);
	return (
		<div
			className={cn(
				"dashboard-01-theme flex min-h-screen bg-canvas p-xl font-body text-body-xl text-ink antialiased",
				stage.align === "end"
					? "justify-end"
					: stage.align === "center"
						? "justify-center"
						: "justify-start",
			)}
		>
			<div className={cn("min-w-0", stage.boxClassName)}>{stage.render()}</div>
		</div>
	);
}

/** A stage in the page: a frame of the given size showing one overlay open. */
export function StageFrame({
	id,
	height,
	width = "100%",
	title,
}: {
	id: string;
	height: number;
	width?: number | "100%";
	title: string;
}) {
	const mode =
		new URLSearchParams(window.location.search).get("mode") === "dark"
			? "dark"
			: "light";
	return (
		<iframe
			title={title}
			src={`/dev/design-system?mode=${mode}&stage=${encodeURIComponent(id)}`}
			loading="lazy"
			className="max-w-full corner-s border-0 shadow-card"
			style={{ height, width }}
		/>
	);
}
