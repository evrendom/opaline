import { Agentation, type Annotation, loadAnnotations } from "agentation";
import { useRef } from "react";
import { toast } from "sonner";
import { useMountEffect } from "@/app/hooks/useMountEffect";
import { copyTextToClipboardWithResult } from "@/lib/clipboard";
import { describePlacement } from "./placement";

const PLACEMENTS_KEY = "email-lab-placements";

function readPlacements(): Record<string, string> {
	try {
		return JSON.parse(localStorage.getItem(PLACEMENTS_KEY) ?? "{}");
	} catch {
		return {};
	}
}

function writePlacements(placements: Record<string, string>) {
	localStorage.setItem(PLACEMENTS_KEY, JSON.stringify(placements));
}

/**
 * Agentation for the email lab. Each annotation also records where its
 * element sits in the email (`describePlacement`) and which variant, client
 * and theme were showing, and the copied feedback carries that as an
 * "In the email" line under each item's location.
 */
export function LabAgentation({ context }: { context: string }) {
	// The context when an annotation is added, not when this first rendered.
	const contextRef = useRef(context);
	contextRef.current = context;
	// The element under the last click inside the email: Agentation annotates
	// the element it was opened on, and this capture listener runs first.
	const lastTarget = useRef<Element | null>(null);
	useMountEffect(() => {
		const remember = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Element && target.closest(".email-lab-body"))
				lastTarget.current = target;
		};
		window.addEventListener("pointerdown", remember, { capture: true });
		return () =>
			window.removeEventListener("pointerdown", remember, { capture: true });
	});

	function onAdd(annotation: Annotation) {
		const element = lastTarget.current;
		if (!element) return;
		writePlacements({
			...readPlacements(),
			[annotation.id]: `${contextRef.current} › ${describePlacement(element)}`,
		});
	}

	function onDelete(annotation: Annotation) {
		const placements = readPlacements();
		delete placements[annotation.id];
		writePlacements(placements);
	}

	async function onCopy(markdown: string) {
		const placements = readPlacements();
		const annotations = loadAnnotations(window.location.pathname);
		// Agentation prints the annotations in their stored order as "### N.".
		const enriched = markdown.replace(
			/^(### (\d+)\. .*\n(?:\*\*Location:\*\*.*\n)?)/gmu,
			(block, _whole, number: string) => {
				const annotation = annotations[Number(number) - 1];
				const placement = annotation && placements[annotation.id];
				return placement ? `${block}**In the email:** ${placement}\n` : block;
			},
		);
		const result = await copyTextToClipboardWithResult(enriched, {
			preferSelectionCopy: true,
			allowPromptFallback: true,
			promptMessage: "Copy Agentation feedback: Cmd/Ctrl+C, Enter",
		});
		if (result === "failed")
			toast.error(
				"Agentation could not copy feedback. Check clipboard permission and use localhost or HTTPS.",
			);
	}

	return (
		<Agentation
			copyToClipboard={false}
			onAnnotationAdd={onAdd}
			onAnnotationDelete={onDelete}
			onAnnotationsClear={() => writePlacements({})}
			onCopy={(markdown) => void onCopy(markdown)}
		/>
	);
}
