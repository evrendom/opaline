import { useLayoutEffect, useRef, useState } from "react";
import { useFluidHover } from "@/hooks/use-fluid-hover";
import { FluidHoverHighlight } from "./fluid-hover-highlight";
import "./fluid-menu-hover.css";

const DEFAULT_ITEMS =
	'[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], button:not([data-slot="button"]), [data-slot="button"][data-variant="secondary"], [data-fluid-menu-option], label[for]';
const ROOT = "[data-fluid-menu-root]";

/**
 * Decorative only: primitives retain ownership of focus, typeahead and clicks.
 *
 * `bridgeGap` keeps the highlight on the nearest item while the pointer
 * crosses a gap between items of up to that many pixels, so it glides from
 * row to row instead of fading out and back in. Lists with spaced-out rows
 * (the app sidebar) opt in; tight menus have no gaps to bridge.
 */
export function FluidMenuHover({
	items = DEFAULT_ITEMS,
	bridgeGap = 0,
	over = false,
	fillClassName,
}: {
	items?: string;
	bridgeGap?: number;
	over?: boolean;
	fillClassName?: string;
}) {
	const anchorRef = useRef<HTMLSpanElement>(null);
	const containerRef = useRef<HTMLElement | null>(null);
	const hover = useFluidHover(containerRef, { gapClick: false });
	const { registerItem, setActiveIndex, remeasure, sessionRef } = hover;
	const [appearance, setAppearance] = useState({
		radius: "6px",
		destructive: false,
	});

	useLayoutEffect(() => {
		const container = anchorRef.current?.parentElement;
		if (!container) return;
		containerRef.current = container;
		let registered: HTMLElement[] = [];
		let active: HTMLElement | undefined;
		const activate = (item: HTMLElement | undefined) => {
			if (item === active) return;
			active = item;
			setActiveIndex(item ? registered.indexOf(item) : null);
			if (item) {
				setAppearance({
					radius: getComputedStyle(item).borderRadius,
					destructive: item.dataset.variant === "destructive",
				});
			}
		};
		const resolve = (target: EventTarget | null) => {
			if (!(target instanceof Element)) return undefined;
			return registered.find(
				(item) => item.contains(target) && !isDisabled(item),
			);
		};
		// The enabled item nearest the pointer, if it is within `bridgeGap`.
		const nearest = (x: number, y: number) => {
			let closest: HTMLElement | undefined;
			let closestDistance = bridgeGap;
			for (const item of registered) {
				if (isDisabled(item)) continue;
				const rect = item.getBoundingClientRect();
				const distance = Math.hypot(
					Math.max(rect.left - x, 0, x - rect.right),
					Math.max(rect.top - y, 0, y - rect.bottom),
				);
				if (distance <= closestDistance) {
					closest = item;
					closestDistance = distance;
				}
			}
			return closest;
		};
		const sync = () => {
			const next = Array.from(
				container.querySelectorAll<HTMLElement>(items),
			).filter(
				(item) =>
					item.closest(ROOT) === container &&
					!item.parentElement?.closest("label[for]") &&
					!item.closest('[hidden], [aria-hidden="true"]'),
			);
			if (
				next.length !== registered.length ||
				next.some((item, i) => item !== registered[i])
			) {
				registered.forEach((item, i) => {
					item.removeAttribute("data-fluid-menu-item");
					registerItem(i, null);
				});
				registered = next;
				registered.forEach((item, i) => {
					item.setAttribute("data-fluid-menu-item", "");
					registerItem(i, item);
				});
				active = undefined;
				setActiveIndex(null);
			}
			if (active && isDisabled(active)) activate(undefined);
		};
		const onPointerOver = (event: PointerEvent) => {
			if (event.pointerType === "touch" || bridgeGap > 0) return;
			activate(resolve(event.target));
		};
		// With bridging, follow every move (once per frame): pointerover only
		// fires on entering an element, so it never notices the pointer
		// crossing a gap.
		let frame: number | null = null;
		const onPointerMove = (event: PointerEvent) => {
			if (event.pointerType === "touch") return;
			const { target, clientX, clientY } = event;
			if (frame !== null) cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				frame = null;
				activate(resolve(target) ?? nearest(clientX, clientY));
			});
		};
		const onEnter = () => {
			sessionRef.current += 1;
		};
		const onLeave = () => {
			if (frame !== null) cancelAnimationFrame(frame);
			frame = null;
			activate(undefined);
		};
		const onFocus = (event: FocusEvent) => activate(resolve(event.target));
		const onBlur = (event: FocusEvent) => {
			if (
				!(event.relatedTarget instanceof Node) ||
				!container.contains(event.relatedTarget)
			)
				activate(undefined);
		};
		sync();
		activate(resolve(document.activeElement));
		const observer = new MutationObserver((changes) => {
			sync();
			if (changes.some((change) => change.type === "childList")) remeasure();
			if (
				changes.some((change) => change.attributeName === "data-highlighted")
			) {
				activate(
					registered.find(
						(item) =>
							item.hasAttribute("data-highlighted") && !isDisabled(item),
					),
				);
			}
		});
		observer.observe(container, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: [
				"data-highlighted",
				"disabled",
				"data-disabled",
				"aria-disabled",
				"hidden",
			],
		});
		// Also refresh a force-mounted popup when its opening transition begins.
		container.addEventListener("animationstart", remeasure);
		container.addEventListener("pointerover", onPointerOver);
		if (bridgeGap > 0) container.addEventListener("pointermove", onPointerMove);
		container.addEventListener("pointerenter", onEnter);
		container.addEventListener("pointerleave", onLeave);
		container.addEventListener("focusin", onFocus);
		container.addEventListener("focusout", onBlur);
		return () => {
			observer.disconnect();
			container.removeEventListener("animationstart", remeasure);
			container.removeEventListener("pointerover", onPointerOver);
			container.removeEventListener("pointermove", onPointerMove);
			if (frame !== null) cancelAnimationFrame(frame);
			container.removeEventListener("pointerenter", onEnter);
			container.removeEventListener("pointerleave", onLeave);
			container.removeEventListener("focusin", onFocus);
			container.removeEventListener("focusout", onBlur);
			registered.forEach((item) => {
				item.removeAttribute("data-fluid-menu-item");
			});
		};
	}, [bridgeGap, items, registerItem, remeasure, sessionRef, setActiveIndex]);

	return (
		<>
			<span ref={anchorRef} hidden aria-hidden="true" />
			<div
				aria-hidden="true"
				className="fluid-menu-hover-layer"
				data-over={over || undefined}
				data-destructive={appearance.destructive || undefined}
				style={{ borderRadius: appearance.radius }}
			>
				<FluidHoverHighlight
					hover={hover}
					className={
						fillClassName
							? `fluid-menu-hover-fill ${fillClassName}`
							: "fluid-menu-hover-fill"
					}
				/>
			</div>
		</>
	);
}

function isDisabled(item: HTMLElement) {
	return (
		item.matches(':disabled, [data-disabled], [aria-disabled="true"]') ||
		Boolean(item.querySelector(':disabled, [aria-disabled="true"]'))
	);
}
