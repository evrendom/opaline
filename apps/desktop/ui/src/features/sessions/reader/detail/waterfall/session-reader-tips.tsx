import {
	type ComponentProps,
	cloneElement,
	createContext,
	type Dispatch,
	type ReactElement,
	type ReactNode,
	type Ref,
	type SetStateAction,
	useCallback,
	useContext,
	useRef,
	useState,
} from "react";
import { Tooltip, TooltipContent } from "@/app/ui/tooltip";

type Side = ComponentProps<typeof TooltipContent>["side"];
type TipEntry = { label: ReactNode; side?: Side };
type Labels = WeakMap<Element, TipEntry>;

const TipLayerContext = createContext<Labels | null>(null);

const WARM_MS = 300;

type Shown = { anchor: Element; entry: TipEntry; open: boolean };

function watchTips(
	labels: Labels,
	within: Element | null,
	delayRef: { current: number },
	setShown: Dispatch<SetStateAction<Shown | null>>,
) {
	let timer: number | undefined;
	let current: Element | null = null;
	let dismissed: Element | null = null;
	let open = false;
	let warmUntil = 0;
	// The element whose tip is open wears `data-popup-open`, as a Base UI
	// tooltip's trigger does, for what styles it (a menu's button lit).
	let marked: Element | null = null;
	const mark = (anchor: Element) => {
		if (anchor.hasAttribute("data-popup-open")) return;
		anchor.setAttribute("data-popup-open", "");
		marked = anchor;
	};
	const unmark = () => {
		if (marked && marked.getAttribute("aria-expanded") !== "true")
			marked.removeAttribute("data-popup-open");
		marked = null;
	};
	const onKey = (event: KeyboardEvent) => {
		if (event.key !== "Escape" || !open) return;
		const anchor = current;
		show(null);
		dismissed = anchor;
	};
	const tipAt = (target: EventTarget | null) => {
		for (
			let element = target instanceof Element ? target : null;
			element && (!within || within.contains(element));
			element = element.parentElement
		) {
			const entry = labels.get(element);
			if (entry) return { anchor: element, entry };
		}
		return null;
	};
	const show = (tip: { anchor: Element; entry: TipEntry } | null) => {
		if (tip?.anchor !== dismissed) dismissed = null;
		if (dismissed) return;
		if ((tip?.anchor ?? null) === current) return;
		window.clearTimeout(timer);
		unmark();
		current = tip?.anchor ?? null;
		if (!tip) {
			if (open) warmUntil = performance.now() + WARM_MS;
			open = false;
			document.removeEventListener("keydown", onKey);
			setShown((last) => (last ? { ...last, open: false } : null));
			return;
		}
		const reveal = () => {
			open = true;
			document.addEventListener("keydown", onKey);
			mark(tip.anchor);
			setShown({ ...tip, open: true });
		};
		if (open || performance.now() < warmUntil) reveal();
		else timer = window.setTimeout(reveal, delayRef.current);
	};
	return {
		over: (event: Pick<PointerEvent, "pointerType" | "target">) => {
			if (event.pointerType === "mouse") show(tipAt(event.target));
		},
		out: (event: Pick<PointerEvent, "pointerType" | "relatedTarget">) => {
			if (event.pointerType === "mouse") show(tipAt(event.relatedTarget));
		},
		hide: () => show(null),
		focus: (event: Pick<FocusEvent, "target">) => {
			const tip = tipAt(event.target);
			if (tip?.anchor.matches(":focus-visible")) show(tip);
		},
		stop: () => {
			window.clearTimeout(timer);
			document.removeEventListener("keydown", onKey);
			unmark();
		},
	};
}

export function TipLayer({
	children,
	delay = 600,
	portals = false,
}: {
	children: ReactNode;
	delay?: number;
	portals?: boolean;
}) {
	const [labels] = useState<Labels>(() => new WeakMap());
	const [shown, setShown] = useState<Shown | null>(null);
	const delayRef = useRef(delay);
	delayRef.current = delay;
	const watcherRef = useRef<ReturnType<typeof watchTips> | null>(null);

	const listen = useCallback(
		(wrapper: HTMLDivElement | null) => {
			if (!wrapper) return;
			const watcher = watchTips(
				labels,
				portals ? null : wrapper,
				delayRef,
				setShown,
			);
			watcherRef.current = watcher;
			if (portals)
				return () => {
					watcher.stop();
					watcherRef.current = null;
				};
			wrapper.addEventListener("pointerover", watcher.over);
			wrapper.addEventListener("pointerout", watcher.out);
			wrapper.addEventListener("pointerdown", watcher.hide);
			wrapper.addEventListener("focusin", watcher.focus);
			wrapper.addEventListener("focusout", watcher.hide);
			return () => {
				watcher.stop();
				watcherRef.current = null;
				wrapper.removeEventListener("pointerover", watcher.over);
				wrapper.removeEventListener("pointerout", watcher.out);
				wrapper.removeEventListener("pointerdown", watcher.hide);
				wrapper.removeEventListener("focusin", watcher.focus);
				wrapper.removeEventListener("focusout", watcher.hide);
			};
		},
		[labels, portals],
	);

	return (
		<TipLayerContext.Provider value={labels}>
			{portals ? (
				// biome-ignore lint/a11y/noStaticElementInteractions: listens only; the tips' own elements are the controls
				<div
					ref={listen}
					className="contents"
					onPointerOver={(event) => watcherRef.current?.over(event)}
					onPointerOut={(event) => watcherRef.current?.out(event)}
					onPointerDown={() => watcherRef.current?.hide()}
					onFocus={(event) => watcherRef.current?.focus(event)}
					onBlur={() => watcherRef.current?.hide()}
				>
					{children}
				</div>
			) : (
				<div ref={listen} className="contents">
					{children}
				</div>
			)}
			<Tooltip
				open={shown?.open ?? false}
				onOpenChange={(open) => {
					if (!open) setShown((last) => (last ? { ...last, open } : null));
				}}
			>
				{shown ? (
					<TooltipContent
						anchor={shown.anchor}
						side={shown.entry.side}
						style={{ pointerEvents: "none" }}
					>
						{shown.entry.label}
					</TooltipContent>
				) : null}
			</Tooltip>
		</TipLayerContext.Provider>
	);
}

export function useTipLayer(): Labels | null {
	return useContext(TipLayerContext);
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
	if (typeof ref === "function") ref(value);
	else if (ref) ref.current = value;
}

export function LayerTip({
	children,
	label,
	labels,
	side,
}: {
	children: ReactElement;
	label: ReactNode;
	labels: Labels;
	side?: Side;
}) {
	const childRef = (children.props as { ref?: Ref<Element> }).ref;
	return cloneElement(children as ReactElement<{ ref?: Ref<Element> }>, {
		ref: (element: Element | null) => {
			setRef(childRef, element);
			if (!element) return;
			labels.set(element, { label, side });
			return () => {
				labels.delete(element);
				setRef(childRef, null);
			};
		},
	});
}
