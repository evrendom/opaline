import {
	type MouseEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { flushSync } from "react-dom";

export interface PickerQuestion {
	readonly id: string;
	/** The words the title reads, before its own switches. */
	readonly lead: ReactNode;
	/** The whole question, as the menu lists it. */
	readonly question: string;
}

/**
 * A title's whole sentence as a picker: a light box, concentric with the
 * switches inside it, holding the question's leading words, the title's
 * own switches and a chevron. A click anywhere in it but on a switch or a
 * link opens a menu, as wide as the box, of the other questions the chart
 * can answer; picking one switches the chart through a view transition, so
 * the new chart fades in rather than cutting.
 */
export function QuestionPicker({
	questions,
	selected,
	onSelect,
	children,
}: {
	readonly questions: readonly PickerQuestion[];
	readonly selected: string;
	readonly onSelect: (id: string) => void;
	/** The rest of the sentence, its switches included. */
	readonly children?: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLSpanElement>(null);
	const id = useId();
	const current = questions.find((question) => question.id === selected);
	useEffect(() => {
		if (!open) return;
		const close = (event: PointerEvent) => {
			if (!ref.current?.contains(event.target as Node)) setOpen(false);
		};
		const onEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", close);
		document.addEventListener("keydown", onEscape);
		return () => {
			document.removeEventListener("pointerdown", close);
			document.removeEventListener("keydown", onEscape);
		};
	}, [open]);
	// The new chart fades in over the old, where the browser can (and the
	// reader has not asked for less motion).
	const pick = (questionId: string) => {
		const reduce = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if (!document.startViewTransition || reduce) {
			onSelect(questionId);
			return;
		}
		document.startViewTransition(() => {
			flushSync(() => onSelect(questionId));
		});
	};
	// The box opens the menu, except where a switch or link takes the click.
	const onBoxClick = (event: MouseEvent<HTMLSpanElement>) => {
		const target = event.target as HTMLElement;
		if (target.closest(".trends-segmented, a, .trends-question-chevron"))
			return;
		setOpen(!open);
	};
	return (
		<span className="trends-question" ref={ref}>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: the chevron button is the keyboard path; the box only widens its target. */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: as above. */}
			<span
				className="trends-question-box"
				data-open={open}
				onClick={onBoxClick}
			>
				{/* A question may open on its own switch, with no words before it. */}
				{current?.lead ? (
					<span className="trends-question-lead">{current.lead}</span>
				) : null}
				{children}
				<button
					type="button"
					className="trends-tool trends-question-chevron"
					data-icon-only="true"
					aria-label="Pick the question"
					aria-haspopup="menu"
					aria-expanded={open}
					aria-controls={`${id}-menu`}
					onClick={() => setOpen(!open)}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M4.5 6.5 8 10l3.5-3.5" />
					</svg>
				</button>
			</span>
			<span
				id={`${id}-menu`}
				className="trends-question-menu"
				role="menu"
				data-open={open}
				inert={!open}
			>
				{questions
					.filter((question) => question.id !== selected)
					.map((question) => (
						<button
							key={question.id}
							type="button"
							role="menuitem"
							className="trends-question-item"
							onClick={() => {
								// Shut before the old view is captured, so the menu
								// is not part of the fade.
								flushSync(() => setOpen(false));
								pick(question.id);
							}}
						>
							<span className="trends-question-text">{question.question}</span>
						</button>
					))}
			</span>
		</span>
	);
}
