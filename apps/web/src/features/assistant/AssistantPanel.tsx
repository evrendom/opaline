// The in-app assistant panel: a resizable chat panel that pushes the content
// window aside, opened with the A key.
//
// There is no assistant runtime yet. Messages stay in this component and every
// question gets a placeholder reply, so the layout can be tried in the real app.

import {
	IconArrowUp,
	IconPlus,
	IconSparkles,
	IconX,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import {
	type KeyboardEvent,
	type PointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/app/ui/button";
import { cn } from "@/lib/utils";

export const ASSISTANT_SHORTCUT = "a";

const SUGGESTIONS = [
	"Where do our agents get stuck most?",
	"Which repo costs the most this month?",
	"What changed in agent spend this week?",
];

const PLACEHOLDER_REPLY =
	"The assistant isn't connected yet. This panel previews where it will live; answers arrive once it's wired to your sessions.";

// Panel width when open. The content window (flex-1) gives up exactly this much
// room. Drag the panel's left edge to resize within the bounds.
const PANEL_WIDTH = 354;
const MIN_PANEL_WIDTH = 320;
const MAX_PANEL_WIDTH = 640;
// Past a bound the panel rubber-bands with diminishing returns, up to this far,
// then springs back on release.
const MAX_PANEL_STRETCH = 28;
const KEYBOARD_RESIZE_STEP_PX = 1;
const KEYBOARD_RESIZE_LARGE_STEP_PX = 10;
const PANEL_TRANSITION = { duration: 0.25, ease: [0.32, 0.72, 0, 1] } as const;

function rubberBand(excess: number) {
	const sign = Math.sign(excess);
	const distance = Math.abs(excess);
	return (
		sign *
		MAX_PANEL_STRETCH *
		(1 - Math.exp(-distance / (MAX_PANEL_STRETCH * 2)))
	);
}

function isEditableTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	return (
		target.closest(
			'input, textarea, select, [contenteditable="true"], [role="textbox"]',
		) !== null
	);
}

function AssistantMark({ className }: { className?: string }) {
	return (
		<IconSparkles
			aria-hidden="true"
			className={cn("text-blue-500", className)}
		/>
	);
}

/** Opens the assistant on its shortcut key while `enabled`. */
export function useAssistantShortcut(onOpen: () => void, enabled: boolean) {
	useEffect(() => {
		if (!enabled) return;
		function onKeyDown(event: globalThis.KeyboardEvent) {
			if (
				event.key.toLowerCase() !== ASSISTANT_SHORTCUT ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				event.shiftKey ||
				event.repeat ||
				event.defaultPrevented ||
				isEditableTarget(event.target)
			)
				return;
			event.preventDefault();
			onOpen();
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onOpen, enabled]);
}

type AssistantMessage = {
	id: string;
	role: "user" | "assistant";
	text: string;
};

export function AssistantPanel({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [input, setInput] = useState("");
	const [messages, setMessages] = useState<AssistantMessage[]>([]);
	const [scrolled, setScrolled] = useState(false);

	// Width follows the dragged left edge. While dragging, the width tween is
	// off so the panel tracks the pointer exactly.
	const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH);
	const [resizing, setResizing] = useState(false);
	// Rubber-band distance past a bound; only non-zero mid-drag.
	const [stretch, setStretch] = useState(0);
	const displayWidth = panelWidth + stretch;
	const transition = resizing ? { duration: 0 } : PANEL_TRANSITION;

	function startResize(event: PointerEvent<HTMLDivElement>) {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = panelWidth;
		setResizing(true);
		// The pointer leaves the thin handle at once, so pin the cursor (and stop
		// text selection) for the whole drag.
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		function onMove(moveEvent: globalThis.PointerEvent) {
			const raw = startWidth + (startX - moveEvent.clientX);
			const clamped = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, raw));
			setPanelWidth(clamped);
			setStretch(rubberBand(raw - clamped));
		}
		function onUp() {
			setResizing(false);
			setStretch(0);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		}
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}

	// The panel sits on the right, so ArrowLeft widens it.
	function resizeWithKeyboard(event: KeyboardEvent<HTMLHRElement>) {
		const step = event.shiftKey
			? KEYBOARD_RESIZE_LARGE_STEP_PX
			: KEYBOARD_RESIZE_STEP_PX;
		const nextWidth =
			event.key === "Home"
				? MIN_PANEL_WIDTH
				: event.key === "End"
					? MAX_PANEL_WIDTH
					: event.key === "ArrowLeft"
						? panelWidth + step
						: event.key === "ArrowRight"
							? panelWidth - step
							: undefined;
		if (nextWidth === undefined) return;
		event.preventDefault();
		setPanelWidth(
			Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, nextWidth)),
		);
	}

	const scrollRef = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the newest message whenever the list changes.
	useEffect(() => {
		scrollRef.current?.scrollTo({
			top: scrollRef.current.scrollHeight,
			behavior: "smooth",
		});
	}, [messages]);

	// Focus the composer once the 0.25s open animation is done; focusing earlier
	// scrolls the textarea into view and fights the transition. On close, drop
	// focus so the next keystroke (including the shortcut) reaches the page.
	const inputRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (!open) {
			inputRef.current?.blur();
			return;
		}
		const timeout = setTimeout(() => inputRef.current?.focus(), 260);
		return () => clearTimeout(timeout);
	}, [open]);

	// Escape closes the panel, even while the composer has focus.
	useEffect(() => {
		if (!open) return;
		function onKeyDown(event: globalThis.KeyboardEvent) {
			if (event.key !== "Escape") return;
			event.preventDefault();
			onOpenChange(false);
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, onOpenChange]);

	function send(text: string) {
		const trimmed = text.trim();
		if (!trimmed) return;
		setMessages((current) => [
			...current,
			{ id: crypto.randomUUID(), role: "user", text: trimmed },
			{ id: crypto.randomUUID(), role: "assistant", text: PLACEHOLDER_REPLY },
		]);
		setInput("");
	}

	function newChat() {
		setInput("");
		setScrolled(false);
		setMessages([]);
	}

	return (
		<motion.aside
			// Flat on the canvas to the right of the window; animating the width
			// makes the flex-1 window shrink and grow to make room.
			initial={false}
			animate={{ width: open ? displayWidth : 0 }}
			transition={transition}
			// No overflow-hidden: the resize handle hangs past this edge to cover
			// the canvas gap up to the window.
			className="relative hidden h-svh shrink-0 md:block"
			aria-label="Ask Opaline"
			aria-hidden={!open}
			inert={!open}
		>
			{open ? (
				<hr
					aria-label="Resize panel"
					aria-orientation="vertical"
					aria-valuemin={MIN_PANEL_WIDTH}
					aria-valuemax={MAX_PANEL_WIDTH}
					aria-valuenow={Math.round(panelWidth)}
					aria-valuetext={`${Math.round(panelWidth)} pixels`}
					tabIndex={0}
					title="Drag to resize. Use arrow keys for 1 px steps, Shift for 10 px, or double-click to reset."
					data-assistant-resize=""
					data-resizing={resizing || undefined}
					onPointerDown={startResize}
					onDoubleClick={() => setPanelWidth(PANEL_WIDTH)}
					onKeyDown={resizeWithKeyboard}
					className="absolute inset-y-0 -left-2 z-20 m-0 h-full w-4 cursor-col-resize border-0 bg-transparent outline-none"
				/>
			) : null}
			{/* Fixed-width inner so content doesn't reflow while the panel opens;
			    it only follows the rubber-band stretch. */}
			<motion.div
				className="flex h-full flex-col py-2 pr-2"
				initial={false}
				animate={{ width: displayWidth }}
				transition={transition}
			>
				<div className="flex items-center justify-between gap-2 px-2 pt-1 pb-2">
					<span className="flex items-center gap-2 pl-1 text-sm font-medium">
						<AssistantMark className="size-4" />
						Ask Opaline
					</span>
					<div className="flex items-center gap-1">
						<AnimatePresence initial={false}>
							{messages.length > 0 ? (
								<motion.div
									key="new-chat"
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									exit={{ opacity: 0 }}
									transition={{ duration: 0.15, ease: "easeOut" }}
								>
									<Button
										type="button"
										size="icon-sm"
										variant="ghost"
										onClick={newChat}
										aria-label="New chat"
										title="New chat"
									>
										<IconPlus className="size-4" />
									</Button>
								</motion.div>
							) : null}
						</AnimatePresence>
						<Button
							type="button"
							size="icon-sm"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							aria-label="Close"
						>
							<IconX className="size-4" />
						</Button>
					</div>
				</div>

				<div className="relative min-h-0 flex-1">
					<div
						aria-hidden="true"
						className={cn(
							"pointer-events-none absolute inset-x-0 top-0 z-10 h-12 bg-linear-to-b from-sidebar via-sidebar/50 to-transparent transition-opacity duration-200",
							scrolled ? "opacity-100" : "opacity-0",
						)}
					/>
					<div
						ref={scrollRef}
						onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 8)}
						className="h-full overflow-y-auto px-2 py-4"
					>
						<AnimatePresence mode="wait" initial={false}>
							{messages.length === 0 ? (
								<motion.div
									key="empty"
									className="flex h-full flex-col items-center justify-center gap-3 text-center"
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									exit={{ opacity: 0 }}
									transition={{ duration: 0.15, ease: "easeOut" }}
								>
									<span className="flex size-9 items-center justify-center rounded-md bg-blue-500/10 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.14),0_2px_6px_-2px_rgba(59,130,246,0.25)] squircle:rounded-2xl corner-squircle">
										<AssistantMark className="size-5" />
									</span>
									<span className="text-sm font-medium">Ask Opaline</span>
								</motion.div>
							) : (
								<motion.div
									key="messages"
									className="flex flex-col gap-6 pb-8"
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									exit={{ opacity: 0 }}
									transition={{ duration: 0.15, ease: "easeOut" }}
								>
									{messages.map((message) =>
										message.role === "user" ? (
											<div
												key={message.id}
												className="ml-auto w-fit max-w-[85%] rounded-lg bg-card px-3 py-2 text-sm shadow-(--custom-shadow) squircle:rounded-2xl corner-squircle"
											>
												{message.text}
											</div>
										) : (
											<p
												key={message.id}
												className="px-1 text-sm leading-relaxed text-muted-foreground"
											>
												{message.text}
											</p>
										),
									)}
								</motion.div>
							)}
						</AnimatePresence>
					</div>
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-sidebar via-sidebar/50 to-transparent"
					/>
				</div>

				<form
					onSubmit={(event) => {
						event.preventDefault();
						send(input);
					}}
					className="relative flex flex-col gap-2 p-1 pt-0"
				>
					<AnimatePresence>
						{messages.length === 0 ? (
							<motion.div
								key="suggestions"
								className="flex flex-col pl-2"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.15, ease: "easeOut" }}
							>
								{SUGGESTIONS.map((suggestion) => (
									<button
										key={suggestion}
										type="button"
										onClick={() => send(suggestion)}
										className="w-fit cursor-default rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground/60 hover:bg-sidebar-accent/70 hover:text-muted-foreground squircle:rounded-xl corner-squircle"
									>
										{suggestion}
									</button>
								))}
							</motion.div>
						) : null}
					</AnimatePresence>
					<textarea
						ref={inputRef}
						value={input}
						onChange={(event) => setInput(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								send(input);
							}
						}}
						rows={2}
						placeholder="Ask about your team's sessions…"
						aria-label="Message"
						className="max-h-32 min-h-20 flex-1 resize-none rounded-xl bg-white p-4 pr-12 text-sm shadow-(--custom-shadow) outline-none squircle:rounded-4xl corner-squircle"
					/>
					<Button
						type="submit"
						size="icon-xs"
						disabled={!input.trim()}
						aria-label="Send"
						className="absolute right-4 bottom-4 rounded-full"
					>
						<IconArrowUp className="size-4" />
					</Button>
				</form>
			</motion.div>
		</motion.aside>
	);
}
